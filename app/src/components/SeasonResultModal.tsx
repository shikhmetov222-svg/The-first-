import type { SeasonResult } from '../api';
import { money } from '../format';
import { Flag, Trophy } from 'lucide-react';

export function SeasonResultModal({ result, onClose }: { result: SeasonResult; onClose: () => void }) {
  return (
    <div className="backdrop">
      <div className="sheet center">
        <div className="sheet-handle" />
        <div className="big-medal">
          {result.place <= 3 ? <Trophy size={56} /> : <Flag size={56} />}
        </div>
        <h2>Сезон {result.season} завершён</h2>
        <p className="hint">
          Ты занял {result.place} место из {result.total}.<br />
          Итоговый капитал: {money(result.capital)} ({result.growth > 0 ? '+' : ''}
          {String(result.growth).replace('.', ',')}%).
        </p>
        <p className="hint">Начался новый сезон — у всех снова 100 000 ₽. Удачи!</p>
        <button className="button" onClick={onClose}>
          Начать сезон
        </button>
      </div>
    </div>
  );
}
