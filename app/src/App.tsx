import { useCallback, useEffect, useState } from 'react';
import { api, type Player } from './api';
import { money } from './format';
import { haptic, isInTelegram } from './telegram';

type State =
  | { kind: 'loading' }
  | { kind: 'error'; message: string }
  | { kind: 'ready'; player: Player };

export function App() {
  if (!isInTelegram) return <NotInTelegram />;
  return <Game />;
}

function Game() {
  const [state, setState] = useState<State>({ kind: 'loading' });

  const login = useCallback(async () => {
    setState({ kind: 'loading' });
    try {
      const { player } = await api.login();
      setState({ kind: 'ready', player });
    } catch (e) {
      setState({ kind: 'error', message: (e as Error).message });
    }
  }, []);

  useEffect(() => {
    login();
  }, [login]);

  return (
    <main className="screen">
      <header className="hero">
        <div className="logo">CAPITAL</div>
        <p className="subtitle">Бизнес-симулятор</p>
      </header>

      {state.kind === 'loading' && <p className="center hint">Входим в игру…</p>}

      {state.kind === 'error' && (
        <section className="card">
          <h2>Не получилось войти</h2>
          <p className="hint">{state.message}</p>
          <button className="button" onClick={login}>
            Попробовать снова
          </button>
        </section>
      )}

      {state.kind === 'ready' && <Welcome player={state.player} />}
    </main>
  );
}

function Welcome({ player }: { player: Player }) {
  return (
    <>
      <section className="card">
        <h2>
          {player.is_new ? 'Добро пожаловать' : 'С возвращением'}, {player.first_name || 'игрок'}!
        </h2>
        <p className="hint">
          {player.is_new
            ? 'Ты получил стартовый капитал. Скоро здесь можно будет открыть первый бизнес.'
            : 'Твой капитал на месте. Бизнесы появятся совсем скоро.'}
        </p>
        <div className="stat">
          <span className="stat-label">Капитал</span>
          <span className="stat-value">{money(player.cash)}</span>
        </div>
      </section>
      <button className="button" onClick={() => haptic('medium')}>
        Скоро открытие
      </button>
    </>
  );
}

function NotInTelegram() {
  return (
    <main className="screen">
      <header className="hero">
        <div className="logo">CAPITAL</div>
        <p className="subtitle">Бизнес-симулятор</p>
      </header>
      <section className="card">
        <h2>Открой игру в Telegram</h2>
        <p className="hint">
          CAPITAL работает только внутри Telegram: так мы узнаём, кто ты, без паролей.
          Открой бота и нажми кнопку «Играть».
        </p>
      </section>
    </main>
  );
}
