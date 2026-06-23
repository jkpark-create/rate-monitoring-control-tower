"""Japan destination grouping used by market-rate guideline lookups."""

from __future__ import annotations


JAPAN_MAIN_PORTS = {
    "NGO",
    "OSA",
    "TYO",
    "UKB",
    "YOK",
    "HKT",
    "MOJ",
}

JAPAN_LOCAL_PORTS = {
    "AXT",
    "CHB",
    "FKY",
    "HHE",
    "HIJ",
    "HSM",
    "HTA",
    "IMB",
    "IMI",
    "ISI",
    "IWK",
    "IYM",
    "KIJ",
    "KMJ",
    "KNZ",
    "KUH",
    "MAI",
    "MIZ",
    "MUR",
    "MYJ",
    "NAO",
    "NGS",
    "OIT",
    "ONA",
    "SBS",
    "SDJ",
    "SHA",
    "SKT",
    "SMN",
    "SMZ",
    "TAK",
    "THS",
    "TKY",
    "TKS",
    "TMK",
    "TOS",
    "TRG",
    "YAT",
    "YKK",
}

HOKKAIDO_PORTS = {"ISI", "TMK"}

JAPAN_DESTINATION_ALIASES = {
    "JP": "JPM",
    "JPM": "JPM",
    "JPMAIN": "JPM",
    "JPO": "JPO",
    "JPL": "JPO",
    "JPOUT": "JPO",
}


def normalize_code(value):
    return "".join(ch for ch in str(value or "").upper().strip() if ch.isalnum())


def japan_destination_candidates(value):
    destination = normalize_code(value)
    candidates = [destination] if destination else []
    group = JAPAN_DESTINATION_ALIASES.get(destination)
    if group:
        candidates.append(group)
    elif destination in JAPAN_MAIN_PORTS:
        candidates.append("JPM")
    elif destination in JAPAN_LOCAL_PORTS:
        if destination in HOKKAIDO_PORTS:
            candidates.append("HOKKAIDO")
        candidates.append("JPO")

    return tuple(dict.fromkeys(candidates))
