"""S.E.A/ETC working-rate guideline lookup."""

from __future__ import annotations

import json
from pathlib import Path

from guideline_japan import japan_destination_candidates


DATA_FILE = Path(__file__).with_name("guideline_sea_etc.json")
DATA = json.loads(DATA_FILE.read_text(encoding="utf-8"))
ROUTES = DATA["routes"]
ORIGINS = {key.split("|", 1)[0] for key in ROUTES}

DEST_ALIASES = {
    "KAN": "PUS",
    "KPO": "PUS",
    "USN": "PUS",
    "PTK": "INC",
    "PNC": "PUS",
    "SOKHNA": "SKN",
    "AQABA": "AQJ",
    "JPL": "JPO",
    "HKT": "JPM",
    "MOJ": "JPM",
}


def normalize_port(value):
    return "".join(ch for ch in (value or "").upper().strip() if ch.isalnum())


def is_sea_etc_origin(por_port):
    return normalize_port(por_port) in ORIGINS


def guideline_rate_for(por_port, dly_port, container_size, container_type=""):
    origin = normalize_port(por_port)
    destination = DEST_ALIASES.get(normalize_port(dly_port), normalize_port(dly_port))
    destinations = japan_destination_candidates(destination) or (destination,)
    size_text = f"{container_size or ''}{container_type or ''}".upper()
    size_key = "20" if size_text.startswith("20") else "40" if size_text.startswith("40") else None
    if not size_key:
        return None

    route = None
    matched_destination = ""
    for candidate in destinations:
        route = ROUTES.get(f"{origin}|{candidate}")
        if route is not None:
            matched_destination = candidate
            break
    if route is None:
        return None

    amount = route.get(size_key)
    if amount is None:
        return None

    return {
        "amount": float(amount),
        "originSheet": route["sheet"],
        "destination": matched_destination,
        "size": size_key,
        "source": f"SEA/ETC {route['sheet']} {route.get(f'{size_key}Week', '')} {size_key}'".replace("  ", " "),
    }


GUIDELINE_SOURCE_SUMMARY = {
    "sheet": "Guide rates from S.E.A, ETC.xlsx",
    "customerBasis": "KMTC Working rate",
    "comparisonRate": "OF_RATE",
    "routeCount": len(ROUTES),
    "originCount": len(ORIGINS),
}
