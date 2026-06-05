import argparse
import csv
import json
import os
import shutil
import subprocess
import sys
import time
from datetime import datetime
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
SQL_FILE = ROOT / "scripts" / "extract-rate-base.sql"
BASIC_TARIFF_SQL_FILE = ROOT / "scripts" / "extract-basic-tariff.sql"
RATE_ROUTE_SQL_FILE = ROOT / "scripts" / "extract-rate-route.sql"
CANONICAL_RATE_FILE = ROOT / "data" / "rate-base-latest.csv"
CANONICAL_BASIC_TARIFF_FILE = ROOT / "data" / "basic-tariff-latest.csv"
CANONICAL_RATE_ROUTE_FILE = ROOT / "data" / "rate-route-latest.csv"
PUBLIC_DATA_FILE = ROOT / "public" / "data" / "weekly-monitoring.json"
DIST_DATA_FILE = ROOT / "dist" / "data" / "weekly-monitoring.json"
REQUIRED_ORACLE_COLUMNS = {"RATE_ROW_TYPE", "CHARGE_DETAIL_LIST"}
REFERENCE_EXTRACTS = (
    (
        BASIC_TARIFF_SQL_FILE,
        CANONICAL_BASIC_TARIFF_FILE,
        {"FRT_CD", "POL_PLC_TYP_CD", "POL_PLC_NM", "POD_PLC_TYP_CD", "POD_PLC_NM", "RATE"},
    ),
    (
        RATE_ROUTE_SQL_FILE,
        CANONICAL_RATE_ROUTE_FILE,
        {"FRT_APP_NO", "POL_CTR_CD", "POL_PORT_CD", "POD_CTR_CD", "POD_PORT_CD"},
    ),
)
DEFAULT_DBEAVER_DATA_SOURCES = (
    Path(os.environ.get("APPDATA", Path.home() / "AppData" / "Roaming"))
    / "DBeaverData"
    / "workspace6"
    / "General"
    / ".dbeaver"
    / "data-sources.json"
)


def log(message):
    timestamp = datetime.now().isoformat(timespec="seconds")
    print(f"[{timestamp}] {message}", flush=True)


def display_path(path):
    try:
        return path.relative_to(ROOT)
    except ValueError:
        return path


def load_env_file(path):
    if not path.exists():
        return
    for line in path.read_text(encoding="utf-8").splitlines():
        stripped = line.strip()
        if not stripped or stripped.startswith("#") or "=" not in stripped:
            continue
        key, value = stripped.split("=", 1)
        key = key.strip()
        value = value.strip().strip("\"'")
        if key and key not in os.environ:
            os.environ[key] = value


def run(command, env=None):
    log(f"Running: {' '.join(str(part) for part in command)}")
    subprocess.run(command, cwd=ROOT, env=env, check=True)


def sql_text(sql_file=SQL_FILE):
    statement = sql_file.read_text(encoding="utf-8").strip()
    return statement[:-1] if statement.endswith(";") else statement


def csv_value(value):
    if hasattr(value, "read"):
        return value.read()
    return value


def replace_file(source, target):
    for attempt in range(5):
        try:
            source.replace(target)
            return
        except PermissionError:
            if attempt == 4:
                break
            time.sleep(0.5)
    shutil.copyfile(source, target)
    source.unlink(missing_ok=True)


def oracle_dsn_from_jdbc_url(url):
    prefix = "jdbc:oracle:thin:@"
    if not url or not url.lower().startswith(prefix):
        return None
    return url[len(prefix) :].strip()


def apply_dbeaver_connection(connection_name, data_sources_file=None):
    path = Path(data_sources_file).expanduser() if data_sources_file else DEFAULT_DBEAVER_DATA_SOURCES
    if not path.is_absolute():
        path = (ROOT / path).resolve()
    if not path.exists():
        raise FileNotFoundError(f"DBeaver data-sources file does not exist: {path}")

    data = json.loads(path.read_text(encoding="utf-8"))
    connections = data.get("connections", {})
    matches = [
        (connection_id, connection)
        for connection_id, connection in connections.items()
        if connection_id.casefold() == connection_name.casefold()
        or str(connection.get("name", "")).casefold() == connection_name.casefold()
    ]
    if not matches:
        available = ", ".join(
            sorted(connection.get("name", connection_id) for connection_id, connection in connections.items())
        )
        raise RuntimeError(
            f"DBeaver connection '{connection_name}' was not found. Available connections: {available or '(none)'}"
        )

    connection_id, connection = matches[0]
    if connection.get("provider") != "oracle":
        raise RuntimeError(f"DBeaver connection '{connection_name}' is not an Oracle connection")

    configuration = connection.get("configuration") or {}
    dsn = oracle_dsn_from_jdbc_url(configuration.get("url"))
    if not dsn:
        host = configuration.get("host")
        port = configuration.get("port")
        database = configuration.get("database")
        if host and port and database:
            dsn = f"{host}:{port}/{database}"
    if not dsn:
        raise RuntimeError(f"DBeaver connection '{connection_name}' does not contain a usable Oracle DSN")

    if not os.environ.get("RATE_DB_DSN"):
        os.environ["RATE_DB_DSN"] = dsn
    if configuration.get("user") and not os.environ.get("RATE_DB_USER"):
        os.environ["RATE_DB_USER"] = configuration["user"]
    log(f"Loaded Oracle DSN metadata from DBeaver connection '{connection.get('name', connection_id)}'")


def extract_from_oracle(output_file, fetch_size, sql_file=SQL_FILE, required_columns=REQUIRED_ORACLE_COLUMNS):
    try:
        import oracledb
    except ModuleNotFoundError as exc:
        raise RuntimeError(
            "Missing python-oracledb. Install it with: python -m pip install -r requirements-oracle.txt"
        ) from exc

    required = ("RATE_DB_USER", "RATE_DB_PASSWORD", "RATE_DB_DSN")
    missing = [name for name in required if not os.environ.get(name)]
    if missing:
        raise RuntimeError(f"Missing Oracle environment variables: {', '.join(missing)}")

    output_file.parent.mkdir(parents=True, exist_ok=True)
    temporary_file = output_file.with_suffix(".csv.tmp")
    if temporary_file.exists():
        temporary_file.unlink()

    log(f"Extracting {display_path(sql_file)} to {display_path(output_file)}")
    connection = oracledb.connect(
        user=os.environ["RATE_DB_USER"],
        password=os.environ["RATE_DB_PASSWORD"],
        dsn=os.environ["RATE_DB_DSN"],
    )
    try:
        cursor = connection.cursor()
        cursor.arraysize = fetch_size
        cursor.prefetchrows = fetch_size
        cursor.execute(sql_text(sql_file))
        columns = [column[0] for column in cursor.description]
        missing_columns = sorted(required_columns - set(columns))
        if missing_columns:
            raise RuntimeError(f"Oracle extraction is missing required columns: {', '.join(missing_columns)}")
        row_count = 0
        with temporary_file.open("w", encoding="utf-8-sig", newline="") as output:
            writer = csv.writer(output)
            writer.writerow(columns)
            while True:
                rows = cursor.fetchmany()
                if not rows:
                    break
                writer.writerows(tuple(csv_value(value) for value in row) for row in rows)
                row_count += len(rows)
                if row_count % 100000 < len(rows):
                    log(f"Extracted {row_count:,} rows")
        replace_file(temporary_file, output_file)
        log(f"Oracle extraction complete: {row_count:,} rows")
    finally:
        connection.close()


def publish_dist_data():
    if not (ROOT / "dist").exists():
        return
    DIST_DATA_FILE.parent.mkdir(parents=True, exist_ok=True)
    temporary_file = DIST_DATA_FILE.with_suffix(".json.tmp")
    shutil.copyfile(PUBLIC_DATA_FILE, temporary_file)
    replace_file(temporary_file, DIST_DATA_FILE)
    log(f"Published live JSON cache to {DIST_DATA_FILE.relative_to(ROOT)}")


def refresh(args):
    source_file = Path(args.rate_file).expanduser().resolve() if args.rate_file else CANONICAL_RATE_FILE
    if args.oracle:
        extract_from_oracle(source_file, args.fetch_size)
        for sql_file, output_file, required_columns in REFERENCE_EXTRACTS:
            extract_from_oracle(output_file, args.fetch_size, sql_file, required_columns)
    elif args.rate_file and not source_file.exists():
        raise FileNotFoundError(f"Rate-base CSV does not exist: {source_file}")

    if not args.skip_guideline:
        command = [sys.executable, str(ROOT / "scripts" / "sync-sea-guideline.py")]
        if args.refresh_guideline:
            command.append("--refresh")
        run(command)

    build_env = os.environ.copy()
    if source_file.exists():
        build_env["RATE_BASE_CSV"] = str(source_file)
    run([sys.executable, str(ROOT / "scripts" / "build-weekly-data.py")], env=build_env)

    if args.build:
        npm = "npm.cmd" if os.name == "nt" else "npm"
        run([npm, "run", "build"])
    else:
        publish_dist_data()


def parse_args():
    parser = argparse.ArgumentParser(
        description="Refresh rate-monitoring CSV, JSON cache, and optional static build."
    )
    parser.add_argument("--oracle", action="store_true", help="Extract a fresh CSV from Oracle before rebuilding JSON")
    parser.add_argument("--rate-file", help="Use this CSV path; with --oracle this is the extraction target")
    parser.add_argument("--env-file", default=".env.local", help="Optional environment file relative to the project root")
    parser.add_argument(
        "--dbeaver-connection",
        help="Load a saved Oracle DSN from this DBeaver connection name or ID without reading saved credentials",
    )
    parser.add_argument(
        "--dbeaver-data-sources",
        help="Optional DBeaver data-sources.json path; defaults to the current user's workspace6 General project",
    )
    parser.add_argument("--fetch-size", type=int, default=5000, help="Oracle fetch batch size")
    parser.add_argument("--skip-guideline", action="store_true", help="Skip SEA/ETC guideline synchronization")
    parser.add_argument("--refresh-guideline", action="store_true", help="Download SEA/ETC source files before syncing")
    parser.add_argument("--build", action="store_true", help="Run the Vite build after data refresh")
    parser.add_argument("--watch-seconds", type=int, default=0, help="Repeat refresh at this interval; 0 runs once")
    return parser.parse_args()


def main():
    args = parse_args()
    env_file = Path(args.env_file)
    if not env_file.is_absolute():
        env_file = ROOT / env_file
    load_env_file(env_file)

    if args.oracle:
        dbeaver_connection = args.dbeaver_connection or os.environ.get("RATE_DBEAVER_CONNECTION")
        dbeaver_data_sources = args.dbeaver_data_sources or os.environ.get("RATE_DBEAVER_DATA_SOURCES")
        if dbeaver_connection:
            apply_dbeaver_connection(dbeaver_connection, dbeaver_data_sources)

    if args.watch_seconds < 0:
        raise ValueError("--watch-seconds must be 0 or greater")

    if not args.watch_seconds:
        refresh(args)
        return

    log(f"Starting refresh loop every {args.watch_seconds} seconds")
    while True:
        started = time.monotonic()
        try:
            refresh(args)
        except Exception as exc:
            log(f"Refresh failed: {exc}")
        elapsed = time.monotonic() - started
        time.sleep(max(1, args.watch_seconds - elapsed))


if __name__ == "__main__":
    main()
