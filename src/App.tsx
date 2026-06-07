import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import {
  Anchor,
  AlertTriangle,
  BarChart3,
  BookOpen,
  CalendarDays,
  ChevronLeft,
  ChevronRight,
  CircleDollarSign,
  Database,
  ExternalLink,
  FileText,
  Filter,
  Info,
  Languages,
  RefreshCw,
  Route,
  Search,
  Ship,
  TrendingUp,
  Users,
  X,
} from 'lucide-react';
import {
  CartesianGrid,
  Legend,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';

type RawRecord = [
  rateApplicationNo: string,
  effectiveStart: string,
  effectiveEnd: string,
  laneIndex: number,
  shipperIndex: number,
  staffIndex: number,
  containerIndex: number,
  cargoProfileIndex: number,
  ofRate: number,
  marketRate: number | null,
  marketSourceIndex: number,
  teamIndex: number,
  rateDetailIndex: number,
  containerSizeIndex: number,
  containerTypeIndex: number,
  cargoTypeIndex: number,
  specialCargoTypeIndex: number,
  fullEmptyTypeIndex: number,
  approvalStatusIndex: number,
];

type RawRateDetail = [
  freightUnit: string,
  prepaidCollect: string,
  masterPrepaidCollect: string,
  chargeBasket: string,
  chargeCount: number,
  thcRate: number,
  lssRate: number,
  fafRate: number,
  wrsRate: number,
  efcRate: number,
  cisRate: number,
  secRate: number,
  coreRate: number | null,
  allInRate: number | null,
  chargeItems: RawChargeItem[],
];

type RawChargeItem = [
  code: string,
  currency: string,
  localAmount: number | null,
  usdAmount: number | null,
  paymentCode: string,
  category: ChargeCategory,
  appliedToComparison?: boolean,
  source?: ChargeSource,
  applicationType?: ChargeApplicationType,
];

type ChargeCategory = 'OCEAN FREIGHT' | 'SURCHARGE' | 'LOCAL CHARGE' | 'UNCLASSIFIED';
type ChargeSource = 'RATE_FILE' | 'BASIC_TARIFF';
type ChargeApplicationType = 'AMOUNT' | 'TARIFF' | 'WAIVE' | 'PERCENT' | 'UNKNOWN';

type MonitoringData = {
  metadata: {
    generatedAt: string;
    sourceFile: string;
    sourceMode: 'canonical' | 'legacy-fallback';
    chargeDetailAvailable: boolean;
    latestSourceDate: string;
    defaultWeek: string;
    availableStartDate: string;
    availableEndDate: string;
    approvalStatusLabels: Record<string, string>;
    comparisonRate: string;
    marketComparisonRate: string;
    marketComparisonContainerTypes: string[];
    marketComparisonCargoType: string;
    marketAverageFallbackRate: string;
    usComparisonExcludedCharges?: string[];
    usComparisonExcludedRule?: string;
    marketAverageFallbackMinimumSamples: number;
    marketAverageFallbackGroupBy: string[];
    marketAverageFallbackPeriod: string;
    teamBasis: string;
    teamOptions: string[];
    recordCount: number;
    skippedInvalidDateRows: number;
    skippedNonOfRows: number;
    recordSchema: string[];
    rateDetailSchema: string[];
  };
  weeks: { value: string; label: string }[];
  dimensions: {
    lanes: [porCountry: string, porPort: string, dlyCountry: string, dlyPort: string][];
    shippers: [code: string, name: string][];
    staff: string[];
    teams: string[];
    containers: string[];
    cargoProfiles: string[];
    containerSizes: string[];
    containerTypes: string[];
    cargoTypes: string[];
    specialCargoTypes: string[];
    fullEmptyTypes: string[];
    approvalStatuses: string[];
    marketSources: string[];
    rateDetails: RawRateDetail[];
  };
  records: RawRecord[];
};

type RateDetail = {
  freightUnit: string;
  prepaidCollect: string;
  masterPrepaidCollect: string;
  chargeBasket: string;
  chargeCount: number;
  thcRate: number;
  lssRate: number;
  fafRate: number;
  wrsRate: number;
  efcRate: number;
  cisRate: number;
  secRate: number;
  coreRate: number | null;
  allInRate: number | null;
  chargeItems: ChargeItem[];
};

type ChargeItem = {
  code: string;
  currency: string;
  localAmount: number | null;
  usdAmount: number | null;
  paymentCode: string;
  category: ChargeCategory;
  appliedToComparison: boolean;
  source: ChargeSource;
  applicationType: ChargeApplicationType;
};

type RateRecord = {
  id: string;
  rateApplicationNo: string;
  effectiveStart: string;
  effectiveEnd: string;
  laneIndex: number;
  porCountry: string;
  porPort: string;
  dlyCountry: string;
  dlyPort: string;
  shipperCode: string;
  shipperName: string;
  shipperIndex: number;
  staff: string;
  team: string;
  container: string;
  containerSize: string;
  containerType: string;
  cargoProfile: string;
  cargoType: string;
  specialCargoType: string;
  fullEmptyType: string;
  approvalStatus: string;
  ofRate: number;
  coreRate: number;
  allInRate: number;
  marketRate: number | null;
  marketSource: string;
  comparisonKey: string;
  rateDetailIndex: number;
};

type LaneBenchmark = {
  sum: number;
  count: number;
};

type IssueStatus = 'market' | 'average';

type LowRateCase = RateRecord & {
  status: IssueStatus;
  benchmarkRate: number;          // all-in 기준 비교값 (저운임 판정 기준)
  benchmarkRateOf: number;        // O/F 기준 비교값 (표시용)
  benchmarkSource: 'market' | 'average';
  periodAverage: number;          // 비교군 O/F 평균 (표시용)
  periodAverageAllIn: number;     // 비교군 all-in 평균 (표시용)
  marketRateAllIn: number | null; // all-in 환산 Market Rate (표시용)
  benchmarkSampleCount: number;
  gapAmount: number;              // all-in 기준 gap
  gapPct: number;                 // all-in 기준 gap
};

type ScopeFilters = {
  originCountry: string[];
  originPort: string[];
  destinationCountry: string[];
  destinationPort: string[];
  containerSize: string[];
  containerType: string[];
  cargoType: string[];
  specialCargoType: string[];
  fullEmptyType: string[];
  staff: string[];
  company: string[];
};

type FilterState = ScopeFilters & {
  periodStart: string;
  periodEnd: string;
  status: IssueStatus[];
  query: string;
};

type DrillFilters = Partial<Record<keyof ScopeFilters, string>>;

type FilterOption = {
  value: string;
  label: string;
};

type Language = 'ko' | 'en';

const RATE_DASHBOARD_URL = 'https://jkpark-create.github.io/kmtc-rate-dashboard/';
const USER_GUIDE_URL = `${import.meta.env.BASE_URL}guide.html`;
const LANGUAGE_STORAGE_KEY = 'rate-monitoring-language';

const UI_COPY = {
  ko: {
    all: 'All',
    selectedSuffix: 'selected',
    dashboardLink: 'Rate Dashboard',
    languageToggle: 'EN',
    source: {
      source: 'Source',
      role: 'O/F · Origin Sales',
      records: 'records',
      updated: 'Updated',
      cache: 'Cache',
    },
    title: '운임파일 등록현황 모니터링',
    dataQuality: {
      title: '이전 CSV 사용 중',
      message: '새 SQL 추출본이 연결되지 않아 charge별 통화와 금액을 확인할 수 없습니다. `npm run data:oracle`로 최신 CSV를 추출해 주세요.',
    },
    filter: {
      title: '조회 조건',
      filters: 'filters',
      startDate: '시작일',
      endDate: '종료일',
      originCountry: '선적지 국가',
      originPort: '선적지 포트',
      destinationCountry: '도착지 국가',
      destinationPort: '도착지 포트',
      containerSize: 'CNTR Size',
      containerType: 'CNTR Type',
      cargoType: 'Cargo Type',
      oogType: 'OOG Type',
      fullEmpty: 'Full / Empty',
      staff: '영업사원',
      company: '업체',
      status: '판정 Status',
      rateSearch: '운임번호 검색',
      ratePlaceholder: 'Rate no.',
      reset: 'Reset',
    },
    metrics: {
      activeRates: '기간 유효 운임',
      lowCases: '저운임 확인 필요',
      marketLow: 'Market 대비 저운임 건수',
      averageLow: '기간 AVG 대비 저운임 건수',
      lowShippers: '저운임 화주수',
      marketCoverage: 'Market 직접 매핑',
    },
    panel: {
      aggregatedView: 'Aggregated View',
      lowFreightCases: 'Low Freight Cases',
      summaryTitle: '집계 분석',
      detailTitle: '확인 대상 운임',
      summaryTab: '집계',
      detailTab: '상세',
      cases: 'cases',
    },
    summary: {
      origin: '선적지 국가 / 포트',
      destination: '도착지 국가 / 포트',
      staff: '영업사원별',
      company: '업체별 트렌드',
      drillNote: '국가 행을 클릭하면 포트별 집계가 펼쳐집니다. 포트 행을 클릭하면 해당 조건의 상세 목록으로 이동합니다.',
      noTrend: '트렌드를 표시할 업체가 없습니다.',
      trendSelectedSuffix: '주차별 평균 Ocean Freight 추이 · 점선은 동일 구간·CNTR·Cargo 조건의 타 업체 O/F 평균입니다.',
      topTrendPrefix: '상위',
      topTrendSuffix: '개 업체의 주차별 평균 Ocean Freight 추이 · 하단 업체를 클릭하면 해당 업체 추이로 변경됩니다.',
      resetTopTrend: '상위 5개 보기',
      benchmarkLegend: '동일 구간 타 업체 평균',
      head: {
        lowCount: '저운임 건수',
        lowShipperCount: '저운임 화주수',
        laneCount: '구간수',
        rateFileCount: '운임파일수',
        marketLow: 'Market 저운임 건수',
        averageLow: '기간 AVG 저운임 건수',
      },
      activeRateLabel: '유효운임',
      expandPrefix: '클릭하여 포트별',
      collapse: '접기',
      expand: '보기',
      detailDrill: '클릭하여 상세 보기',
      empty: '선택한 조건에서 표시할 집계 데이터가 없습니다.',
    },
    detail: {
      status: 'Status',
      rateNo: 'Rate No.',
      lane: 'Lane',
      cntr: 'CNTR',
      registered: 'Registered O/F (all-in)',
      marketRate: 'Market Rate',
      benchmark: '적용 비교 기준',
      periodAverage: '조회 기간 Avg',
      gap: 'Gap (all-in)',
      salesStaff: 'Sales Staff',
      company: 'Company',
      validPeriod: 'Valid Period',
      directMarket: '직접 Market · O/F (all-in)',
      averageFallback: '기간 평균 fallback',
      periodAvgSource: 'valid rates · O/F (all-in)',
      empty: '선택한 조건에서 확인할 저운임 등록 운임이 없습니다.',
      selectTitle: '운임파일을 선택해 주세요.',
      selectHint: '확인 대상 운임 목록에서 행을 클릭하면 charge 상세를 확인할 수 있습니다.',
      rateDetail: 'Rate Detail',
      close: 'Close detail',
      validPeriodShort: 'Valid Period',
      cargoProfile: 'Cargo / OOG Type / F-E',
      registeredDetail: 'Registered O/F (all-in)',
      gapBasis: 'Gap (all-in 기준)',
      appliedBenchmark: '적용 비교 기준',
    },
    charge: {
      title: 'Charge 항목',
      freightUnit: 'Freight Unit',
      payment: 'PP / CC',
      count: 'Charge Count',
      basket: 'Charge Basket',
      dataNote: '현재 CSV에는 charge별 등록 통화가 없어 합계 기준으로 표시합니다. 변경된 SQL로 다시 추출하면 SURCHARGE와 LOCAL CHARGE가 구분됩니다.',
      note: '적용 방식은 등록 금액 아래에 표시합니다. WAIVE는 금액 없이 상세 조회되며 비교 all-in에는 포함되지 않습니다.',
      charge: 'Charge',
      registeredAmount: '등록 금액',
      usdAmount: 'USD 환산',
      paymentLocation: '지불지',
      empty: '표시할 charge 항목이 없습니다.',
      comparisonAllIn: '비교 ALL-IN RATE',
      unclassified: '미분류',
      excluded: '제외',
      applied: '비교 반영',
      detailOnly: '상세 조회',
      originPay: '선적지 지불',
      destinationPay: '도착지 지불',
      unknownPay: '미확인',
    },
    focus: {
      eyebrow: 'Focus Lanes',
      title: '확인 집중 구간',
      note: '현재 조회 조건의 확인 대상 운임을 Lane별로 묶어 저운임 건수, 저운임 화주수 순으로 정렬한 상위 10개입니다.',
      marketLow: 'Market 저운임',
      averageLow: '기간 AVG 저운임',
      lowShipper: '저운임 화주',
      directMarket: '직접 Market',
      empty: '표시할 구간이 없습니다.',
    },
    criteria: {
      eyebrow: 'Criteria',
      title: '판단 기준',
      activeRatesTitle: '유효 운임',
      activeRatesDesc: '선택한 조회 기간과 Effective Start / End가 겹치는 등록 건. 동일 운임은 기간 안에서 한 번만 집계',
      allInTitle: '비교 기준 (all-in)',
      allInDesc: '모든 저운임 판정은 all-in 기준으로 비교합니다. Market guideline은 O/F 레벨이므로 해당 건의 서차지·로컬차지(all-in − O/F)를 더해 all-in으로 환산합니다. 표시는 O/F와 괄호 안 all-in을 함께 보여줍니다.',
      usTitle: 'US향발 PSS/GRI',
      usDesc: '선적지 또는 도착지가 US인 운임은 PSS와 GRI를 비교 all-in 계산에서 제외합니다. 항목 자체는 운임파일 detail에 표시합니다.',
      marketTitle: 'Market 저운임',
      marketDesc: '구간 · CNTR Size에 매핑된 Market Rate(GP · HC · TK, Cargo 00 Non-DG)를 all-in으로 환산한 값보다 등록 all-in이 낮은 건',
      averageTitle: '기간 Avg 저운임',
      averageDesc: 'Market Rate가 없는 경우 조회 기간에 유효한 동일 구간 · CNTR Size · CNTR Type · Cargo · OOG Type · Full/Empty 비교군의 all-in 평균보다 등록 all-in이 낮은 건 (최소 3건 이상)',
      statusTitle: '판정 Status',
      statusDesc: '직접 Market Rate를 적용하면 Market 저운임, Market 미매핑으로 기간 평균을 적용하면 기간 Avg 저운임. 정상 건은 확인 대상 목록에서 제외',
      fileStatusTitle: '운임 파일 Status',
      fileStatusPrefix: '원본 CSV의 APPROVAL_STATUS 코드. 현재 추출본에는',
      fileStatusSuffix: '포함',
      noValue: '값 없음',
      minimumTitle: '평균 최소 표본',
      minimumSuffix: '건 이상인 비교군만 기간 평균 fallback 적용',
      footer: '저운임 판정은 all-in 기준입니다. US향발 PSS/GRI는 비교 all-in 계산에서 제외합니다. GP · HC · TK Non-DG는 Market Rate(O/F→all-in 환산)를 우선 적용하고, Market 미매핑 운임은 조회 기간 all-in 평균으로 fallback 합니다. 비정상 유효기간 {count}건은 제외했습니다.',
    },
    status: {
      market: 'Market 저운임',
      average: '기간 Avg 저운임',
      all: 'All',
    },
    multiSelect: {
      search: 'Search',
      all: 'All',
      close: 'Close',
      noMatches: 'No matches',
    },
  },
  en: {
    all: 'All',
    selectedSuffix: 'selected',
    dashboardLink: 'Rate Dashboard',
    languageToggle: 'KO',
    source: {
      source: 'Source',
      role: 'O/F · Origin Sales',
      records: 'records',
      updated: 'Updated',
      cache: 'Cache',
    },
    title: 'Rate Application Monitoring',
    dataQuality: {
      title: 'Legacy CSV in use',
      message: 'Charge currency and amount details are unavailable because the latest SQL extract is not connected. Run `npm run data:oracle` to extract the current CSV.',
    },
    filter: {
      title: 'Filters',
      filters: 'filters',
      startDate: 'Start',
      endDate: 'End',
      originCountry: 'Origin Country',
      originPort: 'Origin Port',
      destinationCountry: 'Destination Country',
      destinationPort: 'Destination Port',
      containerSize: 'CNTR Size',
      containerType: 'CNTR Type',
      cargoType: 'Cargo Type',
      oogType: 'OOG Type',
      fullEmpty: 'Full / Empty',
      staff: 'Sales Staff',
      company: 'Company',
      status: 'Judgement Status',
      rateSearch: 'Rate No. Search',
      ratePlaceholder: 'Rate no.',
      reset: 'Reset',
    },
    metrics: {
      activeRates: 'Active Rates',
      lowCases: 'Low Freight Cases',
      marketLow: 'Below Market Count',
      averageLow: 'Below Period AVG Count',
      lowShippers: 'Low Freight Shippers',
      marketCoverage: 'Direct Market Match',
    },
    panel: {
      aggregatedView: 'Aggregated View',
      lowFreightCases: 'Low Freight Cases',
      summaryTitle: 'Aggregated Analysis',
      detailTitle: 'Low Freight Cases',
      summaryTab: 'Summary',
      detailTab: 'Detail',
      cases: 'cases',
    },
    summary: {
      origin: 'Origin Country / Port',
      destination: 'Destination Country / Port',
      staff: 'By Sales Staff',
      company: 'Company Trend',
      drillNote: 'Click a country row to expand port-level totals. Click a port row to open the filtered detail list.',
      noTrend: 'No companies available for the trend chart.',
      trendSelectedSuffix: 'weekly average Ocean Freight trend · dotted line is the peer O/F average for the same lane, CNTR, and cargo conditions.',
      topTrendPrefix: 'Top',
      topTrendSuffix: 'companies by weekly average Ocean Freight trend · click a company row below to switch to that company.',
      resetTopTrend: 'Show Top 5',
      benchmarkLegend: 'Peer average for same lane',
      head: {
        lowCount: 'Low Count',
        lowShipperCount: 'Low Shippers',
        laneCount: 'Lane Count',
        rateFileCount: 'Rate Files',
        marketLow: 'Market Low Count',
        averageLow: 'Period AVG Low Count',
      },
      activeRateLabel: 'active rates',
      expandPrefix: 'click to',
      collapse: 'collapse ports',
      expand: 'show ports',
      detailDrill: 'click for detail',
      empty: 'No aggregated data for the selected filters.',
    },
    detail: {
      status: 'Status',
      rateNo: 'Rate No.',
      lane: 'Lane',
      cntr: 'CNTR',
      registered: 'Registered O/F (all-in)',
      marketRate: 'Market Rate',
      benchmark: 'Applied Benchmark',
      periodAverage: 'Period AVG',
      gap: 'Gap (all-in)',
      salesStaff: 'Sales Staff',
      company: 'Company',
      validPeriod: 'Valid Period',
      directMarket: 'Direct Market · O/F (all-in)',
      averageFallback: 'Period average fallback',
      periodAvgSource: 'valid rates · O/F (all-in)',
      empty: 'No low freight cases for the selected filters.',
      selectTitle: 'Select a rate file.',
      selectHint: 'Click a row in the low freight case list to review charge details.',
      rateDetail: 'Rate Detail',
      close: 'Close detail',
      validPeriodShort: 'Valid Period',
      cargoProfile: 'Cargo / OOG Type / F-E',
      registeredDetail: 'Registered O/F (all-in)',
      gapBasis: 'Gap (all-in basis)',
      appliedBenchmark: 'Applied Benchmark',
    },
    charge: {
      title: 'Charge Items',
      freightUnit: 'Freight Unit',
      payment: 'PP / CC',
      count: 'Charge Count',
      basket: 'Charge Basket',
      dataNote: 'The current CSV has no charge-level currency, so amounts are shown from summary totals. Re-extract with the updated SQL to separate SURCHARGE and LOCAL CHARGE.',
      note: 'Application type is shown below the registered amount. WAIVE items are detail-only with no amount and are excluded from comparison all-in.',
      charge: 'Charge',
      registeredAmount: 'Registered Amount',
      usdAmount: 'USD Amount',
      paymentLocation: 'Payment Location',
      empty: 'No charge items to display.',
      comparisonAllIn: 'Comparison ALL-IN RATE',
      unclassified: 'Unclassified',
      excluded: 'Excluded',
      applied: 'Applied to comparison',
      detailOnly: 'Detail only',
      originPay: 'Origin Pay',
      destinationPay: 'Destination Pay',
      unknownPay: 'Unknown',
    },
    focus: {
      eyebrow: 'Focus Lanes',
      title: 'Focus Lanes',
      note: 'Top 10 lanes from the current filters, sorted by low freight count and low freight shipper count.',
      marketLow: 'Market low',
      averageLow: 'Period AVG low',
      lowShipper: 'Low shippers',
      directMarket: 'Direct Market',
      empty: 'No lanes to display.',
    },
    criteria: {
      eyebrow: 'Criteria',
      title: 'Judgement Criteria',
      activeRatesTitle: 'Active Rates',
      activeRatesDesc: 'Registered rates whose Effective Start / End overlaps the selected query period. Duplicate rates are counted once within the period.',
      allInTitle: 'Comparison Basis (all-in)',
      allInDesc: 'All low-freight judgement uses all-in values. Market guidelines are O/F-level, so the record surcharge/local charge delta (all-in − O/F) is added to convert the benchmark to all-in. The UI shows O/F and all-in in parentheses.',
      usTitle: 'US-bound/origin PSS/GRI',
      usDesc: 'For rates where origin or destination country is US, PSS and GRI are excluded from comparison all-in. The charge items remain visible in rate detail.',
      marketTitle: 'Market Low',
      marketDesc: 'Cases where registered all-in is lower than a directly mapped Market Rate converted to all-in for the lane and CNTR Size (GP, HC, TK, Cargo 00 Non-DG).',
      averageTitle: 'Period AVG Low',
      averageDesc: 'When no Market Rate is mapped, cases where registered all-in is lower than the period average of the same lane, CNTR Size, CNTR Type, Cargo, OOG Type, and Full/Empty group (minimum 3 samples).',
      statusTitle: 'Judgement Status',
      statusDesc: 'Direct Market Rate produces Market Low. Market-unmapped fallback produces Period AVG Low. Normal cases are excluded from the review list.',
      fileStatusTitle: 'Rate File Status',
      fileStatusPrefix: 'Original CSV APPROVAL_STATUS code. Current extract includes',
      fileStatusSuffix: '',
      noValue: 'no values',
      minimumTitle: 'Minimum Average Sample',
      minimumSuffix: 'or more samples are required for period-average fallback.',
      footer: 'Low freight judgement is based on all-in. US-bound/origin PSS and GRI are excluded from comparison all-in. GP, HC, TK Non-DG uses Market Rate first, and unmapped rates fallback to period all-in average. Invalid effective periods excluded: {count}.',
    },
    status: {
      market: 'Market Low',
      average: 'Period AVG Low',
      all: 'All',
    },
    multiSelect: {
      search: 'Search',
      all: 'All',
      close: 'Close',
      noMatches: 'No matches',
    },
  },
} as const;

const USER_GUIDE_COPY = {
  ko: {
    button: '사용자 가이드',
  },
  en: {
    button: 'User Guide',
  },
} as const;

const PAGE_SIZE = 30;
const configuredDataRefreshSeconds = Number(import.meta.env.VITE_DATA_REFRESH_SECONDS ?? 0);
const DATA_REFRESH_MS = Number.isFinite(configuredDataRefreshSeconds) && configuredDataRefreshSeconds > 0
  ? configuredDataRefreshSeconds * 1000
  : 0;
const GOOGLE_CLIENT_ID = String(import.meta.env.VITE_GOOGLE_CLIENT_ID ?? '').trim();
const ALLOWED_GOOGLE_DOMAINS = String(import.meta.env.VITE_ALLOWED_GOOGLE_DOMAINS ?? '')
  .split(',')
  .map((domain) => domain.trim().toLowerCase())
  .filter(Boolean);
const AUTH_REQUIRED = String(import.meta.env.VITE_AUTH_REQUIRED ?? '').toLowerCase() === 'true' || Boolean(GOOGLE_CLIENT_ID);
// When set, the dashboard reads its data from this restricted Google Drive file
// via the Drive API using the signed-in user's access token, instead of a public
// static JSON. Keep the Drive file shared to the company domain only.
const DRIVE_FILE_ID = String(import.meta.env.VITE_DRIVE_FILE_ID ?? '').trim();
const DRIVE_SCOPES = 'openid email profile https://www.googleapis.com/auth/drive.readonly';

type GoogleProfile = {
  email: string;
  name?: string;
  picture?: string;
  hd?: string;
};

type GoogleTokenResponse = {
  access_token?: string;
  expires_in?: number;
  scope?: string;
  token_type?: string;
  error?: string;
  error_description?: string;
};

type GoogleTokenClient = {
  requestAccessToken: (overrides?: { prompt?: string }) => void;
};

declare global {
  interface Window {
    google?: {
      accounts: {
        oauth2: {
          initTokenClient: (config: {
            client_id: string;
            scope: string;
            callback: (response: GoogleTokenResponse) => void;
            error_callback?: (error: { type?: string; message?: string }) => void;
          }) => GoogleTokenClient;
          revoke: (token: string, done?: () => void) => void;
        };
      };
    };
  }
}

type AuthContextValue = {
  accessToken: string;
  email: string;
  refresh: () => Promise<string>;
};

const AuthContext = createContext<AuthContextValue | null>(null);

// Persist the access token + profile for the tab so a page refresh (or the in-app
// Refresh button, which reloads the page) reuses a still-valid token instead of
// forcing another Google sign-in. Mirrors the -3W dashboard's sessionStorage gate.
const AUTH_SESSION_KEY = 'rate-monitoring-auth-session';
const AUTH_SIGNED_IN_FLAG = 'rate-monitoring-signed-in';

type StoredAuthSession = { accessToken: string; profile: GoogleProfile; expiry: number };

function loadStoredAuthSession(): StoredAuthSession | null {
  try {
    const raw = sessionStorage.getItem(AUTH_SESSION_KEY);
    if (!raw) {
      return null;
    }
    const parsed = JSON.parse(raw) as StoredAuthSession;
    // Require at least one more minute of validity so a refresh doesn't race expiry.
    if (parsed?.accessToken && parsed?.profile?.email
        && typeof parsed.expiry === 'number' && parsed.expiry > Date.now() + 60_000) {
      return parsed;
    }
  } catch {
    // ignore malformed storage
  }
  return null;
}

function clearStoredAuthSession() {
  try {
    sessionStorage.removeItem(AUTH_SESSION_KEY);
    localStorage.removeItem(AUTH_SIGNED_IN_FLAG);
  } catch {
    // ignore storage errors
  }
}

const formatNumber = (value: number) => new Intl.NumberFormat('en-US').format(Math.round(value));
const formatMoney = (value: number) => `$${new Intl.NumberFormat('en-US', { maximumFractionDigits: 0 }).format(value)}`;
const formatRateMoney = (value: number | null) => value === null ? '-' : `${value < 0 ? '-' : ''}$${new Intl.NumberFormat('en-US', { maximumFractionDigits: 2 }).format(Math.abs(value))}`;
const formatPct = (value: number) => `${(value * 100).toFixed(1)}%`;
const formatSignedPct = (value: number) => `${value > 0 ? '-' : ''}${Math.abs(value * 100).toFixed(1)}%`;
const formatDate = (value: string) => value.replaceAll('-', '.');
const formatAmount = (value: number | null) => value === null ? '-' : new Intl.NumberFormat('en-US', { maximumFractionDigits: 2 }).format(value);
const addDays = (value: string, days: number) => {
  const date = new Date(`${value}T00:00:00Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
};
const weekEnd = (weekStart: string) => {
  return addDays(weekStart, 6);
};

function createDefaultFilters(data: MonitoringData): FilterState {
  return {
    periodStart: data.metadata.defaultWeek,
    periodEnd: weekEnd(data.metadata.defaultWeek),
    originCountry: [],
    originPort: [],
    destinationCountry: [],
    destinationPort: [],
    containerSize: [],
    containerType: [],
    cargoType: [],
    specialCargoType: [],
    fullEmptyType: [],
    staff: [],
    company: [],
    status: [],
    query: '',
  };
}

function filterScope(filters: FilterState): ScopeFilters {
  return {
    originCountry: filters.originCountry,
    originPort: filters.originPort,
    destinationCountry: filters.destinationCountry,
    destinationPort: filters.destinationPort,
    containerSize: filters.containerSize,
    containerType: filters.containerType,
    cargoType: filters.cargoType,
    specialCargoType: filters.specialCargoType,
    fullEmptyType: filters.fullEmptyType,
    staff: filters.staff,
    company: filters.company,
  };
}

function hasSelection(selected: string[], value: string) {
  return !selected.length || selected.includes(value);
}

function activeFilterCount(filters: FilterState) {
  return (
    (filters.originCountry.length ? 1 : 0) +
    (filters.originPort.length ? 1 : 0) +
    (filters.destinationCountry.length ? 1 : 0) +
    (filters.destinationPort.length ? 1 : 0) +
    (filters.containerSize.length ? 1 : 0) +
    (filters.containerType.length ? 1 : 0) +
    (filters.cargoType.length ? 1 : 0) +
    (filters.specialCargoType.length ? 1 : 0) +
    (filters.fullEmptyType.length ? 1 : 0) +
    (filters.staff.length ? 1 : 0) +
    (filters.company.length ? 1 : 0) +
    (filters.status.length ? 1 : 0) +
    (filters.query.trim() ? 1 : 0)
  );
}

function filterOptionLabel(value: string, options: FilterOption[]) {
  return options.find((option) => option.value === value)?.label ?? value;
}

function selectedFilterLabel(values: string[], options: FilterOption[], language: Language) {
  if (!values.length) {
    return UI_COPY[language].all;
  }
  if (values.length === 1) {
    return filterOptionLabel(values[0], options);
  }
  return `${values.length} ${UI_COPY[language].selectedSuffix}`;
}

async function fetchGoogleProfile(accessToken: string): Promise<GoogleProfile | null> {
  try {
    const response = await fetch('https://www.googleapis.com/oauth2/v3/userinfo', {
      headers: { Authorization: `Bearer ${accessToken}` },
    });
    if (!response.ok) {
      return null;
    }
    const info = await response.json() as { email?: string; name?: string; picture?: string; hd?: string };
    return info.email ? { email: info.email, name: info.name, picture: info.picture, hd: info.hd } : null;
  } catch {
    return null;
  }
}

function isAllowedGoogleProfile(profile: GoogleProfile) {
  if (!ALLOWED_GOOGLE_DOMAINS.length) {
    return true;
  }
  const emailDomain = profile.email.split('@').at(1)?.toLowerCase() ?? '';
  const hostedDomain = profile.hd?.toLowerCase() ?? '';
  return ALLOWED_GOOGLE_DOMAINS.includes(emailDomain) || ALLOWED_GOOGLE_DOMAINS.includes(hostedDomain);
}

const statusTone: Record<IssueStatus, string> = {
  market: 'orange',
  average: 'amber',
};

const CARGO_TYPE_LABELS: Record<string, string> = {
  '00': 'General',
  '01': 'HZ / Dangerous Cargo',
  '02': 'OOG / Out of Gauge',
  '03': 'ING / In Gauge',
  '04': 'RF / Reefer',
  '05': 'NOR / Non Reefer',
  '06': 'FB / Flexi Bag',
};

const OOG_TYPE_LABELS: Record<string, string> = {
  '00': 'None',
  '01': 'OH',
  '02': 'OW',
  '03': 'OWH',
  '04': 'OL',
  '05': 'OLH',
  '06': 'OLW',
  '07': 'OLWH',
};

const FULL_EMPTY_TYPE_LABELS: Record<string, string> = {
  F: 'Full',
  E: 'Empty',
};

function formatCodeLabel(value: string, labels: Record<string, string>) {
  if (!value) {
    return '-';
  }
  return labels[value] ? `${labels[value]} (${value})` : `Unverified code (${value})`;
}

function formatCargoType(value: string) {
  return formatCodeLabel(value, CARGO_TYPE_LABELS);
}

function formatOogType(value: string) {
  return formatCodeLabel(value, OOG_TYPE_LABELS);
}

function formatFullEmptyType(value: string) {
  return formatCodeLabel(value, FULL_EMPTY_TYPE_LABELS);
}

function formatPaymentLocation(value: string, language: Language) {
  const text = UI_COPY[language].charge;
  const labels: Record<string, string> = {
    P: text.originPay,
    C: text.destinationPay,
  };
  return labels[value] ? `${labels[value]} (${value})` : `${text.unknownPay} (${value || '-'})`;
}

function chargeUsage(item: ChargeItem, language: Language) {
  const text = UI_COPY[language].charge;
  return {
    label: item.appliedToComparison ? item.applicationType : `${item.applicationType} · ${text.excluded}`,
    className: `charge-usage-${item.applicationType.toLowerCase()}`,
    comparisonLabel: item.appliedToComparison ? text.applied : text.detailOnly,
  };
}

function chargeSortRank(item: ChargeItem, index: number) {
  const paymentRank: Record<string, number> = { P: 0, C: 1 };
  const categoryRank: Record<ChargeCategory, number> = {
    'OCEAN FREIGHT': 0,
    SURCHARGE: 1,
    'LOCAL CHARGE': 2,
    UNCLASSIFIED: 3,
  };

  return [
    item.category === 'OCEAN FREIGHT' ? 0 : 1,
    paymentRank[item.paymentCode] ?? 2,
    categoryRank[item.category] ?? 9,
    item.code,
    index,
  ] as const;
}

function formatCargoProfile(value: string) {
  const [cargoType, specialCargoType, fullEmptyType] = value.split('/');
  return `${formatCargoType(cargoType)} / ${formatOogType(specialCargoType)} / ${formatFullEmptyType(fullEmptyType)}`;
}

function overlapsRange(record: RateRecord, rangeStart: string, rangeEnd: string) {
  return record.effectiveStart <= rangeEnd && record.effectiveEnd >= rangeStart;
}

function matchesScope(record: RateRecord, filters: ScopeFilters) {
  return (
    hasSelection(filters.originCountry, record.porCountry) &&
    hasSelection(filters.originPort, record.porPort) &&
    hasSelection(filters.destinationCountry, record.dlyCountry) &&
    hasSelection(filters.destinationPort, record.dlyPort) &&
    hasSelection(filters.containerSize, record.containerSize) &&
    hasSelection(filters.containerType, record.containerType) &&
    hasSelection(filters.cargoType, record.cargoType) &&
    hasSelection(filters.specialCargoType, record.specialCargoType) &&
    hasSelection(filters.fullEmptyType, record.fullEmptyType) &&
    hasSelection(filters.staff, record.staff) &&
    hasSelection(filters.company, shipperKey(record))
  );
}

function unique(values: string[]) {
  return Array.from(new Set(values.filter(Boolean))).sort();
}

function shipperKey(record: RateRecord) {
  return record.shipperCode || record.shipperName;
}

const TREND_COLORS = ['#1f7a5a', '#2563eb', '#d97706', '#9333ea', '#dc2626'];
const TREND_BENCHMARK_DATA_KEY = 'benchmark';

type GroupRow = {
  key: string;
  label: string;
  count: number;
  marketLow: number;
  averageLow: number;
  shipperCount: number;
  activeCount: number;
  laneCount: number;
  rateFileCount: number;
  drill: DrillFilters;
  level?: 'country' | 'port';
  expanded?: boolean;
};

function buildGroupSummary(
  cases: LowRateCase[],
  rates: RateRecord[],
  keyFn: (record: RateRecord) => string,
  labelFn: (record: RateRecord) => string,
  drillFn: (record: RateRecord) => DrillFilters,
): GroupRow[] {
  const map = new Map<string, GroupRow & { shipperKeys: Set<string>; laneKeys: Set<number>; rateFileKeys: Set<string> }>();
  for (const item of cases) {
    const key = keyFn(item);
    if (!key) {
      continue;
    }
    let current = map.get(key);
    if (!current) {
      current = {
        key,
        label: labelFn(item),
        count: 0,
        marketLow: 0,
        averageLow: 0,
        shipperCount: 0,
        activeCount: 0,
        laneCount: 0,
        rateFileCount: 0,
        shipperKeys: new Set(),
        laneKeys: new Set(),
        rateFileKeys: new Set(),
        drill: drillFn(item),
      };
      map.set(key, current);
    }
    current.count += 1;
    current.marketLow += item.status === 'market' ? 1 : 0;
    current.averageLow += item.status === 'average' ? 1 : 0;
    const shipper = shipperKey(item);
    if (shipper) {
      current.shipperKeys.add(shipper);
    }
  }
  for (const item of rates) {
    const current = map.get(keyFn(item));
    if (current) {
      current.activeCount += 1;
      current.laneKeys.add(item.laneIndex);
      current.rateFileKeys.add(item.rateApplicationNo);
    }
  }
  return Array.from(map.values())
    .map(({ shipperKeys, laneKeys, rateFileKeys, ...row }) => ({
      ...row,
      shipperCount: shipperKeys.size,
      laneCount: laneKeys.size,
      rateFileCount: rateFileKeys.size,
    }))
    .sort((a, b) => b.count - a.count || b.shipperCount - a.shipperCount || a.label.localeCompare(b.label));
}

function buildExpandedLocationSummary(
  countryRows: GroupRow[],
  portRows: GroupRow[],
  expandedCountries: string[],
  countryFilter: 'originCountry' | 'destinationCountry',
) {
  const expanded = new Set(expandedCountries);
  const portsByCountry = new Map<string, GroupRow[]>();

  for (const port of portRows) {
    const country = port.drill[countryFilter];
    if (!country) {
      continue;
    }
    const ports = portsByCountry.get(country) ?? [];
    ports.push({ ...port, level: 'port' });
    portsByCountry.set(country, ports);
  }

  return countryRows.flatMap((country) => {
    const isExpanded = expanded.has(country.key);
    return [
      { ...country, level: 'country' as const, expanded: isExpanded },
      ...(isExpanded ? portsByCountry.get(country.key) ?? [] : []),
    ];
  });
}

function decodeRateDetail(detail: RawRateDetail): RateDetail {
  return {
    freightUnit: detail[0],
    prepaidCollect: detail[1],
    masterPrepaidCollect: detail[2],
    chargeBasket: detail[3],
    chargeCount: detail[4],
    thcRate: detail[5],
    lssRate: detail[6],
    fafRate: detail[7],
    wrsRate: detail[8],
    efcRate: detail[9],
    cisRate: detail[10],
    secRate: detail[11],
    coreRate: detail[12],
    allInRate: detail[13],
    chargeItems: (detail[14] ?? []).map(([code, currency, localAmount, usdAmount, paymentCode, category, appliedToComparison = true, source = 'RATE_FILE', applicationType = source === 'BASIC_TARIFF' ? 'TARIFF' : 'UNKNOWN']) => ({
      code,
      currency,
      localAmount,
      usdAmount,
      paymentCode,
      category,
      appliedToComparison,
      source,
      applicationType,
    })),
  };
}

function decodeRecords(data: MonitoringData): RateRecord[] {
  return data.records.map((record, index) => {
    const lane = data.dimensions.lanes[record[3]];
    const shipper = data.dimensions.shippers[record[4]];
    const rateDetail = data.dimensions.rateDetails[record[12]];
    return {
      id: `${record[0]}-${record[3]}-${record[6]}-${record[7]}-${record[8]}-${index}`,
      rateApplicationNo: record[0],
      effectiveStart: record[1],
      effectiveEnd: record[2],
      laneIndex: record[3],
      porCountry: lane[0],
      porPort: lane[1],
      dlyCountry: lane[2],
      dlyPort: lane[3],
      shipperCode: shipper[0],
      shipperName: shipper[1],
      shipperIndex: record[4],
      staff: data.dimensions.staff[record[5]],
      team: data.dimensions.teams[record[11]],
      container: data.dimensions.containers[record[6]],
      containerSize: data.dimensions.containerSizes[record[13]],
      containerType: data.dimensions.containerTypes[record[14]],
      cargoProfile: data.dimensions.cargoProfiles[record[7]],
      cargoType: data.dimensions.cargoTypes[record[15]],
      specialCargoType: data.dimensions.specialCargoTypes[record[16]],
      fullEmptyType: data.dimensions.fullEmptyTypes[record[17]],
      approvalStatus: data.dimensions.approvalStatuses[record[18]],
      ofRate: record[8],
      coreRate: rateDetail[12] ?? record[8],
      allInRate: rateDetail[13] ?? rateDetail[12] ?? record[8],
      marketRate: record[9],
      marketSource: data.dimensions.marketSources[record[10]],
      comparisonKey: `${record[3]}|${record[13]}|${record[14]}|${record[15]}|${record[16]}|${record[17]}`,
      rateDetailIndex: record[12],
    };
  });
}

function buildCases(activeRates: RateRecord[], minimumSamples: number) {
  // 비교는 all-in 기준으로 판정한다. 표시용으로 O/F 평균도 함께 집계한다.
  const ofBenchmarks = new Map<string, LaneBenchmark>();
  const allInBenchmarks = new Map<string, LaneBenchmark>();
  for (const rate of activeRates) {
    const ofBench = ofBenchmarks.get(rate.comparisonKey) ?? { sum: 0, count: 0 };
    ofBench.sum += rate.ofRate;
    ofBench.count += 1;
    ofBenchmarks.set(rate.comparisonKey, ofBench);
    const allInBench = allInBenchmarks.get(rate.comparisonKey) ?? { sum: 0, count: 0 };
    allInBench.sum += rate.allInRate;
    allInBench.count += 1;
    allInBenchmarks.set(rate.comparisonKey, allInBench);
  }

  const cases: LowRateCase[] = [];
  for (const rate of activeRates) {
    const ofBench = ofBenchmarks.get(rate.comparisonKey) ?? { sum: 0, count: 0 };
    const allInBench = allInBenchmarks.get(rate.comparisonKey) ?? { sum: 0, count: 0 };
    const periodAverage = ofBench.count ? ofBench.sum / ofBench.count : 0;
    const periodAverageAllIn = allInBench.count ? allInBench.sum / allInBench.count : 0;

    // Market guideline은 O/F 레벨이므로, 해당 건의 서차지·로컬차지(all-in - O/F)를 더해 all-in으로 환산한다.
    const surchargeDelta = rate.allInRate - rate.ofRate;
    const hasMarket = rate.marketRate !== null;
    const marketRateAllIn = hasMarket ? (rate.marketRate as number) + surchargeDelta : null;

    const benchmarkRateOf = hasMarket ? (rate.marketRate as number) : periodAverage;
    const benchmarkRate = hasMarket
      ? (marketRateAllIn as number)
      : (allInBench.count >= minimumSamples ? periodAverageAllIn : null);

    if (benchmarkRate === null || rate.allInRate >= benchmarkRate) {
      continue;
    }

    const gapAmount = benchmarkRate - rate.allInRate;
    const gapPct = benchmarkRate ? gapAmount / benchmarkRate : 0;

    cases.push({
      ...rate,
      status: hasMarket ? 'market' : 'average',
      benchmarkRate,
      benchmarkRateOf,
      benchmarkSource: hasMarket ? 'market' : 'average',
      periodAverage,
      periodAverageAllIn,
      marketRateAllIn,
      benchmarkSampleCount: ofBench.count,
      gapAmount,
      gapPct,
    });
  }

  return cases.sort((a, b) => b.gapPct - a.gapPct || b.gapAmount - a.gapAmount);
}

function buildPeriodAnalysis(records: RateRecord[], periodStart: string, periodEnd: string, minimumSamples: number) {
  const activeRates = records.filter((record) => overlapsRange(record, periodStart, periodEnd));

  return {
    activeRates,
    cases: buildCases(activeRates, minimumSamples),
  };
}

function StatusBadge({ status, language }: { status: IssueStatus; language: Language }) {
  return <span className={`status-badge status-${statusTone[status]}`}>{UI_COPY[language].status[status]}</span>;
}

function GoogleAuthGate({ children }: { children: ReactNode }) {
  const initialSession = AUTH_REQUIRED ? loadStoredAuthSession() : null;
  const [accessToken, setAccessToken] = useState(initialSession?.accessToken ?? '');
  const [profile, setProfile] = useState<GoogleProfile | null>(initialSession?.profile ?? null);
  const [error, setError] = useState('');
  const [ready, setReady] = useState(false);
  const tokenClientRef = useRef<GoogleTokenClient | null>(null);
  const pendingRef = useRef<{ resolve: (token: string) => void; reject: (reason: Error) => void } | null>(null);
  const autoSilentRef = useRef(false);

  // Load the Google Identity Services script and create an OAuth token client.
  useEffect(() => {
    if (!AUTH_REQUIRED || !GOOGLE_CLIENT_ID) {
      return;
    }

    const settlePending = (token: string | null, reason?: Error) => {
      const pending = pendingRef.current;
      pendingRef.current = null;
      if (!pending) {
        return;
      }
      if (token) {
        pending.resolve(token);
      } else {
        pending.reject(reason ?? new Error('Google authorization failed.'));
      }
    };

    const setup = () => {
      if (!window.google) {
        return;
      }
      tokenClientRef.current = window.google.accounts.oauth2.initTokenClient({
        client_id: GOOGLE_CLIENT_ID,
        scope: DRIVE_SCOPES,
        callback: (response) => {
          if (response.error || !response.access_token) {
            const message = response.error_description || response.error || 'Google authorization failed.';
            setError(message);
            settlePending(null, new Error(message));
            return;
          }
          const token = response.access_token;
          void (async () => {
            const nextProfile = await fetchGoogleProfile(token);
            if (!nextProfile) {
              setError('Could not read the Google account profile.');
              settlePending(null, new Error('profile unavailable'));
              return;
            }
            if (!isAllowedGoogleProfile(nextProfile)) {
              setError(`Allowed domains: ${ALLOWED_GOOGLE_DOMAINS.join(', ') || 'not configured'}`);
              settlePending(null, new Error('domain not allowed'));
              return;
            }
            setProfile(nextProfile);
            setAccessToken(token);
            setError('');
            autoSilentRef.current = false;
            try {
              const expiry = Date.now() + (response.expires_in ?? 3600) * 1000;
              sessionStorage.setItem(AUTH_SESSION_KEY,
                JSON.stringify({ accessToken: token, profile: nextProfile, expiry }));
              localStorage.setItem(AUTH_SIGNED_IN_FLAG, '1');
            } catch {
              // ignore storage errors
            }
            settlePending(token);
          })();
        },
        error_callback: (err) => {
          const message = err.message || err.type || 'Google authorization failed.';
          // Suppress noise from the silent (no-UI) auto-refresh attempt on load.
          if (pendingRef.current || !autoSilentRef.current) {
            setError(message);
          }
          autoSilentRef.current = false;
          settlePending(null, new Error(message));
        },
      });
      setReady(true);
      // Returning user whose stored token expired: try a silent (no-UI) refresh so
      // they don't have to click "Sign in" again.
      if (!accessToken && localStorage.getItem(AUTH_SIGNED_IN_FLAG)) {
        autoSilentRef.current = true;
        try {
          tokenClientRef.current.requestAccessToken({ prompt: '' });
        } catch {
          autoSilentRef.current = false;
        }
      }
    };

    if (window.google) {
      setup();
      return;
    }

    const script = document.createElement('script');
    script.src = 'https://accounts.google.com/gsi/client';
    script.async = true;
    script.defer = true;
    script.onload = setup;
    script.onerror = () => setError('Google login script failed to load.');
    document.head.appendChild(script);

    return () => {
      script.onload = null;
      script.onerror = null;
    };
  }, []);

  // Request (or silently refresh) an access token. `prompt: ''` reuses an active
  // Google session without re-consent once the user has granted the scopes.
  const requestToken = useCallback((prompt: string) => {
    return new Promise<string>((resolve, reject) => {
      const client = tokenClientRef.current;
      if (!client) {
        reject(new Error('Google auth is not ready yet.'));
        return;
      }
      pendingRef.current = { resolve, reject };
      client.requestAccessToken({ prompt });
    });
  }, []);

  const refresh = useCallback(() => requestToken(''), [requestToken]);

  if (!AUTH_REQUIRED) {
    return <>{children}</>;
  }

  if (accessToken && profile) {
    return (
      <AuthContext.Provider value={{ accessToken, email: profile.email, refresh }}>
        <div className="auth-session">
          <span>{profile.email}</span>
          <button
            type="button"
            onClick={() => {
              if (accessToken) {
                window.google?.accounts.oauth2.revoke(accessToken);
              }
              clearStoredAuthSession();
              setAccessToken('');
              setProfile(null);
            }}
          >
            Sign out
          </button>
        </div>
        {children}
      </AuthContext.Provider>
    );
  }

  return (
    <div className="state-screen auth-screen">
      <Database size={28} aria-hidden="true" />
      <strong>Company Google login required</strong>
      {GOOGLE_CLIENT_ID ? (
        <>
          <span>Use an approved company Google account to open the dashboard.</span>
          <button
            type="button"
            className="google-login-button"
            disabled={!ready}
            onClick={() => {
              requestToken('').catch(() => {});
            }}
          >
            Sign in with Google
          </button>
          {ALLOWED_GOOGLE_DOMAINS.length > 0 && <span>Allowed domains: {ALLOWED_GOOGLE_DOMAINS.join(', ')}</span>}
        </>
      ) : (
        <span>Set VITE_GOOGLE_CLIENT_ID and VITE_ALLOWED_GOOGLE_DOMAINS before deployment.</span>
      )}
      {error && <span className="auth-error">{error}</span>}
    </div>
  );
}

function MultiSelectFilter({
  label,
  options,
  values,
  onChange,
  language,
  className = '',
}: {
  label: string;
  options: FilterOption[];
  values: string[];
  onChange: (values: string[]) => void;
  language: Language;
  className?: string;
}) {
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState('');
  const rootRef = useRef<HTMLDivElement>(null);
  const selectedSet = useMemo(() => new Set(values), [values]);
  const visibleOptions = useMemo(() => {
    const needle = search.trim().toLowerCase();
    const filtered = needle
      ? options.filter((option) => `${option.value} ${option.label}`.toLowerCase().includes(needle))
      : options;
    return filtered.slice(0, 160);
  }, [options, search]);

  useEffect(() => {
    const handleClick = (event: MouseEvent) => {
      if (rootRef.current && !rootRef.current.contains(event.target as Node)) {
        setOpen(false);
      }
    };
    document.addEventListener('mousedown', handleClick);
    return () => document.removeEventListener('mousedown', handleClick);
  }, []);

  const toggleValue = (value: string) => {
    onChange(selectedSet.has(value) ? values.filter((item) => item !== value) : [...values, value]);
  };
  const text = UI_COPY[language].multiSelect;

  return (
    <div className={`filter-field multi-filter ${className}`} ref={rootRef}>
      <span>{label}</span>
      <button className="multi-select-trigger" type="button" onClick={() => setOpen((value) => !value)}>
        <span>{selectedFilterLabel(values, options, language)}</span>
        <span className="multi-caret">v</span>
      </button>
      {open && (
        <div className="multi-select-menu">
          <input
            className="multi-search"
            type="search"
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            placeholder={text.search}
          />
          <div className="multi-actions">
            <button type="button" onClick={() => onChange([])}>{text.all}</button>
            <button type="button" onClick={() => setOpen(false)}>{text.close}</button>
          </div>
          <div className="multi-options">
            {visibleOptions.length ? visibleOptions.map((option) => (
              <label className="multi-option" key={option.value}>
                <input
                  checked={selectedSet.has(option.value)}
                  type="checkbox"
                  onChange={() => toggleValue(option.value)}
                />
                <span>{option.label}</span>
              </label>
            )) : <div className="multi-empty">{text.noMatches}</div>}
          </div>
        </div>
      )}
    </div>
  );
}

function RateBreakdown({ detail, language }: { detail: RateDetail; language: Language }) {
  const text = UI_COPY[language].charge;
  const categoryLabel: Record<ChargeCategory, string> = {
    'OCEAN FREIGHT': 'OCEAN FREIGHT',
    SURCHARGE: 'SURCHARGE',
    'LOCAL CHARGE': 'LOCAL CHARGE',
    UNCLASSIFIED: text.unclassified,
  };
  const hasUnclassified = detail.chargeItems.some((item) => item.category === 'UNCLASSIFIED');
  const sortedChargeItems = detail.chargeItems
    .map((item, index) => ({ item, index, rank: chargeSortRank(item, index) }))
    .sort((a, b) => {
      for (let i = 0; i < a.rank.length; i += 1) {
        if (a.rank[i] < b.rank[i]) return -1;
        if (a.rank[i] > b.rank[i]) return 1;
      }
      return 0;
    });

  return (
    <section className="detail-charge-section">
      <h3>{text.title}</h3>
      <div className="detail-meta-grid">
        <div><span>{text.freightUnit}</span><strong>{detail.freightUnit || '-'}</strong></div>
        <div><span>{text.payment}</span><strong>{detail.prepaidCollect || '-'} / {detail.masterPrepaidCollect || '-'}</strong></div>
        <div><span>{text.count}</span><strong>{formatNumber(detail.chargeCount)}</strong></div>
        <div><span>{text.basket}</span><strong>{detail.chargeBasket || '-'}</strong></div>
      </div>
      {hasUnclassified && (
        <p className="charge-data-note">
          {text.dataNote}
        </p>
      )}
      <p>{text.note}</p>
      <div className="detail-charge-table-wrap">
        <table className="detail-rate-table">
          <thead>
            <tr><th>{text.charge}</th><th>{text.registeredAmount}</th><th>{text.usdAmount}</th><th>{text.paymentLocation}</th></tr>
          </thead>
          <tbody>
            {sortedChargeItems.length ? sortedChargeItems.map(({ item, index }) => {
              const usage = chargeUsage(item, language);
              return (
                <tr key={`${item.code}-${item.currency}-${index}`}>
                  <td className="charge-code-cell">
                    <strong>{item.code}</strong>
                    <span className={`charge-category charge-${item.category.toLowerCase().replaceAll(' ', '-')}`}>{categoryLabel[item.category]}</span>
                  </td>
                  <td className="money-cell registered-amount-cell">
                    <span>{item.currency && item.localAmount !== null ? `${item.currency} ${formatAmount(item.localAmount)}` : '-'}</span>
                    <span className={`charge-usage ${usage.className}`} title={usage.comparisonLabel}>{usage.label}</span>
                  </td>
                  <td className="money-cell">{formatRateMoney(item.usdAmount)}</td>
                  <td><span className={`payment-location payment-${item.paymentCode.toLowerCase()}`}>{formatPaymentLocation(item.paymentCode, language)}</span></td>
                </tr>
              );
            }) : (
              <tr><td className="empty-cell" colSpan={4}>{text.empty}</td></tr>
            )}
          </tbody>
          <tfoot>
            <tr><th colSpan={2}>{text.comparisonAllIn}</th><th>{formatRateMoney(detail.allInRate)}</th><th></th></tr>
          </tfoot>
        </table>
      </div>
    </section>
  );
}

function RateDetailPanel({ rate, detail, language, onClose }: { rate: LowRateCase | null; detail: RateDetail | null; language: Language; onClose: () => void }) {
  const text = UI_COPY[language].detail;
  if (!rate) {
    return (
      <aside className="detail-panel detail-side-panel detail-panel-empty">
        <FileText size={22} aria-hidden="true" />
        <strong>{text.selectTitle}</strong>
        <span>{text.selectHint}</span>
      </aside>
    );
  }

  return (
    <aside className="detail-panel detail-side-panel">
      <div className="panel-head">
        <div>
          <p>{text.rateDetail}</p>
          <h2>{rate.rateApplicationNo}</h2>
        </div>
        <button className="square-button" type="button" onClick={onClose} title={text.close}>
          <X size={16} aria-hidden="true" />
        </button>
      </div>
      <div className="detail-grid">
        <div className="detail-wide"><span>{text.lane}</span><strong>{rate.porPort} {rate.porCountry} → {rate.dlyPort} {rate.dlyCountry}</strong></div>
        <div><span>CNTR Size / Type</span><strong>{rate.containerSize || '-'} / {rate.containerType || '-'}</strong></div>
        <div><span>{text.validPeriodShort}</span><strong>{formatDate(rate.effectiveStart)} ~ {formatDate(rate.effectiveEnd)}</strong></div>
        <div className="detail-wide"><span>{text.cargoProfile}</span><strong>{formatCargoType(rate.cargoType)} / {formatOogType(rate.specialCargoType)} / {formatFullEmptyType(rate.fullEmptyType)}</strong></div>
        <div><span>{text.registeredDetail}</span><strong>{formatMoney(rate.ofRate)} ({formatMoney(rate.allInRate)})</strong></div>
        <div><span>{text.gapBasis}</span><strong>{rate.gapPct ? `${formatSignedPct(rate.gapPct)} / ${formatMoney(rate.gapAmount)}` : '-'}</strong></div>
        <div><span>{text.appliedBenchmark}</span><strong>{formatMoney(rate.benchmarkRate)} / {rate.benchmarkSource === 'market' ? 'Market Rate' : UI_COPY[language].status.average}</strong></div>
        <div><span>{text.salesStaff}</span><strong>{rate.staff}</strong></div>
        <div className="detail-wide"><span>{text.company}</span><strong>{rate.shipperCode || '-'} / {rate.shipperName || '-'}</strong></div>
      </div>
      {detail && <RateBreakdown detail={detail} language={language} />}
    </aside>
  );
}

function AppContent({ data }: { data: MonitoringData }) {
  const records = useMemo(() => decodeRecords(data), [data]);
  const [summaryFilters, setSummaryFilters] = useState<FilterState>(() => createDefaultFilters(data));
  const [detailFilters, setDetailFilters] = useState<FilterState>(() => createDefaultFilters(data));
  const [page, setPage] = useState(1);
  const [view, setView] = useState<'summary' | 'detail'>('summary');
  const [summaryDim, setSummaryDim] = useState<'origin' | 'destination' | 'staff' | 'company'>('origin');
  const [expandedOriginCountries, setExpandedOriginCountries] = useState<string[]>([]);
  const [expandedDestinationCountries, setExpandedDestinationCountries] = useState<string[]>([]);
  const [selectedTrendCompany, setSelectedTrendCompany] = useState('');
  const [selectedCase, setSelectedCase] = useState<LowRateCase | null>(null);
  const [language, setLanguage] = useState<Language>(() => {
    try {
      return localStorage.getItem(LANGUAGE_STORAGE_KEY) === 'en' ? 'en' : 'ko';
    } catch {
      return 'ko';
    }
  });
  const text = UI_COPY[language];
  const selectedRateDetail = selectedCase ? decodeRateDetail(data.dimensions.rateDetails[selectedCase.rateDetailIndex]) : null;
  const activeFilters = view === 'summary' ? summaryFilters : detailFilters;
  const setActiveFilters = view === 'summary' ? setSummaryFilters : setDetailFilters;

  const summaryScope = useMemo(() => filterScope(summaryFilters), [summaryFilters]);
  const detailScope = useMemo(() => filterScope(detailFilters), [detailFilters]);
  const summaryPeriodAnalysis = useMemo(
    () => buildPeriodAnalysis(
      records,
      summaryFilters.periodStart,
      summaryFilters.periodEnd,
      data.metadata.marketAverageFallbackMinimumSamples,
    ),
    [data.metadata.marketAverageFallbackMinimumSamples, records, summaryFilters.periodEnd, summaryFilters.periodStart],
  );
  const detailPeriodAnalysis = useMemo(
    () => buildPeriodAnalysis(
      records,
      detailFilters.periodStart,
      detailFilters.periodEnd,
      data.metadata.marketAverageFallbackMinimumSamples,
    ),
    [data.metadata.marketAverageFallbackMinimumSamples, detailFilters.periodEnd, detailFilters.periodStart, records],
  );
  const summaryRates = useMemo(() => summaryPeriodAnalysis.activeRates.filter((rate) => matchesScope(rate, summaryScope)), [summaryPeriodAnalysis.activeRates, summaryScope]);
  const summaryCases = useMemo(() => summaryPeriodAnalysis.cases.filter((item) => matchesScope(item, summaryScope)), [summaryPeriodAnalysis.cases, summaryScope]);
  const detailRates = useMemo(() => detailPeriodAnalysis.activeRates.filter((rate) => matchesScope(rate, detailScope)), [detailPeriodAnalysis.activeRates, detailScope]);
  const detailCases = useMemo(() => detailPeriodAnalysis.cases.filter((item) => matchesScope(item, detailScope)), [detailPeriodAnalysis.cases, detailScope]);
  const filteredCases = useMemo(() => {
    const normalizedQuery = detailFilters.query.trim().toLowerCase();
    return detailCases.filter((item) => {
      if (detailFilters.status.length && !detailFilters.status.includes(item.status)) {
        return false;
      }
      if (!normalizedQuery) {
        return true;
      }
      return [
        item.rateApplicationNo,
        item.staff,
        item.shipperCode,
        item.shipperName,
        item.porCountry,
        item.porPort,
        item.dlyCountry,
        item.dlyPort,
        item.container,
        item.cargoProfile,
        item.approvalStatus,
      ]
        .join(' ')
        .toLowerCase()
        .includes(normalizedQuery);
    });
  }, [detailCases, detailFilters.query, detailFilters.status]);

  useEffect(() => {
    setPage(1);
  }, [detailFilters]);

  const pageCount = Math.max(1, Math.ceil(filteredCases.length / PAGE_SIZE));
  const visibleCases = filteredCases.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE);
  const currentFilterCount = activeFilterCount(activeFilters);
  const currentRates = view === 'summary' ? summaryRates : detailRates;
  const currentCases = view === 'summary' ? summaryCases : filteredCases;
  const toOptions = (values: string[], labelFn: (value: string) => string = (value) => value): FilterOption[] => values.map((value) => ({ value, label: labelFn(value) }));
  const originCountries = useMemo(() => unique(records.map((item) => item.porCountry)), [records]);
  const originCountryOptions = useMemo(() => toOptions(originCountries), [originCountries]);
  const originPorts = useMemo(
    () => unique(records.filter((item) => hasSelection(activeFilters.originCountry, item.porCountry)).map((item) => item.porPort)),
    [activeFilters.originCountry, records],
  );
  const originPortOptions = useMemo(() => toOptions(originPorts), [originPorts]);
  const destinationCountries = useMemo(() => unique(records.map((item) => item.dlyCountry)), [records]);
  const destinationCountryOptions = useMemo(() => toOptions(destinationCountries), [destinationCountries]);
  const destinationPorts = useMemo(
    () => unique(records.filter((item) => hasSelection(activeFilters.destinationCountry, item.dlyCountry)).map((item) => item.dlyPort)),
    [activeFilters.destinationCountry, records],
  );
  const destinationPortOptions = useMemo(() => toOptions(destinationPorts), [destinationPorts]);
  const containerSizes = useMemo(() => unique(records.map((item) => item.containerSize)), [records]);
  const containerSizeOptions = useMemo(() => toOptions(containerSizes), [containerSizes]);
  const containerTypes = useMemo(
    () => unique(records.filter((item) => hasSelection(activeFilters.containerSize, item.containerSize)).map((item) => item.containerType)),
    [activeFilters.containerSize, records],
  );
  const containerTypeOptions = useMemo(() => toOptions(containerTypes), [containerTypes]);
  const cargoTypes = useMemo(() => unique([...Object.keys(CARGO_TYPE_LABELS), ...records.map((item) => item.cargoType)]), [records]);
  const cargoTypeOptions = useMemo(() => toOptions(cargoTypes, formatCargoType), [cargoTypes]);
  const specialCargoTypes = useMemo(
    () => unique([
      ...Object.keys(OOG_TYPE_LABELS),
      ...records.filter((item) => hasSelection(activeFilters.cargoType, item.cargoType)).map((item) => item.specialCargoType),
    ]),
    [activeFilters.cargoType, records],
  );
  const specialCargoTypeOptions = useMemo(() => toOptions(specialCargoTypes, formatOogType), [specialCargoTypes]);
  const fullEmptyTypes = useMemo(() => unique(records.map((item) => item.fullEmptyType)), [records]);
  const fullEmptyTypeOptions = useMemo(() => toOptions(fullEmptyTypes, formatFullEmptyType), [fullEmptyTypes]);
  const approvalStatuses = useMemo(() => unique(records.map((item) => item.approvalStatus)), [records]);
  const formatApprovalStatus = (value: string) => data.metadata.approvalStatusLabels[value] ? `${data.metadata.approvalStatusLabels[value]} (${value})` : value;
  const staffOptions = useMemo(() => unique(records.map((item) => item.staff)), [records]);
  const staffFilterOptions = useMemo(() => toOptions(staffOptions), [staffOptions]);
  const statusFilterOptions = useMemo<FilterOption[]>(() => [
    { value: 'market', label: text.status.market },
    { value: 'average', label: text.status.average },
  ], [text.status.average, text.status.market]);
  const companies = useMemo(
    () => data.dimensions.shippers
      .map(([code, name]) => [code, name, `${code || '-'} / ${name || 'No company name'}`] as const)
      .filter(([code, name]) => code || name)
      .sort((a, b) => a[2].localeCompare(b[2])),
    [data.dimensions.shippers],
  );
  const companyOptions = useMemo<FilterOption[]>(
    () => companies.map(([code, name, label]) => ({ value: code || name, label })),
    [companies],
  );
  const periodStart = activeFilters.periodStart;
  const periodEnd = activeFilters.periodEnd;
  const originCountry = activeFilters.originCountry[0] ?? '';
  const originPort = activeFilters.originPort[0] ?? '';
  const destinationCountry = activeFilters.destinationCountry[0] ?? '';
  const destinationPort = activeFilters.destinationPort[0] ?? '';
  const containerSize = activeFilters.containerSize[0] ?? '';
  const containerType = activeFilters.containerType[0] ?? '';
  const cargoType = activeFilters.cargoType[0] ?? '';
  const specialCargoType = activeFilters.specialCargoType[0] ?? '';
  const fullEmptyType = activeFilters.fullEmptyType[0] ?? '';
  const staff = activeFilters.staff[0] ?? '';
  const company = activeFilters.company[0] ?? '';
  const query = activeFilters.query;
  const statusFilter: 'all' | IssueStatus = activeFilters.status.length === 1 ? activeFilters.status[0] : 'all';
  const setPeriodStart = (value: string) => setActiveFilters((current) => ({ ...current, periodStart: value }));
  const setPeriodEnd = (value: string) => setActiveFilters((current) => ({ ...current, periodEnd: value }));
  const setOriginCountry = (value: string) => setActiveFilters((current) => ({ ...current, originCountry: value ? [value] : [] }));
  const setOriginPort = (value: string) => setActiveFilters((current) => ({ ...current, originPort: value ? [value] : [] }));
  const setDestinationCountry = (value: string) => setActiveFilters((current) => ({ ...current, destinationCountry: value ? [value] : [] }));
  const setDestinationPort = (value: string) => setActiveFilters((current) => ({ ...current, destinationPort: value ? [value] : [] }));
  const setContainerSize = (value: string) => setActiveFilters((current) => ({ ...current, containerSize: value ? [value] : [] }));
  const setContainerType = (value: string) => setActiveFilters((current) => ({ ...current, containerType: value ? [value] : [] }));
  const setCargoType = (value: string) => setActiveFilters((current) => ({ ...current, cargoType: value ? [value] : [] }));
  const setSpecialCargoType = (value: string) => setActiveFilters((current) => ({ ...current, specialCargoType: value ? [value] : [] }));
  const setFullEmptyType = (value: string) => setActiveFilters((current) => ({ ...current, fullEmptyType: value ? [value] : [] }));
  const setStaff = (value: string) => setActiveFilters((current) => ({ ...current, staff: value ? [value] : [] }));
  const setCompany = (value: string) => setActiveFilters((current) => ({ ...current, company: value ? [value] : [] }));
  const setQuery = (value: string) => setActiveFilters((current) => ({ ...current, query: value }));
  const setStatusFilter = (value: 'all' | IssueStatus) => setActiveFilters((current) => ({ ...current, status: value === 'all' ? [] : [value] }));
  const marketLowCount = currentCases.filter((item) => item.status === 'market').length;
  const averageLowCount = currentCases.filter((item) => item.status === 'average').length;
  const lowShipperCount = new Set(currentCases.map(shipperKey).filter(Boolean)).size;
  const marketCoverageCount = currentRates.filter((item) => item.marketRate !== null).length;
  const laneSummary = useMemo(() => {
    const lanes = new Map<string, { lane: string; count: number; lowShipperCount: number; marketLow: number; averageLow: number; marketMapped: number; activeCount: number; shipperKeys: Set<string> }>();
    for (const item of summaryCases) {
      const lane = `${item.porPort} ${item.porCountry} -> ${item.dlyPort} ${item.dlyCountry}`;
      const current = lanes.get(lane) ?? { lane, count: 0, lowShipperCount: 0, marketLow: 0, averageLow: 0, marketMapped: 0, activeCount: 0, shipperKeys: new Set<string>() };
      current.count += 1;
      current.marketLow += item.status === 'market' ? 1 : 0;
      current.averageLow += item.status === 'average' ? 1 : 0;
      const shipper = shipperKey(item);
      if (shipper) {
        current.shipperKeys.add(shipper);
      }
      lanes.set(lane, current);
    }
    for (const item of summaryRates) {
      const lane = `${item.porPort} ${item.porCountry} -> ${item.dlyPort} ${item.dlyCountry}`;
      const current = lanes.get(lane);
      if (!current) {
        continue;
      }
      current.activeCount += 1;
      current.marketMapped += item.marketRate !== null ? 1 : 0;
    }
    return Array.from(lanes.values())
      .map(({ shipperKeys, ...lane }) => ({ ...lane, lowShipperCount: shipperKeys.size }))
      .sort((a, b) => b.count - a.count || b.lowShipperCount - a.lowShipperCount || a.lane.localeCompare(b.lane))
      .slice(0, 10);
  }, [summaryCases, summaryRates]);

  const originCountrySummary = useMemo(
    () => buildGroupSummary(
      summaryCases,
      summaryRates,
      (record) => record.porCountry,
      (record) => record.porCountry,
      (record) => ({ originCountry: record.porCountry }),
    ),
    [summaryCases, summaryRates],
  );
  const originPortSummary = useMemo(
    () => buildGroupSummary(
      summaryCases,
      summaryRates,
      (record) => record.porPort ? `${record.porCountry}|${record.porPort}` : '',
      (record) => `${record.porCountry} ${record.porPort}`,
      (record) => ({ originCountry: record.porCountry, originPort: record.porPort }),
    ),
    [summaryCases, summaryRates],
  );
  const originSummary = useMemo(
    () => buildExpandedLocationSummary(originCountrySummary, originPortSummary, expandedOriginCountries, 'originCountry'),
    [expandedOriginCountries, originCountrySummary, originPortSummary],
  );
  const destinationCountrySummary = useMemo(
    () => buildGroupSummary(
      summaryCases,
      summaryRates,
      (record) => record.dlyCountry,
      (record) => record.dlyCountry,
      (record) => ({ destinationCountry: record.dlyCountry }),
    ),
    [summaryCases, summaryRates],
  );
  const destinationPortSummary = useMemo(
    () => buildGroupSummary(
      summaryCases,
      summaryRates,
      (record) => record.dlyPort ? `${record.dlyCountry}|${record.dlyPort}` : '',
      (record) => `${record.dlyCountry} ${record.dlyPort}`,
      (record) => ({ destinationCountry: record.dlyCountry, destinationPort: record.dlyPort }),
    ),
    [summaryCases, summaryRates],
  );
  const destinationSummary = useMemo(
    () => buildExpandedLocationSummary(destinationCountrySummary, destinationPortSummary, expandedDestinationCountries, 'destinationCountry'),
    [destinationCountrySummary, destinationPortSummary, expandedDestinationCountries],
  );
  const staffSummary = useMemo(
    () => buildGroupSummary(
      summaryCases,
      summaryRates,
      (record) => record.staff,
      (record) => record.staff || '미지정',
      (record) => ({ staff: record.staff }),
    ),
    [summaryCases, summaryRates],
  );
  const companySummary = useMemo(
    () => buildGroupSummary(
      summaryCases,
      summaryRates,
      (record) => record.shipperCode || record.shipperName,
      (record) => `${record.shipperCode || '-'} / ${record.shipperName || 'No company name'}`,
      (record) => ({ company: record.shipperCode || record.shipperName }),
    ),
    [summaryCases, summaryRates],
  );
  const selectedTrendCompanyRow = selectedTrendCompany
    ? companySummary.find((row) => row.key === selectedTrendCompany) ?? null
    : null;

  useEffect(() => {
    if (selectedTrendCompany && !selectedTrendCompanyRow) {
      setSelectedTrendCompany('');
    }
  }, [selectedTrendCompany, selectedTrendCompanyRow]);

  const companyTrend = useMemo(() => {
    const top = selectedTrendCompanyRow ? [selectedTrendCompanyRow] : companySummary.slice(0, 5);
    if (!top.length) {
      return { weeks: [] as Record<string, number | string | null>[], series: [] as { dataKey: string; key: string; label: string }[], showBenchmark: false };
    }
    const trendScope = { ...summaryScope, company: [] };
    const scopedRecords = records.filter((record) => matchesScope(record, trendScope));
    const series = top.map((row, index) => ({ dataKey: `s${index}`, key: row.key, label: row.label }));
    const weeks = data.weeks.map((week) => {
      const weekEndDate = addDays(week.value, 6);
      const row: Record<string, number | string | null> = { week: formatDate(week.value) };
      const weeklyRecords = scopedRecords.filter((record) => overlapsRange(record, week.value, weekEndDate));
      for (const item of series) {
        const matched = weeklyRecords.filter((record) => shipperKey(record) === item.key);
        row[item.dataKey] = matched.length ? Math.round(matched.reduce((sum, record) => sum + record.ofRate, 0) / matched.length) : null;
      }
      if (selectedTrendCompanyRow) {
        const selectedKeys = new Set(
          weeklyRecords
            .filter((record) => shipperKey(record) === selectedTrendCompanyRow.key)
            .map((record) => record.comparisonKey),
        );
        const peerBenchmarks = new Map<string, LaneBenchmark>();
        for (const record of weeklyRecords) {
          if (!selectedKeys.has(record.comparisonKey) || shipperKey(record) === selectedTrendCompanyRow.key) {
            continue;
          }
          const benchmark = peerBenchmarks.get(record.comparisonKey) ?? { sum: 0, count: 0 };
          benchmark.sum += record.ofRate;
          benchmark.count += 1;
          peerBenchmarks.set(record.comparisonKey, benchmark);
        }
        const comparableKeyAverages = Array.from(peerBenchmarks.values()).map((benchmark) => benchmark.sum / benchmark.count);
        row[TREND_BENCHMARK_DATA_KEY] = comparableKeyAverages.length
          ? Math.round(comparableKeyAverages.reduce((sum, average) => sum + average, 0) / comparableKeyAverages.length)
          : null;
      }
      return row;
    });
    return { weeks, series, showBenchmark: Boolean(selectedTrendCompanyRow) };
  }, [companySummary, records, summaryScope, data.weeks, selectedTrendCompanyRow]);

  const drillToDetail = (drill: DrillFilters) => {
    setDetailFilters({
      ...summaryFilters,
      originCountry: drill.originCountry !== undefined ? [drill.originCountry] : summaryFilters.originCountry,
      originPort: drill.originPort !== undefined ? [drill.originPort] : summaryFilters.originPort,
      destinationCountry: drill.destinationCountry !== undefined ? [drill.destinationCountry] : summaryFilters.destinationCountry,
      destinationPort: drill.destinationPort !== undefined ? [drill.destinationPort] : summaryFilters.destinationPort,
      containerSize: drill.containerSize !== undefined ? [drill.containerSize] : summaryFilters.containerSize,
      containerType: drill.containerType !== undefined ? [drill.containerType] : summaryFilters.containerType,
      cargoType: drill.cargoType !== undefined ? [drill.cargoType] : summaryFilters.cargoType,
      specialCargoType: drill.specialCargoType !== undefined ? [drill.specialCargoType] : summaryFilters.specialCargoType,
      fullEmptyType: drill.fullEmptyType !== undefined ? [drill.fullEmptyType] : summaryFilters.fullEmptyType,
      staff: drill.staff !== undefined ? [drill.staff] : summaryFilters.staff,
      company: drill.company !== undefined ? [drill.company] : summaryFilters.company,
      status: [],
      query: '',
    });
    setPage(1);
    setSelectedCase(null);
    setView('detail');
  };

  const toggleSummaryCountry = (country: string) => {
    const toggle = (current: string[]) => current.includes(country)
      ? current.filter((value) => value !== country)
      : [...current, country];

    if (summaryDim === 'origin') {
      setExpandedOriginCountries(toggle);
    } else if (summaryDim === 'destination') {
      setExpandedDestinationCountries(toggle);
    }
  };

  const handleSummaryRowClick = (row: GroupRow) => {
    if (row.level === 'country') {
      toggleSummaryCountry(row.key);
      return;
    }
    if (summaryDim === 'company') {
      setSelectedTrendCompany(row.key);
      return;
    }
    drillToDetail(row.drill);
  };

  const summaryRows = summaryDim === 'origin'
    ? originSummary
    : summaryDim === 'destination'
      ? destinationSummary
      : summaryDim === 'staff'
        ? staffSummary
        : companySummary;
  const summaryHead = summaryDim === 'origin' ? text.summary.origin : summaryDim === 'destination' ? text.summary.destination : summaryDim === 'staff' ? text.filter.staff : text.filter.company;
  const summaryShowActive = summaryDim === 'origin' || summaryDim === 'destination';
  const summaryCountLabel = summaryDim === 'origin'
    ? `${formatNumber(originCountrySummary.length)} ${language === 'ko' ? '국가' : 'countries'}`
    : summaryDim === 'destination'
      ? `${formatNumber(destinationCountrySummary.length)} ${language === 'ko' ? '국가' : 'countries'}`
      : `${formatNumber(summaryRows.length)} ${summaryHead}`;

  const resetScope = () => {
    setActiveFilters(createDefaultFilters(data));
    if (view === 'summary') {
      setExpandedOriginCountries([]);
      setExpandedDestinationCountries([]);
      setSelectedTrendCompany('');
    } else {
      setSelectedCase(null);
      setPage(1);
    }
  };
  const toggleLanguage = () => {
    setLanguage((current) => {
      const next = current === 'ko' ? 'en' : 'ko';
      try {
        localStorage.setItem(LANGUAGE_STORAGE_KEY, next);
      } catch {
        // ignore storage errors
      }
      return next;
    });
  };

  return (
    <div className="app-shell">
      <header className="topbar">
        <div className="topbar-title">
          <h1>{text.title}</h1>
          <aside className="source-remark">
            <Database size={14} aria-hidden="true" />
            <strong>{text.source.source}</strong>
            <span title={data.metadata.sourceFile}>{data.metadata.sourceFile}</span>
            <span>{text.source.role}</span>
            <span>{formatNumber(data.metadata.recordCount)} {text.source.records}</span>
            <span>{text.source.updated} {formatDate(data.metadata.latestSourceDate)}</span>
            <span>{text.source.cache} {data.metadata.generatedAt.replace('T', ' ')}</span>
          </aside>
        </div>
        <div className="topbar-actions">
          <a className="icon-button" href={`${USER_GUIDE_URL}?lang=${language}`} target="_blank" rel="noreferrer">
            <BookOpen size={15} aria-hidden="true" />
            {USER_GUIDE_COPY[language].button}
          </a>
          <a className="icon-button" href={RATE_DASHBOARD_URL} target="_blank" rel="noreferrer">
            <ExternalLink size={15} aria-hidden="true" />
            {text.dashboardLink}
          </a>
          <button className="icon-button language-toggle" type="button" onClick={toggleLanguage} aria-label="Toggle language">
            <Languages size={15} aria-hidden="true" />
            {text.languageToggle}
          </button>
        </div>
      </header>

      <main>
        {!data.metadata.chargeDetailAvailable && (
          <aside className="data-quality-warning">
            <strong>{text.dataQuality.title}</strong>
            <span>{text.dataQuality.message}</span>
          </aside>
        )}

        <section className="scope-bar">
          <div className="scope-heading">
            <span className="scope-heading-title">
              <Filter size={17} aria-hidden="true" />
              <strong>{text.filter.title}</strong>
            </span>
            <span>{currentFilterCount} {text.filter.filters}</span>
          </div>
          <div className="filter-grid active-filter-grid">
            <label className="date-filter">
              <span>{text.filter.startDate}</span>
              <input
                type="date"
                min={data.metadata.availableStartDate}
                max={activeFilters.periodEnd}
                value={activeFilters.periodStart}
                onChange={(event) => {
                  const nextStart = event.target.value;
                  if (nextStart) {
                    setActiveFilters((current) => ({
                      ...current,
                      periodStart: nextStart,
                      periodEnd: current.periodEnd < nextStart ? weekEnd(nextStart) : current.periodEnd,
                    }));
                  }
                }}
              />
            </label>
            <label className="date-filter">
              <span>{text.filter.endDate}</span>
              <input
                type="date"
                min={activeFilters.periodStart}
                max={data.metadata.availableEndDate}
                value={activeFilters.periodEnd}
                onChange={(event) => event.target.value && setActiveFilters((current) => ({ ...current, periodEnd: event.target.value }))}
              />
            </label>
            <MultiSelectFilter language={language} label={text.filter.originCountry} options={originCountryOptions} values={activeFilters.originCountry} onChange={(values) => setActiveFilters((current) => ({ ...current, originCountry: values, originPort: [] }))} />
            <MultiSelectFilter language={language} label={text.filter.originPort} options={originPortOptions} values={activeFilters.originPort} onChange={(values) => setActiveFilters((current) => ({ ...current, originPort: values }))} />
            <MultiSelectFilter language={language} label={text.filter.destinationCountry} options={destinationCountryOptions} values={activeFilters.destinationCountry} onChange={(values) => setActiveFilters((current) => ({ ...current, destinationCountry: values, destinationPort: [] }))} />
            <MultiSelectFilter language={language} label={text.filter.destinationPort} options={destinationPortOptions} values={activeFilters.destinationPort} onChange={(values) => setActiveFilters((current) => ({ ...current, destinationPort: values }))} />
            <MultiSelectFilter language={language} label={text.filter.containerSize} options={containerSizeOptions} values={activeFilters.containerSize} onChange={(values) => setActiveFilters((current) => ({ ...current, containerSize: values, containerType: [] }))} />
            <MultiSelectFilter language={language} label={text.filter.containerType} options={containerTypeOptions} values={activeFilters.containerType} onChange={(values) => setActiveFilters((current) => ({ ...current, containerType: values }))} />
            <MultiSelectFilter language={language} className="cargo-type-filter" label={text.filter.cargoType} options={cargoTypeOptions} values={activeFilters.cargoType} onChange={(values) => setActiveFilters((current) => ({ ...current, cargoType: values, specialCargoType: [] }))} />
            <MultiSelectFilter language={language} className="special-cargo-filter" label={text.filter.oogType} options={specialCargoTypeOptions} values={activeFilters.specialCargoType} onChange={(values) => setActiveFilters((current) => ({ ...current, specialCargoType: values }))} />
            <MultiSelectFilter language={language} className="full-empty-filter" label={text.filter.fullEmpty} options={fullEmptyTypeOptions} values={activeFilters.fullEmptyType} onChange={(values) => setActiveFilters((current) => ({ ...current, fullEmptyType: values }))} />
            <MultiSelectFilter language={language} label={text.filter.staff} options={staffFilterOptions} values={activeFilters.staff} onChange={(values) => setActiveFilters((current) => ({ ...current, staff: values }))} />
            <MultiSelectFilter language={language} className="company-filter" label={text.filter.company} options={companyOptions} values={activeFilters.company} onChange={(values) => setActiveFilters((current) => ({ ...current, company: values }))} />
            {view === 'detail' && <MultiSelectFilter language={language} label={text.filter.status} options={statusFilterOptions} values={activeFilters.status} onChange={(values) => setActiveFilters((current) => ({ ...current, status: values as IssueStatus[] }))} />}
            {view === 'detail' && (
              <label className="query-filter">
                <span>{text.filter.rateSearch}</span>
                <div>
                  <Search size={14} aria-hidden="true" />
                  <input value={activeFilters.query} onChange={(event) => setActiveFilters((current) => ({ ...current, query: event.target.value }))} placeholder={text.filter.ratePlaceholder} />
                </div>
              </label>
            )}
          </div>
          <div className="filter-grid legacy-filter-grid" aria-hidden="true">
            <label className="date-filter">
              <span>시작일</span>
              <input
                type="date"
                min={data.metadata.availableStartDate}
                max={periodEnd}
                value={periodStart}
                onChange={(event) => event.target.value && setPeriodStart(event.target.value)}
              />
            </label>
            <label className="date-filter">
              <span>종료일</span>
              <input
                type="date"
                min={periodStart}
                max={data.metadata.availableEndDate}
                value={periodEnd}
                onChange={(event) => event.target.value && setPeriodEnd(event.target.value)}
              />
            </label>
            <label>
              <span>선적지 국가</span>
              <select value={originCountry} onChange={(event) => { setOriginCountry(event.target.value); setOriginPort(''); }}>
                <option value="">All</option>
                {originCountries.map((value) => <option key={value} value={value}>{value}</option>)}
              </select>
            </label>
            <label>
              <span>선적지 포트</span>
              <select value={originPort} onChange={(event) => setOriginPort(event.target.value)}>
                <option value="">All</option>
                {originPorts.map((value) => <option key={value} value={value}>{value}</option>)}
              </select>
            </label>
            <label>
              <span>도착지 국가</span>
              <select value={destinationCountry} onChange={(event) => { setDestinationCountry(event.target.value); setDestinationPort(''); }}>
                <option value="">All</option>
                {destinationCountries.map((value) => <option key={value} value={value}>{value}</option>)}
              </select>
            </label>
            <label>
              <span>도착지 포트</span>
              <select value={destinationPort} onChange={(event) => setDestinationPort(event.target.value)}>
                <option value="">All</option>
                {destinationPorts.map((value) => <option key={value} value={value}>{value}</option>)}
              </select>
            </label>
            <label>
              <span>CNTR Size</span>
              <select value={containerSize} onChange={(event) => { setContainerSize(event.target.value); setContainerType(''); }}>
                <option value="">All</option>
                {containerSizes.map((value) => <option key={value} value={value}>{value}</option>)}
              </select>
            </label>
            <label>
              <span>CNTR Type</span>
              <select value={containerType} onChange={(event) => setContainerType(event.target.value)}>
                <option value="">All</option>
                {containerTypes.map((value) => <option key={value} value={value}>{value}</option>)}
              </select>
            </label>
            <label className="cargo-type-filter">
              <span>Cargo Type</span>
              <select value={cargoType} onChange={(event) => { setCargoType(event.target.value); setSpecialCargoType(''); }}>
                <option value="">All</option>
                {cargoTypes.map((value) => <option key={value} value={value}>{formatCargoType(value)}</option>)}
              </select>
            </label>
            <label className="special-cargo-filter">
              <span>OOG Type</span>
              <select value={specialCargoType} onChange={(event) => setSpecialCargoType(event.target.value)}>
                <option value="">All</option>
                {specialCargoTypes.map((value) => <option key={value} value={value}>{formatOogType(value)}</option>)}
              </select>
            </label>
            <label className="full-empty-filter">
              <span>Full / Empty</span>
              <select value={fullEmptyType} onChange={(event) => setFullEmptyType(event.target.value)}>
                <option value="">All</option>
                {fullEmptyTypes.map((value) => <option key={value} value={value}>{formatFullEmptyType(value)}</option>)}
              </select>
            </label>
            <label>
              <span>판정 Status</span>
              <select value={statusFilter} onChange={(event) => setStatusFilter(event.target.value as 'all' | IssueStatus)}>
                <option value="all">All</option>
                <option value="market">Market 저운임</option>
                <option value="average">기간 Avg 저운임</option>
              </select>
            </label>
            <label>
              <span>영업사원</span>
              <select value={staff} onChange={(event) => setStaff(event.target.value)}>
                <option value="">All</option>
                {staffOptions.map((value) => <option key={value} value={value}>{value}</option>)}
              </select>
            </label>
            <label className="company-filter">
              <span>업체</span>
              <input list="company-options" value={company} onChange={(event) => setCompany(event.target.value)} placeholder="Code or company name" />
              <datalist id="company-options">
                {companies.map(([code, name, label]) => <option key={`${code}-${name}`} value={`${code} ${name}`} label={label} />)}
              </datalist>
            </label>
            <label className="query-filter">
              <span>운임번호 검색</span>
              <div>
                <Search size={15} aria-hidden="true" />
                <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Rate application no." />
              </div>
            </label>
          </div>
          <button className="reset-button" type="button" onClick={resetScope}>
            <X size={15} aria-hidden="true" />
            {text.filter.reset}
          </button>
        </section>

        <section className="metric-strip">
          <div>
            <CalendarDays size={18} aria-hidden="true" />
            <span>{text.metrics.activeRates}</span>
            <strong>{formatNumber(currentRates.length)}</strong>
          </div>
          <div>
            <AlertTriangle size={18} aria-hidden="true" />
            <span>{text.metrics.lowCases}</span>
            <strong>{formatNumber(currentCases.length)}</strong>
          </div>
          <div>
            <CircleDollarSign size={18} aria-hidden="true" />
            <span>{text.metrics.marketLow}</span>
            <strong>{formatNumber(marketLowCount)}</strong>
          </div>
          <div>
            <BarChart3 size={18} aria-hidden="true" />
            <span>{text.metrics.averageLow}</span>
            <strong>{formatNumber(averageLowCount)}</strong>
          </div>
          <div>
            <Users size={18} aria-hidden="true" />
            <span>{text.metrics.lowShippers}</span>
            <strong>{formatNumber(lowShipperCount)}</strong>
          </div>
          <div>
            <Route size={18} aria-hidden="true" />
            <span>{text.metrics.marketCoverage}</span>
            <strong>{formatPct(currentRates.length ? marketCoverageCount / currentRates.length : 0)}</strong>
          </div>
        </section>

        <section className={`content-grid${view === 'summary' ? '' : ' content-grid-detail'}`}>
          <section className="results-panel">
            <div className="panel-head">
              <div>
                <p>{view === 'summary' ? text.panel.aggregatedView : text.panel.lowFreightCases}</p>
                <h2>{view === 'summary' ? text.panel.summaryTitle : text.panel.detailTitle}</h2>
              </div>
              <strong>{view === 'summary' ? summaryCountLabel : `${formatNumber(filteredCases.length)} ${text.panel.cases}`}</strong>
            </div>
            <div className="view-tabs">
              <button className={view === 'summary' ? 'active' : ''} type="button" onClick={() => setView('summary')}>{text.panel.summaryTab}</button>
              <button className={view === 'detail' ? 'active' : ''} type="button" onClick={() => setView('detail')}>{text.panel.detailTab}</button>
            </div>

            {view === 'summary' ? (
              <>
                <div className="segmented-control summary-dims">
                  {([
                    ['origin', text.summary.origin, Ship],
                    ['destination', text.summary.destination, Anchor],
                    ['staff', text.summary.staff, Users],
                    ['company', text.summary.company, TrendingUp],
                  ] as const).map(([value, label, Icon]) => (
                    <button
                      className={summaryDim === value ? 'active' : ''}
                      key={value}
                      type="button"
                      onClick={() => setSummaryDim(value)}
                    >
                      <Icon size={14} aria-hidden="true" />
                      {label}
                    </button>
                  ))}
                </div>

                {(summaryDim === 'origin' || summaryDim === 'destination') && (
                  <p className="summary-drill-note">{text.summary.drillNote}</p>
                )}

                {summaryDim === 'company' && (
                  <div className="trend-wrap">
                    {companyTrend.series.length ? (
                      <ResponsiveContainer width="100%" height={260}>
                        <LineChart data={companyTrend.weeks} margin={{ top: 8, right: 16, bottom: 0, left: 0 }}>
                          <CartesianGrid strokeDasharray="3 3" stroke="#eef1f0" />
                          <XAxis dataKey="week" tick={{ fontSize: 11 }} />
                          <YAxis tick={{ fontSize: 11 }} width={58} tickFormatter={(value) => `$${formatNumber(Number(value))}`} />
                          <Tooltip formatter={(value) => (value == null ? '-' : formatMoney(Number(value)))} />
                          <Legend wrapperStyle={{ fontSize: 11 }} />
                          {companyTrend.series.map((item, index) => (
                            <Line
                              key={item.dataKey}
                              type="monotone"
                              dataKey={item.dataKey}
                              name={item.label}
                              stroke={TREND_COLORS[index % TREND_COLORS.length]}
                              strokeWidth={2}
                              dot={false}
                              connectNulls
                            />
                          ))}
                          {companyTrend.showBenchmark && (
                            <Line
                              type="monotone"
                              dataKey={TREND_BENCHMARK_DATA_KEY}
                              name={text.summary.benchmarkLegend}
                              stroke="#687580"
                              strokeDasharray="7 5"
                              strokeWidth={2}
                              dot={false}
                              connectNulls
                            />
                          )}
                        </LineChart>
                      </ResponsiveContainer>
                    ) : (
                      <span className="muted">{text.summary.noTrend}</span>
                    )}
                    <div className="trend-note-row">
                      <p className="trend-note">
                        {selectedTrendCompanyRow
                          ? `${selectedTrendCompanyRow.label} ${text.summary.trendSelectedSuffix}`
                          : `${text.summary.topTrendPrefix} ${companyTrend.series.length} ${text.summary.topTrendSuffix}`}
                      </p>
                      {selectedTrendCompanyRow && (
                        <button className="trend-reset-button" type="button" onClick={() => setSelectedTrendCompany('')}>
                          {text.summary.resetTopTrend}
                        </button>
                      )}
                    </div>
                  </div>
                )}

                <div className="table-wrap">
                  <table className={`summary-table${summaryDim === 'company' ? ' summary-company-table' : ''}`}>
                    <thead>
                      <tr>
                        <th>{summaryHead}</th>
                        <th>{text.summary.head.lowCount}</th>
                        {summaryDim === 'company' ? (
                          <>
                            <th>{text.summary.head.laneCount}</th>
                            <th>{text.summary.head.rateFileCount}</th>
                          </>
                        ) : <th>{text.summary.head.lowShipperCount}</th>}
                        <th>{text.summary.head.marketLow}</th>
                        <th>{text.summary.head.averageLow}</th>
                      </tr>
                    </thead>
                    <tbody>
                      {summaryRows.length ? summaryRows.map((row) => (
                        <tr
                          className={[
                            row.level ? `summary-${row.level}-row` : '',
                            summaryDim === 'company' && selectedTrendCompany === row.key ? 'summary-selected-row' : '',
                          ].filter(Boolean).join(' ')}
                          key={`${row.level ?? 'group'}-${row.key}`}
                          onClick={() => handleSummaryRowClick(row)}
                        >
                          <td>
                            {row.level ? (
                              <div className="summary-location-label">
                                {row.level === 'country' && <ChevronRight className={row.expanded ? 'expanded' : ''} size={15} aria-hidden="true" />}
                                <strong>{row.label}</strong>
                              </div>
                            ) : <strong>{row.label}</strong>}
                            {summaryShowActive && (
                              <span>
                                {formatNumber(row.activeCount)} {text.summary.activeRateLabel}
                                {row.level === 'country' ? ` · ${text.summary.expandPrefix} ${row.expanded ? text.summary.collapse : text.summary.expand}` : ` · ${text.summary.detailDrill}`}
                              </span>
                            )}
                          </td>
                          <td className="num-cell"><strong>{formatNumber(row.count)}</strong></td>
                          {summaryDim === 'company' ? (
                            <>
                              <td className="num-cell"><strong>{formatNumber(row.laneCount)}</strong></td>
                              <td className="num-cell"><strong>{formatNumber(row.rateFileCount)}</strong></td>
                            </>
                          ) : <td className="num-cell"><strong>{formatNumber(row.shipperCount)}</strong></td>}
                          <td className="num-cell">{formatNumber(row.marketLow)}</td>
                          <td className="num-cell">{formatNumber(row.averageLow)}</td>
                        </tr>
                      )) : (
                        <tr>
                          <td colSpan={summaryDim === 'company' ? 6 : 5} className="empty-cell">{text.summary.empty}</td>
                        </tr>
                      )}
                    </tbody>
                  </table>
                </div>
              </>
            ) : (
              <>
                <div className="segmented-control">
                  {[
                    ['all', text.status.all],
                    ['market', text.status.market],
                    ['average', text.status.average],
                  ].map(([value, label]) => (
                    <button
                      className={statusFilter === value ? 'active' : ''}
                      key={value}
                      type="button"
                      onClick={() => setStatusFilter(value as 'all' | IssueStatus)}
                    >
                      {label}
                    </button>
                  ))}
                </div>
                <div className="table-wrap">
                  <table>
                    <thead>
                      <tr>
                        <th>{text.detail.status}</th>
                        <th>{text.detail.rateNo}</th>
                        <th>{text.detail.lane}</th>
                        <th>{text.detail.cntr}</th>
                        <th>{text.detail.registered}</th>
                        <th>{text.detail.marketRate}</th>
                        <th>{text.detail.benchmark}</th>
                        <th>{text.detail.periodAverage}</th>
                        <th>{text.detail.gap}</th>
                        <th>{text.detail.salesStaff}</th>
                        <th>{text.detail.company}</th>
                        <th>{text.detail.validPeriod}</th>
                      </tr>
                    </thead>
                    <tbody>
                      {visibleCases.length ? visibleCases.map((item) => (
                        <tr className={selectedCase?.id === item.id ? 'detail-selected-row' : undefined} key={item.id} onClick={() => setSelectedCase(item)}>
                          <td><StatusBadge status={item.status} language={language} /></td>
                          <td><button className="rate-link" type="button">{item.rateApplicationNo}</button></td>
                          <td><strong>{item.porPort} {item.porCountry} → {item.dlyPort} {item.dlyCountry}</strong></td>
                          <td>{item.container}<span>{formatCargoProfile(item.cargoProfile)}</span></td>
                          <td className="money-cell">{formatMoney(item.ofRate)}<span>all-in {formatMoney(item.allInRate)}</span></td>
                          <td className="money-cell">
                            {item.marketRate !== null ? `${formatMoney(item.marketRate)} (${formatMoney(item.marketRateAllIn as number)})` : '-'}
                            <span>{item.marketRate !== null ? text.detail.directMarket : text.detail.averageFallback}</span>
                          </td>
                          <td className="money-cell">{formatMoney(item.benchmarkRateOf)} ({formatMoney(item.benchmarkRate)})<span>{item.benchmarkSource === 'market' ? 'Market Rate · O/F (all-in)' : `${text.status.average} · O/F (all-in)`}</span></td>
                          <td className="money-cell">
                            {formatMoney(item.periodAverage)} ({formatMoney(item.periodAverageAllIn)})
                            <span>{item.benchmarkSampleCount} {text.detail.periodAvgSource}</span>
                          </td>
                          <td className="gap-cell">
                            <strong>{formatSignedPct(item.gapPct)}</strong>
                            <span>{formatMoney(item.gapAmount)}</span>
                          </td>
                          <td>{item.staff}</td>
                          <td><strong>{item.shipperCode || '-'}</strong><span>{item.shipperName || 'No company name'}</span></td>
                          <td>{formatDate(item.effectiveStart)}<span>~ {formatDate(item.effectiveEnd)}</span></td>
                        </tr>
                      )) : (
                        <tr>
                          <td colSpan={12} className="empty-cell">{text.detail.empty}</td>
                        </tr>
                      )}
                    </tbody>
                  </table>
                </div>
                <div className="pagination">
                  <span>{page} / {pageCount}</span>
                  <div>
                    <button className="square-button" type="button" disabled={page <= 1} onClick={() => setPage((value) => value - 1)}>
                      <ChevronLeft size={16} aria-hidden="true" />
                    </button>
                    <button className="square-button" type="button" disabled={page >= pageCount} onClick={() => setPage((value) => value + 1)}>
                      <ChevronRight size={16} aria-hidden="true" />
                    </button>
                  </div>
                </div>
              </>
            )}
          </section>

          {view === 'summary' && (
            <aside className="side-panel">
              <section>
                <div className="panel-head compact">
                  <div>
                    <p>{text.focus.eyebrow}</p>
                    <h2>{text.focus.title}</h2>
                  </div>
                </div>
                <p className="focus-note">{text.focus.note}</p>
                <div className="lane-list">
                  {laneSummary.length ? laneSummary.map((lane) => (
                    <article key={lane.lane}>
                      <div className="lane-head">
                        <strong>{lane.lane}</strong>
                        <strong className="lane-count">{formatNumber(lane.count)}</strong>
                      </div>
                      <span>{text.focus.marketLow} {lane.marketLow}{language === 'ko' ? '건' : ''} · {text.focus.averageLow} {lane.averageLow}{language === 'ko' ? '건' : ''}</span>
                      <span>{text.focus.lowShipper} {lane.lowShipperCount} · {text.focus.directMarket} {lane.marketMapped}/{lane.activeCount}</span>
                    </article>
                  )) : <span className="muted">{text.focus.empty}</span>}
                </div>
              </section>
            </aside>
          )}

          {view === 'detail' && (
            <RateDetailPanel rate={selectedCase} detail={selectedRateDetail} language={language} onClose={() => setSelectedCase(null)} />
          )}
        </section>

        <section className="criteria-panel criteria-section">
          <div className="panel-head compact">
            <div>
              <p>{text.criteria.eyebrow}</p>
              <h2>{text.criteria.title}</h2>
            </div>
            <Info size={17} aria-hidden="true" />
          </div>
          <dl>
            <div>
              <dt>{text.criteria.activeRatesTitle}</dt>
              <dd>{text.criteria.activeRatesDesc}</dd>
            </div>
            <div>
              <dt>{text.criteria.allInTitle}</dt>
              <dd>{text.criteria.allInDesc}</dd>
            </div>
            <div>
              <dt>{text.criteria.usTitle}</dt>
              <dd>{text.criteria.usDesc}</dd>
            </div>
            <div>
              <dt>{text.criteria.marketTitle}</dt>
              <dd>{text.criteria.marketDesc}</dd>
            </div>
            <div>
              <dt>{text.criteria.averageTitle}</dt>
              <dd>{text.criteria.averageDesc}</dd>
            </div>
            <div>
              <dt>{text.criteria.statusTitle}</dt>
              <dd>{text.criteria.statusDesc}</dd>
            </div>
            <div>
              <dt>{text.criteria.fileStatusTitle}</dt>
              <dd>{text.criteria.fileStatusPrefix} {approvalStatuses.map(formatApprovalStatus).join(', ') || text.criteria.noValue} {text.criteria.fileStatusSuffix}</dd>
            </div>
            <div>
              <dt>{text.criteria.minimumTitle}</dt>
              <dd>{data.metadata.marketAverageFallbackMinimumSamples}{language === 'ko' ? '건 ' : ' '}{text.criteria.minimumSuffix}</dd>
            </div>
          </dl>
        </section>

        <aside className="data-note">
          <FileText size={14} aria-hidden="true" />
          <span>{text.criteria.footer.replace('{count}', formatNumber(data.metadata.skippedInvalidDateRows))}</span>
        </aside>
      </main>
    </div>
  );
}

function DashboardLoader() {
  const auth = useContext(AuthContext);
  const authRef = useRef(auth);
  authRef.current = auth;
  const [data, setData] = useState<MonitoringData | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    const loadData = async () => {
      const useDrive = Boolean(DRIVE_FILE_ID);
      const url = useDrive
        ? `https://www.googleapis.com/drive/v3/files/${DRIVE_FILE_ID}?alt=media`
        : `${import.meta.env.BASE_URL}data/weekly-monitoring.json?t=${Date.now()}`;
      const runFetch = (token: string) =>
        fetch(url, {
          cache: 'no-store',
          headers: useDrive && token ? { Authorization: `Bearer ${token}` } : undefined,
        });
      try {
        let token = authRef.current?.accessToken ?? '';
        let response = await runFetch(token);
        // Access tokens expire (~1h); refresh once on an auth failure and retry.
        if (useDrive && (response.status === 401 || response.status === 403) && authRef.current) {
          token = await authRef.current.refresh();
          response = await runFetch(token);
        }
        if (!response.ok) {
          throw new Error(`Data request failed: ${response.status}`);
        }
        const nextData = await response.json() as MonitoringData;
        if (active) {
          setData(nextData);
          setError(null);
        }
      } catch (err: unknown) {
        if (active) {
          setError(err instanceof Error ? err.message : 'Unknown data error');
        }
      }
    };

    loadData();
    const refreshTimer = DATA_REFRESH_MS ? window.setInterval(loadData, DATA_REFRESH_MS) : null;
    return () => {
      active = false;
      if (refreshTimer) {
        window.clearInterval(refreshTimer);
      }
    };
  }, []);

  if (error && !data) {
    return (
      <div className="state-screen">
        <AlertTriangle size={28} aria-hidden="true" />
        <strong>Data load failed</strong>
        <span>{error}</span>
      </div>
    );
  }

  if (!data) {
    return (
      <div className="state-screen">
        <RefreshCw size={28} aria-hidden="true" />
        <strong>Loading weekly rate data</strong>
      </div>
    );
  }

  return <AppContent data={data} />;
}

export function App() {
  return (
    <GoogleAuthGate>
      <DashboardLoader />
    </GoogleAuthGate>
  );
}
