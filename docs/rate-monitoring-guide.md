# Rate Monitoring Control Tower Guide

운임파일 등록현황 모니터링 대시보드의 데이터 생성, 판정 로직, 화면 사용법, 배포/운영 절차를 정리한 가이드입니다.

## 1. 목적

이 대시보드는 등록된 O/F 운임 중 영업 검토가 필요한 저운임 건을 빠르게 찾기 위한 모니터링 화면입니다. 단순히 낮은 O/F만 찾는 것이 아니라, 파일에 등록된 surcharge와 local charge를 반영한 all-in 기준으로 비교합니다.

## 2. 데이터 소스

- Rate Base: `scripts/extract-rate-base.sql`
- Basic Tariff: `scripts/extract-basic-tariff.sql`
- Route: `scripts/extract-rate-route.sql`
- CN/HK Market Rate guideline: `scripts/sync-china-guideline.py`
- SEA/ETC working-rate guideline: `scripts/sync-sea-guideline.py`
- JSON 생성: `scripts/build-weekly-data.py`

운영 화면은 최종 JSON 캐시를 읽습니다. GitHub Pages 배포본은 Google Drive의 JSON 파일을 OAuth로 읽도록 구성되어 있습니다.

## 3. 데이터 생성 흐름

```text
Oracle SQL 추출
  -> rate-base-latest.csv
  -> basic-tariff-latest.csv
  -> rate-route-latest.csv
Market guideline / SEA guideline 동기화
  -> scripts/build-weekly-data.py
  -> public/data/weekly-monitoring.json
  -> Google Drive 업로드
  -> GitHub Pages 화면에서 조회
```

운영 자동화는 하루 2회, 06:30과 12:00 KST에 실행하도록 작업 스케줄러에 등록했습니다. 소스 DW가 야간 배치 중심으로 갱신되기 때문에 15분 단위 갱신은 비효율적입니다.

## 4. 주요 판정 로직

- 유효 운임: 조회 기간과 `EFFECTIVE_START_DATE` / `EFFECTIVE_END_DATE`가 겹치는 운임.
- 비교 대상: O/F가 등록된 `Origin Sales` 운임 행.
- 비교 기준: 모든 저운임 판정은 all-in 기준입니다.
- Market 저운임: 구간, CNTR Size 기준 Market Rate가 직접 매핑되면 Market O/F를 all-in으로 환산해 등록 all-in과 비교합니다. CN/HK는 Rate Dashboard와 동일하게 CD tier를 우선 적용합니다.
- 기간 Avg 저운임: Market Rate가 없으면 동일 구간, CNTR Size, CNTR Type, Cargo Type, OOG Type, Full/Empty의 기간 평균 all-in으로 fallback 합니다.
- 기간 평균 fallback은 비교군이 최소 3건 이상일 때만 적용합니다.
- US 향발 운임은 PSS와 GRI를 비교 all-in 계산에서 제외합니다. 단, 상세 항목에는 표시합니다.

### 비교군을 이렇게 나누는 이유

이 대시보드는 전체 평균과 등록 운임을 단순 비교하지 않습니다. 같은 구간이라도 운임 수준은 장비와 화물 조건에 따라 달라지기 때문입니다. 그래서 기간 평균 fallback 비교군은 아래 조합으로 생성합니다.

```text
Lane
+ CNTR Size
+ CNTR Type
+ Cargo Type
+ OOG Type
+ Full / Empty
```

- `Lane`: 출발/도착 구간이 다르면 시장 가격대가 달라집니다.
- `CNTR Size`: 20/40/45는 단가 구조가 다릅니다.
- `CNTR Type`: GP/HC/TK/RF 등 장비 타입별 비용과 시장가가 다릅니다.
- `Cargo Type`: General, HZ, RF, OOG, ING, FB 등 화물 성격에 따라 비용/리스크가 다릅니다.
- `OOG Type`: OH/OW/OL 등 초과 규격 조건은 장비 운용 난이도가 달라집니다.
- `Full / Empty`: Full 영업 운임과 Empty 재배치성 운임은 목적이 다릅니다.

### 비교 절차

1. 조회 기간과 유효기간이 겹치는 O/F 등록 운임을 선별합니다.
2. `Lane + CNTR Size + CNTR Type + Cargo Type + OOG Type + Full/Empty`로 비교키를 만듭니다.
3. Market Rate가 직접 매핑되면 Market Rate를 우선 사용합니다.
4. Market Rate가 없으면 같은 비교키의 기간 평균 all-in을 사용합니다.
5. 등록 all-in이 기준 all-in보다 낮으면 확인 대상 저운임으로 표시합니다.

### CN/HK Market Rate 매핑

CN/HK Market Rate는 기존 `kmtc-rate-dashboard`와 같은 원천 엑셀을 사용합니다. 화면에서 사용자가 보는 기준과 다르지 않도록 CD tier를 우선 적용하고, 동일 주차에 같은 구간이 복수 행으로 존재하면 Rate Dashboard와 동일하게 평균값을 사용합니다.

포트 매핑도 Market Rate 시트 기준으로 정규화합니다.

- `SHK`, `YTN` 출발은 `SZP` Market Rate를 사용합니다.
- `NNS` 출발은 `CAN` Market Rate를 사용합니다.
- 예: `SHK -> BKK 20GP`는 `SZP -> BKK 20'` 기준을 사용하고, `40GP/40HC`는 `SZP -> BKK 40'` 기준을 사용합니다.

### Market Rate를 all-in으로 환산하는 이유

Market Rate guideline은 O/F 기준입니다. 반면 저운임 판정은 실제 등록 파일의 all-in 수준을 보기 때문에 기준을 맞춰야 합니다.

```text
Market all-in = Market O/F + (등록 all-in - 등록 O/F)
```

즉 등록 운임파일에 포함된 surcharge/local charge 차이를 Market O/F에 더해 Market all-in으로 환산한 뒤 등록 all-in과 비교합니다.

### all-in 기준을 사용하는 이유

O/F만 보면 실제 운임 수준을 잘못 판단할 수 있습니다.

- O/F는 낮지만 surcharge/local charge가 높으면 실제 all-in은 낮지 않을 수 있습니다.
- O/F는 정상처럼 보이지만 charge가 누락되면 실제 all-in은 낮을 수 있습니다.

따라서 저운임 판정은 `O/F + 비교 반영 charge`의 all-in 기준으로 수행합니다.

## 5. Charge 표시 기준

상세 패널은 비교 all-in에 반영되는 항목과 원천 파일에서 조회되는 항목을 함께 보여줍니다.

- `O/F`: Ocean Freight로 분류하고 가장 위에 표시합니다.
- `CUR_CD = USD`인 O/F 외 항목: Surcharge로 분류합니다.
- `CUR_CD != USD`인 항목: Local Charge로 분류합니다.
- `FRT_PNC_CD = P`: 선적지 지불.
- `FRT_PNC_CD = C`: 도착지 지불.
- 정렬 순서: Ocean Freight -> 선적지 지불 -> 도착지 지불 -> Surcharge -> Local Charge.
- 적용 방식은 등록 금액 아래에 `AMOUNT`, `TARIFF`, `WAIVE`, `PERCENT`로 표시합니다.
- `WAIVE` 항목은 금액 없이 상세 조회용으로 표시하고 비교 all-in에는 포함하지 않습니다.
- EFC Basic Tariff처럼 조회 시점에 동적으로 적용되는 항목은 상세 검토용으로 표시하되 비교 all-in에는 포함하지 않습니다.

## 6. 화면 구성

- 조회 조건: 기간, 국가/포트, CNTR, Cargo Type, OOG Type, Full/Empty, 영업사원, 업체를 검색형 멀티셀렉트로 필터링합니다.
- 집계 분석: 국가 단위로 먼저 보여주고, 국가를 클릭하면 포트 단위로 확장합니다.
- 상세: 확인 대상 운임을 행 단위로 보고, 행 선택 시 오른쪽 패널에서 charge 상세를 확인합니다.
- 확인 집중 구간: 집계 탭에서만 보이며 저운임 건수와 저운임 화주수 기준으로 Lane 상위 10개를 보여줍니다.
- 업체별 트렌드: 업체 행을 클릭하면 상세로 이동하지 않고 상단 그래프가 해당 업체 기준으로 변경됩니다.
- 언어 전환: 상단 `EN` / `KO` 토글로 한국어와 영어 화면을 전환합니다. 선택값은 브라우저 localStorage에 저장됩니다.
- 외부 대시보드: 상단 `Rate Dashboard` 버튼은 `https://jkpark-create.github.io/kmtc-rate-dashboard/`로 연결됩니다.

## 7. 운영 명령

로컬 개발:

```bash
npm install
npm run dev
```

기존 CSV로 JSON 재생성:

```bash
npm run data
```

Oracle에서 최신 CSV 추출 후 JSON 생성:

```bash
npm run data:oracle
```

GitHub Drive 업로드:

```bash
python scripts/upload-to-gdrive.py
```

빌드:

```bash
npm run build
```

작업 스케줄러 등록:

```bash
npm run data:task:install
```

## 8. GitHub Pages 배포

`main` 브랜치에 push하면 `.github/workflows/deploy.yml`이 실행되어 GitHub Pages로 배포됩니다. 배포 주소는 다음과 같습니다.

```text
https://jkpark-create.github.io/rate-monitoring-control-tower/
```

Google 로그인은 회사 Google 계정 기준으로 동작하며, 배포본은 Drive에 업로드된 JSON 파일을 OAuth 토큰으로 읽습니다.

## 9. 문제 확인 포인트

- 최신 데이터가 보이지 않으면 Google Drive JSON 업로드 시각과 화면 상단 cache 시각을 비교합니다.
- charge 금액이 비어 있으면 원천 적용 방식이 `WAIVE`인지 먼저 확인합니다.
- local charge의 등록 금액이 비어 있는데 USD 환산만 보이면 `CUR_CD`, `LOC_AMT`, `USD_AMT`, `FIX_USD_AMT` 추출 여부를 확인합니다.
- 특정 charge가 누락되면 Basic Tariff 상세 조회 항목인지, 비교 Basket 항목인지 구분합니다.
- 배포 후 404가 뜨면 GitHub Pages source와 repository name, Vite `base` 설정, OAuth redirect URI를 함께 확인합니다.
