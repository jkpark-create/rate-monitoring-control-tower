import argparse
import importlib.util
import json
import os
import re
import subprocess
import sys
from datetime import datetime
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
DEFAULT_SOURCE_DIR = ROOT.parent / "organizing rate file"
OUTPUT_FILE = ROOT / "scripts" / "guideline_sea_etc.json"
COMPOSITE_DESTINATIONS = {"MIP+MNL": ("MIP", "MNL")}
CONCATENATED_POL_ALIASES = {"SAJED": ("JED",), "EGSKN": ("SKN",), "JOAQJ": ("AQJ",)}


def source_dir():
    return Path(os.environ.get("ORGANIZING_RATE_DIR", DEFAULT_SOURCE_DIR)).resolve()


def load_parser(source):
    parser_path = source / "parse_rates.py"
    if not parser_path.exists():
        raise FileNotFoundError(f"Missing organizing rate parser: {parser_path}")
    spec = importlib.util.spec_from_file_location("organizing_rate_parser", parser_path)
    if spec is None or spec.loader is None:
        raise RuntimeError(f"Could not load organizing rate parser: {parser_path}")
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def origin_ports(pol):
    normalized = str(pol or "").strip().upper()
    if normalized in CONCATENATED_POL_ALIASES:
        return CONCATENATED_POL_ALIASES[normalized]
    return tuple(dict.fromkeys(re.findall(r"\b[A-Z]{3,4}\b", normalized)))


def destination_ports(pod_port):
    normalized = str(pod_port or "").strip().upper()
    if normalized in COMPOSITE_DESTINATIONS:
        return COMPOSITE_DESTINATIONS[normalized]
    return (normalized,) if re.fullmatch(r"[A-Z]{2,4}", normalized) else ()


def update_latest(latest, origin, destination, size, amount, row):
    if amount is None:
        return
    key = (origin, destination, size)
    current = latest.get(key)
    candidate = (str(row.get("date", "")), str(row.get("week", "")), float(amount), row)
    if current is None or candidate[:2] >= current[:2]:
        latest[key] = candidate


def build_routes(rates):
    latest = {}
    for row in rates:
        for origin in origin_ports(row.get("pol")):
            for destination in destination_ports(row.get("pod_port")):
                update_latest(latest, origin, destination, "20", row.get("r20"), row)
                update_latest(latest, origin, destination, "40", row.get("r40"), row)

    # The TH sheet defines LKB as LCH plus fixed inland additions.
    for (origin, destination, size), candidate in list(latest.items()):
        if origin != "LCH":
            continue
        date_text, week, amount, row = candidate
        addition = 100.0 if size == "20" else 150.0
        derived = dict(row)
        derived["pol"] = "TH LKB"
        derived["remark"] = f"LCH rate + ${int(addition)}"
        latest[("LKB", destination, size)] = (date_text, week, amount + addition, derived)

    routes = {}
    for (origin, destination, size), (date_text, week, amount, row) in sorted(latest.items()):
        route = routes.setdefault(
            f"{origin}|{destination}",
            {
                "sheet": str(row.get("pol", "")),
                "remark": str(row.get("remark", "")),
            },
        )
        route[size] = amount
        route[f"{size}Week"] = week
        route[f"{size}Date"] = date_text
    return routes


def refresh_source(source):
    updater = source / "update_rates.py"
    if not updater.exists():
        raise FileNotFoundError(f"Missing organizing rate updater: {updater}")
    subprocess.run([sys.executable, str(updater), "--dry-run"], cwd=source, check=True)


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--refresh", action="store_true", help="Download the latest source workbooks before syncing")
    args = parser.parse_args()

    source = source_dir()
    if args.refresh:
        refresh_source(source)

    organizing_parser = load_parser(source)
    rates = organizing_parser.clean_rates(organizing_parser.parse_file1())
    routes = build_routes(rates)
    payload = {
        "basis": "Latest visible SEA/ETC KMTC Working rate by route and container size",
        "generatedAt": datetime.now().isoformat(timespec="seconds"),
        "routes": routes,
        "source": str(source / "[SEA] Market Rate.xlsx"),
    }
    OUTPUT_FILE.write_text(json.dumps(payload, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    print(f"Wrote {OUTPUT_FILE}")
    print(f"SEA / ETC routes: {len(routes):,}")


if __name__ == "__main__":
    main()
