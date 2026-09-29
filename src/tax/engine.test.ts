import { describe, expect, it } from 'vitest';
import { calculateTaxes, lifeInsuranceDeduction, salaryIncome, type TaxInput } from './engine';
import { analyzeMethod, burden, oneStopUnavailableReason } from './limit';

function makeInput(overrides: Partial<TaxInput> = {}): TaxInput {
  return {
    salary: 5_000_000,
    socialInsurance: 750_000,
    spouse: { has: false, salary: 0, elderly: false },
    dependents: { general: 0, specific: 0, elderly: 0, elderlyLivingTogether: 0 },
    housingLoan: { amount: 0, period: 'from2022', firstYear: false },
    ideco: 0,
    lifeInsurance: { general: 0, care: 0, pension: 0 },
    earthquakeInsurance: 0,
    medicalDeduction: 0,
    ...overrides,
  };
}

describe('salaryIncome（令和8年分）', () => {
  it('220万円未満は最低保障額 74万円を控除', () => {
    expect(salaryIncome(1_000_000)).toBe(260_000);
    expect(salaryIncome(700_000)).toBe(0);
  });
  it('660万円未満は4,000円単位（別表第五）で計算', () => {
    expect(salaryIncome(5_000_000)).toBe(3_560_000);
    // 3,001,999円 → 3,000,000円として計算: 3,000,000×0.7−80,000
    expect(salaryIncome(3_001_999)).toBe(2_020_000);
  });
  it('660万円以上は速算式、850万円超は195万円控除', () => {
    expect(salaryIncome(8_000_000)).toBe(6_100_000);
    expect(salaryIncome(10_000_000)).toBe(8_050_000);
  });
});

describe('lifeInsuranceDeduction', () => {
  it('新制度の区分ごとに所得税・住民税の控除額を計算する', () => {
    expect(lifeInsuranceDeduction({ general: 80_000, care: 0, pension: 0 })).toEqual({ incomeTax: 40_000, resident: 28_000 });
    expect(lifeInsuranceDeduction({ general: 100_000, care: 100_000, pension: 100_000 })).toEqual({
      incomeTax: 120_000,
      resident: 70_000,
    });
  });
});

describe('calculateTaxes: 年収500万円・独身・社会保険料75万円', () => {
  const input = makeInput();
  const t = calculateTaxes(input, 0, 'oneStop');

  it('所得税: 課税所得177万円（基礎控除104万円）、税率5%', () => {
    expect(t.salaryIncome).toBe(3_560_000);
    expect(t.incomeTax.taxable).toBe(1_770_000);
    expect(t.incomeTax.marginalRate).toBe(0.05);
    expect(t.incomeTax.beforeCredit).toBe(88_500);
    expect(t.incomeTax.total).toBe(90_300); // 88,500 × 1.021 = 90,358 → 百円未満切捨て
  });

  it('住民税: 課税所得238万円、調整控除2,500円', () => {
    expect(t.resident.taxable).toBe(2_380_000);
    expect(t.resident.gross).toBe(238_000);
    expect(t.resident.adjustmentCredit).toBe(2_500);
    expect(t.resident.afterAdjustment).toBe(235_500);
  });

  it('特例控除割合は 238万 − 5万 − (104万 − 48万) = 177万円 → 84.895%', () => {
    expect(t.resident.specialRate).toBeCloseTo(0.84895);
  });

  it('上限目安は 235,500×20% ÷ 84.895% + 2,000 ≒ 57,480円 → 57,000円', () => {
    const oneStop = analyzeMethod(input, 'oneStop');
    expect(oneStop.limit).toBe(57_000);
    expect(oneStop.burdenAtLimit).toBe(2000);
    expect(oneStop.safeLimit).toBe(57_000);
  });

  it('上限内なら確定申告でもワンストップでも実質負担はほぼ2,000円', () => {
    expect(burden(input, 50_000, 'oneStop')).toBeCloseTo(2000, 0);
    expect(burden(input, 50_000, 'taxReturn')).toBeCloseTo(2000, 0);
  });

  it('上限を超えると実質負担が増える', () => {
    expect(burden(input, 80_000, 'oneStop')).toBeGreaterThan(10_000);
  });
});

describe('住宅ローン控除との関係: 年収500万円・独身・控除可能額25万円', () => {
  const input = makeInput({ housingLoan: { amount: 250_000, period: 'from2022', firstYear: false } });

  it('寄附しなくても、住民税の控除限度（課税所得の5%）を超えた分は消える', () => {
    const t = calculateTaxes(input, 0, 'oneStop');
    expect(t.incomeTax.housingLoanCredit).toBe(88_500);
    expect(t.incomeTax.total).toBe(0);
    expect(t.resident.housingLoanCap).toBe(88_500);
    expect(t.resident.housingLoanCredit).toBe(88_500);
    expect(t.housingLoanLost).toBe(73_000);
  });

  it('ワンストップ特例なら上限目安は住宅ローン控除がない場合と同じ', () => {
    const oneStop = analyzeMethod(input, 'oneStop');
    expect(oneStop.limit).toBe(57_000);
    expect(oneStop.burdenAtLimit).toBe(2000);
    expect(oneStop.extraHousingLoanLost).toBe(0);
  });

  it('確定申告だと寄附金控除で所得税・住民税の控除限度が下がり、住宅ローン控除が目減りする', () => {
    const ret = analyzeMethod(input, 'taxReturn');
    expect(ret.limit).toBe(57_000);
    // 実質負担 ≒ 2,000 + (57,000 − 2,000) × 10.105% ≒ 7,558円
    expect(ret.burdenAtLimit).toBeGreaterThan(7_000);
    expect(ret.burdenAtLimit).toBeLessThan(8_000);
    expect(ret.extraHousingLoanLost).toBeGreaterThan(2_500);
    expect(ret.safeLimit).toBeLessThan(3_000);
  });
});

describe('住宅ローン控除が住民税の限度内に収まる場合', () => {
  it('確定申告でも損は出ない', () => {
    // 所得税 88,500円 + 住民税の限度 88,500円 に対し控除可能額 12万円
    const input = makeInput({ housingLoan: { amount: 120_000, period: 'from2022', firstYear: false } });
    const ret = analyzeMethod(input, 'taxReturn');
    expect(ret.safeLimit).toBeGreaterThan(30_000);
    expect(calculateTaxes(input, 0, 'taxReturn').housingLoanLost).toBe(0);
  });
});

describe('家族構成', () => {
  it('年収700万円・配偶者控除・特定扶養1人', () => {
    const input = makeInput({
      salary: 7_000_000,
      socialInsurance: 1_050_000,
      spouse: { has: true, salary: 0, elderly: false },
      dependents: { general: 0, specific: 1, elderly: 0, elderlyLivingTogether: 0 },
    });
    const t = calculateTaxes(input, 0, 'oneStop');
    // 給与所得 7,000,000×0.9−1,100,000 = 5,200,000（合計所得 489万超 → 基礎控除67万）
    expect(t.salaryIncome).toBe(5_200_000);
    // 所得税: 5,200,000 − 1,050,000 − 670,000 − 380,000 − 630,000 = 2,470,000
    expect(t.incomeTax.taxable).toBe(2_470_000);
    // 住民税: 5,200,000 − 1,050,000 − 430,000 − 330,000 − 450,000 = 2,940,000
    expect(t.resident.taxable).toBe(2_940_000);
    // 人的控除差 5万+5万+18万=28万、判定額 294万−28万−19万=247万 → 79.79%
    expect(t.resident.specialRate).toBeCloseTo(0.7979);
  });

  it('配偶者特別控除（配偶者の給与収入150万円 → 所得76万円 → 38万円/33万円）', () => {
    const base = calculateTaxes(makeInput(), 0, 'oneStop');
    const t = calculateTaxes(makeInput({ spouse: { has: true, salary: 1_500_000, elderly: false } }), 0, 'oneStop');
    expect(base.incomeTax.deductions - t.incomeTax.deductions).toBe(-380_000);
    expect(base.resident.deductions - t.resident.deductions).toBe(-330_000);
  });
});

describe('oneStopUnavailableReason', () => {
  it('住宅ローン控除1年目・医療費控除ありは確定申告が必要', () => {
    expect(oneStopUnavailableReason(makeInput({ housingLoan: { amount: 100_000, period: 'from2022', firstYear: true } }))).not.toBeNull();
    expect(oneStopUnavailableReason(makeInput({ medicalDeduction: 50_000 }))).not.toBeNull();
    expect(oneStopUnavailableReason(makeInput())).toBeNull();
  });
});
