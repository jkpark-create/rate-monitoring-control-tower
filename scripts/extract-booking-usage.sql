-- Booking usage extract for the rate-monitoring dashboard (사용 실적).
--
-- Purpose
-- -------
-- Produces actual booking / B/L usage per rate application + container, so the
-- dashboard can show "부킹 N건 · TEU · BL N건 · TEU" instead of "미사용".
-- It also carries vessel/voyage for B/L-linked rate-file lookup.
-- build-weekly-data.py (build_booking_usage) joins this on
--     (RATE_APPLICATION_NO, CONTAINER_SIZE, CONTAINER_TYPE)
-- and reads ONLY these columns:
--     RATE_APPLICATION_NO, BOOKING_NO, BL_NO,
--     ROUTE_NAME, LEG_SEQ, VESSEL_CODE, VOYAGE_NO,
--     POR_COUNTRY, POR_PORT, LEG_ORIGIN_COUNTRY, LEG_ORIGIN_PORT,
--     LEG_DESTINATION_COUNTRY, LEG_DESTINATION_PORT, DLY_COUNTRY, DLY_PORT,
--     CONTAINER_SIZE, CONTAINER_TYPE, TOTAL_TEU, HAS_BL_FLAG
-- TOTAL_TEU is collapsed per distinct BOOKING_NO (max, then summed) on the build
-- side, so emitting the same booking-level TEU across a booking's B/L rows is safe.
--
-- Sources (confirmed from the existing booking pipeline / Script-2 weekly query)
-- ---------------------------------------------------------------------------
--   DW_SALES.SP002S  booking container snapshot (latest revision per CLOS_DTM)
--   ODS_ICC.CS004R   issued booking -> B/L mapping (historical)
--   ODS_ICC.M_SA003I B/L assignment snapshot behind KMTC's Lifting Detail
--                    (current/planned B/Ls, latest BASC_DT partition)
--
-- The earlier manual DBeaver export also carried financial columns
-- (CM1_*, *_FRT_AMT, ACTUAL_OF_RATE/ALL_IN_RATE, ACTUAL_CHARGE_BASKET, ...).
-- They are intentionally omitted here: the live dashboard build never reads them,
-- and their settlement/CM1 source tables are not confirmed in this repo. If those
-- columns are needed again, add the revenue source as a separate CTE and SELECT.
--
-- Window: bookings departing within the last 7 months (covers all rate
-- applications currently in dashboard scope; matches the ~6-month span of the
-- original 2026-05-27 export with margin).
--
-- FRT_APP_NO may be NULL in SP002S even after B/L Master Freight has linked a
-- rate file. Keep those rows, then fall back to B/L Master (CS101M) so
-- B/L-linked rates are not missed.

WITH BOOKING_LATEST AS (
    -- Keep the most recent snapshot row per booking container leg.
    -- Mirrors the proven dedup in the weekly booking query (Script-2).
    SELECT
        A.FRT_APP_NO,
        A.BKG_NO,
        A.BKG_STS_CD,
        A.BKG_SHPR_CST_NO,
        A.RTE_CD,
        A.LEG_SEQ,
        A.POR_CTR_CD,
        A.POR_PLC_CD,
        A.POL_CTR_CD,
        A.POL_PORT_CD,
        A.POD_CTR_CD,
        A.POD_PORT_CD,
        A.DLY_CTR_CD,
        A.DLY_PLC_CD,
        A.VSL_CD,
        A.ET_VOY_NO AS VOY_NO,
        A.CNTR_SZ_CD,
        A.CNTR_TYP_CD,
        A.CNTR_QTY,
        A.RVSD_DPO_DT,
        ROW_NUMBER() OVER (
            PARTITION BY A.BKG_NO, A.CNTR_SEQ, A.LEG_SEQ
            ORDER BY A.CLOS_DTM DESC
        ) AS RN
    FROM DW_SALES.SP002S A
    WHERE A.BKG_STS_CD IN ('01', '04')   -- confirmed / on-board; excludes cancelled bookings
      AND A.RVSD_DPO_DT >= TO_CHAR(ADD_MONTHS(SYSDATE, -7), 'YYYYMMDD')
),

BOOKING_AGG AS (
    -- One row per (rate application, booking, leg, container size/type).
    SELECT
        B.FRT_APP_NO,
        B.BKG_NO,
        MAX(B.BKG_STS_CD)       AS BKG_STS_CD,
        MAX(B.BKG_SHPR_CST_NO)  AS BKG_SHPR_CST_NO,
        MAX(B.RTE_CD)           AS RTE_CD,
        B.LEG_SEQ,
        MAX(B.POR_CTR_CD)       AS POR_CTR_CD,
        MAX(B.POR_PLC_CD)       AS POR_PLC_CD,
        MAX(B.POL_CTR_CD)       AS POL_CTR_CD,
        MAX(B.POL_PORT_CD)      AS POL_PORT_CD,
        MAX(B.POD_CTR_CD)       AS POD_CTR_CD,
        MAX(B.POD_PORT_CD)      AS POD_PORT_CD,
        MAX(B.DLY_CTR_CD)       AS DLY_CTR_CD,
        MAX(B.DLY_PLC_CD)       AS DLY_PLC_CD,
        MAX(B.VSL_CD)           AS VSL_CD,
        MAX(B.VOY_NO)           AS VOY_NO,
        MAX(B.RVSD_DPO_DT)      AS RVSD_DPO_DT,
        B.CNTR_SZ_CD,
        B.CNTR_TYP_CD,
        SUM(NVL(B.CNTR_QTY, 0)) AS CNTR_QTY,
        -- TEU: 20' = qty x1, 40'/45' = qty x2 (same rule as the weekly booking query).
        SUM(CASE WHEN B.CNTR_SZ_CD = '20'           THEN NVL(B.CNTR_QTY, 0) * 1
                 WHEN B.CNTR_SZ_CD IN ('40', '45')  THEN NVL(B.CNTR_QTY, 0) * 2
                 ELSE 0 END)    AS TOTAL_TEU,
        SUM(CASE WHEN B.CNTR_SZ_CD = '20'           THEN NVL(B.CNTR_QTY, 0) * 1 ELSE 0 END) AS TEU_20,
        SUM(CASE WHEN B.CNTR_SZ_CD IN ('40', '45')  THEN NVL(B.CNTR_QTY, 0) * 2 ELSE 0 END) AS TEU_40,
        -- Informational: high-cube subset (overlaps TEU_40); TOTAL_TEU stays authoritative.
        SUM(CASE WHEN B.CNTR_TYP_CD = 'HC'          THEN NVL(B.CNTR_QTY, 0) * 2 ELSE 0 END) AS TEU_HC
    FROM BOOKING_LATEST B
    WHERE B.RN = 1
    GROUP BY
        B.FRT_APP_NO,
        B.BKG_NO,
        B.LEG_SEQ,
        B.CNTR_SZ_CD,
        B.CNTR_TYP_CD
),

BKG_BL AS (
    -- Distinct B/L numbers per booking (a booking can split into several B/Ls).
    -- CS004R holds historically issued B/Ls (large, covers past sailings).
    -- M_SA003I is the snapshot behind KMTC's Lifting Detail and carries the
    -- current B/L assignment per booking -- including B/Ls created before
    -- sailing that CS004R does not yet contain. Union both so the dashboard
    -- matches the booking screen for upcoming sailings without losing
    -- past-shipment B/Ls; M_SA003I is pinned to its latest snapshot (one
    -- partition) and excludes cancelled B/Ls.
    SELECT DISTINCT BKG_NO, BL_NO
    FROM ODS_ICC.CS004R
    WHERE BL_NO IS NOT NULL
    UNION
    SELECT DISTINCT BKG_NO, BL_NO
    FROM ODS_ICC.M_SA003I
    WHERE BL_NO IS NOT NULL
      AND CNCL_DT IS NULL
      AND BASC_DT = (SELECT MAX(BASC_DT) FROM ODS_ICC.M_SA003I)
),

BL_RATE AS (
    SELECT
        L.BKG_NO,
        L.BL_NO,
        MAX(C.FRT_APP_NO) AS FRT_APP_NO
    FROM BKG_BL L
    LEFT JOIN ODS_ICC.CS101M C
        ON C.BL_NO = L.BL_NO
       AND C.FRT_APP_NO IS NOT NULL
    GROUP BY
        L.BKG_NO,
        L.BL_NO
)

SELECT
    COALESCE(B.FRT_APP_NO, L.FRT_APP_NO) AS RATE_APPLICATION_NO,
    B.BKG_NO              AS BOOKING_NO,
    L.BL_NO               AS BL_NO,
    B.BKG_STS_CD          AS BOOKING_STATUS_CODE,
    B.BKG_SHPR_CST_NO     AS BOOKING_SHIPPER_CODE,
    B.RTE_CD              AS ROUTE_NAME,
    B.LEG_SEQ             AS LEG_SEQ,
    B.POR_CTR_CD          AS POR_COUNTRY,
    B.POR_PLC_CD          AS POR_PORT,
    B.POL_CTR_CD          AS LEG_ORIGIN_COUNTRY,
    B.POL_PORT_CD         AS LEG_ORIGIN_PORT,
    B.POD_CTR_CD          AS LEG_DESTINATION_COUNTRY,
    B.POD_PORT_CD         AS LEG_DESTINATION_PORT,
    B.DLY_CTR_CD          AS DLY_COUNTRY,
    B.DLY_PLC_CD          AS DLY_PORT,
    B.VSL_CD              AS VESSEL_CODE,
    B.VOY_NO              AS VOYAGE_NO,
    B.RVSD_DPO_DT         AS DEPARTURE_DATE,
    B.CNTR_SZ_CD          AS CONTAINER_SIZE,
    B.CNTR_TYP_CD         AS CONTAINER_TYPE,
    B.CNTR_QTY            AS CNTR_QTY,
    B.TEU_20              AS TEU_20,
    B.TEU_40              AS TEU_40,
    B.TEU_HC              AS TEU_HC,
    B.TOTAL_TEU           AS TOTAL_TEU,
    CASE WHEN L.BL_NO IS NOT NULL THEN 'Y' ELSE 'N' END AS HAS_BL_FLAG
FROM BOOKING_AGG B
LEFT JOIN BL_RATE L
    ON L.BKG_NO = B.BKG_NO;
