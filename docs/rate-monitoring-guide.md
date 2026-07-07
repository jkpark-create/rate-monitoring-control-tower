# Rate Monitoring Control Tower Guide

운임파일 등록현황 모니터링 대시보드의 데이터 생성, 저운임 판정 로직, 화면 사용법, 운영 절차, 최근 개발 업데이트를 정리한 가이드입니다.

최종 업데이트: 2026-06-25

## 1. 목적

이 대시보드는 등록된 O/F 운임 중 영업 검토가 필요한 저운임 건을 빠르게 찾기 위한 모니터링 화면입니다. 단순히 낮은 O/F를 찾는 것이 아니라, 파일에 등록된 surcharge와 local charge를 반영한 all-in 기준으로 Market Rate 또는 기간 평균과 비교합니다.

대시보드는 등록 오류를 단정하는 도구가 아니라 확인 우선순위를 정하는 도구입니다. 최종 조정 여부는 계약, 프로모션, 특수 화물 조건, 담당자 확인을 함께 보고 판단합니다.

## 2. 최근 개발 업데이트

### 2026-07-07 반영 사항

- US 진행 건처럼 `SP301I`의 booking shipper 이름이 비어 있는 운임은 `M_SA201M`의 고객명으로 보강해 화면의 업체명/tooltip에 `No company name`이 남지 않도록 했습니다.
- 브라우저 탭 크래시를 줄이기 위해 운임 레코드 로딩 시 Booking/B/L shipment link 상세를 즉시 객체화하지 않고 필요한 화면에서만 지연 디코딩하도록 변경했습니다. 브라우저 자동 재조회는 기본 비활성화하고, 켜는 경우 최소 30분 간격을 사용합니다.

### 2026-06-25 반영 사항

- Oracle 최신 추출과 Google Drive 운영 캐시 업로드 기준으로 Booking/B/L 번호 상세 조회가 가능하도록 데이터가 갱신되었습니다.
- 상세 패널의 사용 실적 영역에서 `Show by route / vessel / voyage`를 펼치고 항로 행을 선택하면 연결된 Booking No.와 B/L No.를 확인할 수 있습니다.
- B/L이 아직 생성되지 않은 건은 Booking No.와 TEU를 먼저 보여주고, B/L 칸에는 `B/L 미생성`으로 표시합니다.
- 운영 Drive 업로드 시 `weekly-monitoring-details.json`, `weekly-monitoring-shipment-links.json`, `shipment-volumes.json`을 함께 올리고, 메인 `weekly-monitoring.json` metadata에 상세/shipment-link/물량 Drive file id를 기록하도록 정리했습니다.

### 2026-06-15 반영 사항

- CN/HK Market Rate guideline JSON과 SEA/ETC working-rate guideline JSON을 최신 원천 기준으로 갱신했습니다. 생성 시각은 각각 `2026-06-15T12:07:25`, `2026-06-15T12:07:51`입니다.
- Google Drive 문서화를 위한 `scripts/upload-doc-to-gdrive.py`가 추가되었습니다. Markdown 문서를 native Google Docs 파일로 생성하거나 기존 동일 제목 문서를 갱신할 수 있습니다.
- 데이터 파이프라인 상세 문서 `docs/data-pipeline.md`가 추가되어 Oracle 추출, Google Drive 가이드 동기화, Python 빌드, JSON 배포 흐름을 별도 문서로 정리했습니다.

### 최근 기능/로직 변경

- 집계 분석의 기본 화면을 `운임대별` 분석으로 변경했고, 운임대별 기본 차트는 `사이즈·타입별` scatter입니다.
- rate-band scatter의 X축 구간 정렬은 선택 기간에 종속되지 않고, 동일 필터 범위의 전체 BL TEU 물량 기준으로 정렬합니다. 물량이 없으면 운임 건수와 Lane key로 deterministic fallback 정렬합니다.
- 상단 필터에서 OOG Type과 Full/Empty 직접 필터를 제거하고, `사용 실적` 필터를 추가했습니다. 화면 필터는 더 단순해졌지만 기간 평균 비교군 생성에는 OOG Type과 Full/Empty가 계속 사용됩니다.
- booking 사용량 추출에서 `ODS_ICC.M_SA003I`를 추가로 조회해 예정/현재 B/L 배정까지 탐지합니다. 과거 확정 B/L은 `ODS_ICC.CS004R`, 예정/현재 B/L은 `M_SA003I` 최신 `BASC_DT` snapshot으로 보완합니다.
- shipment link 안에 route, vessel, voyage, leg, 선적/도착 구간과 Booking/B/L 번호 목록을 함께 저장해 상세 화면에서 배/항차별 사용 내역을 바로 확인할 수 있습니다.
- charge 상세 생성 시 동일 charge 항목이 중복 표시되지 않도록 charge basket/detail-only 항목을 dedupe합니다.
- 레거시 `scripts/build-data.py`를 제거하고 `scripts/build-weekly-data.py`를 단일 JSON 빌더로 정리했습니다.

## 3. 데이터 소스

| 구분 | 소스 | 대상 | 담당 파일 |
| --- | --- | --- | --- |
| 운임 본문 | Oracle | O/F, surcharge, local charge, charge detail, 고객명 보강 | `scripts/extract-rate-base.sql` |
| Booking 사용량 | Oracle | booking 수, BL 수, TEU | `scripts/extract-booking-usage.sql` |
| Basic Tariff | Oracle | 동적 EFC 상세 조회용 tariff | `scripts/extract-basic-tariff.sql` |
| 운임 적용 항로 | Oracle | rate application route | `scripts/extract-rate-route.sql` |
| CN/HK Market Rate | Google Drive/Sheets | AB Customer tier market guideline | `scripts/sync-china-guideline.py` |
| SEA/ETC Working Rate | Google Drive/Sheets | KMTC working-rate guideline | `scripts/sync-sea-guideline.py` |
| 대시보드 JSON | 로컬/Drive | `weekly-monitoring.json` | `scripts/build-weekly-data.py`, `scripts/upload-to-gdrive.py` |

운영 화면은 최종 JSON 캐시를 읽습니다. GitHub Pages 배포본은 Google Drive의 JSON 파일을 OAuth로 읽도록 구성되어 있으며, 브라우저가 Oracle에 직접 접속하지 않습니다.

## 4. 데이터 생성 흐름

```text
Oracle SQL 추출
  -> data/rate-base-latest.csv
  -> data/booking-usage-latest.csv
  -> data/basic-tariff-latest.csv
  -> data/rate-route-latest.csv
Google Drive market guideline 동기화
  -> scripts/guideline_china_hk.json
  -> scripts/guideline_sea_etc.json
Python 빌드
  -> scripts/build-weekly-data.py
  -> public/data/weekly-monitoring.json
  -> public/data/weekly-monitoring-details.json
  -> public/data/weekly-monitoring-shipment-links.json
  -> public/data/shipment-volumes.json
배포/공유
  -> dist/data/weekly-monitoring.json
  -> dist/data/weekly-monitoring-details.json
  -> dist/data/weekly-monitoring-shipment-links.json
  -> dist/data/shipment-volumes.json
  -> Google Drive 업로드
  -> GitHub Pages 또는 내부 정적 서버에서 조회
```

운영 자동화는 하루 2회, 06:30과 12:00 KST에 실행하도록 Windows 작업 스케줄러에 등록합니다. 소스 DW가 야간 배치 중심으로 갱신되기 때문에 15분 단위 상시 갱신은 임시 운영이나 내부 서버 테스트용으로만 사용합니다.

## 5. 주요 판정 로직

- 유효 운임: 조회 기간과 `EFFECTIVE_START_DATE` / `EFFECTIVE_END_DATE`가 겹치는 운임입니다.
- 비교 대상: O/F가 등록된 `Origin Sales` 운임 행입니다.
- 비교 기준: 모든 저운임 판정은 all-in 기준입니다.
- Market 저운임: 구간, CNTR Size 기준 Market Rate가 직접 매핑되면 Market O/F를 all-in으로 환산해 등록 all-in과 비교합니다. CN/HK는 AB Customer tier를 적용합니다.
- 기간 Avg 저운임: Market Rate가 없으면 동일 Lane, CNTR Size, CNTR Type, Cargo Type, OOG Type, Full/Empty의 기간 평균 all-in으로 fallback합니다.
- 기간 평균 fallback은 비교군이 최소 3건 이상일 때만 적용합니다.
- US 향발 운임은 PSS와 GRI를 비교 all-in 계산에서 제외합니다. 단, 상세 항목에는 표시합니다.

### 비교군을 나누는 이유

이 대시보드는 전체 평균과 등록 운임을 단순 비교하지 않습니다. 같은 구간이라도 운임 수준은 장비와 화물 조건에 따라 달라지기 때문입니다. 기간 평균 fallback 비교군은 아래 조합으로 생성합니다.

```text
Lane
+ CNTR Size
+ CNTR Type
+ Cargo Type
+ OOG Type
+ Full / Empty
```

화면 상단 필터에서는 OOG Type과 Full/Empty를 직접 노출하지 않지만, 비교군 생성에는 계속 포함됩니다. 따라서 화면은 간결하게 유지하면서도 판정 로직은 기존의 조건별 비교 기준을 유지합니다.

### 비교 절차

1. 조회 기간과 유효기간이 겹치는 O/F 등록 운임을 선별합니다.
2. `Lane + CNTR Size + CNTR Type + Cargo Type + OOG Type + Full/Empty`로 비교키를 만듭니다.
3. Market Rate가 직접 매핑되면 Market Rate를 우선 사용합니다.
4. Market Rate가 없으면 같은 비교키의 기간 평균 all-in을 사용합니다.
5. 등록 all-in이 기준 all-in보다 낮으면 확인 대상 저운임으로 표시합니다.

### Market Rate를 all-in으로 환산하는 이유

Market Rate guideline은 O/F 기준입니다. 반면 저운임 판정은 실제 등록 파일의 all-in 수준을 보기 때문에 기준을 맞춰야 합니다.

```text
Market all-in = Market O/F + (등록 all-in - 등록 O/F)
```

즉 등록 운임파일에 포함된 surcharge/local charge 차이를 Market O/F에 더해 Market all-in으로 환산한 뒤 등록 all-in과 비교합니다.

## 6. Booking 사용량 로직

Booking 사용량은 `RATE_APPLICATION_NO + CONTAINER_SIZE + CONTAINER_TYPE` 기준으로 대시보드 운임과 연결합니다.

- `DW_SALES.SP002S`에서 최근 7개월 출항분의 확정/선적 booking을 추출합니다.
- booking container snapshot은 `CLOS_DTM` 최신값 기준으로 dedupe합니다.
- T/S booking도 배별 분석에서 빠지지 않도록 `LEG_SEQ = 1`로 제한하지 않고 전체 leg의 `RTE_CD + VSL_CD + ET_VOY_NO + POR/POL/POD/DLY`를 shipment link로 보존합니다.
- B/L이 아직 생성되지 않은 booking도 배/항차 필터에서 확인되도록 shipment link는 booking 기준으로 만들며, 화면에는 BL 수·TEU와 booking 수·TEU를 분리해 표시합니다.
- TEU는 20' = 수량 x 1, 40'/45' = 수량 x 2로 계산합니다.
- `CS004R`은 과거 확정 B/L mapping, `M_SA003I`는 현재/예정 B/L assignment를 보완합니다.
- Python 빌더는 booking별 `TOTAL_TEU`를 최대값으로 접어 조인 fan-out에 따른 TEU 중복 합산을 방지합니다.
- 화면 상세에는 `부킹 N건 · booking TEU · BL N건 · BL TEU` 형식으로 표시합니다.
- 상세 패널의 연결 항로 목록은 `ROUTE_NAME + VESSEL_CODE + VOYAGE_NO + LEG_SEQ + booking/leg lane` 기준으로 묶입니다. 항로 행을 선택하면 해당 묶음의 Booking No., B/L No., TEU 목록을 표시합니다.
- B/L 번호가 아직 없는 booking은 누락으로 처리하지 않고 `B/L 미생성`으로 표시합니다. 이 경우 booking TEU에는 포함되지만 B/L TEU에는 포함되지 않을 수 있습니다.
- 상단 필터의 `사용 실적`은 booking 또는 BL이 있는 운임과 미사용 운임을 구분합니다.

## 7. Charge 표시 기준

상세 패널은 비교 all-in에 반영되는 항목과 원천 파일에서 조회되는 항목을 함께 보여줍니다.

- `O/F`: Ocean Freight로 분류하고 가장 위에 표시합니다.
- `CUR_CD = USD`인 O/F 외 항목: Surcharge로 분류합니다.
- `CUR_CD != USD`인 항목: Local Charge로 분류합니다.
- `FRT_PNC_CD = P`: 선적지 지불입니다.
- `FRT_PNC_CD = C`: 도착지 지불입니다.
- 정렬 순서: Ocean Freight -> 선적지 지불 -> 도착지 지불 -> Surcharge -> Local Charge.
- 적용 방식은 등록 금액 아래에 `AMOUNT`, `TARIFF`, `WAIVE`, `PERCENT`로 표시합니다.
- `WAIVE` 항목은 금액 없이 상세 조회용으로 표시하고 비교 all-in에는 포함하지 않습니다.
- EFC Basic Tariff처럼 조회 시점에 동적으로 적용되는 항목은 상세 검토용으로 표시하되 비교 all-in에는 포함하지 않습니다.
- charge basket과 detail-only 항목은 dedupe하여 같은 항목이 반복 노출되지 않도록 했습니다.

## 8. 화면 구성

### 조회 조건

조회 조건은 기간, 국가/포트, CNTR Size/Type, Cargo Type, 사용 실적, 영업사원, 업체를 검색형 멀티셀렉트로 제공합니다. 상세 탭에서는 운임번호 검색과 `전체 / 확인대상 / Market 저운임 / 기간 Avg 저운임` 보기 모드를 사용할 수 있습니다.

`사용 실적` 필터는 `실적 있음`과 `실적 없음`을 구분합니다. 실적 데이터가 아직 생성되지 않은 경우 상세에는 `데이터 갱신 후 표시`로 표시됩니다.

### 집계 분석

- 기본 집계 화면은 `운임대별`입니다.
- 운임대별 기본 차트는 `사이즈·타입별` scatter입니다.
- scatter의 점 하나는 운임 한 건을 의미하며, 색상은 정상/Market 저운임/기간 Avg 저운임 상태를 나타냅니다.
- X축은 선적지 또는 도착지 기준으로 전환할 수 있습니다.
- 컨테이너 조합은 화면에서 선택할 수 있으며, 기본 fallback은 `40|HC`가 있으면 40'HC입니다.
- X축 Lane은 현재 필터 범위의 전체 BL TEU 물량 기준으로 정렬합니다. 이 정렬은 선택 기간의 유효 운임 기간에만 묶이지 않기 때문에 물량이 큰 Lane을 안정적으로 앞에 보여줍니다.
- 국가/포트 집계에서는 국가 행을 클릭하면 포트 단위로 확장하고, 포트 행을 클릭하면 상세 목록으로 이동합니다.

### 상세 검토

상세 목록에서는 확인 대상 운임을 행 단위로 보고, 행 선택 시 오른쪽 패널에서 charge 상세, 비교 기준, 사용 실적, 담당자/화주/항로 정보를 확인합니다.

사용 실적 영역의 `Show by route / vessel / voyage` 버튼을 열면 연결된 항로별 사용량이 표시됩니다. 먼저 route/vessel/voyage 행을 선택한 뒤, 아래 `Booking / B/L 번호` 영역에서 Booking No., B/L No., TEU를 확인합니다. 여러 booking이 같은 배/항차에 묶이면 같은 항로 행 아래에 함께 표시됩니다.

이 영역이 `데이터 갱신 후 표시` 또는 `Booking and B/L numbers are available after the next data refresh`로 보이면, 화면 문제가 아니라 현재 캐시가 Booking/B/L 상세 목록을 포함하지 않는 상태일 가능성이 큽니다. `npm run data:oracle`로 `booking-usage-latest.csv`를 새로 추출하고, `python scripts/upload-to-gdrive.py`로 메인/상세/물량 JSON을 함께 업로드해야 합니다.

업체 행을 클릭하면 상세로 이동하지 않고 상단 그래프가 해당 업체 기준으로 변경됩니다. 상단 `EN` / `KO` 토글로 한국어와 영어 화면을 전환하며, 선택값은 브라우저 localStorage에 저장됩니다.

## 9. 운영 명령

로컬 개발:

```bash
npm install
npm run dev
```

기존 CSV로 JSON 재생성:

```bash
npm run data
```

Market guideline 원천을 새로 받은 뒤 JSON 재생성:

```bash
npm run data:fresh
```

Oracle에서 최신 CSV 추출 후 JSON 생성:

```bash
npm run data:oracle
```

15분 주기 임시 반복 추출:

```bash
npm run data:oracle:watch
```

Google Drive에 JSON 업로드:

```bash
python scripts/upload-to-gdrive.py
```

운영 화면이 Drive JSON을 읽는 경우, Oracle 갱신 후에는 위 업로드까지 실행해야 Cache 시각과 Booking/B/L 번호 상세가 화면에 반영됩니다. 이 스크립트는 `weekly-monitoring.json`, `weekly-monitoring-details.json`, `weekly-monitoring-shipment-links.json`, `shipment-volumes.json`을 같은 Drive 폴더에 업데이트하고 메인 metadata에 보조 파일 id를 기록합니다.

Google Drive에 문서 업로드:

```bash
python scripts/upload-doc-to-gdrive.py docs/rate-monitoring-guide.md "Rate Monitoring Control Tower Guide"
```

빌드:

```bash
npm run build
```

작업 스케줄러 등록:

```bash
npm run data:task:install
```

## 10. GitHub Pages 배포

`main` 브랜치에 push하면 `.github/workflows/deploy.yml`이 실행되어 GitHub Pages로 배포됩니다.

```text
https://jkpark-create.github.io/rate-monitoring-control-tower/
```

Google 로그인은 회사 Google 계정 기준으로 동작하며, 배포본은 Drive에 업로드된 JSON 파일을 OAuth 토큰으로 읽습니다. GitHub Pages는 정적 배포본이므로 완전한 준실시간 운영에는 내부 정적 서버와 `data:oracle:watch` 또는 작업 스케줄러 조합이 더 적합합니다.

## 11. 문제 확인 포인트

- 최신 데이터가 보이지 않으면 Google Drive JSON 업로드 시각과 화면 상단 cache 시각을 비교합니다.
- 사용 실적이 모두 비어 있으면 `data/booking-usage-latest.csv` 생성 여부와 `usageAvailable` metadata를 확인합니다.
- 사용 실적 숫자는 보이지만 Booking/B/L 번호 영역에 `데이터 갱신 후 표시`가 나오면 `shipmentLinkAvailable`, `shipmentLinkBookingDetailSchema`, `detailDriveFileId`, `shipmentLinkDriveFileId`, `shipmentVolumeDriveFileId`가 최신 `weekly-monitoring.json` metadata에 들어 있는지 확인합니다.
- 특정 route/vessel/voyage 행의 번호가 기대보다 적으면 B/L 미생성 booking인지 먼저 확인합니다. B/L 미생성 건은 Booking No.만 표시되고 B/L 칸은 `B/L 미생성`으로 표시됩니다.
- 예정 B/L이 누락되면 `M_SA003I` 최신 `BASC_DT`, `CNCL_DT IS NULL`, booking number mapping을 확인합니다.
- charge 금액이 비어 있으면 원천 적용 방식이 `WAIVE`인지 먼저 확인합니다.
- local charge의 등록 금액이 비어 있는데 USD 환산만 보이면 `CUR_CD`, `LOC_AMT`, `USD_AMT`, `FIX_USD_AMT` 추출 여부를 확인합니다.
- 특정 charge가 누락되면 Basic Tariff 상세 조회 항목인지, 비교 basket 항목인지 구분합니다.
- rate-band scatter 정렬이 기대와 다르면 선택 기간이 아니라 현재 scope 전체의 BL TEU 기준으로 정렬된다는 점을 먼저 확인합니다.
- 배포 후 404가 뜨면 GitHub Pages source, repository name, Vite `base` 설정, OAuth redirect URI를 함께 확인합니다.

## 12. 핵심 파일 레퍼런스

| 파일 | 역할 |
| --- | --- |
| `src/App.tsx` | React 대시보드 화면, 필터, 집계/상세 분석, rate-band scatter |
| `src/App.css` | 대시보드 스타일 |
| `public/guide.html` | 화면에서 여는 사용자 가이드 |
| `docs/data-pipeline.md` | 데이터 수집/가공 상세 문서 |
| `scripts/refresh-dashboard-data.py` | 전체 데이터 갱신 오케스트레이션 |
| `scripts/build-weekly-data.py` | CSV/가이드라인을 대시보드 JSON으로 변환 |
| `scripts/extract-rate-base.sql` | 운임 본문 추출 |
| `scripts/extract-booking-usage.sql` | booking/BL/TEU 사용량 추출 |
| `scripts/extract-basic-tariff.sql` | Basic Tariff 추출 |
| `scripts/extract-rate-route.sql` | 운임 적용 항로 추출 |
| `scripts/sync-china-guideline.py` | CN/HK Market Rate guideline JSON 생성 |
| `scripts/sync-sea-guideline.py` | SEA/ETC working-rate guideline JSON 생성 |
| `scripts/upload-to-gdrive.py` | JSON 산출물 Google Drive 업로드 |
| `scripts/upload-doc-to-gdrive.py` | Markdown 문서 Google Docs 변환 업로드 |
