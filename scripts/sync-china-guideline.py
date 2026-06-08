import argparse
import importlib.util
import json
import math
import re
import subprocess
import sys
from datetime import datetime
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
DEFAULT_SOURCE_DIR = ROOT.parent / "organizing rate file"
OUTPUT_FILE = ROOT / "scripts" / "guideline_china_hk.json"
COMPOSITE_DESTINATIONS = {"MIP+MNL": ("MIP", "MNL")}


def source_dir():
    return Path(DEFAULT_SOURCE_DIR).resolve()


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


def normalize_code(value):
    return "".join(ch for ch in str(value or "").upper().strip() if ch.isalnum())


def destination_ports(pod_port):
    normalized = normalize_code(pod_port)
    if normalized in COMPOSITE_DESTINATIONS:
        return COMPOSITE_DESTINATIONS[normalized]
    return (normalized,) if re.fullmatch(r"[A-Z0-9]{2,5}", normalized) else ()


def filter_cd_only(rates):
    cd_routes = {
        (row.get("src"), row.get("pol"), row.get("pod_port"))
        for row in rates
        if row.get("tier") == "CD"
    }
    return [
        row
        for row in rates
        if not (row.get("tier") == "AB" and (row.get("src"), row.get("pol"), row.get("pod_port")) in cd_routes)
    ]


def latest_bucket(buckets, origin, destination, size, amount, row):
    if amount is None:
        return
    key = (origin, destination, size)
    candidate_period = (str(row.get("date", "")), str(row.get("week", "")))
    bucket = buckets.get(key)
    if bucket is None or candidate_period > bucket["period"]:
        buckets[key] = {
            "period": candidate_period,
            "amounts": [float(amount)],
            "rows": [row],
        }
        return
    if candidate_period == bucket["period"]:
        bucket["amounts"].append(float(amount))
        bucket["rows"].append(row)


def dashboard_round(value):
    return float(math.floor(value + 0.5))


def build_routes(rates):
    buckets = {}
    for row in filter_cd_only(rates):
        if row.get("src") != "CN_HK":
            continue
        origin = normalize_code(row.get("pol"))
        if not origin:
            continue
        for destination in destination_ports(row.get("pod_port")):
            latest_bucket(buckets, origin, destination, "20", row.get("r20"), row)
            latest_bucket(buckets, origin, destination, "40", row.get("r40"), row)

    routes = {}
    for (origin, destination, size), bucket in sorted(buckets.items()):
        rows = bucket["rows"]
        representative = rows[0]
        average = sum(bucket["amounts"]) / len(bucket["amounts"])
        amount = dashboard_round(average)
        route = routes.setdefault(
            f"{origin}|{destination}",
            {
                "sheet": origin,
                "tier": str(representative.get("tier", "")),
                "remark": str(representative.get("remark", "")),
            },
        )
        route[size] = amount
        route[f"{size}Week"] = bucket["period"][1]
        route[f"{size}Date"] = bucket["period"][0]
        route[f"{size}Samples"] = len(bucket["amounts"])
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
    rates = organizing_parser.clean_rates(organizing_parser.parse_file2())
    routes = build_routes(rates)
    payload = {
        "basis": "Latest visible CN/HK Market Rate CD tier by route and container size",
        "generatedAt": datetime.now().isoformat(timespec="seconds"),
        "routes": routes,
        "originAliases": {
            "SHK": "SZP",
            "YTN": "SZP",
            "NNS": "CAN",
        },
        "source": str(source / "[CN_HK] Market Rate.xlsx"),
    }
    OUTPUT_FILE.write_text(json.dumps(payload, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    print(f"Wrote {OUTPUT_FILE}")
    print(f"CN/HK routes: {len(routes):,}")


if __name__ == "__main__":
    main()
