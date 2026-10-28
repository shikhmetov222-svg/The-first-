import { BellOff } from 'lucide-react';
import type { GameState } from '../api';

/** Список уведомлений: продажи на рынке и т. п. */
export function NotificationsSheet({ game, onClose }: { game: GameState; onClose: () => void }) {
  const list = game.notifications ?? [];
  return (
    <div className="backdrop" onClick={onClose}>
      <div className="sheet" onClick={(e) => e.stopPropagation()}>
        <div className="sheet-handle" />
        <h2>Уведомления</h2>
        {list.length === 0 ? (
          <div className="placeholder">
            <div className="placeholder-icon">
              <BellOff size={24} />
            </div>
            <p className="hint">Пока тихо. Здесь появятся продажи твоих лотов и бизнесов.</p>
          </div>
        ) : (
          <ul className="list notif-list">
            {list.map((n) => (
              <li key={n.id} className={n.read ? '' : 'unread'}>
                <span>{n.text}</span>
                <span className="stat-label">
                  {new Date(n.at).toLocaleString('ru-RU', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })}
                </span>
              </li>
            ))}
          </ul>
        )}
        <p className="hint small">
          Если в профиле включены уведомления от бота, он тоже пришлёт сообщение — не больше 5 в сутки.
        </p>
        <button className="button ghost" onClick={onClose}>
          Закрыть
        </button>
      </div>
    </div>
  );
}
