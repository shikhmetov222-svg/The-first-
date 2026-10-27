import { useState } from 'react';
import { CalendarClock, CircleCheck, CircleX } from 'lucide-react';
import type { Decision } from '../api';
import { haptic } from '../telegram';

interface Props {
  decision: Decision;
  busy: boolean;
  onChoose: (option: number) => void;
}

/** «Решение дня»: компактная карточка. Последствия считает сервер. */
export function DecisionCard({ decision, busy, onChoose }: Props) {
  const [expanded, setExpanded] = useState(false);
  const decided = decision.choice !== null;

  return (
    <section className={`card decision ${decided ? 'decided' : ''}`}>
      <div className="decision-tag">Решение дня</div>
      <h3>{decision.title}</h3>
      <p
        className={`decision-body ${expanded ? 'expanded' : ''}`}
        onClick={() => setExpanded(!expanded)}
        title={decision.body}
      >
        {decision.body}
      </p>

      {decided ? (
        <div className={`decision-result ${decision.success === false ? 'bad' : ''}`}>
          <span className="decision-result-text">
            {decision.success === false ? <CircleX size={18} /> : <CircleCheck size={18} />}
            <span>{decision.result}</span>
          </span>
          <span className="decision-next">
            <CalendarClock size={14} /> Новое решение — завтра
          </span>
        </div>
      ) : (
        <div className="decision-options">
          {decision.options.slice(0, 2).map((o, i) => (
            <div key={i} className="decision-option">
              <button
                className={`button small ${i === 0 ? '' : 'secondary'}`}
                disabled={busy}
                onClick={() => {
                  haptic('light');
                  onChoose(i);
                }}
              >
                {o.label}
              </button>
              <span className="decision-hint">{o.hint}</span>
            </div>
          ))}
        </div>
      )}
    </section>
  );
}
