"""CN/HK market-rate guideline rates captured from the Drive guideline sheet.

The Google Sheet is the source of truth. This compact table keeps the static
dashboard build deployable on GitHub Pages without publishing the workbook.
Rates are O/F-style 20' and 40' guideline amounts by origin sheet and POD.
"""

from __future__ import annotations

import json
from pathlib import Path

from guideline_japan import japan_destination_candidates


DATA_FILE = Path(__file__).with_name("guideline_china_hk.json")

ORIGIN_TO_SHEET = {
    "SHA": "SHA",
    "NBO": "NBO",
    "TAO": "TAO",
    "HKG": "HKG",
    "XGG": "XGG",
    "SHK": "SZP",
    "NNS": "CAN",
    "SZP": "SZP",
    "YTN": "SZP",
    "CAN": "CAN",
    "DLC": "DLC",
    "DCB": "DLC",
    "XMN": "XMN",
    "FQG": "XMN",
    "NKG": "NKG",
    "LYG": "NKG",
    "MX": "MX",
}

CN_HK_COUNTRIES = {"CN", "HK"}

DEST_ALIASES = {
    "KAN": "PUS",
    "KPO": "PUS",
    "USN": "PUS",
    "PTK": "INC",
    "SKN": "SKN",
    "SOKHNA": "SKN",
    "AQABA": "AQJ",
}

RAW_RATES = {
    "SHA": [
        ("HKG", 100, 200),
        ("SGN HPH", 450, 800),
        ("BKK", 800, 1550),
        ("LCH", 650, 1200),
        ("SIN PKG PEN", 750, 1400),
        ("PGU", 800, 1500),
        ("JKT SUB", 850, 1400),
        ("NSA MUN", 2150, 2200),
        ("MAA VTZ KTP", 1350, 1400),
        ("HZR", 2350, 2400),
        ("BOM", 2200, 2300),
        ("KHI", 2250, 2300),
        ("KLF JEA", 4800, 5600),
        ("SOH", 4900, 5800),
        ("JED SKN AQJ", 5200, 6500),
        ("MBA", 2200, 3100),
        ("DAR", 2350, 3400),
        ("ZLO", 4500, 4700),
        ("LGB", 2560, 3200),
        ("JPL", 300, 600),
        ("JPM", 250, 500),
        ("PUS", -110, -220),
        ("INC", 250, 500),
    ],
    "NBO": [
        ("BKK", 600, 1200),
        ("LCH", 500, 1000),
        ("MNL MIP", 200, 400),
        ("SIN", 350, 700),
        ("PKG", 700, 1400),
        ("JKT SUB", 875, 1650),
        ("SRG BLW", 1400, 2600),
        ("NSA MUN", 2100, 2200),
        ("BOM", 2300, 2600),
        ("HZR", 2200, 2400),
        ("MAA TUT VTZ", 2200, 2200),
        ("KHI", 2250, 2350),
        ("JEA KLF", 3600, 4600),
        ("SOH", 3400, 4600),
        ("JED SKN", 4000, 5000),
        ("AQJ", 4100, 5100),
        ("MBA", 2200, 2900),
        ("DAR", 2150, 3000),
        ("ZLO", 4500, 4900),
        ("LGB", 2800, 3500),
        ("PUS", -70, -140),
        ("INC", 250, 500),
        ("JPL JPM", 270, 540),
        ("VVO", 900, 1200),
    ],
    "TAO": [
        ("PUS", 420, 840),
        ("INC", 610, 1170),
        ("JPL JPM", 450, 900),
        ("VVO", 500, 700),
        ("HKG", 400, 450),
        ("SGN HPH", 900, 1000),
        ("BKK", 1150, 1250),
        ("LCH", 950, 1050),
        ("MNL", 300, 200),
        ("MIP", 500, 500),
        ("SIN", 1400, 1500),
        ("PKG", 1400, 1500),
        ("PGU", 1450, 1550),
        ("JKT", 1200, 1200),
        ("SUB", 1250, 1250),
        ("BLW", 1700, 1800),
        ("CMB", 3000, 3000),
        ("NSA MUN", 2800, 3000),
        ("HZR", 3000, 3200),
        ("MAA VTZ KTP", 1600, 1700),
        ("KHI", 3100, 3300),
        ("JEA KLF SOH", 5000, 6000),
        ("JED SKN AQJ", 5500, 7000),
        ("MBA", 2500, 3500),
        ("DAR", 2700, 3700),
        ("ZLO", 4500, 4700),
        ("LGB", 2800, 3500),
    ],
    "HKG": [
        ("PUS KAN KPO USN", 110, 220),
        ("INC PTK", 140, 280),
        ("JPM", 30, 60),
        ("HKT MOJ JPL", 100, 200),
        ("SHA", 60, 160),
        ("TAO NBO XMN", 80, 200),
        ("KEL TXG KHH", 15, 30),
        ("TYN", 50, 100),
        ("SGN", 325, 650),
        ("HPH", 100, 200),
        ("BKK LCH", 200, 400),
        ("MNL MIP", 100, 200),
        ("SIN", 250, 500),
        ("PKG PGU", 175, 350),
        ("PEN", 205, 410),
        ("JKT SUB", 300, 600),
        ("SRG", 550, 1100),
        ("NSA TUT MUN HZR", 2050, 1950),
        ("MAA VTZ KTP", 1100, 1050),
        ("KHI", 2550, 2700),
        ("JED SKN", 5200, 6800),
        ("AQJ", 5250, 6900),
        ("ZLO", 4450, 4700),
        ("LGB", 2750, 2400),
    ],
    "XGG": [
        ("PUS", 380, 600),
        ("INC", 450, 550),
        ("JPL", 450, 750),
        ("JPM", 200, 400),
        ("VVO", 700, 1000),
        ("SGN", 900, 950),
        ("HPH", 650, 750),
        ("BKK", 1150, 1200),
        ("LCH", 1100, 1150),
        ("MNL", 250, 150),
        ("MIP", 500, 500),
        ("SIN", 1200, 1250),
        ("PKG PKW PEN", 1200, 1250),
        ("JKT", 1150, 1200),
        ("SUB", 1200, 1250),
        ("NSA MUN", 2300, 2300),
        ("MAA", 1600, 1700),
        ("VTZ KTP", 1700, 1800),
        ("KHI", 2500, 2500),
        ("JEA KLF", 4500, 5500),
        ("SOH", 4500, 5000),
        ("JED SKN AQJ", 5300, 6700),
        ("ZLO", 4200, 4500),
        ("LGB", 2400, 3000),
    ],
    "DLC": [
        ("PUS", 380, 760),
        ("INC", 610, 1220),
        ("JPL", 600, 1000),
        ("JPM", 400, 700),
        ("VVO", 1000, 1300),
        ("SGN", 900, 900),
        ("HPH", 700, 800),
        ("BKK", 1000, 1050),
        ("LCH", 900, 950),
        ("MNL", 250, 250),
        ("MIP", 400, 400),
        ("SIN", 1200, 1300),
        ("PKG PKW PEN", 1300, 1400),
        ("PGU", 1350, 1450),
        ("JKT", 1150, 1200),
        ("SUB", 1200, 1250),
        ("NSA MUN", 2000, 2100),
        ("HZR", 2100, 2200),
        ("MAA", 1400, 1500),
        ("VTZ KTP", 1500, 1600),
        ("KHI", 2100, 2200),
        ("JEA KLF SOH", 4000, 5000),
        ("JED SKN AQJ", 4000, 5000),
        ("ZLO", 4200, 4500),
        ("LGB", 2800, 3500),
    ],
    "XMN": [
        ("PUS", 250, 500),
        ("INC", 300, 600),
        ("PTK", 350, 700),
        ("JPL", 200, 400),
        ("VVO", 975, 1150),
        ("BKK", 535, 1070),
        ("LCH", 360, 720),
        ("SIN PKG", 455, 910),
        ("JKT SRG", 660, 1320),
        ("BLW", 860, 1720),
        ("NSA MUN TUT", 2250, 2250),
        ("HZR", 2450, 2450),
        ("MAA VTZ KTP", 1350, 1350),
        ("KHI", 2375, 2350),
        ("JEA KLF", 4450, 5450),
        ("SOH", 4350, 5350),
        ("ZLO", 2150, 2350),
        ("LGB", 2680, 3350),
    ],
    "NKG": [
        ("PUS", 0, 0),
        ("INC", 300, 600),
        ("JPL", 450, 900),
        ("JPM", 350, 700),
        ("HKG", 300, 600),
        ("SGN HPH", 500, 1000),
        ("BKK", 850, 1650),
        ("LCH", 800, 1550),
        ("SIN PKG PEN", 850, 1700),
        ("PGU", 900, 1800),
        ("JKT SUB", 900, 1700),
        ("BLW", 1200, 2300),
        ("NSA MUN", 2000, 2100),
        ("HZR", 2150, 2400),
        ("MAA VTZ KTP", 1350, 1500),
        ("TUT", 2200, 2600),
        ("KHI", 2300, 2500),
        ("JEA KLF SOH", 4400, 5600),
        ("JED SKN AQJ", 5500, 7000),
        ("MBA", 2500, 3700),
        ("DAR", 2800, 4000),
        ("ZLO", 4800, 5500),
        ("LGB", 2700, 3500),
    ],
}


def _expand_rates():
    expanded = {}
    for origin, rows in RAW_RATES.items():
        expanded[origin] = {}
        for destinations, rate20, rate40 in rows:
            for destination in destinations.split():
                expanded[origin][destination] = {"20": float(rate20), "40": float(rate40)}
    return expanded


GUIDELINE_RATES = _expand_rates()


def normalize_port(value):
    return "".join(ch for ch in (value or "").upper().strip() if ch.isalnum())


def _load_generated_guideline():
    if not DATA_FILE.exists():
        return {}, {}
    payload = json.loads(DATA_FILE.read_text(encoding="utf-8"))
    aliases = {
        normalize_port(origin): normalize_port(sheet)
        for origin, sheet in payload.get("originAliases", {}).items()
    }
    return payload.get("routes", {}), aliases


GENERATED_ROUTES, GENERATED_ALIASES = _load_generated_guideline()
ORIGIN_TO_SHEET.update(GENERATED_ALIASES)


def is_china_hk_origin(por_port, por_country):
    port = normalize_port(por_port)
    country = normalize_port(por_country)
    return country in CN_HK_COUNTRIES or port in ORIGIN_TO_SHEET


def guideline_rate_for(por_port, dly_port, container_size, container_type=""):
    origin = normalize_port(por_port)
    destination = normalize_port(dly_port)
    sheet = ORIGIN_TO_SHEET.get(origin)
    if not sheet:
        return None

    destination = DEST_ALIASES.get(destination, destination)
    destinations = japan_destination_candidates(destination) or (destination,)
    size_text = f"{container_size or ''}{container_type or ''}".upper()
    size_key = "20" if size_text.startswith("20") else "40" if size_text.startswith("40") else None
    if not size_key:
        return None

    for candidate in destinations:
        route = GENERATED_ROUTES.get(f"{sheet}|{candidate}")
        if route is not None and route.get(size_key) is not None:
            week = route.get(f"{size_key}Week")
            return {
                "amount": float(route[size_key]),
                "originSheet": route.get("sheet", sheet),
                "destination": candidate,
                "size": size_key,
                "source": f"{route.get('sheet', sheet)} AB Customer {size_key}'" + (f" {week}" if week else ""),
            }

    rates = None
    matched_destination = ""
    for candidate in destinations:
        rates = GUIDELINE_RATES.get(sheet, {}).get(candidate)
        if rates is not None:
            matched_destination = candidate
            break
    if rates is None:
        return None

    amount = rates[size_key]
    return {
        "amount": amount,
        "originSheet": sheet,
        "destination": matched_destination,
        "size": size_key,
        "source": f"{sheet} legacy market {size_key}'",
    }


GUIDELINE_SOURCE_SUMMARY = {
    "sheet": "[CN/HK] Market Rate",
    "customerBasis": "AB Customer",
    "comparisonRate": "OF_RATE",
    "originSheets": sorted(GUIDELINE_RATES),
}
