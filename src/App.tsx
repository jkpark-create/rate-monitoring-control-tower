import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import {
  Anchor,
  AlertTriangle,
  BarChart3,
  CalendarDays,
  ChevronLeft,
  ChevronRight,
  CircleDollarSign,
  Database,
  Download,
  FileText,
  Filter,
  Info,
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
const GOOGLE_PROFILE_STORAGE_KEY = 'rate-monitoring-google-profile';

type GoogleCredentialResponse = {
  credential?: string;
};

type GoogleProfile = {
  email: string;
  name?: string;
  picture?: string;
  hd?: string;
  exp?: number;
};

declare global {
  interface Window {
    google?: {
      accounts: {
        id: {
          initialize: (options: {
            client_id: string;
            callback: (response: GoogleCredentialResponse) => void;
            auto_select?: boolean;
            cancel_on_tap_outside?: boolean;
          }) => void;
          renderButton: (parent: HTMLElement, options: Record<string, string | number | boolean>) => void;
          prompt: () => void;
          disableAutoSelect: () => void;
        };
      };
    };
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

function selectedFilterLabel(values: string[], options: FilterOption[]) {
  if (!values.length) {
    return 'All';
  }
  if (values.length === 1) {
    return filterOptionLabel(values[0], options);
  }
  return `${values.length} selected`;
}

function base64UrlDecode(value: string) {
  const padded = value.replace(/-/g, '+').replace(/_/g, '/').padEnd(Math.ceil(value.length / 4) * 4, '=');
  const binary = window.atob(padded);
  const bytes = Uint8Array.from(binary, (char) => char.charCodeAt(0));
  return new TextDecoder().decode(bytes);
}

function decodeGoogleCredential(credential: string): GoogleProfile | null {
  try {
    const [, payload] = credential.split('.');
    if (!payload) {
      return null;
    }
    const profile = JSON.parse(base64UrlDecode(payload)) as GoogleProfile;
    return profile.email ? profile : null;
  } catch {
    return null;
  }
}

function isFreshGoogleProfile(profile: GoogleProfile) {
  return !profile.exp || profile.exp * 1000 > Date.now();
}

function isAllowedGoogleProfile(profile: GoogleProfile) {
  if (!ALLOWED_GOOGLE_DOMAINS.length) {
    return true;
  }
  const emailDomain = profile.email.split('@').at(1)?.toLowerCase() ?? '';
  const hostedDomain = profile.hd?.toLowerCase() ?? '';
  return ALLOWED_GOOGLE_DOMAINS.includes(emailDomain) || ALLOWED_GOOGLE_DOMAINS.includes(hostedDomain);
}

const statusMeta: Record<IssueStatus, { label: string; tone: string }> = {
  market: { label: 'Market 저운임', tone: 'orange' },
  average: { label: '기간 Avg 저운임', tone: 'amber' },
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

const PAYMENT_LOCATION_LABELS: Record<string, string> = {
  P: '선적지 지불',
  C: '도착지 지불',
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

function formatPaymentLocation(value: string) {
  return PAYMENT_LOCATION_LABELS[value] ? `${PAYMENT_LOCATION_LABELS[value]} (${value})` : `미확인 (${value || '-'})`;
}

function chargeUsage(item: ChargeItem) {
  return {
    label: item.applicationType,
    className: `charge-usage-${item.applicationType.toLowerCase()}`,
    comparisonLabel: item.appliedToComparison ? '비교 반영' : '상세 조회',
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

function StatusBadge({ status }: { status: IssueStatus }) {
  const meta = statusMeta[status];
  return <span className={`status-badge status-${meta.tone}`}>{meta.label}</span>;
}

function GoogleAuthGate({ children }: { children: ReactNode }) {
  const buttonRef = useRef<HTMLDivElement>(null);
  const [profile, setProfile] = useState<GoogleProfile | null>(() => {
    if (!AUTH_REQUIRED) {
      return null;
    }
    try {
      const saved = localStorage.getItem(GOOGLE_PROFILE_STORAGE_KEY);
      const parsed = saved ? JSON.parse(saved) as GoogleProfile : null;
      return parsed && isFreshGoogleProfile(parsed) && isAllowedGoogleProfile(parsed) ? parsed : null;
    } catch {
      return null;
    }
  });
  const [error, setError] = useState('');

  useEffect(() => {
    if (!AUTH_REQUIRED || profile || !GOOGLE_CLIENT_ID) {
      return;
    }

    const handleCredential = (response: GoogleCredentialResponse) => {
      if (!response.credential) {
        setError('Google credential was not returned.');
        return;
      }
      const nextProfile = decodeGoogleCredential(response.credential);
      if (!nextProfile || !isFreshGoogleProfile(nextProfile)) {
        setError('Google login response is invalid or expired.');
        return;
      }
      if (!isAllowedGoogleProfile(nextProfile)) {
        setError(`Allowed domains: ${ALLOWED_GOOGLE_DOMAINS.join(', ') || 'not configured'}`);
        return;
      }
      localStorage.setItem(GOOGLE_PROFILE_STORAGE_KEY, JSON.stringify(nextProfile));
      setProfile(nextProfile);
      setError('');
    };

    const initialize = () => {
      if (!window.google || !buttonRef.current) {
        return;
      }
      window.google.accounts.id.initialize({
        client_id: GOOGLE_CLIENT_ID,
        callback: handleCredential,
        auto_select: true,
        cancel_on_tap_outside: false,
      });
      buttonRef.current.innerHTML = '';
      window.google.accounts.id.renderButton(buttonRef.current, {
        theme: 'outline',
        size: 'large',
        text: 'signin_with',
        shape: 'rectangular',
        width: 320,
      });
      window.google.accounts.id.prompt();
    };

    if (window.google) {
      initialize();
      return;
    }

    const script = document.createElement('script');
    script.src = 'https://accounts.google.com/gsi/client';
    script.async = true;
    script.defer = true;
    script.onload = initialize;
    script.onerror = () => setError('Google login script failed to load.');
    document.head.appendChild(script);

    return () => {
      script.onload = null;
      script.onerror = null;
    };
  }, [profile]);

  if (!AUTH_REQUIRED) {
    return <>{children}</>;
  }

  if (profile) {
    return (
      <>
        <div className="auth-session">
          <span>{profile.email}</span>
          <button
            type="button"
            onClick={() => {
              localStorage.removeItem(GOOGLE_PROFILE_STORAGE_KEY);
              window.google?.accounts.id.disableAutoSelect();
              setProfile(null);
            }}
          >
            Sign out
          </button>
        </div>
        {children}
      </>
    );
  }

  return (
    <div className="state-screen auth-screen">
      <Database size={28} aria-hidden="true" />
      <strong>Company Google login required</strong>
      {GOOGLE_CLIENT_ID ? (
        <>
          <span>Use an approved company Google account to open the dashboard.</span>
          <div className="google-login-button" ref={buttonRef} />
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
  className = '',
}: {
  label: string;
  options: FilterOption[];
  values: string[];
  onChange: (values: string[]) => void;
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

  return (
    <div className={`filter-field multi-filter ${className}`} ref={rootRef}>
      <span>{label}</span>
      <button className="multi-select-trigger" type="button" onClick={() => setOpen((value) => !value)}>
        <span>{selectedFilterLabel(values, options)}</span>
        <span className="multi-caret">v</span>
      </button>
      {open && (
        <div className="multi-select-menu">
          <input
            className="multi-search"
            type="search"
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            placeholder="Search"
          />
          <div className="multi-actions">
            <button type="button" onClick={() => onChange([])}>All</button>
            <button type="button" onClick={() => setOpen(false)}>Close</button>
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
            )) : <div className="multi-empty">No matches</div>}
          </div>
        </div>
      )}
    </div>
  );
}

const chargeCategoryLabel: Record<ChargeCategory, string> = {
  'OCEAN FREIGHT': 'OCEAN FREIGHT',
  SURCHARGE: 'SURCHARGE',
  'LOCAL CHARGE': 'LOCAL CHARGE',
  UNCLASSIFIED: '미분류',
};

function RateBreakdown({ detail }: { detail: RateDetail }) {
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
      <h3>Charge 항목</h3>
      <div className="detail-meta-grid">
        <div><span>Freight Unit</span><strong>{detail.freightUnit || '-'}</strong></div>
        <div><span>PP / CC</span><strong>{detail.prepaidCollect || '-'} / {detail.masterPrepaidCollect || '-'}</strong></div>
        <div><span>Charge Count</span><strong>{formatNumber(detail.chargeCount)}</strong></div>
        <div><span>Charge Basket</span><strong>{detail.chargeBasket || '-'}</strong></div>
      </div>
      {hasUnclassified && (
        <p className="charge-data-note">
          현재 CSV에는 charge별 등록 통화가 없어 합계 기준으로 표시합니다. 변경된 SQL로 다시 추출하면 SURCHARGE와 LOCAL CHARGE가 구분됩니다.
        </p>
      )}
      <p>적용 방식은 등록 금액 아래에 표시합니다. WAIVE는 금액 없이 상세 조회되며 비교 all-in에는 포함되지 않습니다.</p>
      <div className="detail-charge-table-wrap">
        <table className="detail-rate-table">
          <thead>
            <tr><th>Charge</th><th>등록 금액</th><th>USD 환산</th><th>지불지</th></tr>
          </thead>
          <tbody>
            {sortedChargeItems.length ? sortedChargeItems.map(({ item, index }) => {
              const usage = chargeUsage(item);
              return (
                <tr key={`${item.code}-${item.currency}-${index}`}>
                  <td className="charge-code-cell">
                    <strong>{item.code}</strong>
                    <span className={`charge-category charge-${item.category.toLowerCase().replaceAll(' ', '-')}`}>{chargeCategoryLabel[item.category]}</span>
                  </td>
                  <td className="money-cell registered-amount-cell">
                    <span>{item.currency && item.localAmount !== null ? `${item.currency} ${formatAmount(item.localAmount)}` : '-'}</span>
                    <span className={`charge-usage ${usage.className}`} title={usage.comparisonLabel}>{usage.label}</span>
                  </td>
                  <td className="money-cell">{formatRateMoney(item.usdAmount)}</td>
                  <td><span className={`payment-location payment-${item.paymentCode.toLowerCase()}`}>{formatPaymentLocation(item.paymentCode)}</span></td>
                </tr>
              );
            }) : (
              <tr><td className="empty-cell" colSpan={4}>표시할 charge 항목이 없습니다.</td></tr>
            )}
          </tbody>
          <tfoot>
            <tr><th colSpan={2}>비교 ALL-IN RATE</th><th>{formatRateMoney(detail.allInRate)}</th><th></th></tr>
          </tfoot>
        </table>
      </div>
    </section>
  );
}

function RateDetailPanel({ rate, detail, onClose }: { rate: LowRateCase | null; detail: RateDetail | null; onClose: () => void }) {
  if (!rate) {
    return (
      <aside className="detail-panel detail-side-panel detail-panel-empty">
        <FileText size={22} aria-hidden="true" />
        <strong>운임파일을 선택해 주세요.</strong>
        <span>확인 대상 운임 목록에서 행을 클릭하면 charge 상세를 확인할 수 있습니다.</span>
      </aside>
    );
  }

  return (
    <aside className="detail-panel detail-side-panel">
      <div className="panel-head">
        <div>
          <p>Rate Detail</p>
          <h2>{rate.rateApplicationNo}</h2>
        </div>
        <button className="square-button" type="button" onClick={onClose} title="Close detail">
          <X size={16} aria-hidden="true" />
        </button>
      </div>
      <div className="detail-grid">
        <div className="detail-wide"><span>Lane</span><strong>{rate.porPort} {rate.porCountry} → {rate.dlyPort} {rate.dlyCountry}</strong></div>
        <div><span>CNTR Size / Type</span><strong>{rate.containerSize || '-'} / {rate.containerType || '-'}</strong></div>
        <div><span>Valid Period</span><strong>{formatDate(rate.effectiveStart)} ~ {formatDate(rate.effectiveEnd)}</strong></div>
        <div className="detail-wide"><span>Cargo / OOG Type / F-E</span><strong>{formatCargoType(rate.cargoType)} / {formatOogType(rate.specialCargoType)} / {formatFullEmptyType(rate.fullEmptyType)}</strong></div>
        <div><span>Registered O/F (all-in)</span><strong>{formatMoney(rate.ofRate)} ({formatMoney(rate.allInRate)})</strong></div>
        <div><span>Gap (all-in 기준)</span><strong>{rate.gapPct ? `${formatSignedPct(rate.gapPct)} / ${formatMoney(rate.gapAmount)}` : '-'}</strong></div>
        <div><span>적용 비교 기준</span><strong>{formatMoney(rate.benchmarkRate)} / {rate.benchmarkSource === 'market' ? 'Market Rate' : '기간 Avg'}</strong></div>
        <div><span>Sales Staff</span><strong>{rate.staff}</strong></div>
        <div className="detail-wide"><span>Company</span><strong>{rate.shipperCode || '-'} / {rate.shipperName || '-'}</strong></div>
      </div>
      {detail && <RateBreakdown detail={detail} />}
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
    { value: 'market', label: statusMeta.market.label },
    { value: 'average', label: statusMeta.average.label },
  ], []);
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
  const summaryHead = summaryDim === 'origin' ? '선적지 국가 / 포트' : summaryDim === 'destination' ? '도착지 국가 / 포트' : summaryDim === 'staff' ? '영업사원' : '업체';
  const summaryShowActive = summaryDim === 'origin' || summaryDim === 'destination';
  const summaryCountLabel = summaryDim === 'origin'
    ? `${formatNumber(originCountrySummary.length)} 국가`
    : summaryDim === 'destination'
      ? `${formatNumber(destinationCountrySummary.length)} 국가`
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

  return (
    <div className="app-shell">
      <header className="topbar">
        <div>
          <p>Rate Application Monitoring</p>
          <h1>운임파일 등록현황 모니터링</h1>
        </div>
        <div className="topbar-actions">
          <a className="icon-button" href="./data/weekly-monitoring.json" download title="Download dashboard data">
            <Download size={17} aria-hidden="true" />
            <span>JSON</span>
          </a>
          <button className="icon-button" type="button" onClick={() => window.location.reload()} title="Reload data">
            <RefreshCw size={17} aria-hidden="true" />
            <span>Refresh</span>
          </button>
        </div>
      </header>

      <main>
        <aside className="source-remark">
          <Database size={14} aria-hidden="true" />
          <strong>Source</strong>
          <span title={data.metadata.sourceFile}>{data.metadata.sourceFile}</span>
          <span>O/F · Origin Sales</span>
          <span>{formatNumber(data.metadata.recordCount)} records</span>
          <span>Updated {formatDate(data.metadata.latestSourceDate)}</span>
          <span>Cache {data.metadata.generatedAt.replace('T', ' ')}</span>
        </aside>

        {!data.metadata.chargeDetailAvailable && (
          <aside className="data-quality-warning">
            <strong>이전 CSV 사용 중</strong>
            <span>새 SQL 추출본이 연결되지 않아 charge별 통화와 금액을 확인할 수 없습니다. `npm run data:oracle`로 최신 CSV를 추출해 주세요.</span>
          </aside>
        )}

        <section className="scope-bar">
          <div className="scope-heading">
            <Filter size={17} aria-hidden="true" />
            <strong>조회 조건</strong>
            <span>{currentFilterCount} filters</span>
          </div>
          <div className="filter-grid active-filter-grid">
            <label className="date-filter">
              <span>시작일</span>
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
              <span>종료일</span>
              <input
                type="date"
                min={activeFilters.periodStart}
                max={data.metadata.availableEndDate}
                value={activeFilters.periodEnd}
                onChange={(event) => event.target.value && setActiveFilters((current) => ({ ...current, periodEnd: event.target.value }))}
              />
            </label>
            <MultiSelectFilter label="선적지 국가" options={originCountryOptions} values={activeFilters.originCountry} onChange={(values) => setActiveFilters((current) => ({ ...current, originCountry: values, originPort: [] }))} />
            <MultiSelectFilter label="선적지 포트" options={originPortOptions} values={activeFilters.originPort} onChange={(values) => setActiveFilters((current) => ({ ...current, originPort: values }))} />
            <MultiSelectFilter label="도착지 국가" options={destinationCountryOptions} values={activeFilters.destinationCountry} onChange={(values) => setActiveFilters((current) => ({ ...current, destinationCountry: values, destinationPort: [] }))} />
            <MultiSelectFilter label="도착지 포트" options={destinationPortOptions} values={activeFilters.destinationPort} onChange={(values) => setActiveFilters((current) => ({ ...current, destinationPort: values }))} />
            <MultiSelectFilter label="CNTR Size" options={containerSizeOptions} values={activeFilters.containerSize} onChange={(values) => setActiveFilters((current) => ({ ...current, containerSize: values, containerType: [] }))} />
            <MultiSelectFilter label="CNTR Type" options={containerTypeOptions} values={activeFilters.containerType} onChange={(values) => setActiveFilters((current) => ({ ...current, containerType: values }))} />
            <MultiSelectFilter className="cargo-type-filter" label="Cargo Type" options={cargoTypeOptions} values={activeFilters.cargoType} onChange={(values) => setActiveFilters((current) => ({ ...current, cargoType: values, specialCargoType: [] }))} />
            <MultiSelectFilter className="special-cargo-filter" label="OOG Type" options={specialCargoTypeOptions} values={activeFilters.specialCargoType} onChange={(values) => setActiveFilters((current) => ({ ...current, specialCargoType: values }))} />
            <MultiSelectFilter className="full-empty-filter" label="Full / Empty" options={fullEmptyTypeOptions} values={activeFilters.fullEmptyType} onChange={(values) => setActiveFilters((current) => ({ ...current, fullEmptyType: values }))} />
            <MultiSelectFilter label="영업사원" options={staffFilterOptions} values={activeFilters.staff} onChange={(values) => setActiveFilters((current) => ({ ...current, staff: values }))} />
            <MultiSelectFilter className="company-filter" label="업체" options={companyOptions} values={activeFilters.company} onChange={(values) => setActiveFilters((current) => ({ ...current, company: values }))} />
            {view === 'detail' && <MultiSelectFilter label="판정 Status" options={statusFilterOptions} values={activeFilters.status} onChange={(values) => setActiveFilters((current) => ({ ...current, status: values as IssueStatus[] }))} />}
            {view === 'detail' && (
              <label className="query-filter">
                <span>운임번호 검색</span>
                <div>
                  <Search size={14} aria-hidden="true" />
                  <input value={activeFilters.query} onChange={(event) => setActiveFilters((current) => ({ ...current, query: event.target.value }))} placeholder="Rate no." />
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
            Reset
          </button>
        </section>

        <section className="metric-strip">
          <div>
            <CalendarDays size={18} aria-hidden="true" />
            <span>기간 유효 운임</span>
            <strong>{formatNumber(currentRates.length)}</strong>
          </div>
          <div>
            <AlertTriangle size={18} aria-hidden="true" />
            <span>저운임 확인 필요</span>
            <strong>{formatNumber(currentCases.length)}</strong>
          </div>
          <div>
            <CircleDollarSign size={18} aria-hidden="true" />
            <span>Market 대비 저운임</span>
            <strong>{formatNumber(marketLowCount)}</strong>
          </div>
          <div>
            <BarChart3 size={18} aria-hidden="true" />
            <span>기간 Avg 대비 저운임</span>
            <strong>{formatNumber(averageLowCount)}</strong>
          </div>
          <div>
            <Users size={18} aria-hidden="true" />
            <span>저운임 화주수</span>
            <strong>{formatNumber(lowShipperCount)}</strong>
          </div>
          <div>
            <Route size={18} aria-hidden="true" />
            <span>Market 직접 매핑</span>
            <strong>{formatPct(currentRates.length ? marketCoverageCount / currentRates.length : 0)}</strong>
          </div>
        </section>

        <section className={`content-grid${view === 'summary' ? '' : ' content-grid-detail'}`}>
          <section className="results-panel">
            <div className="panel-head">
              <div>
                <p>{view === 'summary' ? 'Aggregated View' : 'Low Freight Cases'}</p>
                <h2>{view === 'summary' ? '집계 분석' : '확인 대상 운임'}</h2>
              </div>
              <strong>{view === 'summary' ? summaryCountLabel : `${formatNumber(filteredCases.length)} cases`}</strong>
            </div>
            <div className="view-tabs">
              <button className={view === 'summary' ? 'active' : ''} type="button" onClick={() => setView('summary')}>집계</button>
              <button className={view === 'detail' ? 'active' : ''} type="button" onClick={() => setView('detail')}>상세</button>
            </div>

            {view === 'summary' ? (
              <>
                <div className="segmented-control summary-dims">
                  {([
                    ['origin', '선적지 국가 / 포트', Ship],
                    ['destination', '도착지 국가 / 포트', Anchor],
                    ['staff', '영업사원별', Users],
                    ['company', '업체별 트렌드', TrendingUp],
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
                  <p className="summary-drill-note">국가 행을 클릭하면 포트별 집계가 펼쳐집니다. 포트 행을 클릭하면 해당 조건의 상세 목록으로 이동합니다.</p>
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
                              name="동일 구간 타 업체 평균"
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
                      <span className="muted">트렌드를 표시할 업체가 없습니다.</span>
                    )}
                    <div className="trend-note-row">
                      <p className="trend-note">
                        {selectedTrendCompanyRow
                          ? `${selectedTrendCompanyRow.label} 주차별 평균 Ocean Freight 추이 · 점선은 동일 구간·CNTR·Cargo 조건의 타 업체 O/F 평균입니다.`
                          : `상위 ${companyTrend.series.length}개 업체의 주차별 평균 Ocean Freight 추이 · 하단 업체를 클릭하면 해당 업체 추이로 변경됩니다.`}
                      </p>
                      {selectedTrendCompanyRow && (
                        <button className="trend-reset-button" type="button" onClick={() => setSelectedTrendCompany('')}>
                          상위 5개 보기
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
                        <th>저운임 건수</th>
                        {summaryDim === 'company' ? (
                          <>
                            <th>구간수</th>
                            <th>운임파일수</th>
                          </>
                        ) : <th>저운임 화주수</th>}
                        <th>Market 저운임</th>
                        <th>기간 Avg 저운임</th>
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
                                {formatNumber(row.activeCount)} 유효운임
                                {row.level === 'country' ? ` · 클릭하여 포트별 ${row.expanded ? '접기' : '보기'}` : ' · 클릭하여 상세 보기'}
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
                          <td colSpan={summaryDim === 'company' ? 6 : 5} className="empty-cell">선택한 조건에서 표시할 집계 데이터가 없습니다.</td>
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
                    ['all', 'All'],
                    ['market', 'Market 저운임'],
                    ['average', '기간 Avg 저운임'],
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
                        <th>Status</th>
                        <th>Rate No.</th>
                        <th>Lane</th>
                        <th>CNTR</th>
                        <th>Registered O/F (all-in)</th>
                        <th>Market Rate</th>
                        <th>적용 비교 기준</th>
                        <th>조회 기간 Avg</th>
                        <th>Gap (all-in)</th>
                        <th>Sales Staff</th>
                        <th>Company</th>
                        <th>Valid Period</th>
                      </tr>
                    </thead>
                    <tbody>
                      {visibleCases.length ? visibleCases.map((item) => (
                        <tr className={selectedCase?.id === item.id ? 'detail-selected-row' : undefined} key={item.id} onClick={() => setSelectedCase(item)}>
                          <td><StatusBadge status={item.status} /></td>
                          <td><button className="rate-link" type="button">{item.rateApplicationNo}</button></td>
                          <td><strong>{item.porPort} {item.porCountry} → {item.dlyPort} {item.dlyCountry}</strong></td>
                          <td>{item.container}<span>{formatCargoProfile(item.cargoProfile)}</span></td>
                          <td className="money-cell">{formatMoney(item.ofRate)}<span>all-in {formatMoney(item.allInRate)}</span></td>
                          <td className="money-cell">
                            {item.marketRate !== null ? `${formatMoney(item.marketRate)} (${formatMoney(item.marketRateAllIn as number)})` : '-'}
                            <span>{item.marketRate !== null ? '직접 Market · O/F (all-in)' : '기간 평균 fallback'}</span>
                          </td>
                          <td className="money-cell">{formatMoney(item.benchmarkRateOf)} ({formatMoney(item.benchmarkRate)})<span>{item.benchmarkSource === 'market' ? 'Market Rate · O/F (all-in)' : '기간 Avg · O/F (all-in)'}</span></td>
                          <td className="money-cell">
                            {formatMoney(item.periodAverage)} ({formatMoney(item.periodAverageAllIn)})
                            <span>{item.benchmarkSampleCount} valid rates · O/F (all-in)</span>
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
                          <td colSpan={12} className="empty-cell">선택한 조건에서 확인할 저운임 등록 운임이 없습니다.</td>
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
                    <p>Focus Lanes</p>
                    <h2>확인 집중 구간</h2>
                  </div>
                </div>
                <p className="focus-note">현재 조회 조건의 확인 대상 운임을 Lane별로 묶어 저운임 건수, 저운임 화주수 순으로 정렬한 상위 10개입니다.</p>
                <div className="lane-list">
                  {laneSummary.length ? laneSummary.map((lane) => (
                    <article key={lane.lane}>
                      <div className="lane-head">
                        <strong>{lane.lane}</strong>
                        <strong className="lane-count">{formatNumber(lane.count)}</strong>
                      </div>
                      <span>Market 저운임 {lane.marketLow} · 기간 Avg 저운임 {lane.averageLow}</span>
                      <span>저운임 화주 {lane.lowShipperCount} · 직접 Market {lane.marketMapped}/{lane.activeCount}</span>
                    </article>
                  )) : <span className="muted">표시할 구간이 없습니다.</span>}
                </div>
              </section>
            </aside>
          )}

          {view === 'detail' && (
            <RateDetailPanel rate={selectedCase} detail={selectedRateDetail} onClose={() => setSelectedCase(null)} />
          )}
        </section>

        <section className="criteria-panel criteria-section">
          <div className="panel-head compact">
            <div>
              <p>Criteria</p>
              <h2>판단 기준</h2>
            </div>
            <Info size={17} aria-hidden="true" />
          </div>
          <dl>
            <div>
              <dt>유효 운임</dt>
              <dd>선택한 조회 기간과 Effective Start / End가 겹치는 등록 건. 동일 운임은 기간 안에서 한 번만 집계</dd>
            </div>
            <div>
              <dt>비교 기준 (all-in)</dt>
              <dd>모든 저운임 판정은 all-in 기준으로 비교합니다. Market guideline은 O/F 레벨이므로 해당 건의 서차지·로컬차지(all-in − O/F)를 더해 all-in으로 환산합니다. 표시는 O/F와 괄호 안 all-in을 함께 보여줍니다.</dd>
            </div>
            <div>
              <dt>Market 저운임</dt>
              <dd>구간 · CNTR Size에 매핑된 Market Rate(GP · HC · TK, Cargo 00 Non-DG)를 all-in으로 환산한 값보다 등록 all-in이 낮은 건</dd>
            </div>
            <div>
              <dt>기간 Avg 저운임</dt>
              <dd>Market Rate가 없는 경우 조회 기간에 유효한 동일 구간 · CNTR Size · CNTR Type · Cargo · OOG Type · Full/Empty 비교군의 all-in 평균보다 등록 all-in이 낮은 건 (최소 3건 이상)</dd>
            </div>
            <div>
              <dt>판정 Status</dt>
              <dd>직접 Market Rate를 적용하면 Market 저운임, Market 미매핑으로 기간 평균을 적용하면 기간 Avg 저운임. 정상 건은 확인 대상 목록에서 제외</dd>
            </div>
            <div>
              <dt>운임 파일 Status</dt>
              <dd>원본 CSV의 APPROVAL_STATUS 코드. 현재 추출본에는 {approvalStatuses.map(formatApprovalStatus).join(', ') || '값 없음'} 포함</dd>
            </div>
            <div>
              <dt>평균 최소 표본</dt>
              <dd>{data.metadata.marketAverageFallbackMinimumSamples}건 이상인 비교군만 기간 평균 fallback 적용</dd>
            </div>
          </dl>
        </section>

        <aside className="data-note">
          <FileText size={14} aria-hidden="true" />
          <span>저운임 판정은 all-in 기준입니다. GP · HC · TK Non-DG는 Market Rate(O/F→all-in 환산)를 우선 적용하고, Market 미매핑 운임은 조회 기간 all-in 평균으로 fallback 합니다. 비정상 유효기간 {formatNumber(data.metadata.skippedInvalidDateRows)}건은 제외했습니다.</span>
        </aside>
      </main>
    </div>
  );
}

function DashboardLoader() {
  const [data, setData] = useState<MonitoringData | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    const loadData = () => {
      fetch(`${import.meta.env.BASE_URL}data/weekly-monitoring.json?t=${Date.now()}`, { cache: 'no-store' })
        .then((response) => {
          if (!response.ok) {
            throw new Error(`Data request failed: ${response.status}`);
          }
          return response.json() as Promise<MonitoringData>;
        })
        .then((nextData) => {
          if (active) {
            setData(nextData);
            setError(null);
          }
        })
        .catch((err: unknown) => {
          if (active) {
            setError(err instanceof Error ? err.message : 'Unknown data error');
          }
        });
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
