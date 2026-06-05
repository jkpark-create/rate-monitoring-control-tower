import csv
import json
import math
from collections import Counter, defaultdict
from datetime import datetime
from pathlib import Path

from guideline_china_ab import (
    GUIDELINE_SOURCE_SUMMARY as CHINA_GUIDELINE_SOURCE_SUMMARY,
    guideline_rate_for as china_guideline_rate_for,
    is_china_hk_origin,
)
from guideline_sea_etc import (
    GUIDELINE_SOURCE_SUMMARY as SEA_ETC_GUIDELINE_SOURCE_SUMMARY,
    guideline_rate_for as sea_etc_guideline_rate_for,
    is_sea_etc_origin,
)


ROOT = Path(__file__).resolve().parents[1]
RATE_FILE = next(ROOT.glob("_WITH_RATE_BASE_AS_SELECT_*.csv"))
BOOKING_FILE = next(ROOT.glob("_WITH_BOOKING_USAGE_AS_SELECT_*.csv"))
OUTPUT_FILE = ROOT / "public" / "data" / "monitoring.json"


def number(value, default=0.0):
    if value is None or value == "":
        return default
    try:
        return float(value)
    except ValueError:
        return default


def month_key(value):
    return value[:6] if value and len(value) >= 6 else "UNKNOWN"


def pct(numerator, denominator):
    return numerator / denominator if denominator else 0.0


def clamp(value, low=0.0, high=1.0):
    return max(low, min(high, value))


def quantile(values, q):
    values = sorted(v for v in values if v is not None and math.isfinite(v))
    if not values:
        return 0.0
    pos = (len(values) - 1) * q
    lower = math.floor(pos)
    upper = math.ceil(pos)
    if lower == upper:
        return values[int(pos)]
    weight = pos - lower
    return values[lower] * (1 - weight) + values[upper] * weight


def rate_key(row):
    return (
        row["RATE_APPLICATION_NO"],
        row["CONTAINER_SIZE"],
        row["CONTAINER_TYPE"],
    )


def lane_key(row):
    return (
        row.get("POR_COUNTRY", ""),
        row.get("POR_PORT", ""),
        row.get("DLY_COUNTRY", ""),
        row.get("DLY_PORT", ""),
    )


def make_rate_record(row):
    return {
        "rateRows": 0,
        "rateApplicationNo": row["RATE_APPLICATION_NO"],
        "shipperCode": row.get("BOOKING_SHIPPER_CODE", ""),
        "shipperName": row.get("BOOKING_SHIPPER_NAME", ""),
        "salesStaffNo": row.get("SALES_STAFF_NO", "") or "UNKNOWN",
        "porCountry": row.get("POR_COUNTRY", ""),
        "porPort": row.get("POR_PORT", ""),
        "dlyCountry": row.get("DLY_COUNTRY", ""),
        "dlyPort": row.get("DLY_PORT", ""),
        "containerSize": row.get("CONTAINER_SIZE", ""),
        "containerType": row.get("CONTAINER_TYPE", ""),
        "requestMonth": month_key(row.get("REQUEST_DATE", "")),
        "lastUpdate": row.get("LAST_UPDATE_DATETIME", ""),
        "cnHkRows": 0,
        "seaEtcRows": 0,
        "guidelineRows": 0,
        "guidelineComparableRows": 0,
        "guidelineLowRows": 0,
        "guidelineNoMatchRows": 0,
        "guidelineOfMissingRows": 0,
        "guidelineRateSum": 0.0,
        "guidelineGapMin": 0.0,
        "guidelineGapPctMin": 0.0,
        "guidelineSources": Counter(),
        "baselineRows": 0,
        "noBaselineRows": 0,
        "anyLowRows": 0,
        "lowTypes": set(),
        "flagCounts": Counter(),
        "minGapAmount": 0.0,
        "minGapPct": 0.0,
        "allInRateSum": 0.0,
        "allInBaselineSum": 0.0,
        "allInComparableRows": 0,
        "chargeCountMax": 0,
        "chargeBaskets": Counter(),
        "chargeMissing": False,
    }


def make_booking_record():
    return {
        "bookingRows": 0,
        "bookingNos": set(),
        "blNos": set(),
        "bookingSamples": [],
        "statusCounts": Counter(),
        "hasBLRows": 0,
        "totalTeu": 0.0,
        "cm1CntrAmount": 0.0,
        "cm1BlAmount": 0.0,
        "actualChargeCountMax": 0,
        "actualBaskets": Counter(),
        "bookingMonths": Counter(),
    }


rate_by_key = {}
rate_apps = set()
rate_shippers = set()
rate_lanes = set()
rate_staff = set()
rate_flag_counts = {
    "OF_LOW_FLAG": Counter(),
    "CORE_LOW_FLAG": Counter(),
    "ALL_IN_LOW_FLAG": Counter(),
}
rate_months = defaultdict(lambda: Counter(rateRows=0, baselineRows=0, noBaselineRows=0, lowRows=0))

with RATE_FILE.open("r", encoding="utf-8-sig", newline="") as f:
    reader = csv.DictReader(f)
    for row in reader:
        key = rate_key(row)
        rec = rate_by_key.get(key)
        if rec is None:
            rec = make_rate_record(row)
            rate_by_key[key] = rec

        rec["rateRows"] += 1
        rate_apps.add(row["RATE_APPLICATION_NO"])
        if row.get("BOOKING_SHIPPER_CODE"):
            rate_shippers.add(row["BOOKING_SHIPPER_CODE"])
        rate_lanes.add(lane_key(row))
        if row.get("SALES_STAFF_NO"):
            rate_staff.add(row["SALES_STAFF_NO"])

        month = month_key(row.get("REQUEST_DATE", ""))
        rate_months[month]["rateRows"] += 1
        cn_hk_origin = is_china_hk_origin(row.get("POR_PORT", ""), row.get("POR_COUNTRY", ""))
        sea_etc_origin = (not cn_hk_origin) and is_sea_etc_origin(row.get("POR_PORT", ""))
        guideline = (
            china_guideline_rate_for(
                row.get("POR_PORT", ""),
                row.get("DLY_PORT", ""),
                row.get("CONTAINER_SIZE", ""),
                row.get("CONTAINER_TYPE", ""),
            )
            if cn_hk_origin
            else sea_etc_guideline_rate_for(
                row.get("POR_PORT", ""),
                row.get("DLY_PORT", ""),
                row.get("CONTAINER_SIZE", ""),
                row.get("CONTAINER_TYPE", ""),
            )
        )
        of_rate = number(row.get("OF_RATE"), None)
        all_in_rate_for_guide = number(row.get("ALL_IN_RATE"), None)

        flags = {
            "OF": row.get("OF_LOW_FLAG", ""),
            "CORE": row.get("CORE_LOW_FLAG", ""),
            "ALL_IN": row.get("ALL_IN_LOW_FLAG", ""),
        }
        all_no_baseline = all(value == "NO_BASELINE" for value in flags.values())
        has_baseline = not all_no_baseline
        any_low = any(value == "Y" for value in flags.values())

        if has_baseline:
            rec["baselineRows"] += 1
            rate_months[month]["baselineRows"] += 1
        else:
            rec["noBaselineRows"] += 1
            rate_months[month]["noBaselineRows"] += 1

        if any_low:
            rec["anyLowRows"] += 1
            rate_months[month]["lowRows"] += 1

        benchmark_exists = has_baseline
        benchmark_low = any_low
        if cn_hk_origin:
            rec["cnHkRows"] += 1
        if sea_etc_origin:
            rec["seaEtcRows"] += 1
        if guideline is not None and of_rate is not None and (abs(of_rate) > 0 or guideline["amount"] == 0):
            guideline_amount = guideline["amount"]
            guideline_gap = of_rate - guideline_amount
            guideline_low = guideline_gap < 0
            benchmark_exists = True
            benchmark_low = guideline_low
            rec["guidelineRows"] += 1
            rec["guidelineComparableRows"] += 1
            rec["guidelineRateSum"] += guideline_amount
            rec["guidelineGapMin"] = min(rec["guidelineGapMin"], guideline_gap)
            if abs(guideline_amount) > 0:
                rec["guidelineGapPctMin"] = min(rec["guidelineGapPctMin"], guideline_gap / abs(guideline_amount))
            if guideline_low:
                rec["guidelineLowRows"] += 1
            rec["guidelineSources"][guideline["source"]] += 1
        elif guideline is not None and all_in_rate_for_guide is not None and all_in_rate_for_guide > 0:
            rec["guidelineOfMissingRows"] += 1
        elif cn_hk_origin or sea_etc_origin:
            rec["guidelineNoMatchRows"] += 1

        if benchmark_exists:
            rate_months[month]["benchmarkRows"] += 1
        else:
            rate_months[month]["benchmarkMissingRows"] += 1
        if benchmark_low:
            rate_months[month]["benchmarkLowRows"] += 1

        for flag_name in rate_flag_counts:
            flag_value = row.get(flag_name, "")
            rate_flag_counts[flag_name][flag_value] += 1
            rec["flagCounts"][flag_value] += 1

        for label, flag_value in flags.items():
            if flag_value == "Y":
                rec["lowTypes"].add(label)

        gap_fields = [
            ("OF", "OF_RATE", "OF_BASELINE_P75", "OF_GAP_TO_BASELINE"),
            ("CORE", "CORE_RATE", "CORE_BASELINE_P75", "CORE_GAP_TO_BASELINE"),
            ("ALL_IN", "ALL_IN_RATE", "ALL_IN_BASELINE_P75", "ALL_IN_GAP_TO_BASELINE"),
        ]
        for _, rate_col, baseline_col, gap_col in gap_fields:
            baseline = number(row.get(baseline_col), None)
            gap = number(row.get(gap_col), None)
            if baseline is not None and baseline > 0 and gap is not None:
                rec["minGapAmount"] = min(rec["minGapAmount"], gap)
                rec["minGapPct"] = min(rec["minGapPct"], gap / baseline)

        all_in_rate = number(row.get("ALL_IN_RATE"), None)
        all_in_baseline = number(row.get("ALL_IN_BASELINE_P75"), None)
        if all_in_rate is not None and all_in_baseline is not None and all_in_baseline > 0:
            rec["allInRateSum"] += all_in_rate
            rec["allInBaselineSum"] += all_in_baseline
            rec["allInComparableRows"] += 1

        charge_count = int(number(row.get("CHARGE_COUNT"), 0))
        rec["chargeCountMax"] = max(rec["chargeCountMax"], charge_count)
        basket = row.get("CHARGE_BASKET", "")
        if basket:
            rec["chargeBaskets"][basket] += 1
        if number(row.get("OF_RATE"), 0) == 0 and number(row.get("ALL_IN_RATE"), 0) > 0:
            rec["chargeMissing"] = True


booking_by_key = {}
booking_apps = set()
booking_shippers = set()
booking_months = defaultdict(lambda: Counter(bookingRows=0, hasBLRows=0))
booking_month_values = defaultdict(lambda: {"totalTeu": 0.0, "cm1CntrAmount": 0.0})

with BOOKING_FILE.open("r", encoding="utf-8-sig", newline="") as f:
    reader = csv.DictReader(f)
    for row in reader:
        key = rate_key(row)
        rec = booking_by_key.get(key)
        if rec is None:
            rec = make_booking_record()
            booking_by_key[key] = rec

        rec["bookingRows"] += 1
        rec["bookingNos"].add(row.get("BOOKING_NO", ""))
        if row.get("BL_NO"):
            rec["blNos"].add(row["BL_NO"])
        rec["statusCounts"][row.get("BOOKING_STATUS_NAME", "")] += 1
        if len(rec["bookingSamples"]) < 20:
            total_teu = number(row.get("TOTAL_TEU"))
            rec["bookingSamples"].append(
                {
                    "bookingNo": row.get("BOOKING_NO", ""),
                    "blNo": row.get("BL_NO", ""),
                    "status": row.get("BOOKING_STATUS_NAME", ""),
                    "bookingDate": row.get("BOOKING_DATE", ""),
                    "container": f"{row.get('CONTAINER_SIZE', '')}{row.get('CONTAINER_TYPE', '')}",
                    "totalTeu": total_teu,
                    "cm1CntrAmount": number(row.get("CM1_CNTR_AMOUNT")),
                    "cm1CntrPerTeu": number(row.get("CM1_CNTR_AMOUNT")) / total_teu if total_teu else 0.0,
                    "actualOfRate": number(row.get("ACTUAL_OF_RATE")),
                    "actualAllInRate": number(row.get("ACTUAL_ALL_IN_RATE")),
                    "hasBL": row.get("HAS_BL_FLAG") == "Y",
                }
            )
        rec["hasBLRows"] += 1 if row.get("HAS_BL_FLAG") == "Y" else 0
        rec["totalTeu"] += number(row.get("TOTAL_TEU"))
        rec["cm1CntrAmount"] += number(row.get("CM1_CNTR_AMOUNT"))
        rec["cm1BlAmount"] += number(row.get("CM1_BL_AMOUNT"))
        rec["actualChargeCountMax"] = max(rec["actualChargeCountMax"], int(number(row.get("ACTUAL_CHARGE_COUNT"), 0)))
        if row.get("ACTUAL_CHARGE_BASKET"):
            rec["actualBaskets"][row["ACTUAL_CHARGE_BASKET"]] += 1
        month = month_key(row.get("BOOKING_DATE", ""))
        rec["bookingMonths"][month] += 1

        booking_apps.add(row["RATE_APPLICATION_NO"])
        if row.get("BOOKING_SHIPPER_CODE"):
            booking_shippers.add(row["BOOKING_SHIPPER_CODE"])
        booking_months[month]["bookingRows"] += 1
        booking_months[month]["hasBLRows"] += 1 if row.get("HAS_BL_FLAG") == "Y" else 0
        booking_month_values[month]["totalTeu"] += number(row.get("TOTAL_TEU"))
        booking_month_values[month]["cm1CntrAmount"] += number(row.get("CM1_CNTR_AMOUNT"))


cm1_samples = []
teu_samples = []
for booking in booking_by_key.values():
    total_teu = booking["totalTeu"]
    if total_teu > 0:
        cm1_samples.append(booking["cm1CntrAmount"] / total_teu)
        teu_samples.append(total_teu)

thresholds = {
    "cm1Low": quantile(cm1_samples, 0.30),
    "cm1Good": quantile(cm1_samples, 0.60),
    "cm1High": quantile(cm1_samples, 0.75),
    "teuMedian": quantile(teu_samples, 0.50),
    "teuHigh": quantile(teu_samples, 0.75),
}


def cm1_score(cm1_per_teu):
    span = thresholds["cm1Good"] - thresholds["cm1Low"]
    if span == 0:
        return 0.5 if cm1_per_teu > 0 else 0.0
    return clamp((cm1_per_teu - thresholds["cm1Low"]) / span)


def action_for(row):
    if "NO_GUIDELINE" in row["tags"]:
        return "Working Rate Adjustment"
    if "NO_BASELINE" in row["tags"] and not row["comparisonExists"]:
        return "Working Rate Adjustment"
    if "CHARGE_MISSING" in row["tags"]:
        return "Audit Rate File"
    if row["anyLow"] and not row["hasBooking"]:
        return "Stop Discount"
    if row["anyLow"] and row["hasBooking"] and row["cm1PerTeu"] >= thresholds["cm1Good"]:
        return "Strategic Discount Allowed"
    if row["anyLow"] and row["hasBooking"] and row["cm1PerTeu"] < thresholds["cm1Low"]:
        return "Raise Rate or Add Charge"
    if not row["anyLow"] and row["hasBooking"] and row["cm1PerTeu"] >= thresholds["cm1Good"] and row["usedTeu"] >= thresholds["teuMedian"]:
        return "Rate Increase Candidate"
    if row["hasBooking"] and row["hasBL"] and row["cm1PerTeu"] >= thresholds["cm1Good"]:
        return "Space Priority Customer"
    if not row["hasBooking"]:
        return "Reduce Quotation Effort"
    return "Monitor"


def lane_label(row):
    return f"{row['porPort']} {row['porCountry']} -> {row['dlyPort']} {row['dlyCountry']}"


def no_baseline_reason(row):
    if row["container"] in ("", "0000"):
        return "Container code cleanup"
    if not row["shipperCode"] and not row["shipperName"]:
        return "Shipper mapping cleanup"
    if row["guidelineEligible"] and not row["guidelineMatched"]:
        return "Guideline route mapping"
    return "Internal P75 generation"


def no_baseline_check_file(row):
    reason = no_baseline_reason(row)
    if reason == "Container code cleanup":
        return "Rate Base container fields"
    if reason == "Shipper mapping cleanup":
        return "Rate Base shipper fields"
    if reason == "Guideline route mapping":
        return "CN/HK guideline map" if row["chinaHkOrigin"] else "SEA/ETC guideline map"
    return "Rate Base baseline fields"


def normalized_group(group):
    total = group["rateKeys"]
    baseline = group["baselineKeys"]
    benchmark = group["benchmarkKeys"]
    low = group["lowKeys"]
    matched = group["matchedKeys"]
    normal = group["normalKeys"]
    normal_matched = group["normalMatchedKeys"]
    low_matched = group["lowMatchedKeys"]
    used_teu = group["usedTeu"]
    booking_conversion = pct(matched, total)
    bl_conversion = pct(group["blKeys"], matched)
    low_rate = pct(low, benchmark)
    rate_acceptance = pct(normal_matched, normal)
    low_conversion = pct(low_matched, low)
    discount_effectiveness = low_conversion - rate_acceptance
    quote_waste = pct(total - matched, total)
    cm1_per_teu = group["cm1CntrAmount"] / used_teu if used_teu else 0.0
    cm1_norm = cm1_score(cm1_per_teu)
    usage_norm = clamp(math.log1p(used_teu) / 12)
    price_defense_score = round((rate_acceptance * 0.45 + bl_conversion * 0.25 + cm1_norm * 0.30) * 100, 1)
    space_priority_score = round((bl_conversion * 0.35 + cm1_norm * 0.30 + rate_acceptance * 0.25 + usage_norm * 0.10 - quote_waste * 0.20) * 100, 1)

    if booking_conversion >= 0.35 and cm1_per_teu >= thresholds["cm1Good"]:
        strategy = "High Conversion + High CM1"
    elif booking_conversion >= 0.35 and cm1_per_teu < thresholds["cm1Good"]:
        strategy = "High Conversion + Low CM1"
    elif booking_conversion < 0.35 and cm1_per_teu >= thresholds["cm1Good"]:
        strategy = "Low Conversion + High CM1"
    else:
        strategy = "Low Conversion + Low CM1"

    return {
        "rateKeys": total,
        "baselineKeys": baseline,
        "benchmarkKeys": benchmark,
        "benchmarkMissingKeys": group["benchmarkMissingKeys"],
        "guidelineMatchedKeys": group["guidelineMatchedKeys"],
        "guidelineLowKeys": group["guidelineLowKeys"],
        "chinaHkKeys": group["chinaHkKeys"],
        "seaEtcKeys": group["seaEtcKeys"],
        "guidelineEligibleKeys": group["guidelineEligibleKeys"],
        "lowKeys": low,
        "noBaselineKeys": group["noBaselineKeys"],
        "matchedKeys": matched,
        "bookingConversion": booking_conversion,
        "blConversion": bl_conversion,
        "lowRate": low_rate,
        "rateAcceptanceIndex": rate_acceptance,
        "discountEffectiveness": discount_effectiveness,
        "discountDependency": pct(group["lowUsedTeu"], used_teu),
        "quoteWastePct": quote_waste,
        "usedTeu": used_teu,
        "cm1PerTeu": cm1_per_teu,
        "revenueProtectionGap": group["revenueProtectionGap"],
        "priceDefenseScore": price_defense_score,
        "spacePriorityScore": max(0, space_priority_score),
        "strategy": strategy,
    }


enriched_rows = []
rows_by_staff = defaultdict(list)
groups_by_lane = defaultdict(lambda: Counter())
groups_by_staff = defaultdict(lambda: Counter())
groups_by_shipper = defaultdict(lambda: Counter())
action_summary = defaultdict(lambda: {"count": 0, "usedTeu": 0.0, "revenueProtectionGap": 0.0})

for key, rate in rate_by_key.items():
    booking = booking_by_key.get(key)
    has_booking = booking is not None
    used_teu = booking["totalTeu"] if booking else 0.0
    cm1_amount = booking["cm1CntrAmount"] if booking else 0.0
    cm1_per_teu = cm1_amount / used_teu if used_teu else 0.0
    has_bl = bool(booking and booking["hasBLRows"] > 0)
    baseline_exists = rate["baselineRows"] > 0
    p75_any_low = rate["anyLowRows"] > 0
    no_baseline = not baseline_exists
    china_hk_origin = rate["cnHkRows"] > 0
    sea_etc_origin = rate["seaEtcRows"] > 0
    guideline_eligible = china_hk_origin or sea_etc_origin
    guideline_matched = rate["guidelineComparableRows"] > 0
    guideline_of_missing = rate["guidelineOfMissingRows"] > 0 and not guideline_matched
    guideline_low = guideline_matched and rate["guidelineLowRows"] > 0
    guideline_rate = rate["guidelineRateSum"] / rate["guidelineComparableRows"] if guideline_matched else 0.0
    guideline_gap_amount = max(0.0, -rate["guidelineGapMin"]) if guideline_matched else 0.0
    guideline_gap_pct = max(0.0, -rate["guidelineGapPctMin"]) if guideline_matched else 0.0
    comparison_exists = guideline_matched or baseline_exists
    any_low = guideline_low if guideline_matched else p75_any_low
    low_gap_amount = guideline_gap_amount if guideline_matched else max(0.0, -rate["minGapAmount"])
    low_gap_pct = guideline_gap_pct if guideline_matched else max(0.0, -rate["minGapPct"])
    revenue_gap = low_gap_amount * used_teu if any_low and used_teu > 0 else 0.0
    if guideline_matched and china_hk_origin:
        comparison_basis = "CN/HK AB Guideline"
    elif guideline_matched:
        comparison_basis = "SEA/ETC Working Rate"
    else:
        comparison_basis = "Internal P75 Baseline"

    tags = []
    if guideline_low:
        tags.append("GUIDE_LOW")
    elif guideline_matched:
        tags.append("GUIDE_MATCHED")
    elif guideline_of_missing:
        tags.append("GUIDE_OF_MISSING")
    elif guideline_eligible:
        tags.append("NO_GUIDELINE")
    if no_baseline:
        tags.append("NO_BASELINE")
    if p75_any_low:
        tags.append("ANY_LOW")
    if low_gap_pct >= 0.20:
        tags.append("SEVERE_LOW")
    if has_booking:
        tags.append("USED_BOOKING")
    else:
        tags.append("NO_BOOKING")
    if has_bl:
        tags.append("HAS_BL")
    if rate["chargeMissing"] or rate["chargeCountMax"] <= 1:
        tags.append("CHARGE_MISSING")
    if used_teu > 0 and cm1_per_teu < thresholds["cm1Low"]:
        tags.append("LOW_CM1")

    if not comparison_exists:
        rate_level = "No Baseline"
    elif low_gap_pct >= 0.20:
        rate_level = "Severe Low"
    elif any_low:
        rate_level = "Low"
    else:
        rate_level = "Normal"
    if guideline_matched:
        low_type = "Guideline Low" if guideline_low else "Guideline Normal"
    else:
        low_type = "Multi Low" if len(rate["lowTypes"]) > 1 else (next(iter(rate["lowTypes"])) + " Low" if rate["lowTypes"] else "Normal")

    row = {
        "id": "|".join(key),
        "rateApplicationNo": rate["rateApplicationNo"],
        "shipperCode": rate["shipperCode"],
        "shipperName": rate["shipperName"],
        "salesStaffNo": rate["salesStaffNo"],
        "lane": lane_label(rate),
        "porPort": rate["porPort"],
        "porCountry": rate["porCountry"],
        "dlyPort": rate["dlyPort"],
        "dlyCountry": rate["dlyCountry"],
        "container": f"{rate['containerSize']}{rate['containerType']}",
        "requestMonth": rate["requestMonth"],
        "baselineExists": baseline_exists,
        "comparisonExists": comparison_exists,
        "comparisonBasis": comparison_basis,
        "chinaHkOrigin": china_hk_origin,
        "seaEtcOrigin": sea_etc_origin,
        "guidelineEligible": guideline_eligible,
        "guidelineMatched": guideline_matched,
        "guidelineOfMissing": guideline_of_missing,
        "guidelineRate": guideline_rate,
        "guidelineGapAmount": guideline_gap_amount,
        "guidelineGapPct": guideline_gap_pct,
        "guidelineSource": rate["guidelineSources"].most_common(1)[0][0] if rate["guidelineSources"] else "",
        "p75AnyLow": p75_any_low,
        "anyLow": any_low,
        "lowType": low_type,
        "rateLevel": rate_level,
        "lowGapAmount": low_gap_amount,
        "lowGapPct": low_gap_pct,
        "hasBooking": has_booking,
        "hasBL": has_bl,
        "bookingCount": len(booking["bookingNos"]) if booking else 0,
        "bookingNos": sorted(value for value in booking["bookingNos"] if value)[:20] if booking else [],
        "blNos": sorted(value for value in booking["blNos"] if value)[:20] if booking else [],
        "bookingDetails": booking["bookingSamples"] if booking else [],
        "bookingStatusCounts": dict(booking["statusCounts"]) if booking else {},
        "usedTeu": used_teu,
        "cm1PerTeu": cm1_per_teu,
        "cm1Amount": cm1_amount,
        "revenueProtectionGap": revenue_gap,
        "chargeCount": rate["chargeCountMax"],
        "quoteBasket": rate["chargeBaskets"].most_common(1)[0][0] if rate["chargeBaskets"] else "",
        "actualBasket": booking["actualBaskets"].most_common(1)[0][0] if booking and booking["actualBaskets"] else "",
        "tags": tags,
    }
    row["recommendedAction"] = action_for(row)
    enriched_rows.append(row)
    rows_by_staff[row["salesStaffNo"]].append(row)

    for group_key, group_map in [
        (row["lane"], groups_by_lane),
        (row["salesStaffNo"], groups_by_staff),
        (row["shipperCode"] or "UNKNOWN", groups_by_shipper),
    ]:
        group = group_map[group_key]
        group["rateKeys"] += 1
        group["baselineKeys"] += 1 if baseline_exists else 0
        group["noBaselineKeys"] += 1 if no_baseline else 0
        group["benchmarkKeys"] += 1 if comparison_exists else 0
        group["benchmarkMissingKeys"] += 1 if not comparison_exists else 0
        group["chinaHkKeys"] += 1 if china_hk_origin else 0
        group["seaEtcKeys"] += 1 if sea_etc_origin else 0
        group["guidelineEligibleKeys"] += 1 if guideline_eligible else 0
        group["guidelineMatchedKeys"] += 1 if guideline_matched else 0
        group["guidelineLowKeys"] += 1 if guideline_low else 0
        group["lowKeys"] += 1 if any_low else 0
        group["matchedKeys"] += 1 if has_booking else 0
        group["blKeys"] += 1 if has_bl else 0
        group["normalKeys"] += 1 if comparison_exists and not any_low else 0
        group["normalMatchedKeys"] += 1 if comparison_exists and not any_low and has_booking else 0
        group["lowMatchedKeys"] += 1 if any_low and has_booking else 0
        group["lowUsedTeu"] += used_teu if any_low else 0
        group["usedTeu"] += used_teu
        group["cm1CntrAmount"] += cm1_amount
        group["revenueProtectionGap"] += revenue_gap

    action = row["recommendedAction"]
    action_summary[action]["count"] += 1
    action_summary[action]["usedTeu"] += used_teu
    action_summary[action]["revenueProtectionGap"] += revenue_gap


rate_keys = len(rate_by_key)
booking_keys = len(booking_by_key)
matched_keys = sum(1 for row in enriched_rows if row["hasBooking"])
baseline_keys = sum(1 for row in enriched_rows if row["baselineExists"])
benchmark_keys = sum(1 for row in enriched_rows if row["comparisonExists"])
benchmark_missing_keys = rate_keys - benchmark_keys
china_hk_keys = sum(1 for row in enriched_rows if row["chinaHkOrigin"])
sea_etc_keys = sum(1 for row in enriched_rows if row["seaEtcOrigin"])
guideline_eligible_keys = sum(1 for row in enriched_rows if row["guidelineEligible"])
guideline_matched_keys = sum(1 for row in enriched_rows if row["guidelineMatched"])
guideline_of_missing_keys = sum(1 for row in enriched_rows if row.get("guidelineOfMissing"))
guideline_low_keys = sum(1 for row in enriched_rows if row["guidelineMatched"] and row["anyLow"])
low_keys = sum(1 for row in enriched_rows if row["anyLow"])
no_baseline_keys = rate_keys - baseline_keys
bl_keys = sum(1 for row in enriched_rows if row["hasBL"])
used_teu_total = sum(row["usedTeu"] for row in enriched_rows)
cm1_amount_total = sum(row["cm1Amount"] for row in enriched_rows)
revenue_gap_total = sum(row["revenueProtectionGap"] for row in enriched_rows)
normal_keys = sum(1 for row in enriched_rows if row["comparisonExists"] and not row["anyLow"])
normal_matched = sum(1 for row in enriched_rows if row["comparisonExists"] and not row["anyLow"] and row["hasBooking"])
low_matched = sum(1 for row in enriched_rows if row["anyLow"] and row["hasBooking"])
low_used_teu = sum(row["usedTeu"] for row in enriched_rows if row["anyLow"])

overview = {
    "rateRows": sum(rec["rateRows"] for rec in rate_by_key.values()),
    "rateKeys": rate_keys,
    "rateApplications": len(rate_apps),
    "rateShippers": len(rate_shippers),
    "lanes": len(rate_lanes),
    "salesStaff": len(rate_staff),
    "bookingRows": sum(rec["bookingRows"] for rec in booking_by_key.values()),
    "bookingKeys": booking_keys,
    "bookingApplications": len(booking_apps),
    "matchedKeys": matched_keys,
    "baselineKeys": baseline_keys,
    "noBaselineKeys": no_baseline_keys,
    "benchmarkKeys": benchmark_keys,
    "benchmarkMissingKeys": benchmark_missing_keys,
    "chinaHkKeys": china_hk_keys,
    "seaEtcKeys": sea_etc_keys,
    "guidelineEligibleKeys": guideline_eligible_keys,
    "guidelineMatchedKeys": guideline_matched_keys,
    "guidelineOfMissingKeys": guideline_of_missing_keys,
    "guidelineLowKeys": guideline_low_keys,
    "guidelineCoverage": pct(guideline_matched_keys, guideline_eligible_keys),
    "guidelineLowRate": pct(guideline_low_keys, guideline_matched_keys),
    "lowKeys": low_keys,
    "blKeys": bl_keys,
    "usedTeu": used_teu_total,
    "cm1Amount": cm1_amount_total,
    "cm1PerTeu": cm1_amount_total / used_teu_total if used_teu_total else 0.0,
    "lowRate": pct(low_keys, benchmark_keys),
    "baselineMissingRate": pct(no_baseline_keys, rate_keys),
    "benchmarkMissingRate": pct(benchmark_missing_keys, rate_keys),
    "bookingConversion": pct(matched_keys, rate_keys),
    "blConversion": pct(bl_keys, matched_keys),
    "rateAcceptanceIndex": pct(normal_matched, normal_keys),
    "discountEffectiveness": pct(low_matched, low_keys) - pct(normal_matched, normal_keys),
    "discountDependency": pct(low_used_teu, used_teu_total),
    "quoteWastePct": pct(rate_keys - matched_keys, rate_keys),
    "revenueProtectionGap": revenue_gap_total,
}

trend = []
for month in sorted(set(rate_months) | set(booking_months)):
    rm = rate_months[month]
    bm = booking_months[month]
    bv = booking_month_values[month]
    trend.append(
        {
            "month": month,
            "rateRows": rm["rateRows"],
            "lowRate": pct(rm["benchmarkLowRows"], rm["benchmarkRows"]),
            "baselineMissingRate": pct(rm["benchmarkMissingRows"], rm["rateRows"]),
            "bookingRows": bm["bookingRows"],
            "blRows": bm["hasBLRows"],
            "usedTeu": bv["totalTeu"],
            "cm1PerTeu": bv["cm1CntrAmount"] / bv["totalTeu"] if bv["totalTeu"] else 0.0,
        }
    )


def summarize_map(group_map, label_key, top_n, sort_key):
    records = []
    for key, group in group_map.items():
        data = normalized_group(group)
        data[label_key] = key
        records.append(data)
    return sorted(records, key=sort_key, reverse=True)[:top_n]


lane_summary = summarize_map(groups_by_lane, "lane", 80, lambda item: item["usedTeu"] + item["revenueProtectionGap"] / 1000)
staff_summary = summarize_map(groups_by_staff, "salesStaffNo", 30, lambda item: item["revenueProtectionGap"] + item["rateKeys"] * 50)
shipper_summary = summarize_map(groups_by_shipper, "shipperCode", 80, lambda item: item["revenueProtectionGap"] + item["usedTeu"])

action_priority = {
    "Working Rate Adjustment": 90,
    "Stop Discount": 85,
    "Raise Rate or Add Charge": 80,
    "Strategic Discount Allowed": 75,
    "Rate Increase Candidate": 70,
    "Space Priority Customer": 65,
    "Audit Rate File": 60,
    "Reduce Quotation Effort": 50,
    "Monitor": 10,
}
def unique_rows(candidate_sets, limit):
    seen = set()
    selected = []
    for candidates in candidate_sets:
        for row in candidates:
            if row["id"] in seen:
                continue
            seen.add(row["id"])
            selected.append(row)
            if len(selected) >= limit:
                return selected
    return selected


priority_candidates = sorted(
    enriched_rows,
    key=lambda row: (
        action_priority.get(row["recommendedAction"], 0),
        row["revenueProtectionGap"],
        row["lowGapPct"],
        row["usedTeu"],
    ),
    reverse=True,
)[:280]
booking_candidates = sorted(
    (row for row in enriched_rows if row["hasBooking"]),
    key=lambda row: (row["usedTeu"], row["revenueProtectionGap"], row["bookingCount"]),
    reverse=True,
)[:260]
bl_candidates = sorted(
    (row for row in enriched_rows if row["hasBL"]),
    key=lambda row: (row["usedTeu"], row["cm1PerTeu"]),
    reverse=True,
)[:160]
low_booking_candidates = sorted(
    (row for row in enriched_rows if row["anyLow"] and row["hasBooking"]),
    key=lambda row: (row["revenueProtectionGap"], row["lowGapPct"], row["usedTeu"]),
    reverse=True,
)[:220]
staff_candidates = []
for staff_rows in rows_by_staff.values():
    staff_candidates.extend(
        sorted(
            staff_rows,
            key=lambda row: (action_priority.get(row["recommendedAction"], 0), row["revenueProtectionGap"], row["usedTeu"]),
            reverse=True,
        )[:2]
    )

main_matrix = unique_rows(
    [priority_candidates, booking_candidates, bl_candidates, low_booking_candidates, staff_candidates],
    900,
)

no_baseline_rows = [row for row in enriched_rows if "NO_BASELINE" in row["tags"]]
no_baseline_reason_counts = Counter(no_baseline_reason(row) for row in no_baseline_rows)
no_baseline_groups_by_key = {}

for row in no_baseline_rows:
    group_key = (
        row["salesStaffNo"],
        row["shipperCode"],
        row["shipperName"],
        row["lane"],
    )
    group = no_baseline_groups_by_key.setdefault(
        group_key,
        {
            "salesStaffNo": row["salesStaffNo"],
            "shipperCode": row["shipperCode"],
            "shipperName": row["shipperName"],
            "lane": row["lane"],
            "porPort": row["porPort"],
            "porCountry": row["porCountry"],
            "dlyPort": row["dlyPort"],
            "dlyCountry": row["dlyCountry"],
            "keyCount": 0,
            "rateApplicationNos": set(),
            "containers": set(),
            "unresolvedKeys": 0,
            "guidelineFallbackKeys": 0,
            "containerUnmappedKeys": 0,
            "missingShipperKeys": 0,
            "guidelineUnmappedKeys": 0,
            "usedTeu": 0.0,
            "reasonCounts": Counter(),
            "checkFileCounts": Counter(),
            "monthStats": defaultdict(lambda: Counter()),
        },
    )
    reason = no_baseline_reason(row)
    month_stats = group["monthStats"][row["requestMonth"]]
    group["keyCount"] += 1
    group["rateApplicationNos"].add(row["rateApplicationNo"])
    group["containers"].add(row["container"])
    group["unresolvedKeys"] += 0 if row["comparisonExists"] else 1
    group["guidelineFallbackKeys"] += 1 if row["comparisonExists"] else 0
    group["containerUnmappedKeys"] += 1 if row["container"] in ("", "0000") else 0
    group["missingShipperKeys"] += 1 if not row["shipperCode"] and not row["shipperName"] else 0
    group["guidelineUnmappedKeys"] += 1 if row["guidelineEligible"] and not row["guidelineMatched"] else 0
    group["usedTeu"] += row["usedTeu"]
    group["reasonCounts"][reason] += 1
    group["checkFileCounts"][no_baseline_check_file(row)] += 1
    month_stats["keyCount"] += 1
    month_stats["unresolvedKeys"] += 0 if row["comparisonExists"] else 1
    month_stats["guidelineFallbackKeys"] += 1 if row["comparisonExists"] else 0
    month_stats["containerUnmappedKeys"] += 1 if row["container"] in ("", "0000") else 0
    month_stats["missingShipperKeys"] += 1 if not row["shipperCode"] and not row["shipperName"] else 0
    month_stats["guidelineUnmappedKeys"] += 1 if row["guidelineEligible"] and not row["guidelineMatched"] else 0

no_baseline_groups = []
for group in no_baseline_groups_by_key.values():
    primary_reason = group["reasonCounts"].most_common(1)[0][0]
    check_file = group["checkFileCounts"].most_common(1)[0][0]
    no_baseline_groups.append(
        {
            "salesStaffNo": group["salesStaffNo"],
            "shipperCode": group["shipperCode"],
            "shipperName": group["shipperName"],
            "lane": group["lane"],
            "porPort": group["porPort"],
            "porCountry": group["porCountry"],
            "dlyPort": group["dlyPort"],
            "dlyCountry": group["dlyCountry"],
            "keyCount": group["keyCount"],
            "applicationCount": len(group["rateApplicationNos"]),
            "rateApplicationNos": sorted(group["rateApplicationNos"])[:4],
            "containers": sorted(group["containers"]),
            "primaryReason": primary_reason,
            "checkFile": check_file,
            "monthStats": {
                month: [
                    stats["keyCount"],
                    stats["unresolvedKeys"],
                    stats["guidelineFallbackKeys"],
                    stats["containerUnmappedKeys"],
                    stats["missingShipperKeys"],
                    stats["guidelineUnmappedKeys"],
                ]
                for month, stats in sorted(group["monthStats"].items())
            },
        }
    )

no_baseline_groups.sort(
    key=lambda group: (
        group["keyCount"],
        group["applicationCount"],
    ),
    reverse=True,
)

no_baseline_summary = {
    "totalKeys": len(no_baseline_rows),
    "rate": pct(len(no_baseline_rows), rate_keys),
    "unresolvedKeys": sum(1 for row in no_baseline_rows if not row["comparisonExists"]),
    "guidelineFallbackKeys": sum(1 for row in no_baseline_rows if row["comparisonExists"]),
    "containerUnmappedKeys": sum(1 for row in no_baseline_rows if row["container"] in ("", "0000")),
    "missingShipperKeys": sum(1 for row in no_baseline_rows if not row["shipperCode"] and not row["shipperName"]),
    "guidelineUnmappedKeys": sum(1 for row in no_baseline_rows if row["guidelineEligible"] and not row["guidelineMatched"]),
    "ownerCount": len(set(row["salesStaffNo"] for row in no_baseline_rows)),
    "groupCount": len(no_baseline_groups),
    "reasonCounts": dict(no_baseline_reason_counts),
}

origin_ports = defaultdict(set)
destination_ports = defaultdict(set)
request_months = set()
for row in enriched_rows:
    if row["porCountry"]:
        origin_ports[row["porCountry"]].add(row["porPort"])
    if row["dlyCountry"]:
        destination_ports[row["dlyCountry"]].add(row["dlyPort"])
    if row["requestMonth"] != "UNKNOWN":
        request_months.add(row["requestMonth"])

filter_options = {
    "origins": {country: sorted(port for port in ports if port) for country, ports in sorted(origin_ports.items())},
    "destinations": {country: sorted(port for port in ports if port) for country, ports in sorted(destination_ports.items())},
    "requestMonths": sorted(request_months),
}

rate_level_counts = Counter(row["rateLevel"] for row in enriched_rows)
tag_counts = Counter(tag for row in enriched_rows for tag in row["tags"])

payload = {
    "metadata": {
        "generatedAt": datetime.now().isoformat(timespec="seconds"),
        "sourceFiles": {
            "rateBase": RATE_FILE.name,
            "bookingUsage": BOOKING_FILE.name,
            "guidelineChinaHk": "[CN/HK] Market Rate / AB Customer",
            "guidelineSeaEtc": "Guide rates from S.E.A, ETC.xlsx / KMTC Working rate",
        },
        "guidelineSources": {
            "chinaHk": CHINA_GUIDELINE_SOURCE_SUMMARY,
            "seaEtc": SEA_ETC_GUIDELINE_SOURCE_SUMMARY,
        },
        "joinKey": ["RATE_APPLICATION_NO", "CONTAINER_SIZE", "CONTAINER_TYPE"],
        "limitations": [
            "Booking Usage export excludes Cancel rows, so Quote Waste uses No Booking only.",
            "CN/HK rows use AB Customer guideline OF_RATE. SEA/ETC rows use the latest visible KMTC Working rate from the Office guideline file. If quote OF_RATE is missing, the internal P75 baseline is used.",
            "Revenue Protection Gap uses the most negative comparable benchmark gap multiplied by matched Used TEU.",
        ],
        "thresholds": thresholds,
    },
    "overview": overview,
    "rateFlagCounts": {key: dict(value) for key, value in rate_flag_counts.items()},
    "rateLevelCounts": dict(rate_level_counts),
    "tagCounts": dict(tag_counts),
    "decisionSummary": [
        {
            "action": action,
            "count": values["count"],
            "usedTeu": values["usedTeu"],
            "revenueProtectionGap": values["revenueProtectionGap"],
        }
        for action, values in sorted(action_summary.items(), key=lambda item: action_priority.get(item[0], 0), reverse=True)
    ],
    "trend": trend,
    "laneSummary": lane_summary,
    "staffSummary": staff_summary,
    "shipperSummary": shipper_summary,
    "mainMatrix": main_matrix,
    "filterOptions": filter_options,
    "noBaselineSummary": no_baseline_summary,
    "noBaselineGroups": no_baseline_groups,
    "formulaCatalog": [
        {
            "name": "GUIDE_LOW_FLAG",
            "formula": "Mapped guideline route: OF_RATE < guideline rate (CN/HK AB Customer or SEA/ETC KMTC Working rate)",
        },
        {
            "name": "ANY_LOW_FLAG",
            "formula": "OF_LOW_FLAG = Y OR CORE_LOW_FLAG = Y OR ALL_IN_LOW_FLAG = Y",
        },
        {
            "name": "LOW_GAP_PCT",
            "formula": "If guideline matched: (OF_RATE - Guideline) / ABS(Guideline); otherwise MIN((Quote Rate - Baseline P75) / Baseline P75)",
        },
        {
            "name": "Rate Acceptance Index",
            "formula": "Normal Rate Keys with Booking / Normal Rate Keys",
        },
        {
            "name": "Discount Effectiveness",
            "formula": "Low Quote Booking Conversion - Normal Quote Booking Conversion",
        },
        {
            "name": "Discount Dependency",
            "formula": "Low Quote Used TEU / Total Used TEU",
        },
        {
            "name": "Quote Waste %",
            "formula": "No Booking Rate Keys / Total Rate Keys",
        },
        {
            "name": "Revenue Protection Gap",
            "formula": "MAX(0, Benchmark Comparable Rate - Quote Comparable Rate) * Used TEU",
        },
        {
            "name": "Price Defense Score",
            "formula": "Rate Acceptance * 45% + BL Conversion * 25% + CM1 Score * 30%",
        },
        {
            "name": "Space Priority Score",
            "formula": "BL Conversion * 35% + CM1 Score * 30% + Rate Acceptance * 25% + Usage Score * 10% - Quote Waste * 20%",
        },
    ],
}

OUTPUT_FILE.parent.mkdir(parents=True, exist_ok=True)
with OUTPUT_FILE.open("w", encoding="utf-8") as f:
    json.dump(payload, f, ensure_ascii=False, separators=(",", ":"))

print(f"Wrote {OUTPUT_FILE.relative_to(ROOT)}")
print(f"Rate keys: {rate_keys:,} / Booking keys: {booking_keys:,} / Matched: {matched_keys:,}")
