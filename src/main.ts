import './styles/main.css';
import { calculateTaxes, estimateSocialInsurance, type FilingMethod, type TaxInput } from './tax/engine';
import { analyzeMethod, burden, burdenCurve, oneStopUnavailableReason, type MethodResult } from './tax/limit';
import type { HousingLoanPeriod } from './tax/params';
import { BurdenChart } from './ui/chart';
import { formatMan, formatNumber, formatYen, parseMoney } from './ui/format';

const $ = <T extends HTMLElement = HTMLElement>(sel: string) => document.querySelector<T>(sel)!;
const money = (id: string) => parseMoney($<HTMLInputElement>(`#${id}`).value);
const radio = (name: string) => document.querySelector<HTMLInputElement>(`input[name="${name}"]:checked`)?.value ?? '';
const stepperValue = (id: string) => Number($<HTMLOutputElement>(`#${id}`).value || $(`#${id}`).textContent || 0);

const METHOD_LABEL: Record<FilingMethod, string> = { oneStop: 'ワンストップ特例', taxReturn: '確定申告' };

function readInput(): TaxInput {
  const hasLoan = radio('loan') === 'has';
  return {
    salary: money('salary'),
    socialInsurance: $<HTMLInputElement>('#social-auto').checked ? null : money('social'),
    spouse: {
      has: radio('spouse') === 'has',
      salary: money('spouse-salary'),
      elderly: $<HTMLInputElement>('#spouse-elderly').checked,
    },
    dependents: {
      general: stepperValue('dep-general'),
      specific: stepperValue('dep-specific'),
      elderly: stepperValue('dep-elderly'),
      elderlyLivingTogether: stepperValue('dep-elderly-together'),
    },
    housingLoan: {
      amount: hasLoan ? money('loan-amount') : 0,
      period: $<HTMLSelectElement>('#loan-period').value as HousingLoanPeriod,
      firstYear: hasLoan && $<HTMLInputElement>('#loan-first').checked,
    },
    ideco: money('ideco'),
    lifeInsurance: { general: money('life-general'), care: money('life-care'), pension: money('life-pension') },
    earthquakeInsurance: money('quake'),
    medicalDeduction: money('medical'),
  };
}

function el<K extends keyof HTMLElementTagNameMap>(tag: K, className?: string, text?: string): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

interface Analysis {
  input: TaxInput;
  oneStop: MethodResult | null;
  oneStopReason: string | null;
  taxReturn: MethodResult;
  recommended: FilingMethod;
  planned: number;
}

function analyze(input: TaxInput): Analysis {
  const oneStopReason = oneStopUnavailableReason(input);
  const oneStop = oneStopReason ? null : analyzeMethod(input, 'oneStop');
  const taxReturn = analyzeMethod(input, 'taxReturn');
  let recommended: FilingMethod = 'taxReturn';
  if (oneStop && oneStop.burdenAtLimit <= taxReturn.burdenAtLimit + 100) recommended = 'oneStop';
  return { input, oneStop, oneStopReason, taxReturn, recommended, planned: money('planned') };
}

function renderMethodCard(a: Analysis, method: FilingMethod): HTMLElement {
  const result = method === 'oneStop' ? a.oneStop : a.taxReturn;
  const card = el('article', 'method');
  card.dataset.method = method;
  const head = el('div', 'method-head');
  head.append(el('h3', 'method-name', METHOD_LABEL[method]));
  const same =
    a.oneStop !== null && Math.abs(a.oneStop.burdenAtLimit - a.taxReturn.burdenAtLimit) <= 100 && a.oneStop.limit === a.taxReturn.limit;
  if (result && a.recommended === method) {
    card.classList.add('is-recommended');
    head.append(el('span', 'badge', same ? '手続きが簡単' : 'おすすめ'));
  }
  card.append(head);

  if (!result) {
    card.classList.add('is-disabled');
    card.append(el('p', 'method-note', a.oneStopReason ?? ''));
    return card;
  }

  const value = el('p', 'method-value');
  value.append(el('span', 'num', formatNumber(result.limit)), el('span', 'yen', '円'));
  card.append(value);

  const burdenLine = el('p', 'method-burden');
  burdenLine.append('この額の実質負担 ', el('strong', result.burdenAtLimit > 2100 ? 'is-bad' : '', formatYen(result.burdenAtLimit)));
  card.append(burdenLine);

  if (result.extraHousingLoanLost > 0) {
    const p = el('p', 'method-warn');
    p.append('住宅ローン控除が ', el('strong', '', formatYen(result.extraHousingLoanLost)), ' 目減り');
    card.append(p);
  }
  if (result.safeLimit <= 3000 && result.burdenAtLimit > 2100) {
    card.append(el('p', 'method-warn', '少額の寄附でも実質負担が2,000円を超えます'));
  } else if (result.safeLimit < result.limit - 1000) {
    const p = el('p', 'method-warn');
    p.append('負担を2,000円に抑えるなら ', el('strong', '', formatYen(result.safeLimit)), ' まで');
    card.append(p);
  }
  if (a.planned > 0) {
    const b = Math.round(burden(a.input, a.planned, method, true));
    const p = el('p', 'method-planned');
    p.append(`予定額 ${formatMan(a.planned)} の実質負担 `, el('strong', b > 2100 ? 'is-bad' : '', formatYen(b)));
    card.append(p);
  }
  return card;
}

function renderAdvice(a: Analysis): HTMLElement[] {
  const items: HTMLElement[] = [];
  const add = (kind: 'info' | 'warn' | 'good', text: string) => {
    const p = el('p', `advice-item is-${kind}`);
    const icon = el('span', 'advice-icon', kind === 'warn' ? '!' : kind === 'good' ? '✓' : 'i');
    icon.setAttribute('aria-hidden', 'true');
    p.append(icon, el('span', '', text));
    items.push(p);
  };

  const { input, oneStop, taxReturn } = a;
  const hasLoan = input.housingLoan.amount > 0;
  const baseLost = calculateTaxes(input, 0, 'oneStop').housingLoanLost;

  if (input.salary <= 0) {
    add('info', '給与収入を入力すると上限目安を計算します。');
    return items;
  }
  if (a.oneStopReason) add('info', a.oneStopReason);

  if (hasLoan && oneStop && taxReturn.burdenAtLimit > oneStop.burdenAtLimit + 100) {
    add(
      'warn',
      `住宅ローン控除を所得税から引ききれていないため、確定申告にすると住宅ローン控除が約${formatNumber(taxReturn.extraHousingLoanLost)}円目減りし、上限目安まで寄附したときの実質負担は約${formatNumber(taxReturn.burdenAtLimit)}円になります。寄附先を5自治体以内にして、ワンストップ特例を使うのがおすすめです。`,
    );
  } else if (hasLoan && !oneStop && taxReturn.burdenAtLimit > 2100) {
    const tail =
      taxReturn.safeLimit <= 3000
        ? '寄附額に応じて住宅ローン控除が少しずつ目減りするため、返礼品の価値と実質負担を比べて寄附額を決めましょう。'
        : `負担を2,000円に抑えるなら${formatNumber(taxReturn.safeLimit)}円までにしましょう。`;
    add(
      'warn',
      `確定申告では住宅ローン控除の一部が消えるため、上限目安まで寄附すると実質負担は約${formatNumber(taxReturn.burdenAtLimit)}円です。${tail}`,
    );
  } else if (hasLoan) {
    add('good', '住宅ローン控除は所得税と住民税の範囲に収まっているため、ふるさと納税による目減りはありません。');
  }

  if (hasLoan && baseLost > 0) {
    add(
      'info',
      `ふるさと納税をしなくても、住宅ローン控除のうち約${formatNumber(baseLost)}円は所得税・住民税から引ききれていません（住民税から控除できる上限を超えています）。`,
    );
  }

  add('info', '年収や控除は見込みで計算しているため、上限目安の9割程度までに収めると安心です。');
  return items;
}

function row(label: string, value: string, className = ''): HTMLTableRowElement {
  const tr = el('tr', className);
  const th = el('th', '', label);
  th.scope = 'row';
  tr.append(th, el('td', '', value));
  return tr;
}

function renderDetail(a: Analysis, method: FilingMethod): HTMLElement {
  const wrap = el('div', 'detail-body');
  const result = method === 'oneStop' ? a.oneStop : a.taxReturn;
  if (!result) {
    wrap.append(el('p', 'method-note', a.oneStopReason ?? ''));
    return wrap;
  }
  const donation = a.planned > 0 ? a.planned : result.limit;
  const before = calculateTaxes(a.input, 0, method);
  const after = calculateTaxes(a.input, donation, method);

  wrap.append(el('p', 'detail-caption', `${a.planned > 0 ? '寄附予定額' : '上限目安'} ${formatYen(donation)} を${METHOD_LABEL[method]}で寄附した場合`));

  const table = el('table', 'kv');
  const body = el('tbody');
  const itSaved = before.incomeTax.total - after.incomeTax.total;
  const loanLost = after.housingLoanLost - before.housingLoanLost;
  const saved = before.totalTax - after.totalTax;
  body.append(
    row('所得税の軽減', formatYen(itSaved)),
    row('住民税 基本分', formatYen(after.resident.donationBasic)),
    row('住民税 特例分', formatYen(after.resident.donationSpecial)),
  );
  if (method === 'oneStop') body.append(row('住民税 申告特例分', formatYen(after.resident.donationOneStop)));
  if (a.input.housingLoan.amount > 0) {
    const lostChange = after.resident.housingLoanCredit - before.resident.housingLoanCredit;
    body.append(row('住宅ローン控除（住民税）の増減', `${lostChange >= 0 ? '+' : '−'}${formatYen(Math.abs(lostChange))}`));
    if (loanLost > 0) body.append(row('消えた住宅ローン控除', `−${formatYen(loanLost)}`, 'is-bad'));
  }
  if (after.resident.donationCreditUnused > 0) {
    body.append(row('住民税が足りず控除しきれない額', `−${formatYen(after.resident.donationCreditUnused)}`, 'is-bad'));
  }
  body.append(row('税金の軽減額の合計', formatYen(saved), 'is-total'), row('実質負担', formatYen(donation - saved), 'is-total'));
  table.append(body);
  wrap.append(table);
  wrap.append(el('p', 'hint', '内訳は実際の端数処理（千円未満・百円未満の切捨てなど）で計算しているため、上の目安と数百円ずれることがあります。'));

  // 計算の詳細
  const details = el('details', 'calc-details');
  details.append(el('summary', '', '計算の詳細を見る'));
  const t2 = el('table', 'kv kv-3');
  const thead = el('thead');
  const hr = el('tr');
  for (const h of ['', '寄附しない場合', '寄附した場合']) {
    const th = el('th', '', h);
    th.scope = 'col';
    hr.append(th);
  }
  thead.append(hr);
  const b2 = el('tbody');
  const r3 = (label: string, v1: string, v2: string) => {
    const tr = el('tr');
    const th = el('th', '', label);
    th.scope = 'row';
    tr.append(th, el('td', '', v1), el('td', '', v2));
    return tr;
  };
  const section = (label: string) => {
    const tr = el('tr', 'kv-section');
    const th = el('th', '', label);
    th.colSpan = 3;
    tr.append(th);
    return tr;
  };
  const pct = (v: number) => `${(Math.round(v * 100000) / 1000).toString()}%`;
  b2.append(
    r3('給与所得', formatYen(before.salaryIncome), formatYen(after.salaryIncome)),
    r3('社会保険料', formatYen(before.socialInsurance), formatYen(after.socialInsurance)),
    section('所得税'),
    r3('所得控除の合計', formatYen(before.incomeTax.deductions), formatYen(after.incomeTax.deductions)),
    r3('課税所得', formatYen(before.incomeTax.taxable), formatYen(after.incomeTax.taxable)),
    r3('税率', pct(before.incomeTax.marginalRate), pct(after.incomeTax.marginalRate)),
    r3('住宅ローン控除', formatYen(before.incomeTax.housingLoanCredit), formatYen(after.incomeTax.housingLoanCredit)),
    r3('所得税額（復興税込）', formatYen(before.incomeTax.total), formatYen(after.incomeTax.total)),
    section('住民税（所得割）'),
    r3('所得控除の合計', formatYen(before.resident.deductions), formatYen(after.resident.deductions)),
    r3('課税所得', formatYen(before.resident.taxable), formatYen(after.resident.taxable)),
    r3('所得割（調整控除後）', formatYen(before.resident.afterAdjustment), formatYen(after.resident.afterAdjustment)),
    r3('特例分の上限（20%）', '—', formatYen(after.resident.afterAdjustment * 0.2)),
    r3('特例控除割合', '—', pct(after.resident.specialRate)),
    r3('住宅ローン控除の控除限度', formatYen(before.resident.housingLoanCap), formatYen(after.resident.housingLoanCap)),
    r3('住宅ローン控除', formatYen(before.resident.housingLoanCredit), formatYen(after.resident.housingLoanCredit)),
    r3('寄附金税額控除', '—', formatYen(after.resident.donationBasic + after.resident.donationSpecial + after.resident.donationOneStop)),
    r3('所得割額', formatYen(before.resident.total), formatYen(after.resident.total)),
  );
  t2.append(thead, b2);
  const scroll = el('div', 'table-scroll');
  scroll.append(t2);
  details.append(scroll);
  wrap.append(details);
  return wrap;
}

const chart = new BurdenChart($('#chart'));
let lastAnalysis: Analysis | null = null;

function update() {
  const input = readInput();
  const a = analyze(input);
  lastAnalysis = a;

  const methods = $('#methods');
  methods.replaceChildren(renderMethodCard(a, 'oneStop'), renderMethodCard(a, 'taxReturn'));
  $('#advice').replaceChildren(...renderAdvice(a));

  const best = a.recommended === 'oneStop' && a.oneStop ? a.oneStop : a.taxReturn;
  $('#sticky-value').textContent = input.salary > 0 ? formatYen(best.limit) : '—';

  const maxLimit = Math.max(a.taxReturn.limit, a.oneStop?.limit ?? 0, a.planned, 10_000);
  const step = maxLimit > 200_000 ? 50_000 : 10_000;
  const xMax = Math.ceil((maxLimit * 1.5) / step) * step;
  chart.update({ points: burdenCurve(input, xMax, 60, a.oneStop !== null), showOneStop: a.oneStop !== null });

  renderDetailSection();
}

function renderDetailSection() {
  if (!lastAnalysis) return;
  const selected = (radio('detail-method') || 'oneStop') as FilingMethod;
  $('#detail').replaceChildren(renderDetail(lastAnalysis, selected));
}

// ---- 入力の配線 ----

let timer: number | undefined;
const scheduleUpdate = () => {
  window.clearTimeout(timer);
  timer = window.setTimeout(update, 120);
};

function updateManHints() {
  document.querySelectorAll<HTMLElement>('[data-man-for]').forEach((node) => {
    const v = money(node.dataset.manFor!);
    node.textContent = v > 0 ? `（${formatMan(v)}）` : '';
  });
}

function updateReveals() {
  document.querySelectorAll<HTMLElement>('[data-show-when]').forEach((node) => {
    const [name, value] = node.dataset.showWhen!.split('=');
    node.hidden = radio(name) !== value;
  });
}

function syncSocialPlaceholder() {
  const auto = $<HTMLInputElement>('#social-auto').checked;
  const social = $<HTMLInputElement>('#social');
  const estimate = formatNumber(estimateSocialInsurance(money('salary')));
  social.disabled = auto;
  social.placeholder = estimate;
  if (auto) social.value = '';
}

document.querySelectorAll<HTMLInputElement>('input.money').forEach((input) => {
  input.addEventListener('input', () => {
    updateManHints();
    if (input.id === 'salary') syncSocialPlaceholder();
    scheduleUpdate();
  });
  input.addEventListener('blur', () => {
    const v = parseMoney(input.value);
    input.value = input.value.trim() === '' ? '' : formatNumber(v);
  });
  input.addEventListener('focus', () => input.select());
});

$<HTMLInputElement>('#social-auto').addEventListener('change', (ev) => {
  const auto = (ev.target as HTMLInputElement).checked;
  const social = $<HTMLInputElement>('#social');
  syncSocialPlaceholder();
  if (!auto) {
    social.value = formatNumber(estimateSocialInsurance(money('salary')));
    social.focus();
  }
  scheduleUpdate();
});

document.querySelectorAll<HTMLInputElement>('input[type="radio"], input[type="checkbox"], select').forEach((input) => {
  if (input.id === 'social-auto') return;
  input.addEventListener('change', () => {
    updateReveals();
    if (input.name === 'detail-method') renderDetailSection();
    else scheduleUpdate();
  });
});

document.querySelectorAll<HTMLElement>('[data-stepper]').forEach((stepper) => {
  const output = stepper.querySelector('output')!;
  const set = (v: number) => {
    const next = Math.max(0, Math.min(9, v));
    output.value = String(next);
    output.textContent = String(next);
    scheduleUpdate();
  };
  stepper.querySelector('[data-dec]')!.addEventListener('click', () => set(Number(output.textContent) - 1));
  stepper.querySelector('[data-inc]')!.addEventListener('click', () => set(Number(output.textContent) + 1));
});

$('#loan-apply').addEventListener('click', () => {
  const balance = money('loan-balance');
  const rate = Number($<HTMLSelectElement>('#loan-rate').value);
  const amount = Math.floor((balance * rate) / 100) * 100;
  $<HTMLInputElement>('#loan-amount').value = formatNumber(amount);
  scheduleUpdate();
});

// モバイルの追従バー: 結果カードが見えている間は隠す
const stickyBar = $('#sticky-bar');
const resultCard = document.querySelector('.result-card');
if (resultCard && 'IntersectionObserver' in window) {
  let resultVisible = false;
  let simVisible = true;
  const apply = () => stickyBar.classList.toggle('is-visible', simVisible && !resultVisible);
  new IntersectionObserver(([entry]) => {
    resultVisible = entry.isIntersecting;
    apply();
  }).observe(resultCard);
  new IntersectionObserver(([entry]) => {
    simVisible = entry.isIntersecting;
    apply();
  }).observe($('#sim-form'));
}

updateReveals();
updateManHints();
syncSocialPlaceholder();
update();
