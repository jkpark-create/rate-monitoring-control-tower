# Rate Monitoring — 데이터 수집 로직 정리

> 운임 모니터링 대시보드(Origin Sales 등록 운임 감시)의 데이터 파이프라인 전체 문서
> 최종 정리일: 2026-06-15

---

## 1. 개요

이 프로젝트는 Origin Sales가 등록한 해상 운임(O/F + 부대비)을 수집하여, 시장 가이드라인 및 기간 평균과 비교해 **의심스러운 저운임**을 찾아내는 React/TypeScript 대시보드입니다.

데이터는 다음 흐름으로 처리됩니다.

```
Oracle DB + Google Drive(시장 가이드) → CSV/JSON 추출 → Python 가공 → weekly-monitoring.json → 대시보드
```

- **Frontend:** React 19, TypeScript, Vite, Recharts
- **Data 처리:** Python 3, Oracle(`python-oracledb` Thin 모드), Google Drive REST API
- **데이터 형식:** Oracle → CSV → Python 가공 → 단일 JSON(대시보드 소비)

---

## 2. 데이터 소스

| 구분 | 소스 | 대상 테이블 / 파일 | 추출 방법 |
|------|------|------|------|
| 운임 본문 | Oracle | `DW_SALES.SP301I`, `ODS_ICC.SA202D`, `ODS_ICC.SA215I` | `extract-rate-base.sql` |
| Booking 사용량 | Oracle | `DW_SALES.SP002S`, `ODS_ICC.CS004R`, `ODS_ICC.M_SA003I`, `ODS_ICC.CS101M` | `extract-booking-usage.sql` |
| Basic Tariff(EFC) | Oracle | `DW_SALES.SP301I02` | `extract-basic-tariff.sql` |
| 운임 적용 항로 | Oracle | `ODS_ICC.SA201M` | `extract-rate-route.sql` |
| CN/HK 시장가이드 | Google Drive | `[CN_HK] Market Rate.xlsx` | Drive API 다운로드 → 파싱 |
| SEA/ETC 시장가이드 | Google Drive | `[SEA] Market Rate.xlsx` | Drive API 다운로드 → 파싱 |

### 2.1 운임 본문 (Oracle)
- 운임 등록 레코드 본체. O/F 및 각종 부대비(THC, LSS, FAF, WRS, EFC, CIS, SEC 등)를 추출.
- 유효기간 범위: 오늘 기준 **과거 6개월 ~ 미래 13개월**.
- `APV_STS='03'`(승인) 상태의 O/F 적용건만 스코프로 사용.
- HQ route team 전체(`BIZ_TEAM_CAT_CD IN ('O', 'E', 'I', 'J')`, OBT/EST/IST/JBT)를 추출해 배/항차 사용 운임이 특정 팀 코드 때문에 누락되지 않게 합니다.

### 2.2 Booking 사용량 (Oracle)
- 운임 적용 단위별 **실제 사용량**(BL 수, Booking 수, TEU)을 제공.
- 최근 **7개월** 출항분 대상.
- TEU 계산: 20' = 수량 × 1, 40'/45' = 수량 × 2.
- 조인 fan-out으로 인한 중복은 `CLOS_DTM` 최신값 기준으로 먼저 제거하고, 최신 booking 상태가 확정/선적(STS `01`, `04`)인 경우만 집계합니다.
- T/S 누락 방지를 위해 `SP002S.LEG_SEQ` 전체를 추출하고, leg별 `RTE_CD + VSL_CD + ET_VOY_NO + POR/POL/POD/DLY`를 shipment link로 보존합니다.
- B/L이 아직 생성되지 않은 booking도 vessel/voyage 필터에서 확인되도록 shipment link는 booking 기준으로 생성하고, BL 수·TEU와 booking 수·TEU를 분리해 저장합니다.
- 과거 확정 B/L은 `ODS_ICC.CS004R`, 현재/예정 B/L assignment는 `ODS_ICC.M_SA003I` 최신 `BASC_DT` snapshot을 함께 사용.
- `SP002S.FRT_APP_NO`가 비어 있어도 B/L Master Freight에 운임이 링크된 경우가 있어 `ODS_ICC.CS101M.FRT_APP_NO`로 보강합니다.

### 2.3 시장 가이드라인 (Google Drive)
- **CN/HK:** AB 등급(고가치) 고객 운임을 사용. 사이드 프로젝트 `organizing rate file`의 파서를 재사용.
- **SEA/ETC:** KMTC working rate 사용. LCH 기준가에 고정 가산($100/20', $150/40')하여 LKB 등 파생.
- Drive API(OAuth 2.0, `.gdrive-mcp`의 refresh token)로 Google Sheets를 XLSX로 내보낸 뒤 파싱.

---

## 3. 추출 계층 (SQL)

| 파일 | 입력 테이블 | 출력 |
|------|------|------|
| `extract-rate-base.sql` | SP301I, SA202D, SA215I | `data/rate-base-latest.csv` (70+ 컬럼) |
| `extract-basic-tariff.sql` | SP301I02 | `data/basic-tariff-latest.csv` |
| `extract-rate-route.sql` | SA201M | `data/rate-route-latest.csv` |
| `extract-booking-usage.sql` | SP002S, CS004R, M_SA003I, CS101M | `data/booking-usage-latest.csv` |

`extract-rate-base.sql`은 `UNION ALL`로 다음 행 타입을 결합합니다.
- `OCEAN_FREIGHT` — 기본 O/F (USD > 0)
- `CHARGE_GROUP` — 컨테이너 사이즈/타입별 부대비 집계
- `WAIVE_GROUP` — 면제 항목
- `DETAIL_ONLY_GROUP` — 상세 표시 전용

주요 출력 필드: `RATE_ROW_TYPE`, `OF_RATE`, 각종 부대비, `ALL_IN_RATE`, `CHARGE_BASKET`('+'로 join된 코드), `CHARGE_DETAIL_LIST`('~'로 join된 파이프 구분 레코드), 항로(`POR/DLY_COUNTRY/PORT`), 화주/영업, 컨테이너(20/40/45, GP/HC/TK…), 화물(`CARGO_TYPE`, `FULL_EMPTY_TYPE`) 등.

---

## 4. 가이드라인 동기화 계층

| 파일 | 역할 | 출력 |
|------|------|------|
| `download-market-guidelines.py` | Drive에서 SEA/CN_HK 워크북 다운로드 (atomic write) | `../organizing rate file/[SEA] / [CN_HK] Market Rate.xlsx` |
| `sync-china-guideline.py` | CN/HK 워크북 파싱 → AB 등급 운임 추출 | `scripts/guideline_china_hk.json` |
| `sync-sea-guideline.py` | SEA/ETC 워크북 파싱 | `scripts/guideline_sea_etc.json` |

동기화 로직: (origin, destination, size)로 그룹화 → 최신 주차 유지 → 다중 행이면 평균 → 반올림 `floor(amount + 0.5)`.

**Python 조회 모듈**
- `guideline_china_ab.py` — 생성된 JSON(`guideline_china_hk.json`) 우선, 없으면 하드코딩 `RAW_RATES` fallback. `is_china_hk_origin()`, `guideline_rate_for()`.
- `guideline_sea_etc.py` — import 시 JSON 로드, 목적지 별칭(KAN→PUS, PTK→INC 등) 처리.

---

## 5. 가공 계층 — `build-weekly-data.py`

CSV들을 읽어 대시보드용 단일 JSON으로 변환하는 핵심 스크립트.

**입력 탐색**
- 1순위: `data/rate-base-latest.csv` (Oracle 추출 또는 `RATE_BASE_CSV` 환경변수)
- fallback: 레거시 `_WITH_RATE_BASE_AS_SELECT_*.csv` / `_WITH_BOOKING_USAGE_AS_SELECT_*.csv`
- Booking 사용량 CSV 없으면 사용량 빈 값으로 graceful degradation.

**주요 상수**
- `RECENT_WEEK_COUNT = 32` (32주 롤링 윈도우)
- `FUTURE_WINDOW_DAYS = 395` (미래 운임 포함 범위)
- `HQ_ROUTE_TEAMS = (OBT, EST, IST, JBT)`
- 시장비교 대상: 컨테이너 타입 ∈ {GP, HC, TK}, 화물타입 `00`(Non-DG)

**처리 단계**
1. **CSV 인덱싱** — O/F 행 분리, CHARGE/WAIVE/DETAIL_ONLY 그룹·tariff 인덱싱.
2. **부대비 병합** — 각 O/F 행에 사이즈/타입(와일드카드 `00` 포함) 매칭 부대비 합산 → `ALL_IN_RATE`, `CHARGE_COUNT`, `CHARGE_BASKET`. 동적 EFC tariff 상세 병합. US 항로는 PSS/GRI를 비교에서 제외(상세는 표시).
3. **시장 비교** — `guideline_for()`로 origin에 따라 CN/HK 또는 SEA/ETC 가이드 조회. all-in < (가이드 O/F + 부대비 델타)이면 "Market 저운임", 기간 그룹 평균 대비 낮으면 "기간 Avg 저운임".
4. **Booking 사용량 집계** — 중복 booking 행 제거 후 booking별 TEU 합산, HAS_BL_FLAG로 BL/Booking 수 분리. B/L TEU와 booking TEU를 따로 저장해 실제 선적 실적과 예정/booking 실적을 함께 볼 수 있게 함.
5. **레코드 변환·인덱싱** — `Origin Sales`만, O/F ≤ 0/유효기간 오류 행 skip. 차원값(항로·화주·영업·팀·컨테이너 등 14종)을 정수 인덱스로 매핑하여 dense 배열로 저장.

---

## 6. 출력 & 배포

**산출물:** `public/data/weekly-monitoring.json`
- 인덱싱된 차원 + 레코드 배열 형태의 컴팩트 JSON (~121–124MB, gzip 효율 높음).
- 약 487K개 O/F 레코드, 14개 차원.
- 메타: `generatedAt`, `sourceFile`, `sourceMode`(canonical/legacy-fallback), `defaultWeek`, `availableStart/EndDate`, `recordCount`, `usageAvailable`, `chargeDetailAvailable`.
- 화면의 `사용 실적` 필터와 상세 패널은 `usageAvailable`, B/L 수, booking 수, B/L TEU, booking TEU를 기준으로 표시.

**배포 경로**
- 로컬 개발: `npm run dev` → `public/data/...` 읽음.
- 빌드: `npm run build` → `dist/data/weekly-monitoring.json` 번들.
- GitHub Pages: 정적 스냅샷(`dist/` 커밋).
- 사내 서버: `npm run data:oracle:watch`(15분 주기 재추출) + `npm run serve:dist`로 준실시간.
- 선택적 Drive 연동: `upload-to-gdrive.py`로 JSON을 "Rate Monitoring" 폴더에 업로드, 회사 도메인(ekmtc.com) read-only 공유. 대시보드는 `VITE_DRIVE_FILE_ID`로 로그인 사용자가 Drive API 통해 읽음.

---

## 7. 오케스트레이션 — `refresh-dashboard-data.py`

전체 갱신을 조율하는 엔트리 포인트.

| 명령 | 동작 |
|------|------|
| `npm run data` | 기존 CSV로 JSON 재빌드 |
| `npm run data:fresh` | 시장가이드 새로 받고 재빌드 |
| `npm run data:oracle` | Oracle 새 추출 + 가이드 동기화 + 빌드 |
| `npm run data:oracle:watch` | 15분(900s) 주기 반복 추출 |
| `npm run data:task:install` | Windows Task Scheduler 등록(매일 06:30, 12:00) |

**실행 흐름:** (`--oracle`이면) Oracle 추출 → 가이드 동기화(`sync-china/sea-guideline.py`) → `build-weekly-data.py`로 JSON 빌드 → (`--build`면 `npm run build`, 아니면 `dist/`로 복사).

**Oracle 접속:** `python-oracledb` Thin 모드(클라이언트 설치 불필요). `.env.local`의 `RATE_DB_DSN`(host:port/service) 또는 `RATE_DBEAVER_CONNECTION` 사용. 5000행 배치 fetch. 임시파일(`*.csv.tmp`) → atomic replace로 OneDrive 잠금 회피.

---

## 8. 데이터 플로우 다이어그램

```
Oracle Database                  Google Drive/Sheets            Legacy Fallback
    │                                  │                              │
extract-rate-base.sql            [CN_HK] Market Rate.xlsx       _WITH_RATE_BASE_*.csv
extract-basic-tariff.sql         [SEA]   Market Rate.xlsx       _WITH_BOOKING_USAGE_*.csv
extract-rate-route.sql                 │
extract-booking-usage.sql        download-market-guidelines.py
    │                                  │
CSV (data/*.csv)                 sync-china/sea-guideline.py
    │                                  │
    │                            guideline_*.json
    └──────────────┬───────────────────┘
                   ▼
          build-weekly-data.py
        (부대비 병합·시장비교·팀분류·차원인덱싱)
                   ▼
      public/data/weekly-monitoring.json  (487K 레코드 / 14 차원)
                   ▼
   ┌───────────────┼───────────────┬────────────────┐
   ▼               ▼               ▼                ▼
 npm run dev   npm run build   GitHub Pages   사내 서버(watch+serve) / Drive 업로드
```

---

## 9. 핵심 파일 레퍼런스

| 파일 | 역할 |
|------|------|
| `scripts/refresh-dashboard-data.py` | 전체 오케스트레이션 |
| `scripts/extract-rate-base.sql` | 운임 본문 추출 |
| `scripts/extract-booking-usage.sql` | 사용량 추출 |
| `scripts/extract-basic-tariff.sql` / `extract-rate-route.sql` | EFC tariff / 항로 |
| `scripts/download-market-guidelines.py` | Drive 워크북 다운로드 |
| `scripts/sync-china-guideline.py` / `sync-sea-guideline.py` | 가이드 파싱·JSON 생성 |
| `scripts/guideline_china_ab.py` / `guideline_sea_etc.py` | 가이드 조회 모듈 |
| `scripts/build-weekly-data.py` | CSV → JSON 빌더 |
| `scripts/upload-to-gdrive.py` | 산출 JSON Drive 업로드 |
| `scripts/upload-doc-to-gdrive.py` | Markdown 가이드를 native Google Docs로 업로드 |
| `public/data/weekly-monitoring.json` | 대시보드 데이터 산출물 |
| `.env.local` | Oracle 자격증명·가이드 소스·Drive 설정 |

---

## 10. 운영 메모

- **이중 모드:** `data:oracle`(Oracle 라이브) vs `data`(기존 CSV 재사용, 개발 빠름).
- **부대비 아키텍처:** SQL `UNION ALL` 결합 → Python에서 적용단위별 재병합 + 동적 EFC + US 항로 예외.
- **시장비교는 O/F ↔ O/F** 기준이며 부대비 델타는 동적 계산.
- **사용량 보강:** CS004R의 과거 B/L과 M_SA003I의 현재/예정 B/L을 합쳐 booking 화면과의 괴리를 줄임.
- **화면 기본 분석:** 집계 화면은 운임대별 scatter를 기본으로 열며, X축 Lane은 선택 기간이 아니라 동일 scope 전체 BL TEU 기준으로 정렬.
- **데이터 밀도:** 레코드를 차원 인덱스의 정수 배열로 저장해 JSON 압축·React 필터링 효율 확보.
- **OneDrive 내구성:** 임시파일 + atomic replace로 동기화 잠금 손상 방지.
