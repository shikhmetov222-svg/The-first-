import type { CatalogItem, LoginResult } from '../api';
import { BUSINESS_INFO } from '../content';
import { count, duration, money } from '../format';

interface Props {
  summary: NonNullable<LoginResult['summary']>;
  catalog: CatalogItem[];
  pending: number;
  busy: boolean;
  onCollect: () => void;
  onClose: () => void;
}

export function AwaySummary({ summary, catalog, pending, busy, onCollect, onClose }: Props) {
  const away = Date.now() - new Date(summary.since).getTime();
  const revenue = summary.items.reduce((s, i) => s + i.revenue, 0);

  return (
    <div className="backdrop">
      <div className="sheet">
        <div className="sheet-handle" />
        <h2>Пока тебя не было</h2>
        <p className="hint">Прошло {duration(away)}. Вот что произошло:</p>

        <ul className="summary">
          {summary.items.map((i) => {
            const item = catalog.find((c) => c.type === i.type)!;
            const isFactory = item.production_rate > 0;
            return (
              <li key={i.type}>
                <span className="icon">{BUSINESS_INFO[i.type].icon}</span>
                <div className="grow">
                  <b>{item.name}</b>
                  <div className="hint small">
                    {isFactory
                      ? `Испечено ${count(i.produced)} шт. хлеба`
                      : `Продано ${count(i.sold)} шт. на ${money(i.revenue)}`}
                  </div>
                  {!isFactory && i.stock === 0 && <div className="warning small">Склад пуст!</div>}
                  {isFactory && i.raw_stock === 0 && <div className="warning small">Мука закончилась!</div>}
                </div>
              </li>
            );
          })}
        </ul>

        {revenue > 0 && (
          <div className="stat">
            <span className="stat-label">Выручка за это время</span>
            <span className="stat-value">{money(revenue)}</span>
          </div>
        )}

        {pending > 0 ? (
          <button className="button" disabled={busy} onClick={onCollect}>
            Забрать {money(pending)}
          </button>
        ) : null}
        <button className="button ghost" onClick={onClose}>
          {pending > 0 ? 'Позже' : 'Понятно'}
        </button>
      </div>
    </div>
  );
}
