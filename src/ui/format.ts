const yenFormatter = new Intl.NumberFormat('ja-JP');

export const formatYen = (value: number) => `${yenFormatter.format(Math.round(value))}円`;
export const formatNumber = (value: number) => yenFormatter.format(Math.round(value));

/** 「5.7万円」のような短い表記 */
export function formatMan(value: number): string {
  const man = value / 10_000;
  if (Math.abs(man) >= 100) return `${yenFormatter.format(Math.round(man))}万円`;
  return `${(Math.round(man * 10) / 10).toLocaleString('ja-JP')}万円`;
}

/** グラフ軸用: 0, 2万, 4万 ... */
export function formatAxisMan(value: number): string {
  if (value === 0) return '0';
  const man = value / 10_000;
  return `${Number.isInteger(man) ? man : man.toFixed(1)}万`;
}

/** 全角数字やカンマを含む入力を数値にする */
export function parseMoney(raw: string): number {
  const normalized = raw
    .replace(/[０-９]/g, (c) => String.fromCharCode(c.charCodeAt(0) - 0xfee0))
    .replace(/[^0-9]/g, '');
  if (!normalized) return 0;
  return Math.min(Number(normalized), 9_999_999_999);
}
