import { TIERS, type Country } from '../../supabase/functions/_shared/game/config.ts';

const nf = new Intl.NumberFormat('ru-RU', { maximumFractionDigits: 0 });
export const fmt = (n: number) => nf.format(Math.round(n));
/** Копейки → «1 234 ₽». */
export const rub = (kop: number) => fmt(kop / 100) + ' ₽';
/** Копейки → сумма в валюте страны. */
export const local = (c: Country, kop: number) => fmt(kop / 100 / c.rate) + ' ' + c.cur;
export const fmtMul = (m: number) => (m % 1 ? m.toFixed(1) : fmt(m));
export const tierById = (id: string) => TIERS.find((t) => t.id === id) ?? TIERS[TIERS.length - 1];
export const tierVar = (id: string) => `var(--t-${id})`;
export const esc = (s: string) => s.replace(/[&<>"']/g, (ch) => `&#${ch.charCodeAt(0)};`);
