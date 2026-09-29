import {
  CURRENT_PARAMS,
  DEPENDENT_DEDUCTION,
  PERSONAL_DEDUCTION_DIFF,
  SPOUSE_DEDUCTION,
  lookup,
  type HousingLoanPeriod,
  type TaxYearParams,
} from './params';

export type FilingMethod = 'oneStop' | 'taxReturn';

export interface TaxInput {
  /** 給与収入（源泉徴収票の支払金額） */
  salary: number;
  /** 社会保険料（未入力なら給与収入の15%で推定） */
  socialInsurance: number | null;
  spouse: {
    has: boolean;
    /** 配偶者の給与収入 */
    salary: number;
    /** 70歳以上 */
    elderly: boolean;
  };
  dependents: {
    /** 16〜18歳・23〜69歳 */
    general: number;
    /** 19〜22歳 */
    specific: number;
    /** 70歳以上（同居老親以外） */
    elderly: number;
    /** 70歳以上の同居の父母など */
    elderlyLivingTogether: number;
  };
  housingLoan: {
    /** 住宅ローン控除の年間控除可能額（0なら適用なし） */
    amount: number;
    period: HousingLoanPeriod;
    /** 控除1年目（確定申告が必須） */
    firstYear: boolean;
  };
  /** iDeCo・小規模企業共済等掛金 */
  ideco: number;
  /** 生命保険料（新制度の支払額） */
  lifeInsurance: { general: number; care: number; pension: number };
  /** 地震保険料の支払額 */
  earthquakeInsurance: number;
  /** 医療費控除額（計算済みの控除額） */
  medicalDeduction: number;
}

export interface CalcOptions {
  /** 実際の端数処理（千円未満切捨て等）を行うか。上限探索では false にして連続値で計算する */
  rounding: boolean;
  params?: TaxYearParams;
}

export interface TaxBreakdown {
  donation: number;
  method: FilingMethod;
  salaryIncome: number;
  socialInsurance: number;
  incomeTax: {
    deductions: number;
    donationDeduction: number;
    taxable: number;
    marginalRate: number;
    /** 住宅ローン控除前の所得税額 */
    beforeCredit: number;
    housingLoanCredit: number;
    /** 復興特別所得税を含む最終的な所得税額 */
    total: number;
  };
  resident: {
    deductions: number;
    taxable: number;
    /** 所得割額（調整控除前） */
    gross: number;
    adjustmentCredit: number;
    /** 調整控除後の所得割額（特例控除上限の基準） */
    afterAdjustment: number;
    housingLoanCredit: number;
    /** 住宅ローン控除の住民税での控除限度額 */
    housingLoanCap: number;
    donationBasic: number;
    donationSpecial: number;
    donationOneStop: number;
    /** 所得割が足りずに使い切れなかった寄附金税額控除 */
    donationCreditUnused: number;
    specialRate: number;
    specialCapped: boolean;
    total: number;
  };
  /** 所得税でも住民税でも引ききれず消えた住宅ローン控除 */
  housingLoanLost: number;
  totalTax: number;
}

const MAN = 10_000;

const floorTo = (value: number, unit: number, rounding: boolean) =>
  rounding ? Math.floor(value / unit) * unit : value;

/** 給与所得（令和8年分。660万円未満は所得税法別表第五に相当する4,000円単位の計算） */
export function salaryIncome(salary: number, params: TaxYearParams = CURRENT_PARAMS): number {
  if (salary <= 0) return 0;
  if (salary < params.salaryDeductionMinUpTo) {
    return Math.max(0, Math.floor(salary) - params.salaryDeductionMin);
  }
  if (salary < 660 * MAN) {
    const a = Math.floor(salary / 4000) * 4000;
    if (salary <= 360 * MAN) return Math.floor(a * 0.7 - 80_000);
    return Math.floor(a * 0.8 - 440_000);
  }
  if (salary <= 850 * MAN) return Math.floor(salary * 0.9 - 1_100_000);
  return Math.floor(salary - 1_950_000);
}

/** 納税者の合計所得による配偶者控除の区分（0: 900万以下, 1: 950万以下, 2: 1,000万以下, null: 適用なし） */
function spouseTier(totalIncome: number): 0 | 1 | 2 | null {
  if (totalIncome <= 900 * MAN) return 0;
  if (totalIncome <= 950 * MAN) return 1;
  if (totalIncome <= 1000 * MAN) return 2;
  return null;
}

interface PersonalDeductions {
  incomeTax: number;
  resident: number;
  /** 調整控除・特例控除割合判定に使う人的控除差（基礎控除分を含む） */
  diff: number;
}

function personalDeductions(input: TaxInput, totalIncome: number, params: TaxYearParams): PersonalDeductions {
  let incomeTax = lookup(params.basicDeductionIncomeTax, totalIncome);
  let resident = lookup(params.basicDeductionResident, totalIncome);
  let diff = totalIncome <= 2500 * MAN ? PERSONAL_DEDUCTION_DIFF.basic : 0;

  const tier = spouseTier(totalIncome);
  if (input.spouse.has && tier !== null) {
    const spouseIncome = salaryIncome(input.spouse.salary, params);
    if (spouseIncome <= params.dependentIncomeLimit) {
      const kind = input.spouse.elderly ? 'elderly' : 'general';
      incomeTax += SPOUSE_DEDUCTION.incomeTax[kind][tier];
      resident += SPOUSE_DEDUCTION.resident[kind][tier];
      diff += input.spouse.elderly
        ? PERSONAL_DEDUCTION_DIFF.spouseElderly[tier]
        : PERSONAL_DEDUCTION_DIFF.spouseGeneral[tier];
    } else {
      const row = params.spouseSpecial.find((r) => spouseIncome <= r.upTo);
      if (row) {
        incomeTax += row.incomeTax[tier];
        resident += row.resident[tier];
      }
    }
  }

  const d = input.dependents;
  const count = (n: number) => Math.max(0, Math.floor(n || 0));
  incomeTax +=
    count(d.general) * DEPENDENT_DEDUCTION.incomeTax.general +
    count(d.specific) * DEPENDENT_DEDUCTION.incomeTax.specific +
    count(d.elderly) * DEPENDENT_DEDUCTION.incomeTax.elderly +
    count(d.elderlyLivingTogether) * DEPENDENT_DEDUCTION.incomeTax.elderlyLivingTogether;
  resident +=
    count(d.general) * DEPENDENT_DEDUCTION.resident.general +
    count(d.specific) * DEPENDENT_DEDUCTION.resident.specific +
    count(d.elderly) * DEPENDENT_DEDUCTION.resident.elderly +
    count(d.elderlyLivingTogether) * DEPENDENT_DEDUCTION.resident.elderlyLivingTogether;
  diff +=
    count(d.general) * PERSONAL_DEDUCTION_DIFF.dependentGeneral +
    count(d.specific) * PERSONAL_DEDUCTION_DIFF.dependentSpecific +
    count(d.elderly) * PERSONAL_DEDUCTION_DIFF.dependentElderly +
    count(d.elderlyLivingTogether) * PERSONAL_DEDUCTION_DIFF.dependentElderlyLivingTogether;

  return { incomeTax, resident, diff };
}

/** 生命保険料控除（新制度・区分ごと）: 所得税 */
function lifeInsuranceIncomeTaxPart(paid: number): number {
  if (paid <= 0) return 0;
  if (paid <= 20_000) return paid;
  if (paid <= 40_000) return Math.ceil(paid / 2 + 10_000);
  if (paid <= 80_000) return Math.ceil(paid / 4 + 20_000);
  return 40_000;
}

/** 生命保険料控除（新制度・区分ごと）: 住民税 */
function lifeInsuranceResidentPart(paid: number): number {
  if (paid <= 0) return 0;
  if (paid <= 12_000) return paid;
  if (paid <= 32_000) return Math.ceil(paid / 2 + 6_000);
  if (paid <= 56_000) return Math.ceil(paid / 4 + 14_000);
  return 28_000;
}

export function lifeInsuranceDeduction(li: TaxInput['lifeInsurance']): { incomeTax: number; resident: number } {
  const parts = [li.general, li.care, li.pension].map((v) => Math.max(0, v || 0));
  return {
    incomeTax: Math.min(120_000, parts.reduce((s, p) => s + lifeInsuranceIncomeTaxPart(p), 0)),
    resident: Math.min(70_000, parts.reduce((s, p) => s + lifeInsuranceResidentPart(p), 0)),
  };
}

export function estimateSocialInsurance(salary: number): number {
  return Math.floor(Math.max(0, salary) * 0.15);
}

function incomeTaxAmount(taxable: number, params: TaxYearParams): { tax: number; rate: number } {
  if (taxable <= 0) return { tax: 0, rate: 0 };
  const { rate, deduction } = lookup(params.incomeTaxRates, taxable);
  return { tax: taxable * rate - deduction, rate };
}

/**
 * 寄附額と申告方法を与えて、所得税・住民税（所得割）を計算する。
 * donation = 0 のときが「ふるさと納税をしなかった場合」。
 */
export function calculateTaxes(
  input: TaxInput,
  donation: number,
  method: FilingMethod,
  options: CalcOptions = { rounding: true },
): TaxBreakdown {
  const params = options.params ?? CURRENT_PARAMS;
  const r = options.rounding;

  const income = salaryIncome(input.salary, params);
  const totalIncome = income; // 給与所得のみを想定
  const social = input.socialInsurance ?? estimateSocialInsurance(input.salary);
  const personal = personalDeductions(input, totalIncome, params);
  const life = lifeInsuranceDeduction(input.lifeInsurance);
  const quakePaid = Math.max(0, input.earthquakeInsurance || 0);
  const common = Math.max(0, social) + Math.max(0, input.ideco || 0) + Math.max(0, input.medicalDeduction || 0);

  const d = Math.max(0, donation);
  const hasDonation = d > 2000;

  // ---- 所得税 ----
  const donationDeduction =
    method === 'taxReturn' && hasDonation ? Math.max(0, Math.min(d, totalIncome * 0.4) - 2000) : 0;
  const itDeductions = common + personal.incomeTax + life.incomeTax + Math.min(quakePaid, 50_000) + donationDeduction;
  const itTaxable = floorTo(Math.max(0, totalIncome - itDeductions), 1000, r);
  const { tax: itGross, rate: marginalRate } = incomeTaxAmount(itTaxable, params);
  const itBefore = r ? Math.floor(itGross) : itGross;
  const loan = Math.max(0, input.housingLoan.amount || 0);
  const itLoanCredit = Math.min(loan, itBefore);
  const itBase = itBefore - itLoanCredit;
  const itTotal = floorTo(itBase * params.reconstructionMultiplier, 100, r);

  // ---- 住民税（所得割） ----
  const rDeductions = common + personal.resident + life.resident + Math.min(quakePaid / 2, 25_000);
  const rTaxable = floorTo(Math.max(0, totalIncome - rDeductions), 1000, r);
  const rGross = rTaxable * params.residentRate;

  // 調整控除
  let adjustment = 0;
  if (totalIncome <= 2500 * MAN && rTaxable > 0) {
    adjustment =
      rTaxable <= 200 * MAN
        ? Math.min(personal.diff, rTaxable) * 0.05
        : Math.max(personal.diff - (rTaxable - 200 * MAN), 5 * MAN) * 0.05;
  }
  const rAfterAdj = Math.max(0, rGross - adjustment);

  // 住宅ローン控除（所得税で引ききれない分を住民税から）
  const loanCapCfg = params.housingLoanResidentCap[input.housingLoan.period];
  const loanCap = Math.min(floorTo(itTaxable * loanCapCfg.ratio, 1, r), loanCapCfg.max);
  const loanLeft = loan - itLoanCredit;
  const rLoanCredit = Math.min(loanLeft, loanCap, rAfterAdj);
  const housingLoanLost = loanLeft - rLoanCredit;
  const rAfterLoan = rAfterAdj - rLoanCredit;

  // 寄附金税額控除
  const specialKey = rTaxable - personal.diff - (lookup(params.basicDeductionIncomeTax, totalIncome) - 48 * MAN);
  const specialRate = specialKey < 0 ? params.specialDeductionRateBelowZero : lookup(params.specialDeductionRates, specialKey);
  let donationBasic = 0;
  let donationSpecial = 0;
  let donationOneStop = 0;
  let specialCapped = false;
  if (hasDonation) {
    donationBasic = (Math.max(0, Math.min(d, totalIncome * 0.3) - 2000)) * 0.1;
    const specialRaw = (d - 2000) * specialRate;
    let specialCap = rAfterAdj * params.specialDeductionCapRatio;
    if (params.specialDeductionFixedCap !== null) specialCap = Math.min(specialCap, params.specialDeductionFixedCap);
    specialCapped = specialRaw > specialCap;
    donationSpecial = Math.min(specialRaw, specialCap);
    if (method === 'oneStop') {
      const oneStopRate = specialKey < 0 ? 0 : lookup(params.oneStopRates, specialKey);
      donationOneStop = donationSpecial * oneStopRate;
    }
    if (r) {
      donationBasic = Math.ceil(donationBasic);
      donationSpecial = Math.ceil(donationSpecial);
      donationOneStop = Math.ceil(donationOneStop);
    }
  }
  const donationCredits = donationBasic + donationSpecial + donationOneStop;
  const donationApplied = Math.min(donationCredits, rAfterLoan);
  const rTotal = floorTo(rAfterLoan - donationApplied, 100, r);

  return {
    donation: d,
    method,
    salaryIncome: income,
    socialInsurance: social,
    incomeTax: {
      deductions: itDeductions,
      donationDeduction,
      taxable: itTaxable,
      marginalRate,
      beforeCredit: itBefore,
      housingLoanCredit: itLoanCredit,
      total: itTotal,
    },
    resident: {
      deductions: rDeductions,
      taxable: rTaxable,
      gross: rGross,
      adjustmentCredit: adjustment,
      afterAdjustment: rAfterAdj,
      housingLoanCredit: rLoanCredit,
      housingLoanCap: loanCap,
      donationBasic,
      donationSpecial,
      donationOneStop,
      donationCreditUnused: donationCredits - donationApplied,
      specialRate,
      specialCapped,
      total: rTotal,
    },
    housingLoanLost,
    totalTax: itTotal + rTotal,
  };
}
