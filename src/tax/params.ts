/**
 * 年分ごとの税制パラメータ。
 * 年ごとに改正されるので、新しい年分はこのファイルに追加して差し替える。
 *
 * 出典:
 * - 国税庁 No.1199 基礎控除 / No.1410 給与所得控除（令和8年分）
 * - 財務省 令和8年度税制改正の大綱（令和7年12月26日閣議決定）
 * - 千代田区「ふるさと納税の制度と申告」（特例控除割合・人的控除差）
 */

/** [上限（以下）, 値] の区分表。最後の区分は Infinity */
export type Bracket<T> = readonly (readonly [number, T])[];

export interface IncomeTaxRate {
  /** 所得税率 */
  rate: number;
  /** 速算表の控除額 */
  deduction: number;
}

export interface SpouseSpecialRow {
  /** 配偶者の合計所得金額の上限（以下） */
  upTo: number;
  /** 納税者の合計所得 900万以下 / 950万以下 / 1,000万以下 のときの控除額 */
  incomeTax: readonly [number, number, number];
  resident: readonly [number, number, number];
}

export interface TaxYearParams {
  /** 寄附をする年（所得税の年分） */
  year: number;
  /** 表示用ラベル */
  label: string;
  /** 住民税の年度（和暦） */
  residentTaxYearLabel: string;

  /** 給与所得控除の最低保障額 */
  salaryDeductionMin: number;
  /** 最低保障額が適用される給与収入の上限 */
  salaryDeductionMinUpTo: number;

  /** 所得税の基礎控除（合計所得金額の区分） */
  basicDeductionIncomeTax: Bracket<number>;
  /** 住民税の基礎控除（合計所得金額の区分） */
  basicDeductionResident: Bracket<number>;

  /** 同一生計配偶者・扶養親族の合計所得金額要件 */
  dependentIncomeLimit: number;
  /** 配偶者特別控除（配偶者の合計所得金額の区分） */
  spouseSpecial: readonly SpouseSpecialRow[];

  /** 所得税の速算表（課税所得金額の区分） */
  incomeTaxRates: Bracket<IncomeTaxRate>;
  /** 復興特別所得税を含めた倍率 */
  reconstructionMultiplier: number;

  /** 住民税所得割の税率（道府県民税＋市町村民税） */
  residentRate: number;

  /**
   * 特例控除割合（ふるさと納税の住民税特例分）
   * キー: 住民税の課税総所得金額 − 人的控除差 − (所得税の基礎控除 − 48万円)
   */
  specialDeductionRates: Bracket<number>;
  /** 上記が 0 円未満のときの特例控除割合 */
  specialDeductionRateBelowZero: number;
  /** 申告特例控除割合（ワンストップ特例）。同じキーで判定 */
  oneStopRates: Bracket<number>;
  /** 特例控除額の上限（所得割に対する割合） */
  specialDeductionCapRatio: number;
  /** 特例控除額の定額上限（2027年以降の寄附で導入。未導入なら null） */
  specialDeductionFixedCap: number | null;

  /** 住宅ローン控除の住民税控除限度（入居時期ごと） */
  housingLoanResidentCap: Record<HousingLoanPeriod, { ratio: number; max: number }>;
}

export type HousingLoanPeriod = 'from2022' | 'from2014to2021';

const MAN = 10_000;

export const PARAMS_2026: TaxYearParams = {
  year: 2026,
  label: '2026年（令和8年）',
  residentTaxYearLabel: '令和9年度',

  // 令和8年分・9年分は最低保障額 69万円＋特例5万円＝74万円（住民税も令和9・10年度分は同様）
  salaryDeductionMin: 74 * MAN,
  salaryDeductionMinUpTo: 220 * MAN,

  basicDeductionIncomeTax: [
    [489 * MAN, 104 * MAN],
    [655 * MAN, 67 * MAN],
    [2350 * MAN, 62 * MAN],
    [2400 * MAN, 48 * MAN],
    [2450 * MAN, 32 * MAN],
    [2500 * MAN, 16 * MAN],
    [Infinity, 0],
  ],
  basicDeductionResident: [
    [2400 * MAN, 43 * MAN],
    [2450 * MAN, 29 * MAN],
    [2500 * MAN, 15 * MAN],
    [Infinity, 0],
  ],

  dependentIncomeLimit: 62 * MAN,
  spouseSpecial: [
    { upTo: 95 * MAN, incomeTax: [38 * MAN, 26 * MAN, 13 * MAN], resident: [33 * MAN, 22 * MAN, 11 * MAN] },
    { upTo: 100 * MAN, incomeTax: [36 * MAN, 24 * MAN, 12 * MAN], resident: [33 * MAN, 22 * MAN, 11 * MAN] },
    { upTo: 105 * MAN, incomeTax: [31 * MAN, 21 * MAN, 11 * MAN], resident: [31 * MAN, 21 * MAN, 11 * MAN] },
    { upTo: 110 * MAN, incomeTax: [26 * MAN, 18 * MAN, 9 * MAN], resident: [26 * MAN, 18 * MAN, 9 * MAN] },
    { upTo: 115 * MAN, incomeTax: [21 * MAN, 14 * MAN, 7 * MAN], resident: [21 * MAN, 14 * MAN, 7 * MAN] },
    { upTo: 120 * MAN, incomeTax: [16 * MAN, 11 * MAN, 6 * MAN], resident: [16 * MAN, 11 * MAN, 6 * MAN] },
    { upTo: 125 * MAN, incomeTax: [11 * MAN, 8 * MAN, 4 * MAN], resident: [11 * MAN, 8 * MAN, 4 * MAN] },
    { upTo: 130 * MAN, incomeTax: [6 * MAN, 4 * MAN, 2 * MAN], resident: [6 * MAN, 4 * MAN, 2 * MAN] },
    { upTo: 133 * MAN, incomeTax: [3 * MAN, 2 * MAN, 1 * MAN], resident: [3 * MAN, 2 * MAN, 1 * MAN] },
  ],

  incomeTaxRates: [
    [1_949_000, { rate: 0.05, deduction: 0 }],
    [3_299_000, { rate: 0.1, deduction: 97_500 }],
    [6_949_000, { rate: 0.2, deduction: 427_500 }],
    [8_999_000, { rate: 0.23, deduction: 636_000 }],
    [17_999_000, { rate: 0.33, deduction: 1_536_000 }],
    [39_999_000, { rate: 0.4, deduction: 2_796_000 }],
    [Infinity, { rate: 0.45, deduction: 4_796_000 }],
  ],
  reconstructionMultiplier: 1.021,

  residentRate: 0.1,

  specialDeductionRates: [
    [195 * MAN, 0.84895],
    [330 * MAN, 0.7979],
    [695 * MAN, 0.6958],
    [900 * MAN, 0.66517],
    [1800 * MAN, 0.56307],
    [4000 * MAN, 0.4916],
    [Infinity, 0.44055],
  ],
  specialDeductionRateBelowZero: 0.9,
  oneStopRates: [
    [195 * MAN, 5.105 / 84.895],
    [330 * MAN, 10.21 / 79.79],
    [695 * MAN, 20.42 / 69.58],
    [900 * MAN, 23.483 / 66.517],
    [Infinity, 33.693 / 56.307],
  ],
  specialDeductionCapRatio: 0.2,
  specialDeductionFixedCap: null,

  housingLoanResidentCap: {
    from2022: { ratio: 0.05, max: 97_500 },
    from2014to2021: { ratio: 0.07, max: 136_500 },
  },
};

/** 所得税の人的控除額と住民税の人的控除額の差（地方税法で定める額） */
export const PERSONAL_DEDUCTION_DIFF = {
  basic: 5 * MAN,
  dependentGeneral: 5 * MAN,
  dependentSpecific: 18 * MAN,
  dependentElderly: 10 * MAN,
  dependentElderlyLivingTogether: 13 * MAN,
  /** 配偶者控除: 納税者の合計所得 900万以下 / 950万以下 / 1,000万以下 */
  spouseGeneral: [5 * MAN, 4 * MAN, 2 * MAN] as const,
  spouseElderly: [10 * MAN, 6 * MAN, 3 * MAN] as const,
};

/** 扶養控除の額 */
export const DEPENDENT_DEDUCTION = {
  incomeTax: { general: 38 * MAN, specific: 63 * MAN, elderly: 48 * MAN, elderlyLivingTogether: 58 * MAN },
  resident: { general: 33 * MAN, specific: 45 * MAN, elderly: 38 * MAN, elderlyLivingTogether: 45 * MAN },
};

/** 配偶者控除の額（納税者の合計所得 900万以下 / 950万以下 / 1,000万以下） */
export const SPOUSE_DEDUCTION = {
  incomeTax: { general: [38 * MAN, 26 * MAN, 13 * MAN], elderly: [48 * MAN, 32 * MAN, 16 * MAN] },
  resident: { general: [33 * MAN, 22 * MAN, 11 * MAN], elderly: [38 * MAN, 26 * MAN, 13 * MAN] },
} as const;

export const CURRENT_PARAMS = PARAMS_2026;

export function lookup<T>(bracket: Bracket<T>, value: number): T {
  for (const [upTo, v] of bracket) {
    if (value <= upTo) return v;
  }
  return bracket[bracket.length - 1][1];
}
