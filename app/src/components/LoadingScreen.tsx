import { useState } from 'react';
import { Lightbulb, TrendingUp } from 'lucide-react';
import { TIPS } from '../content';

/** Экран загрузки: логотип, полоса загрузки, силуэт города и случайный совет. */
export function LoadingScreen({ children }: { children?: React.ReactNode }) {
  const [tip] = useState(() => TIPS[Math.floor(Math.random() * TIPS.length)]);

  return (
    <div className="loading">
      <div className="loading-mark">
        <TrendingUp size={44} strokeWidth={2.4} />
      </div>
      <div className="loading-title">CAPITAL</div>
      <p className="loading-subtitle">Построй свою империю</p>

      {children ?? (
        <>
          <div className="loading-bar" />
          <div className="loading-status">Открываем биржу…</div>
        </>
      )}

      <CitySkyline />
      {!children && (
        <div className="loading-tip">
          <Lightbulb size={18} />
          <span>
            <b>Совет:</b> {tip}
          </span>
        </div>
      )}
    </div>
  );
}

function CitySkyline() {
  return (
    <svg className="loading-city" viewBox="0 0 400 160" preserveAspectRatio="none" aria-hidden="true">
      <path
        fill="currentColor"
        d="M0 160V112h14V96h18v16h10V70h26v42h8V88h20V54l12-10 12 10v58h10V80h22v32h8V30h30v82h8V92h16v20h12V62h24v50h10V84h18
           V40l14-12 14 12v72h8V96h20v16h10V74h24v38h12V100h18v60z"
      />
    </svg>
  );
}
