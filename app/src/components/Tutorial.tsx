import { useEffect, useState } from 'react';
import { GraduationCap, X } from 'lucide-react';

export interface TutorialStep {
  /** Значение атрибута data-tour у подсвечиваемой кнопки. */
  target: string;
  title: string;
  text: string;
}

interface Props {
  step: TutorialStep;
  index: number;
  total: number;
  onSkip: () => void;
}

/** Подсветка элемента на экране и подсказка рядом. Нажатия проходят сквозь затемнение. */
export function Tutorial({ step, index, total, onSkip }: Props) {
  const [rect, setRect] = useState<DOMRect | null>(null);

  useEffect(() => {
    const el = document.querySelector<HTMLElement>(`[data-tour="${step.target}"]`);
    el?.scrollIntoView({ behavior: 'smooth', block: 'center' });
    const measure = () => {
      const node = document.querySelector<HTMLElement>(`[data-tour="${step.target}"]`);
      setRect(node ? node.getBoundingClientRect() : null);
    };
    measure();
    const id = window.setInterval(measure, 250);
    window.addEventListener('scroll', measure, { passive: true });
    window.addEventListener('resize', measure);
    return () => {
      window.clearInterval(id);
      window.removeEventListener('scroll', measure);
      window.removeEventListener('resize', measure);
    };
  }, [step.target]);

  const pad = 6;
  const below = rect ? rect.top < window.innerHeight / 2 : true;

  return (
    <div className="tour" aria-live="polite">
      {rect && (
        <div
          className="tour-hole"
          style={{
            top: rect.top - pad,
            left: rect.left - pad,
            width: rect.width + pad * 2,
            height: rect.height + pad * 2,
          }}
        />
      )}
      <div
        className="tour-tip"
        style={
          rect
            ? below
              ? { top: rect.bottom + 16 }
              : { bottom: window.innerHeight - rect.top + 16 }
            : { bottom: 120 }
        }
      >
        <div className="tour-tip-head">
          <GraduationCap size={18} />
          <span>
            Обучение · {index + 1} из {total}
          </span>
          <button className="tour-skip" onClick={onSkip} aria-label="Пропустить обучение">
            <X size={18} />
          </button>
        </div>
        <b>{step.title}</b>
        <p>{step.text}</p>
      </div>
    </div>
  );
}
