import type { CurvePoint } from '../tax/limit';
import { formatAxisMan, formatNumber, formatYen } from './format';

export interface ChartData {
  points: CurvePoint[];
  showOneStop: boolean;
}

interface Series {
  key: 'oneStop' | 'taxReturn';
  name: string;
  colorVar: string;
}

const SVG_NS = 'http://www.w3.org/2000/svg';

function svgEl<K extends keyof SVGElementTagNameMap>(tag: K, attrs: Record<string, string | number> = {}): SVGElementTagNameMap[K] {
  const el = document.createElementNS(SVG_NS, tag);
  for (const [k, v] of Object.entries(attrs)) el.setAttribute(k, String(v));
  return el;
}

function niceStep(range: number, targetTicks: number): number {
  const raw = range / Math.max(1, targetTicks);
  const pow = 10 ** Math.floor(Math.log10(raw));
  const n = raw / pow;
  const nice = n <= 1 ? 1 : n <= 2 ? 2 : n <= 2.5 ? 2.5 : n <= 5 ? 5 : 10;
  return nice * pow;
}

function formatYAxis(v: number): string {
  return v >= 10_000 ? formatAxisMan(v) : formatNumber(v);
}

export class BurdenChart {
  private root: HTMLElement;
  private data: ChartData | null = null;
  private activeIndex: number | null = null;
  private resizeObserver: ResizeObserver;
  private lastWidth = 0;

  constructor(root: HTMLElement) {
    this.root = root;
    this.resizeObserver = new ResizeObserver(() => {
      const w = this.root.clientWidth;
      if (this.data && Math.abs(w - this.lastWidth) > 4) this.render();
    });
    this.resizeObserver.observe(this.root);
  }

  update(data: ChartData) {
    this.data = data;
    if (this.activeIndex !== null && this.activeIndex >= data.points.length) this.activeIndex = null;
    this.render();
  }

  private series(): Series[] {
    const s: Series[] = [];
    if (this.data?.showOneStop) s.push({ key: 'oneStop', name: 'ワンストップ特例', colorVar: '--series-1' });
    s.push({ key: 'taxReturn', name: '確定申告', colorVar: '--series-2' });
    return s;
  }

  private render() {
    const data = this.data;
    if (!data || data.points.length < 2) return;
    const series = this.series();
    const width = Math.max(280, this.root.clientWidth || 320);
    this.lastWidth = width;
    const height = width < 480 ? 230 : 270;
    const margin = { top: 16, right: 14, bottom: 30, left: 46 };
    const plotW = width - margin.left - margin.right;
    const plotH = height - margin.top - margin.bottom;

    const xMax = data.points[data.points.length - 1].donation;
    const yMaxRaw = Math.max(
      4000,
      ...data.points.flatMap((p) => series.map((s) => p[s.key] ?? 0)),
    );
    const yStep = niceStep(yMaxRaw, 4);
    const yMax = Math.ceil(yMaxRaw / yStep) * yStep;
    const xStep = niceStep(xMax, width < 480 ? 4 : 6);

    const x = (v: number) => margin.left + (v / xMax) * plotW;
    const y = (v: number) => margin.top + plotH - (Math.max(0, v) / yMax) * plotH;

    const tableWasOpen = this.root.querySelector<HTMLDetailsElement>('details.table-view')?.open ?? false;
    this.root.replaceChildren();

    // 凡例（2系列以上のとき）
    if (series.length > 1) {
      const legend = document.createElement('ul');
      legend.className = 'legend';
      for (const s of series) {
        const li = document.createElement('li');
        const key = document.createElement('span');
        key.className = 'legend-key';
        key.style.setProperty('--key-color', `var(${s.colorVar})`);
        li.append(key, document.createTextNode(s.name));
        legend.append(li);
      }
      this.root.append(legend);
    }

    const plot = document.createElement('div');
    plot.className = 'chart-plot';
    const svg = svgEl('svg', {
      width,
      height,
      viewBox: `0 0 ${width} ${height}`,
      role: 'img',
      tabindex: 0,
      'aria-label': '寄附額ごとの実質負担のグラフ。左右の矢印キーで寄附額を動かして値を確認できます。',
    });

    // グリッドと Y 軸ラベル
    const grid = svgEl('g', { class: 'grid' });
    for (let v = 0; v <= yMax + 0.5; v += yStep) {
      const yy = y(v);
      grid.append(svgEl('line', { x1: margin.left, x2: width - margin.right, y1: yy, y2: yy, class: v === 0 ? 'baseline' : 'gridline' }));
      const label = svgEl('text', { x: margin.left - 8, y: yy, class: 'tick', 'text-anchor': 'end', 'dominant-baseline': 'middle' });
      label.textContent = formatYAxis(v);
      grid.append(label);
    }
    for (let v = 0; v <= xMax + 0.5; v += xStep) {
      const label = svgEl('text', { x: x(v), y: height - 8, class: 'tick', 'text-anchor': v === 0 ? 'start' : 'middle' });
      label.textContent = formatAxisMan(v);
      grid.append(label);
    }
    svg.append(grid);

    // 2,000円ライン
    const refY = y(2000);
    svg.append(svgEl('line', { x1: margin.left, x2: width - margin.right, y1: refY, y2: refY, class: 'ref-line' }));
    // ラベルは線の下（右端寄り）に置き、系列の線と重ならないようにする
    const refLabel = svgEl('text', {
      x: width - margin.right - 4,
      y: Math.min(refY + 14, margin.top + plotH - 4),
      class: 'ref-label',
      'text-anchor': 'end',
    });
    refLabel.textContent = '自己負担 2,000円';
    svg.append(refLabel);

    // 系列
    const endLabels: { y: number; name: string; colorVar: string }[] = [];
    for (const s of series) {
      const d = data.points
        .map((p, i) => `${i === 0 ? 'M' : 'L'}${x(p.donation).toFixed(1)},${y(p[s.key] ?? 0).toFixed(1)}`)
        .join('');
      svg.append(svgEl('path', { d, class: 'series-line', style: `stroke: var(${s.colorVar})` }));
      const last = data.points[data.points.length - 1];
      endLabels.push({ y: y(last[s.key] ?? 0), name: s.name, colorVar: s.colorVar });
    }

    // 線の終点付近に直接ラベル（重なる場合はずらす）
    endLabels.sort((a, b) => a.y - b.y);
    let prevY = -Infinity;
    for (const l of endLabels) {
      let ly = Math.max(margin.top + 10, l.y - 8);
      if (ly - prevY < 16) ly = prevY + 16;
      prevY = ly;
      const t = svgEl('text', { x: width - margin.right - 2, y: ly, class: 'direct-label', 'text-anchor': 'end' });
      t.textContent = l.name;
      svg.append(t);
    }

    // クロスヘア
    const cross = svgEl('g', { class: 'crosshair' });
    const vline = svgEl('line', { y1: margin.top, y2: margin.top + plotH, class: 'cross-line' });
    cross.append(vline);
    const dots = series.map((s) => {
      const c = svgEl('circle', { r: 4, class: 'cross-dot', style: `fill: var(${s.colorVar})` });
      cross.append(c);
      return c;
    });
    svg.append(cross);

    const tooltip = document.createElement('div');
    tooltip.className = 'chart-tooltip';
    tooltip.setAttribute('role', 'status');
    tooltip.hidden = true;

    const show = (index: number) => {
      const p = data.points[index];
      this.activeIndex = index;
      const px = x(p.donation);
      vline.setAttribute('x1', String(px));
      vline.setAttribute('x2', String(px));
      series.forEach((s, i) => {
        dots[i].setAttribute('cx', String(px));
        dots[i].setAttribute('cy', String(y(p[s.key] ?? 0)));
      });
      cross.classList.add('visible');

      tooltip.replaceChildren();
      const head = document.createElement('div');
      head.className = 'tt-head';
      head.textContent = `寄附額 ${formatYen(p.donation)}`;
      tooltip.append(head);
      for (const s of series) {
        const row = document.createElement('div');
        row.className = 'tt-row';
        const key = document.createElement('span');
        key.className = 'tt-key';
        key.style.setProperty('--key-color', `var(${s.colorVar})`);
        const value = document.createElement('strong');
        value.textContent = formatYen(p[s.key] ?? 0);
        const name = document.createElement('span');
        name.className = 'tt-name';
        name.textContent = s.name;
        row.append(key, value, name);
        tooltip.append(row);
      }
      tooltip.hidden = false;
      const ttWidth = tooltip.offsetWidth || 160;
      const left = Math.min(Math.max(px - ttWidth / 2, 4), width - ttWidth - 4);
      tooltip.style.transform = `translate(${left}px, 0)`;
    };
    const hide = () => {
      this.activeIndex = null;
      cross.classList.remove('visible');
      tooltip.hidden = true;
    };

    const indexFromEvent = (ev: PointerEvent) => {
      const rect = svg.getBoundingClientRect();
      const px = ((ev.clientX - rect.left) / rect.width) * width;
      const v = ((px - margin.left) / plotW) * xMax;
      let best = 0;
      let bestDist = Infinity;
      data.points.forEach((p, i) => {
        const dist = Math.abs(p.donation - v);
        if (dist < bestDist) {
          best = i;
          bestDist = dist;
        }
      });
      return best;
    };

    svg.addEventListener('pointermove', (ev) => show(indexFromEvent(ev)));
    svg.addEventListener('pointerdown', (ev) => show(indexFromEvent(ev)));
    svg.addEventListener('pointerleave', (ev) => {
      if (ev.pointerType === 'mouse') hide();
    });
    svg.addEventListener('focus', () => show(this.activeIndex ?? Math.floor(data.points.length / 2)));
    svg.addEventListener('blur', hide);
    svg.addEventListener('keydown', (ev) => {
      const cur = this.activeIndex ?? 0;
      if (ev.key === 'ArrowRight') show(Math.min(data.points.length - 1, cur + 1));
      else if (ev.key === 'ArrowLeft') show(Math.max(0, cur - 1));
      else if (ev.key === 'Home') show(0);
      else if (ev.key === 'End') show(data.points.length - 1);
      else if (ev.key === 'Escape') hide();
      else return;
      ev.preventDefault();
    });

    plot.append(svg, tooltip);
    this.root.append(plot);
    if (this.activeIndex !== null) show(this.activeIndex);

    // 表で見る
    const details = document.createElement('details');
    details.className = 'table-view';
    details.open = tableWasOpen;
    const summary = document.createElement('summary');
    summary.textContent = '表で見る';
    details.append(summary);
    const wrap = document.createElement('div');
    wrap.className = 'table-scroll';
    const table = document.createElement('table');
    const thead = document.createElement('thead');
    const hr = document.createElement('tr');
    for (const h of ['寄附額', ...series.map((s) => `実質負担（${s.name}）`)]) {
      const th = document.createElement('th');
      th.scope = 'col';
      th.textContent = h;
      hr.append(th);
    }
    thead.append(hr);
    const tbody = document.createElement('tbody');
    const every = Math.max(1, Math.round(data.points.length / 12));
    data.points.forEach((p, i) => {
      if (i % every !== 0 && i !== data.points.length - 1) return;
      const tr = document.createElement('tr');
      const th = document.createElement('th');
      th.scope = 'row';
      th.textContent = formatYen(p.donation);
      tr.append(th);
      for (const s of series) {
        const td = document.createElement('td');
        td.textContent = formatYen(p[s.key] ?? 0);
        tr.append(td);
      }
      tbody.append(tr);
    });
    table.append(thead, tbody);
    wrap.append(table);
    details.append(wrap);
    this.root.append(details);
  }
}
