// «Поделиться» — только картинкой: номер не уходит текстом, его нельзя скопировать и набрать.
import type { Country } from '../../supabase/functions/_shared/game/config.ts';
import { fmtMul, local, rub, tierById } from './format.ts';
import type { Sim } from './types.ts';

const TIER_COLORS: Record<string, string> = {
  common: '#a3a8bb', nice: '#4ade80', rare: '#38bdf8', epic: '#b38cff', legend: '#fbbf24',
};

async function render(c: Country, s: Sim): Promise<Blob> {
  await document.fonts?.ready;
  const W = 1080, H = 1350, cv = document.createElement('canvas');
  cv.width = W; cv.height = H;
  const g = cv.getContext('2d')!;
  const tc = TIER_COLORS[s.tier] ?? TIER_COLORS.common;

  const bg = g.createRadialGradient(W, 0, 0, W, 0, W * 1.3);
  bg.addColorStop(0, '#3a2312'); bg.addColorStop(0.55, '#0c0912');
  g.fillStyle = bg; g.fillRect(0, 0, W, H);

  g.fillStyle = '#f6b833'; g.font = '800 54px Manrope, sans-serif'; g.textAlign = 'center';
  g.fillText('Золотой номер', W / 2, 150);

  // карточка со срезанным углом, как в игре
  const x = 90, y = 260, w = W - 180, h = 560, cut = 90;
  g.save();
  g.shadowColor = tc; g.shadowBlur = s.tier === 'common' ? 0 : 80;
  g.beginPath(); g.moveTo(x, y); g.lineTo(x + w - cut, y); g.lineTo(x + w, y + cut); g.lineTo(x + w, y + h); g.lineTo(x, y + h); g.closePath();
  const cardBg = g.createLinearGradient(x, y, x + w, y + h);
  cardBg.addColorStop(0, '#fffdf7'); cardBg.addColorStop(1, '#ebe5d6');
  g.fillStyle = cardBg; g.fill();
  g.restore();

  const chip = g.createLinearGradient(x + 50, y + 60, x + 140, y + 125);
  chip.addColorStop(0, '#e9c46a'); chip.addColorStop(1, '#b8862b');
  g.fillStyle = chip; g.beginPath(); g.roundRect(x + 50, y + 60, 90, 66, 14); g.fill();

  g.textAlign = 'left'; g.fillStyle = '#16121c'; g.font = '800 48px Manrope, sans-serif';
  g.fillText(`${c.flag} ${c.code}`, x + 170, y + 110);
  g.textAlign = 'right'; g.font = '800 40px Manrope, sans-serif';
  g.fillText(s.operator, x + w - 60, y + 210);

  g.textAlign = 'center'; g.font = '800 72px "JetBrains Mono", monospace';
  g.fillText(s.label.slice(c.code.length + 1), W / 2, y + 360);
  g.fillStyle = '#8a8273'; g.font = '700 32px Manrope, sans-serif';
  g.fillText('Игровой номер · не звоните по нему', W / 2, y + h - 50);

  g.fillStyle = tc; g.font = '800 64px Manrope, sans-serif';
  g.fillText(`${tierById(s.tier).name} · ×${fmtMul(s.mul)}`, W / 2, 960);
  g.fillStyle = '#d8d0ea'; g.font = '700 40px Manrope, sans-serif';
  g.fillText(s.tags.join(' · ') || 'Ничего особенного', W / 2, 1035);
  g.fillStyle = '#f4effc'; g.font = '800 70px Manrope, sans-serif';
  g.fillText(c.cur === '₽' ? rub(s.value) : `${local(c, s.value)} ≈ ${rub(s.value)}`, W / 2, 1150);

  return new Promise((res) => cv.toBlob((b) => res(b!), 'image/png'));
}

export async function shareSim(c: Country, s: Sim) {
  const blob = await render(c, s);
  const file = new File([blob], 'zolotoy-nomer.png', { type: 'image/png' });
  const nav = navigator as Navigator & { canShare?: (d: ShareData) => boolean };
  if (nav.canShare?.({ files: [file] })) {
    try { await nav.share({ files: [file] }); return; } catch (e) {
      if ((e as Error).name === 'AbortError') return;
    }
  }
  // Запасной вариант: показать картинку — её можно сохранить долгим нажатием.
  const img = document.getElementById('share-img') as HTMLImageElement;
  img.src = URL.createObjectURL(blob);
  document.getElementById('share-sheet')!.classList.remove('hidden');
}
