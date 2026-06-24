import csv
import json
import shutil
import time
from datetime import datetime
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
BOOKING_USAGE_FILE = ROOT / "data" / "booking-usage-latest.csv"
OUTPUT_FILE = ROOT / "public" / "data" / "shipment-volumes.json"


def number(value, default=0.0):
    try:
        return float(value)
    except (TypeError, ValueError):
        return default


def first_value(row, *names):
    for name in names:
        value = (row.get(name, "") or "").strip()
        if value:
            return value
    return ""


def sortable_leg_seq(value):
    try:
        return int(value)
    except (TypeError, ValueError):
        return 9999


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


def write_json_atomic(payload, target):
    target.parent.mkdir(parents=True, exist_ok=True)
    temporary_file = target.with_suffix(".json.tmp")
    with temporary_file.open("w", encoding="utf-8") as output:
        json.dump(payload, output, ensure_ascii=False, separators=(",", ":"))
    replace_file(temporary_file, target)


def update_departure_range(volume, departure_date):
    if not departure_date:
        return
    start = volume.get("departureStart", "")
    end = volume.get("departureEnd", "")
    if not start or departure_date < start:
        volume["departureStart"] = departure_date
    if not end or departure_date > end:
        volume["departureEnd"] = departure_date


def build_shipment_volumes(path):
    if not path.exists():
        raise FileNotFoundError(f"Missing booking usage file: {path}")

    aggregates = {}
    row_count = 0
    with path.open("r", encoding="utf-8-sig", newline="") as source:
        reader = csv.DictReader(source)
        for row in reader:
            row_count += 1
            booking_no = (row.get("BOOKING_NO", "") or "").strip()
            if not booking_no:
                continue

            route_name = first_value(row, "ROUTE_NAME", "ROUTE_CODE", "RTE_CD", "ROUTE")
            leg_seq = first_value(row, "LEG_SEQ", "LEG")
            vessel = first_value(row, "VESSEL_CODE", "VSL_CD", "VESSEL")
            voyage = first_value(row, "VOYAGE_NO", "VOY_NO", "VOYAGE")
            if not (route_name or leg_seq or vessel or voyage):
                continue

            booking_por_country = first_value(row, "POR_COUNTRY", "POR_CTR_CD")
            booking_por_port = first_value(row, "POR_PORT", "POR_PLC_CD")
            leg_origin_country = first_value(row, "LEG_ORIGIN_COUNTRY", "POL_CTR_CD")
            leg_origin_port = first_value(row, "LEG_ORIGIN_PORT", "POL_PORT_CD")
            leg_destination_country = first_value(row, "LEG_DESTINATION_COUNTRY", "POD_CTR_CD")
            leg_destination_port = first_value(row, "LEG_DESTINATION_PORT", "POD_PORT_CD")
            booking_dly_country = first_value(row, "DLY_COUNTRY", "DLY_CTR_CD")
            booking_dly_port = first_value(row, "DLY_PORT", "DLY_PLC_CD")
            container_size = first_value(row, "CONTAINER_SIZE", "CNTR_SZ_CD")
            container_type = first_value(row, "CONTAINER_TYPE", "CNTR_TYP_CD")
            key = (
                route_name,
                vessel,
                voyage,
                leg_seq,
                booking_por_country,
                booking_por_port,
                leg_origin_country,
                leg_origin_port,
                leg_destination_country,
                leg_destination_port,
                booking_dly_country,
                booking_dly_port,
                container_size,
                container_type,
            )
            volume = aggregates.get(key)
            if volume is None:
                volume = {
                    "bookings": set(),
                    "blCount": 0,
                    "bookingTeu": 0.0,
                    "shippedTeu": 0.0,
                    "departureStart": "",
                    "departureEnd": "",
                }
                aggregates[key] = volume

            has_bl = row.get("HAS_BL_FLAG", "") == "Y"
            if booking_no not in volume["bookings"]:
                volume["bookings"].add(booking_no)
                booking_teu = number(row.get("TOTAL_TEU"))
                volume["bookingTeu"] += booking_teu
                if has_bl:
                    volume["shippedTeu"] += booking_teu
                    volume["blCount"] += 1
            update_departure_range(volume, (row.get("DEPARTURE_DATE", "") or "").strip())

    shipment_volumes = []
    for (
        route_name,
        vessel,
        voyage,
        leg_seq,
        booking_por_country,
        booking_por_port,
        leg_origin_country,
        leg_origin_port,
        leg_destination_country,
        leg_destination_port,
        booking_dly_country,
        booking_dly_port,
        container_size,
        container_type,
    ), volume in aggregates.items():
        shipment_volumes.append(
            (
                route_name,
                vessel,
                voyage,
                leg_seq,
                booking_por_country,
                booking_por_port,
                leg_origin_country,
                leg_origin_port,
                leg_destination_country,
                leg_destination_port,
                booking_dly_country,
                booking_dly_port,
                container_size,
                container_type,
                volume["blCount"],
                len(volume["bookings"]),
                round(volume["shippedTeu"], 1),
                round(volume["bookingTeu"], 1),
                volume["departureStart"],
                volume["departureEnd"],
            )
        )

    shipment_volumes.sort(
        key=lambda item: (
            item[18] or "99999999",
            sortable_leg_seq(item[3]),
            item[5],
            item[9],
            item[0],
            item[1],
            item[2],
            item[12],
            item[13],
        )
    )
    return row_count, tuple(shipment_volumes)


def main():
    row_count, shipment_volumes = build_shipment_volumes(BOOKING_USAGE_FILE)
    payload = {
        "metadata": {
            "generatedAt": datetime.now().isoformat(timespec="seconds"),
            "sourceFile": BOOKING_USAGE_FILE.name,
            "sourceRows": row_count,
            "shipmentVolumeCount": len(shipment_volumes),
            "shipmentVolumeSchema": [
                "routeName",
                "vesselCode",
                "voyageNo",
                "legSeq",
                "bookingPorCountry",
                "bookingPorPort",
                "legOriginCountry",
                "legOriginPort",
                "legDestinationCountry",
                "legDestinationPort",
                "bookingDlyCountry",
                "bookingDlyPort",
                "containerSize",
                "containerType",
                "blCount",
                "bookingCount",
                "teu",
                "bookingTeu",
                "departureStart",
                "departureEnd",
            ],
        },
        "shipmentVolumes": shipment_volumes,
    }
    write_json_atomic(payload, OUTPUT_FILE)
    print(f"Wrote {OUTPUT_FILE.relative_to(ROOT)}")
    print(f"Source rows: {row_count:,}")
    print(f"Shipment volume lanes: {len(shipment_volumes):,}")


if __name__ == "__main__":
    main()
