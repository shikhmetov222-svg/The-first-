import { displayName, haptic, isInTelegram, tg } from './telegram';

export function App() {
  return (
    <main className="screen">
      <header className="hero">
        <div className="logo">CAPITAL</div>
        <p className="subtitle">Бизнес-симулятор</p>
      </header>

      <section className="card">
        <h2>Привет, {displayName()}!</h2>
        <p className="hint">
          Скоро здесь появится твой первый бизнес. Сейчас идёт строительство города.
        </p>
        <button className="button" onClick={() => haptic('medium')}>
          Скоро открытие
        </button>
      </section>

      <footer className="status">
        {isInTelegram
          ? `Открыто в Telegram · ${tg?.platform} · v${tg?.version}`
          : 'Открыто в браузере (не в Telegram)'}
      </footer>
    </main>
  );
}
