import { calculateTaxes, type FilingMethod, type TaxBreakdown, type TaxInput } from './engine';

/** 実質負担 = 寄附額 − (寄附しなかった場合の税額 − 寄附した場合の税額) */
export function burden(input: TaxInput, donation: number, method: FilingMethod, rounding = false): number {
  const opts = { rounding };
  const base = calculateTaxes(input, 0, method, opts).totalTax;
  const withDonation = calculateTaxes(input, donation, method, opts).totalTax;
  return donation - (base - withDonation);
}

export interface MethodResult {
  method: FilingMethod;
  /**
   * 上限目安: 住民税の特例分が上限（所得割の20%）に達するか、
   * 所得割が足りず控除を使い切れなくなる寄附額（一般的な「控除上限額」）
   */
  limit: number;
  /** 上限目安まで寄附した場合の実質負担 */
  burdenAtLimit: number;
  /** 実質負担が 2,000円 に収まる最大の寄附額（住宅ローン控除の目減り等を含めた実質的な上限） */
  safeLimit: number;
  /** 上限目安まで寄附した場合に、寄附しない場合より余計に消える住宅ローン控除 */
  extraHousingLoanLost: number;
  breakdown: TaxBreakdown;
}

const BURDEN_TOLERANCE = 50;

/** 上限目安を超えているか（特例分の上限到達 or 控除の使い残し発生） */
function overConventionalLimit(input: TaxInput, donation: number, method: FilingMethod): boolean {
  const t = calculateTaxes(input, donation, method, { rounding: false });
  return t.resident.specialCapped || t.resident.donationCreditUnused > 0.5;
}

function bisect(lo: number, hi: number, pred: (x: number) => boolean): number {
  // pred(lo) === false, pred(hi) === true を前提に境界を探す
  for (let i = 0; i < 60 && hi - lo > 1; i++) {
    const mid = (lo + hi) / 2;
    if (pred(mid)) hi = mid;
    else lo = mid;
  }
  return lo;
}

function conventionalLimit(input: TaxInput, method: FilingMethod): number {
  const upper = Math.max(10_000, input.salary);
  if (!overConventionalLimit(input, upper, method)) return upper;
  if (overConventionalLimit(input, 2001, method)) return 2000;
  return bisect(2001, upper, (d) => overConventionalLimit(input, d, method));
}

function safeLimit(input: TaxInput, method: FilingMethod, conventional: number): number {
  const exceeds = (d: number) => burden(input, d, method) > 2000 + BURDEN_TOLERANCE;
  // 2,000円から千円刻みで走査し、最初に負担が2,000円を超える区間を二分探索する
  const end = Math.max(conventional * 1.5, 10_000);
  const step = Math.max(1000, Math.round(end / 400));
  let prev = 2000;
  for (let d = 2000 + step; d <= end; d += step) {
    if (exceeds(d)) return bisect(prev, d, exceeds);
    prev = d;
  }
  return end;
}

const floor1000 = (v: number) => Math.max(0, Math.floor(v / 1000) * 1000);

export function analyzeMethod(input: TaxInput, method: FilingMethod): MethodResult {
  const limitRaw = conventionalLimit(input, method);
  const safeRaw = Math.min(safeLimit(input, method, limitRaw), limitRaw);
  const limit = floor1000(limitRaw);
  const noDonation = calculateTaxes(input, 0, method);
  const breakdown = calculateTaxes(input, limit, method);
  return {
    method,
    limit,
    burdenAtLimit: Math.round(burden(input, limit, method)),
    safeLimit: floor1000(safeRaw),
    extraHousingLoanLost: Math.max(0, Math.round(breakdown.housingLoanLost - noDonation.housingLoanLost)),
    breakdown,
  };
}

export interface CurvePoint {
  donation: number;
  oneStop: number | null;
  taxReturn: number;
}

/** 寄附額ごとの実質負担（グラフ用） */
export function burdenCurve(input: TaxInput, maxDonation: number, points = 60, includeOneStop = true): CurvePoint[] {
  const out: CurvePoint[] = [];
  for (let i = 0; i <= points; i++) {
    const donation = Math.round((maxDonation * i) / points);
    out.push({
      donation,
      oneStop: includeOneStop ? Math.round(burden(input, donation, 'oneStop')) : null,
      taxReturn: Math.round(burden(input, donation, 'taxReturn')),
    });
  }
  return out;
}

/** ワンストップ特例が使えるか（使えない理由を返す） */
export function oneStopUnavailableReason(input: TaxInput): string | null {
  if (input.housingLoan.amount > 0 && input.housingLoan.firstYear) {
    return '住宅ローン控除の1年目は確定申告が必要なため、ワンストップ特例は使えません。';
  }
  if (input.medicalDeduction > 0) {
    return '医療費控除を受けるには確定申告が必要なため、ワンストップ特例は使えません。';
  }
  if (input.salary > 20_000_000) {
    return '給与収入が2,000万円を超える場合は確定申告が必要なため、ワンストップ特例は使えません。';
  }
  return null;
}
