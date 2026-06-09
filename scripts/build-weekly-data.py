import calendar
import csv
import json
import os
import shutil
import time
from collections import defaultdict
from datetime import date, datetime, timedelta
from pathlib import Path

from guideline_china_ab import guideline_rate_for as china_guideline_rate_for
from guideline_china_ab import is_china_hk_origin
from guideline_sea_etc import guideline_rate_for as sea_etc_guideline_rate_for
from guideline_sea_etc import is_sea_etc_origin


ROOT = Path(__file__).resolve().parents[1]
CANONICAL_RATE_FILE = ROOT / "data" / "rate-base-latest.csv"
BASIC_TARIFF_FILE = ROOT / "data" / "basic-tariff-latest.csv"
RATE_ROUTE_FILE = ROOT / "data" / "rate-route-latest.csv"
OUTPUT_FILE = ROOT / "public" / "data" / "weekly-monitoring.json"


def find_booking_usage_file():
    """Locate the booking-usage extract (BL/TEU per rate application).

    The file is an optional manual extract; usage stays empty when it is absent
    so the rest of the build keeps working without it.
    """
    for base in (ROOT / "data", ROOT):
        candidate = base / "booking-usage-latest.csv"
        if candidate.exists():
            return candidate
        matches = sorted(base.glob("_WITH_BOOKING_USAGE_AS_SELECT_*.csv"))
        if matches:
            return matches[-1]
    return None


BOOKING_USAGE_FILE = find_booking_usage_file()
RECENT_WEEK_COUNT = 32
FUTURE_WINDOW_DAYS = 395
HQ_ROUTE_TEAMS = ("OBT", "EST", "IST", "JBT")
MARKET_CONTAINER_TYPES = ("GP", "HC", "TK")
MARKET_NON_DG_CARGO_TYPE = "00"
US_COMPARISON_EXCLUDED_CHARGES = ("PSS", "GRI")
# 통화와 무관하게 항상 LOCAL CHARGE로 분류하는 charge 코드
LOCAL_CHARGE_CODES = ("THC", "SEC")
APPROVAL_STATUS_LABELS = {"03": "Accepted"}
FALLBACK_CHARGE_COLUMNS = (
    ("O/F", "OF_RATE"),
    ("THC", "THC_RATE"),
    ("LSS", "LSS_RATE"),
    ("FAF", "FAF_RATE"),
    ("WRS", "WRS_RATE"),
    ("EFC", "EFC_RATE"),
    ("CIS", "CIS_RATE"),
    ("SEC", "SEC_RATE"),
)
COMPONENT_RATE_COLUMNS = (
    "THC_RATE",
    "LSS_RATE",
    "FAF_RATE",
    "WRS_RATE",
    "EFC_RATE",
    "CIS_RATE",
    "SEC_RATE",
    "CORE_RATE",
    "ALL_IN_RATE",
)
COMPONENT_MATCH_FIELDS = (
    ("RATE_APPLICATION_NO", ""),
    ("EFFECTIVE_START_DATE", "00000000"),
    ("EFFECTIVE_END_DATE", "99991231"),
    ("POR_COUNTRY", "00"),
    ("POR_PORT", "00"),
    ("DLY_COUNTRY", "00"),
    ("DLY_PORT", "00"),
    ("BOOKING_SHIPPER_CODE", "00"),
    ("CARGO_TYPE", "00"),
    ("SPECIAL_CARGO_TYPE", "00"),
    ("FULL_EMPTY_TYPE", "F"),
)
DETAIL_MATCH_FIELDS = (
    ("RATE_APPLICATION_NO", ""),
    ("EFFECTIVE_START_DATE", "00000000"),
    ("EFFECTIVE_END_DATE", "99991231"),
    ("POR_COUNTRY", "00"),
    ("POR_PORT", "00"),
    ("DLY_COUNTRY", "00"),
    ("DLY_PORT", "00"),
    ("BOOKING_SHIPPER_CODE", "00"),
    ("FULL_EMPTY_TYPE", "F"),
)


def rate_file():
    configured = os.environ.get("RATE_BASE_CSV")
    if configured:
        candidate = Path(configured).expanduser().resolve()
        if not candidate.exists():
            raise FileNotFoundError(f"Configured RATE_BASE_CSV does not exist: {candidate}")
        return candidate
    if CANONICAL_RATE_FILE.exists():
        return CANONICAL_RATE_FILE
    legacy_files = list(ROOT.glob("_WITH_RATE_BASE_AS_SELECT_*.csv"))
    if not legacy_files:
        raise FileNotFoundError("Missing rate-base CSV. Set RATE_BASE_CSV or extract data/rate-base-latest.csv.")
    return max(legacy_files, key=lambda path: path.stat().st_mtime)


RATE_FILE = rate_file()


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


def number(value, default=0.0):
    if value is None or value == "":
        return default
    try:
        return float(value)
    except ValueError:
        return default


def nullable_number(value):
    if value is None or value == "":
        return None
    try:
        return float(value)
    except ValueError:
        return None


def parse_date(value):
    if not value:
        return None
    if value == "99999999":
        return date(2099, 12, 31)
    try:
        return datetime.strptime(value, "%Y%m%d").date()
    except ValueError:
        pass

    # A few source rows use impossible month-end dates such as 20251131.
    if len(value) == 8 and value.isdigit():
        year = int(value[:4])
        month = int(value[4:6])
        day = int(value[6:8])
        if 1 <= month <= 12 and 1 <= day <= 31:
            return date(year, month, min(day, calendar.monthrange(year, month)[1]))
    return None


def iso_date(value):
    return value.isoformat()


def week_start(value):
    # 주 시작은 일요일 (일요일~토요일). weekday(): 월=0 ... 일=6
    return value - timedelta(days=(value.weekday() + 1) % 7)


def dimension_index(values, index_map, value):
    if value not in index_map:
        index_map[value] = len(values)
        values.append(value)
    return index_map[value]


def guideline_for(row):
    por_port = row.get("POR_PORT", "")
    por_country = row.get("POR_COUNTRY", "")
    dly_port = row.get("DLY_PORT", "")
    container_size = row.get("CONTAINER_SIZE", "")
    container_type = row.get("CONTAINER_TYPE", "")

    if container_type not in MARKET_CONTAINER_TYPES or row.get("CARGO_TYPE", "") != MARKET_NON_DG_CARGO_TYPE:
        return None

    if is_china_hk_origin(por_port, por_country):
        return china_guideline_rate_for(por_port, dly_port, container_size, container_type)
    if is_sea_etc_origin(por_port):
        return sea_etc_guideline_rate_for(por_port, dly_port, container_size, container_type)
    return None


def normalized_text(value, default=""):
    return (value or "").strip() or default


def classify_team(origin, dly_raw):
    """Mirror the -3W bkg dashboard HQ route-team classification."""
    o, d = str(origin).strip(), str(dly_raw).strip()
    if o not in ("KR", "JP") and d != "KR":
        return "OBT"
    if o == "KR" and d != "JP":
        return "EST"
    if o != "JP" and d == "KR":
        return "IST"
    return "JBT"


def cargo_values(row):
    cargo_type = normalized_text(row.get("CARGO_TYPE", ""), "00")
    special_type = normalized_text(row.get("SPECIAL_CARGO_TYPE", ""), "00")
    full_empty = normalized_text(row.get("FULL_EMPTY_TYPE", ""), "F")
    return cargo_type, special_type, full_empty


def cargo_label(row):
    cargo_type, special_type, full_empty = cargo_values(row)
    return f"{cargo_type}/{special_type}/{full_empty}"


def charge_category(code, currency):
    normalized = normalized_text(code).upper()
    if normalized == "O/F":
        return "OCEAN FREIGHT"
    if normalized in LOCAL_CHARGE_CODES:
        return "LOCAL CHARGE"
    return "SURCHARGE" if currency.upper() == "USD" else "LOCAL CHARGE"


def is_us_lane(row):
    return row.get("POR_COUNTRY", "").strip().upper() == "US" or row.get("DLY_COUNTRY", "").strip().upper() == "US"


def charge_detail_parts(raw_item):
    return (raw_item.split("|", 6) + ["", "", "", "", "", "", ""])[:7]


def charge_detail_code(raw_item):
    return normalized_text(charge_detail_parts(raw_item)[0]).upper()


def charge_detail_usd_amount(raw_item):
    _, currency, local_amount, usd_amount, *_ = charge_detail_parts(raw_item)
    amount = nullable_number(usd_amount)
    if amount is None and normalized_text(currency).upper() == "USD":
        amount = nullable_number(local_amount)
    return amount or 0


def is_us_comparison_excluded_charge(row, raw_item):
    return is_us_lane(row) and charge_detail_code(raw_item) in US_COMPARISON_EXCLUDED_CHARGES


def charge_basket_from_items(items):
    codes = []
    seen = set()
    for item in items:
        code = charge_detail_code(item)
        if code and code not in seen:
            seen.add(code)
            codes.append(code)
    return "+".join(codes), len(codes)


def dedupe_basket(basket):
    """Collapse a '+'-joined charge basket to distinct codes, preserving order.

    The basket arrives as a raw LISTAGG (no DISTINCT, so a code charged in two
    currencies or PP/CC splits repeats) and is then concatenated across rate
    components (so shared codes like DCF repeat again). Both produce the
    duplicated 'O/F+CAC+CAC+...+DCF+DCF+DCF' seen in the detail panel.
    """
    codes = []
    seen = set()
    for code in basket.split("+"):
        if code and code not in seen:
            seen.add(code)
            codes.append(code)
    return "+".join(codes)


def fallback_charge_items(row):
    items = []
    summarized_codes = set()
    for code, column in FALLBACK_CHARGE_COLUMNS:
        amount = nullable_number(row.get(column))
        if amount is None or amount == 0:
            continue
        summarized_codes.add(code)
        items.append(
            (
                code,
                "",
                None,
                amount,
                normalized_text(row.get("PREPAID_COLLECT", "")),
                "UNCLASSIFIED",
                True,
                "RATE_FILE",
                "UNKNOWN",
            )
        )

    for code in sorted(set(filter(None, row.get("CHARGE_BASKET", "").split("+"))) - summarized_codes):
        items.append(
            (
                code,
                "",
                None,
                None,
                normalized_text(row.get("PREPAID_COLLECT", "")),
                "UNCLASSIFIED",
                True,
                "RATE_FILE",
                "UNKNOWN",
            )
        )
    return tuple(items)


def charge_items(row):
    raw_detail = row.get("CHARGE_DETAIL_LIST", "")
    if not raw_detail:
        return fallback_charge_items(row)

    items = []
    seen_items = set()
    for detail_list, applied_to_comparison in (
        (raw_detail, True),
        (row.get("DETAIL_ONLY_CHARGE_DETAIL_LIST", ""), False),
    ):
        for raw_item in detail_list.split("~"):
            if not raw_item:
                continue
            code, currency, local_amount, usd_amount, payment_code, source, application_type = charge_detail_parts(raw_item)
            source = normalized_text(source, "RATE_FILE")
            application_type = normalized_text(
                application_type,
                "TARIFF" if source == "BASIC_TARIFF" else "UNKNOWN",
            )
            signature = (code, currency, local_amount, usd_amount, payment_code, source, application_type)
            if signature in seen_items:
                continue
            seen_items.add(signature)
            items.append(
                (
                    normalized_text(code, "UNKNOWN"),
                    normalized_text(currency),
                    nullable_number(local_amount),
                    nullable_number(usd_amount),
                    normalized_text(payment_code, normalized_text(row.get("PREPAID_COLLECT", ""))),
                    charge_category(code, currency),
                    applied_to_comparison,
                    source,
                    application_type,
                )
            )
    return tuple(items)


def rate_detail(row):
    basket = dedupe_basket(row.get("CHARGE_BASKET", ""))
    return (
        row.get("FREIGHT_UNIT", ""),
        row.get("PREPAID_COLLECT", ""),
        row.get("MASTER_PREPAID_COLLECT", ""),
        basket,
        len(basket.split("+")) if basket else 0,
        number(row.get("THC_RATE")),
        number(row.get("LSS_RATE")),
        number(row.get("FAF_RATE")),
        number(row.get("WRS_RATE")),
        number(row.get("EFC_RATE")),
        number(row.get("CIS_RATE")),
        number(row.get("SEC_RATE")),
        number(row.get("CORE_RATE"), None),
        number(row.get("ALL_IN_RATE"), None),
        charge_items(row),
    )


def source_columns(path):
    with path.open("r", encoding="utf-8-sig", newline="") as source:
        return set(csv.DictReader(source).fieldnames or [])


def component_match_key(row):
    return tuple(normalized_text(row.get(field, ""), default) for field, default in COMPONENT_MATCH_FIELDS)


def component_lookup_key(row):
    return component_match_key(row) + (
        normalized_text(row.get("CONTAINER_SIZE", ""), "00"),
        normalized_text(row.get("CONTAINER_TYPE", ""), "00"),
    )


def detail_match_key(row):
    return tuple(normalized_text(row.get(field, ""), default) for field, default in DETAIL_MATCH_FIELDS)


def compact_charge_component(row):
    return (
        tuple(number(row.get(column)) for column in COMPONENT_RATE_COLUMNS),
        int(number(row.get("CHARGE_COUNT"))),
        normalized_text(row.get("CHARGE_BASKET", "")),
        normalized_text(row.get("CHARGE_DETAIL_LIST", "")),
        normalized_text(row.get("LAST_UPDATE_DATETIME", "")),
    )


def comparison_adjusted_component(row, component):
    rates, charge_count, charge_basket, detail_list, last_update = component
    items = [item for item in detail_list.split("~") if item]
    if not items or not is_us_lane(row):
        return rates, charge_count, charge_basket, detail_list, last_update, ()

    included_items = []
    excluded_items = []
    for item in items:
        if is_us_comparison_excluded_charge(row, item):
            excluded_items.append(item)
        else:
            included_items.append(item)

    if not excluded_items:
        return rates, charge_count, charge_basket, detail_list, last_update, ()

    adjusted_rates = list(rates)
    all_in_index = COMPONENT_RATE_COLUMNS.index("ALL_IN_RATE")
    adjusted_rates[all_in_index] -= sum(charge_detail_usd_amount(item) for item in excluded_items)
    adjusted_basket, adjusted_count = charge_basket_from_items(included_items)

    return (
        tuple(adjusted_rates),
        adjusted_count,
        adjusted_basket,
        "~".join(included_items),
        last_update,
        tuple(excluded_items),
    )


def basic_tariff_lookup(active_profiles):
    if not BASIC_TARIFF_FILE.exists() or not RATE_ROUTE_FILE.exists():
        print("WARNING: Basic Tariff or rate-route reference CSV is missing. Dynamic EFC detail is unavailable.")
        return {}

    specificity = {"40": 1, "20": 2, "45": 3}
    tariffs_by_route = defaultdict(list)
    with BASIC_TARIFF_FILE.open("r", encoding="utf-8-sig", newline="") as source:
        for tariff in csv.DictReader(source):
            pol_type = normalized_text(tariff.get("POL_PLC_TYP_CD", ""))
            pol_name = normalized_text(tariff.get("POL_PLC_NM", ""))
            pod_type = normalized_text(tariff.get("POD_PLC_TYP_CD", ""))
            pod_name = normalized_text(tariff.get("POD_PLC_NM", ""))
            if not all((pol_type, pol_name, pod_type, pod_name)):
                continue
            priority = (
                normalized_text(tariff.get("STR_DT", "")),
                specificity.get(pol_type, 0) + specificity.get(pod_type, 0),
                normalized_text(tariff.get("SCHG_TRF_NO", "")),
                -number(tariff.get("SCHG_TRF_SEQ")),
            )
            tariffs_by_route[(pol_type, pol_name, pod_type, pod_name)].append((priority, tariff))

    active_apps = {profile[0] for profile in active_profiles}
    best = {}
    with RATE_ROUTE_FILE.open("r", encoding="utf-8-sig", newline="") as source:
        for route in csv.DictReader(source):
            app_no = normalized_text(route.get("FRT_APP_NO", ""))
            if not app_no or app_no not in active_apps:
                continue
            cargo_mode = normalized_text(route.get("CGO_MODE_CD", ""), "00")
            pol_places = (
                ("40", normalized_text(route.get("POL_CTR_CD", ""))),
                ("20", normalized_text(route.get("POL_PORT_CD", ""))),
                ("45", normalized_text(route.get("POL_TRML_CD", ""))),
            )
            pod_places = (
                ("40", normalized_text(route.get("POD_CTR_CD", ""))),
                ("20", normalized_text(route.get("POD_PORT_CD", ""))),
                ("45", normalized_text(route.get("POD_TRML_CD", ""))),
            )
            for pol_type, pol_name in pol_places:
                if not pol_name:
                    continue
                for pod_type, pod_name in pod_places:
                    if not pod_name:
                        continue
                    for priority, tariff in tariffs_by_route.get((pol_type, pol_name, pod_type, pod_name), ()):
                        tariff_cargo_mode = normalized_text(tariff.get("CGO_MODE_CD", ""), "00")
                        if tariff_cargo_mode not in ("00", cargo_mode):
                            continue
                        profile_key = (
                            app_no,
                            normalized_text(tariff.get("CNTR_SZ_CD", ""), "00"),
                            normalized_text(tariff.get("CNTR_TYP_CD", ""), "00"),
                            normalized_text(tariff.get("CGO_TYP_CD", ""), "00"),
                        )
                        if profile_key not in active_profiles:
                            continue
                        current = best.get(profile_key)
                        if current is None or priority > current[0]:
                            best[profile_key] = (priority, tariff)

    print(f"Indexed dynamic basic tariffs: {len(best):,}")
    return {key: tariff for key, (_, tariff) in best.items()}


def dynamic_basic_tariff_detail(row, lookup):
    tariff = lookup.get(
        (
            normalized_text(row.get("RATE_APPLICATION_NO", "")),
            normalized_text(row.get("CONTAINER_SIZE", ""), "00"),
            normalized_text(row.get("CONTAINER_TYPE", ""), "00"),
            normalized_text(row.get("CARGO_TYPE", ""), "00"),
        )
    )
    if not tariff:
        return ""

    def clean(value):
        return normalized_text(value).replace("|", " ").replace("~", " ")

    code = clean(tariff.get("FRT_CD", "")) or "EFC"
    currency = clean(tariff.get("CUR_CD", ""))
    rate = clean(tariff.get("RATE", ""))
    usd_amount = rate if currency.upper() == "USD" else ""
    payment_code = clean(tariff.get("FRT_PNC_CD", "")) or normalized_text(row.get("PREPAID_COLLECT", ""))
    return f"{code}|{currency}|{rate}|{usd_amount}|{payment_code}|BASIC_TARIFF|TARIFF"


def charge_component_lookups(path):
    lookup = defaultdict(list)
    detail_lookup = defaultdict(list)
    detail_only_lookup = defaultdict(list)
    detail_only_counts = defaultdict(int)
    active_profiles = set()
    with path.open("r", encoding="utf-8-sig", newline="") as source:
        for row in csv.DictReader(source):
            if row.get("RATE_ROW_TYPE") == "OCEAN_FREIGHT":
                active_profiles.add(
                    (
                        normalized_text(row.get("RATE_APPLICATION_NO", "")),
                        normalized_text(row.get("CONTAINER_SIZE", ""), "00"),
                        normalized_text(row.get("CONTAINER_TYPE", ""), "00"),
                        normalized_text(row.get("CARGO_TYPE", ""), "00"),
                    )
                )
            elif row.get("RATE_ROW_TYPE") == "CHARGE_GROUP":
                lookup[component_lookup_key(row)].append(compact_charge_component(row))
                container_size = normalized_text(row.get("CONTAINER_SIZE", ""), "00")
                container_type = normalized_text(row.get("CONTAINER_TYPE", ""), "00")
                detail_list = normalized_text(row.get("CHARGE_DETAIL_LIST", ""))
                if container_size == "00" and container_type == "00" and detail_list:
                    detail_lookup[detail_match_key(row)].append(detail_list)
            elif row.get("RATE_ROW_TYPE") in ("TARIFF_GROUP", "WAIVE_GROUP", "DETAIL_ONLY_GROUP"):
                detail_list = normalized_text(row.get("CHARGE_DETAIL_LIST", ""))
                if detail_list:
                    is_common_waive = (
                        row.get("RATE_ROW_TYPE") == "WAIVE_GROUP"
                        and normalized_text(row.get("CONTAINER_SIZE", ""), "00") == "00"
                        and normalized_text(row.get("CONTAINER_TYPE", ""), "00") == "00"
                        and normalized_text(row.get("CARGO_TYPE", ""), "00") == "00"
                        and normalized_text(row.get("SPECIAL_CARGO_TYPE", ""), "00") == "00"
                    )
                    if is_common_waive:
                        detail_lookup[detail_match_key(row)].append(detail_list)
                    else:
                        detail_only_lookup[component_lookup_key(row)].append(detail_list)
                    detail_only_counts[row.get("RATE_ROW_TYPE")] += 1
    print(f"Indexed charge groups: {sum(len(items) for items in lookup.values()):,}")
    print(f"Indexed file-detail groups: {sum(len(items) for items in detail_lookup.values()):,}")
    print(f"Indexed basic tariff groups: {detail_only_counts['TARIFF_GROUP']:,}")
    print(f"Indexed waive groups: {detail_only_counts['WAIVE_GROUP']:,}")
    print(f"Indexed detail-only groups: {detail_only_counts['DETAIL_ONLY_GROUP']:,}")
    return lookup, detail_lookup, detail_only_lookup, active_profiles


def merge_charge_components(row, lookup, detail_lookup, detail_only_lookup, dynamic_tariffs):
    container_size = normalized_text(row.get("CONTAINER_SIZE", ""), "00")
    container_type = normalized_text(row.get("CONTAINER_TYPE", ""), "00")
    base_key = component_match_key(row)
    keys = {
        base_key + (size, cntr_type)
        for size in ("00", container_size)
        for cntr_type in ("00", container_type)
    }
    adjusted_components = [
        comparison_adjusted_component(row, component)
        for key in keys
        for component in lookup.get(key, ())
    ]
    components = [component[:5] for component in adjusted_components]
    comparison_excluded_items = [
        item
        for component in adjusted_components
        for item in component[5]
    ]
    merged = dict(row)
    if components:
        for column_index, column in enumerate(COMPONENT_RATE_COLUMNS):
            merged[column] = number(row.get(column)) + sum(component[0][column_index] for component in components)

        merged["CHARGE_COUNT"] = int(number(row.get("CHARGE_COUNT"))) + sum(component[1] for component in components)
        merged["CHARGE_BASKET"] = "+".join(
            filter(None, [normalized_text(row.get("CHARGE_BASKET", "")), *(component[2] for component in components)])
        )
        merged["CHARGE_DETAIL_LIST"] = "~".join(
            filter(None, [normalized_text(row.get("CHARGE_DETAIL_LIST", "")), *(component[3] for component in components)])
        )
        update_datetimes = [normalized_text(row.get("LAST_UPDATE_DATETIME", "")), *(component[4] for component in components)]
        merged["LAST_UPDATE_DATETIME"] = max(filter(None, update_datetimes), default="")

    applied_items = set(filter(None, normalized_text(merged.get("CHARGE_DETAIL_LIST", "")).split("~")))
    detail_only_items = []
    for item in comparison_excluded_items:
        if item and item not in applied_items and item not in detail_only_items:
            detail_only_items.append(item)
    for detail_list in detail_lookup.get(detail_match_key(row), ()):
        for item in detail_list.split("~"):
            if item and item not in applied_items and item not in detail_only_items:
                detail_only_items.append(item)
    for key in keys:
        for detail_list in detail_only_lookup.get(key, ()):
            for item in detail_list.split("~"):
                if item and item not in applied_items and item not in detail_only_items:
                    detail_only_items.append(item)
    known_items = applied_items.union(detail_only_items)
    if not any(item.split("|", 1)[0] == "EFC" for item in known_items):
        dynamic_tariff = dynamic_basic_tariff_detail(row, dynamic_tariffs)
        if dynamic_tariff:
            detail_only_items.append(dynamic_tariff)
    merged["DETAIL_ONLY_CHARGE_DETAIL_LIST"] = "~".join(detail_only_items)
    return merged


def dashboard_rows(path, columns):
    if "RATE_ROW_TYPE" not in columns:
        with path.open("r", encoding="utf-8-sig", newline="") as source:
            yield from csv.DictReader(source)
        return

    lookup, detail_lookup, detail_only_lookup, active_profiles = charge_component_lookups(path)
    dynamic_tariffs = basic_tariff_lookup(active_profiles)
    with path.open("r", encoding="utf-8-sig", newline="") as source:
        for row in csv.DictReader(source):
            if row.get("RATE_ROW_TYPE") == "OCEAN_FREIGHT":
                yield merge_charge_components(row, lookup, detail_lookup, detail_only_lookup, dynamic_tariffs)


def booking_usage_key(application_no, container_size, container_type):
    return (
        (application_no or "").strip(),
        (container_size or "").strip(),
        (container_type or "").strip(),
    )


def build_booking_usage(path):
    """Aggregate actual usage per (rate application, CNTR size, CNTR type).

    The extract repeats a booking across several rows (joins fan out up to ~12x),
    so TOTAL_TEU is collapsed per distinct BOOKING_NO before summing — otherwise
    volume is multiplied by the duplicate-row count. blCount/teu come only from
    bookings that produced a B/L (HAS_BL_FLAG='Y'), i.e. actually shipped volume;
    bookingCount counts every distinct booking that referenced the rate.
    """
    if path is None:
        return {}, False

    aggregates = {}
    with path.open("r", encoding="utf-8-sig", newline="") as source:
        for row in csv.DictReader(source):
            booking_no = (row.get("BOOKING_NO", "") or "").strip()
            if not booking_no:
                continue
            key = booking_usage_key(
                row.get("RATE_APPLICATION_NO", ""),
                row.get("CONTAINER_SIZE", ""),
                row.get("CONTAINER_TYPE", ""),
            )
            entry = aggregates.get(key)
            if entry is None:
                entry = {"bookings": {}, "bls": set()}
                aggregates[key] = entry
            has_bl = row.get("HAS_BL_FLAG", "") == "Y"
            booking = entry["bookings"].get(booking_no)
            if booking is None:
                booking = {"teu": 0.0, "hasBL": False}
                entry["bookings"][booking_no] = booking
            # Duplicate rows carry the same booking-level TOTAL_TEU; take the max
            # (not the sum) so a fanned-out join does not inflate the volume.
            booking["teu"] = max(booking["teu"], number(row.get("TOTAL_TEU")))
            booking["hasBL"] = booking["hasBL"] or has_bl
            bl_no = (row.get("BL_NO", "") or "").strip()
            if has_bl and bl_no:
                entry["bls"].add(bl_no)

    usage_map = {}
    for key, entry in aggregates.items():
        booking_teu = sum(b["teu"] for b in entry["bookings"].values())
        shipped_teu = sum(b["teu"] for b in entry["bookings"].values() if b["hasBL"])
        usage_map[key] = (
            len(entry["bls"]),
            len(entry["bookings"]),
            round(shipped_teu, 1),
            round(booking_teu, 1),
        )
    return usage_map, True


booking_usage_map, booking_usage_available = build_booking_usage(BOOKING_USAGE_FILE)

dimensions = {
    "lanes": [],
    "shippers": [],
    "staff": [],
    "teams": [],
    "containers": [],
    "cargoProfiles": [],
    "containerSizes": [],
    "containerTypes": [],
    "cargoTypes": [],
    "specialCargoTypes": [],
    "fullEmptyTypes": [],
    "approvalStatuses": [],
    "marketSources": [],
    "rateDetails": [],
}
dimension_maps = {key: {} for key in dimensions}
records = []
seen_records = set()
skipped_invalid_date_rows = 0
skipped_non_of_rows = 0
latest_source_date = None

rate_source_columns = source_columns(RATE_FILE)
charge_detail_available = "CHARGE_DETAIL_LIST" in rate_source_columns
for row in dashboard_rows(RATE_FILE, rate_source_columns):
        update_text = row.get("LAST_UPDATE_DATETIME", "")[:10]
        try:
            update_date = datetime.strptime(update_text, "%Y-%m-%d").date()
            latest_source_date = max(latest_source_date, update_date) if latest_source_date else update_date
        except ValueError:
            pass

        if row.get("SALES_ROLE") != "Origin Sales":
            continue

        of_rate = number(row.get("OF_RATE"))
        if of_rate <= 0:
            skipped_non_of_rows += 1
            continue

        effective_start = parse_date(row.get("EFFECTIVE_START_DATE", ""))
        effective_end = parse_date(row.get("EFFECTIVE_END_DATE", ""))
        if not effective_start or not effective_end or effective_end < effective_start:
            skipped_invalid_date_rows += 1
            continue

        lane = (
            row.get("POR_COUNTRY", ""),
            row.get("POR_PORT", ""),
            row.get("DLY_COUNTRY", ""),
            row.get("DLY_PORT", ""),
        )
        shipper = (
            row.get("BOOKING_SHIPPER_CODE", ""),
            row.get("BOOKING_SHIPPER_NAME", ""),
        )
        staff = row.get("SALES_STAFF_NO", "") or "UNKNOWN"
        team = classify_team(row.get("POR_COUNTRY", ""), row.get("DLY_COUNTRY", ""))
        container_size = normalized_text(row.get("CONTAINER_SIZE", ""), "Unmapped")
        container_type = normalized_text(row.get("CONTAINER_TYPE", ""), "Unmapped")
        cargo_type, special_cargo_type, full_empty_type = cargo_values(row)
        approval_status = normalized_text(row.get("APPROVAL_STATUS", ""), "Unmapped")
        container = f"{container_size}{container_type}"
        cargo = cargo_label(row)
        guideline = guideline_for(row)
        market_rate = guideline["amount"] if guideline and guideline["amount"] > 0 else None
        market_source = guideline["source"] if market_rate is not None else ""
        detail = rate_detail(row)

        bl_count, booking_count, teu, booking_teu = booking_usage_map.get(
            booking_usage_key(
                row.get("RATE_APPLICATION_NO", ""),
                row.get("CONTAINER_SIZE", ""),
                row.get("CONTAINER_TYPE", ""),
            ),
            (0, 0, 0.0, 0.0),
        )

        record_key = (
            row.get("RATE_APPLICATION_NO", ""),
            effective_start,
            effective_end,
            lane,
            shipper,
            staff,
            team,
            container,
            cargo,
            approval_status,
            of_rate,
            market_rate,
            market_source,
            detail,
        )
        if record_key in seen_records:
            continue
        seen_records.add(record_key)

        records.append(
            [
                row.get("RATE_APPLICATION_NO", ""),
                iso_date(effective_start),
                iso_date(effective_end),
                dimension_index(dimensions["lanes"], dimension_maps["lanes"], lane),
                dimension_index(dimensions["shippers"], dimension_maps["shippers"], shipper),
                dimension_index(dimensions["staff"], dimension_maps["staff"], staff),
                dimension_index(dimensions["containers"], dimension_maps["containers"], container),
                dimension_index(dimensions["cargoProfiles"], dimension_maps["cargoProfiles"], cargo),
                of_rate,
                market_rate,
                dimension_index(dimensions["marketSources"], dimension_maps["marketSources"], market_source),
                dimension_index(dimensions["teams"], dimension_maps["teams"], team),
                dimension_index(dimensions["rateDetails"], dimension_maps["rateDetails"], detail),
                dimension_index(dimensions["containerSizes"], dimension_maps["containerSizes"], container_size),
                dimension_index(dimensions["containerTypes"], dimension_maps["containerTypes"], container_type),
                dimension_index(dimensions["cargoTypes"], dimension_maps["cargoTypes"], cargo_type),
                dimension_index(dimensions["specialCargoTypes"], dimension_maps["specialCargoTypes"], special_cargo_type),
                dimension_index(dimensions["fullEmptyTypes"], dimension_maps["fullEmptyTypes"], full_empty_type),
                dimension_index(dimensions["approvalStatuses"], dimension_maps["approvalStatuses"], approval_status),
                bl_count,
                booking_count,
                teu,
                booking_teu,
            ]
        )

if latest_source_date is None:
    latest_source_date = date.today()

default_week = week_start(date.today())
first_week = default_week - timedelta(days=7 * (RECENT_WEEK_COUNT - 1))
weeks = []
cursor = first_week
while cursor <= default_week:
    weeks.append(
        {
            "value": iso_date(cursor),
            "label": f"{cursor.isoformat()} ~ {(cursor + timedelta(days=6)).isoformat()}",
        }
    )
    cursor += timedelta(days=7)

window_end = default_week + timedelta(days=6)
data_window_end = window_end + timedelta(days=FUTURE_WINDOW_DAYS)
records = [record for record in records if record[1] <= iso_date(data_window_end) and record[2] >= iso_date(first_week)]

payload = {
    "metadata": {
        "generatedAt": datetime.now().isoformat(timespec="seconds"),
        "sourceFile": RATE_FILE.name,
        "sourceMode": "canonical" if RATE_FILE.resolve() == CANONICAL_RATE_FILE.resolve() else "legacy-fallback",
        "chargeDetailAvailable": charge_detail_available,
        "usageAvailable": booking_usage_available,
        "usageSourceFile": BOOKING_USAGE_FILE.name if BOOKING_USAGE_FILE else "",
        "latestSourceDate": iso_date(latest_source_date),
        "defaultWeek": iso_date(default_week),
        "availableStartDate": iso_date(first_week),
        "availableEndDate": iso_date(data_window_end),
        "approvalStatusLabels": APPROVAL_STATUS_LABELS,
        "comparisonRate": "ALL_IN_RATE",
        "marketComparisonRate": "OF_RATE guideline -> all-in (guideline O/F + record surcharge delta)",
        "marketComparisonContainerTypes": list(MARKET_CONTAINER_TYPES),
        "marketComparisonCargoType": MARKET_NON_DG_CARGO_TYPE,
        "marketAverageFallbackRate": "ALL_IN_RATE",
        "usComparisonExcludedCharges": list(US_COMPARISON_EXCLUDED_CHARGES),
        "usComparisonExcludedRule": "For lanes where POR_COUNTRY or DLY_COUNTRY is US, PSS and GRI remain visible in detail but are excluded from comparison all-in calculations.",
        "marketAverageFallbackMinimumSamples": 3,
        "marketAverageFallbackGroupBy": [
            "lane",
            "containerSize",
            "containerType",
            "cargoType",
            "specialCargoType",
            "fullEmptyType",
        ],
        "marketAverageFallbackPeriod": "selected query period",
        "teamBasis": "HQ route team by POR_COUNTRY / DLY_COUNTRY; same rule as -3W bkg dashboard",
        "teamOptions": list(HQ_ROUTE_TEAMS),
        "recordCount": len(records),
        "skippedInvalidDateRows": skipped_invalid_date_rows,
        "skippedNonOfRows": skipped_non_of_rows,
        "recordSchema": [
            "rateApplicationNo",
            "effectiveStart",
            "effectiveEnd",
            "laneIndex",
            "shipperIndex",
            "staffIndex",
            "containerIndex",
            "cargoProfileIndex",
            "ofRate",
            "marketRate",
            "marketSourceIndex",
            "teamIndex",
            "rateDetailIndex",
            "containerSizeIndex",
            "containerTypeIndex",
            "cargoTypeIndex",
            "specialCargoTypeIndex",
            "fullEmptyTypeIndex",
            "approvalStatusIndex",
            "blCount",
            "bookingCount",
            "teu",
            "bookingTeu",
        ],
        "rateDetailSchema": [
            "freightUnit",
            "prepaidCollect",
            "masterPrepaidCollect",
            "chargeBasket",
            "chargeCount",
            "thcRate",
            "lssRate",
            "fafRate",
            "wrsRate",
            "efcRate",
            "cisRate",
            "secRate",
            "coreRate",
            "allInRate",
            "chargeItems",
        ],
    },
    "weeks": weeks,
    "dimensions": dimensions,
    "records": records,
}

OUTPUT_FILE.parent.mkdir(parents=True, exist_ok=True)
output_temp = OUTPUT_FILE.with_suffix(".json.tmp")
output_temp.write_text(json.dumps(payload, ensure_ascii=False, separators=(",", ":")), encoding="utf-8")
replace_file(output_temp, OUTPUT_FILE)

print(f"Wrote {OUTPUT_FILE.relative_to(ROOT)}")
print(f"Focused O/F records: {len(records):,}")
print(f"Weeks: {weeks[0]['value']} ~ {weeks[-1]['value']}")
print(f"Data window: {iso_date(first_week)} ~ {iso_date(data_window_end)}")
print(f"Skipped invalid-date rows: {skipped_invalid_date_rows:,}")
if not charge_detail_available:
    print("WARNING: Source CSV has no CHARGE_DETAIL_LIST column. Charge rows remain legacy summaries.")
