import type { Decision } from '../api';

interface Props {
  decision: Decision;
  busy: boolean;
  onChoose: (option: number) => void;
}

/** «Решение дня»: одна карточка-событие в сутки. Последствия считает сервер. */
export function DecisionCard({ decision, busy, onChoose }: Props) {
  const decided = decision.choice !== null;

  return (
    <section className={`card decision ${decided ? 'decided' : ''}`}>
      <div className="decision-tag">Решение дня</div>
      <h3>{decision.title}</h3>
      <p className="hint">{decision.body}</p>

      {decided ? (
        <p className={`decision-result ${decision.success === false ? 'bad' : ''}`}>
          {decision.options[decision.choice!]?.label}: {decision.result}
          <span className="hint small"> Новое решение — завтра.</span>
        </p>
      ) : (
        <div className="decision-options">
          {decision.options.map((o, i) => (
            <button key={i} className="option" disabled={busy} onClick={() => onChoose(i)}>
              <b>{o.label}</b>
              <span className="hint small">{o.hint}</span>
            </button>
          ))}
        </div>
      )}
    </section>
  );
}
