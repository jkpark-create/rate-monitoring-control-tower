# Weekly Rate Watch

선택한 기간에 유효한 등록 O/F 운임 중 확인이 필요한 저운임을 찾는 대시보드입니다.

사용자 가이드는 배포 화면 상단의 `사용자 가이드` 버튼 또는 `public/guide.html`에서 확인할 수 있습니다.
운영/판정/배포 가이드는 [docs/rate-monitoring-guide.md](docs/rate-monitoring-guide.md)에 정리되어 있습니다.

## 판단 기준

- 유효 운임: 선택 기간과 `EFFECTIVE_START_DATE` / `EFFECTIVE_END_DATE`가 겹치는 등록 건. 동일 운임은 기간 안에서 한 번만 집계
- 비교 대상: O/F가 등록된 `Origin Sales` 행
- 비교 기준: 모든 저운임 판정은 **all-in 기준**(`ALL_IN_RATE`)으로 등록값과 비교 기준을 맞춰 수행. 화면에는 O/F와 괄호 안 all-in을 함께 표시
- Market 저운임: CNTR Type `GP`, `HC`, `TK`와 Cargo Type `00`(Non-DG) 중 구간, CNTR Size 기준으로 직접 매핑된 O/F Market Rate가 있으면, 해당 건의 서차지·로컬차지(`ALL_IN_RATE − OF_RATE`)를 더해 all-in으로 환산한 Market Rate보다 등록 all-in이 낮은 건
- 기간 Avg 저운임: 직접 Market Rate가 없으면 선택 기간에 유효한 동일 구간, CNTR Size, CNTR Type, Cargo Type, OOG Type, Full/Empty 비교군의 `ALL_IN_RATE` 평균과 비교해 낮은 건
- 기간 평균 비교군: 최소 3건 이상인 경우에만 fallback 적용
- 판정 Status: `Market 저운임`, `기간 Avg 저운임`. 정상 건은 확인 대상 목록에서 제외
- 선적지 / 도착지 집계: 국가별 집계를 먼저 표시. 국가 행을 클릭하면 해당 국가의 포트별 집계를 펼치고, 포트 행을 클릭하면 상세 목록으로 이동
- 확인 집중 구간: 현재 조회 조건의 확인 대상 운임을 Lane별로 묶고 저운임 건수 내림차순, 저운임 화주수 내림차순으로 정렬한 상위 10개. 집계 탭에서만 표시
- 기본 조회 조건: 실행일 기준 금주 일요일 ~ 토요일
- 운임 파일 Status: 현재 추출본은 `Accepted (03)` 단일 상태이므로 조회 필터에서는 제외하고 상세에 원본 코드를 표시
- 팀: `-3W bkg dashboard`와 동일하게 `POR_COUNTRY` / `DLY_COUNTRY` 기준으로 `OBT`, `EST`, `IST`, `JBT`를 분류해 조회 조건과 상세에 표시. 필터에는 네 팀을 항상 제공하며 입력 CSV에 없는 팀은 0건으로 조회
- 상세 검토: 확인 대상 운임 행을 클릭하면 오른쪽 패널에 charge 항목을 표시. 원천 `RATE_APCL_BASC_CD`를 기준으로 `AMOUNT`, `TARIFF`, `WAIVE`, `PERCENT` 적용 방식을 등록 금액 아래에 표시하고, WAIVE는 등록·USD 금액을 비운 상세 조회 항목으로 표시해 비교 all-in에서 제외. 조회 시점에 동적으로 적용되는 EFC Basic Tariff도 상세 검토용으로만 표시하며 비교 all-in에는 포함하지 않음. charge별 `FRT_PNC_CD`를 `선적지 지불 (P)` / `도착지 지불 (C)`로 표시하고, `O/F`는 `OCEAN FREIGHT`, `CUR_CD = USD`인 나머지 항목은 `SURCHARGE`, 비-USD 항목은 `LOCAL CHARGE`로 분류. 상세 항목은 `O/F`를 먼저 표시한 뒤 지불지 `P → C`, 구분 `SURCHARGE → LOCAL CHARGE` 순으로 정렬
- Cargo / OOG 필터: Cargo Type은 `General`, `HZ`, `OOG`, `ING`, `RF`, `NOR`, `FB`; OOG Type은 `None`, `OH`, `OW`, `OWH`, `OL`, `OLH`, `OLW`, `OLWH` 코드 라벨을 표시

## Local

```bash
npm install
npm run data
npm run dev
```

## Data Flow

```text
Rate Base CSV
EFC Basic Tariff CSV
Rate Application Route CSV
CN/HK market-rate guideline
SEA/ETC working-rate guideline
  -> scripts/sync-sea-guideline.py
  -> scripts/build-weekly-data.py
  -> public/data/weekly-monitoring.json
  -> React dashboard
```

Rate Base CSV는 `scripts/extract-rate-base.sql`, 동적 EFC 상세용 참조 데이터는 `scripts/extract-basic-tariff.sql`과 `scripts/extract-rate-route.sql`로 각각 추출합니다. 동적 EFC는 Oracle의 대규모 후보 조인 대신 Python 빌더에서 활성 O/F 프로필에만 매칭합니다.

## Data Refresh Automation

기존 CSV를 사용해 JSON 캐시를 다시 만들고, `dist`가 이미 있으면 운영 정적 파일에도 즉시 게시합니다.

```bash
npm run data
```

Oracle에서 최신 CSV를 직접 추출한 뒤 동일 작업을 수행하려면:

```bash
python -m pip install -r requirements-oracle.txt
copy .env.example .env.local
npm run data:oracle
```

`.env.local`에는 저장소에 커밋하지 않을 DB 접속 정보를 입력합니다.

```dotenv
RATE_DB_USER=
RATE_DB_PASSWORD=
RATE_DB_DSN=host.example.com:1521/service_name
```

DBeaver에 저장된 Oracle 연결의 DSN을 재사용할 수도 있습니다. 이 경우 `RATE_DB_DSN`은 비워 두고 연결 이름을 지정합니다.

```dotenv
RATE_DB_USER=
RATE_DB_PASSWORD=
RATE_DB_DSN=
RATE_DBEAVER_CONNECTION=ORCL
```

자동화는 DBeaver의 `data-sources.json`에서 DSN 메타데이터만 읽습니다. DBeaver 암호 저장소를 읽거나 복호화하지 않으므로 사용자명과 비밀번호는 `.env.local`에 별도로 입력해야 합니다. DBeaver의 Oracle JDBC 드라이버와 Python 자동화가 사용하는 `python-oracledb`는 별개이므로 `python -m pip install -r requirements-oracle.txt` 실행은 필요합니다.

자동 추출 파일은 `data/rate-base-latest.csv`, `data/basic-tariff-latest.csv`, `data/rate-route-latest.csv`에 저장됩니다. CSV와 JSON은 임시 파일 작성 후 교체합니다. OneDrive가 기존 파일을 잠근 경우에는 짧게 재시도한 뒤 덮어쓰기로 fallback 합니다. 운영 내부 서버는 가능하면 OneDrive 밖의 경로에서 실행하는 편이 안정적입니다.

Windows 작업 스케줄러에 하루 2회(06:30, 12:00) 갱신을 등록하려면:

```bash
npm run data:task:install
```

터미널 프로세스로 임시 반복 동기화를 유지할 수도 있습니다. 기본 예시는 15분 주기입니다.

```bash
npm run data:oracle:watch
```

## Live Connection

브라우저가 Oracle에 직접 연결하지는 않습니다. DB 자격증명 노출과 사용자 수에 따른 반복 쿼리를 막기 위해 서버 측 동기화 프로세스가 Oracle을 조회하고 JSON 캐시를 갱신합니다.

사내 정적 서버에서 준실시간으로 운영하려면:

1. `.env.local`에 `VITE_DATA_REFRESH_SECONDS=300`처럼 브라우저 캐시 재조회 간격을 설정합니다.
2. `npm run build`를 실행합니다.
3. `npm run serve:dist`로 내부 정적 서버를 실행합니다.
4. `npm run data:oracle:watch` 또는 작업 스케줄러를 실행합니다.

`python-oracledb`는 기본 Thin 모드에서 Oracle Client 설치 없이 Oracle Database에 직접 연결할 수 있습니다. 사내 DB 정책상 Thick 모드 또는 Wallet이 필요한 경우에는 별도 접속 설정이 필요합니다.

GitHub Pages 배포본은 배포 시점의 `dist`가 고정되므로 자체적으로 라이브 갱신되지 않습니다. GitHub Pages를 유지하려면 동기화 이후 CI 재배포를 트리거해야 하며, 사내 데이터라면 내부 서버 운영이 적합합니다.

## Build

```bash
npm run build
```

최신 SEA/ETC Google Drive 파일까지 다시 받은 뒤 데이터를 만들려면 `npm run data:fresh`를 실행합니다.
SEA/ETC 동기화는 `organizing rate file` 프로젝트의 parser를 재사용하며, 복수 POL/POD를 Route별로 펼치고 `LKB = LCH + $100/$150` 규칙을 반영합니다.
