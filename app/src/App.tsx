import { useCallback, useEffect, useRef, useState } from 'react';
import { api, type BusinessType, type GameState, type LoginResult, type SeasonResult } from './api';
import { BusinessCard } from './components/BusinessCard';
import { ActionSheet, type SheetKind } from './components/ActionSheet';
import { AwaySummary } from './components/AwaySummary';
import { TickTimer } from './components/TickTimer';
import { DecisionCard } from './components/DecisionCard';
import { Leaderboard } from './components/Leaderboard';
import { SeasonResultModal } from './components/SeasonResultModal';
import { BottomNav, type Tab } from './components/BottomNav';
import { LoadingScreen } from './components/LoadingScreen';
import { MarketTab } from './components/MarketTab';
import { ProfileTab } from './components/ProfileTab';
import { duration, money } from './format';
import { isInTelegram, notify } from './telegram';
import { CircleAlert, CircleCheck } from 'lucide-react';
import { CompanyForm } from './components/CompanyForm';
import { Tutorial, type TutorialStep } from './components/Tutorial';
import type { CompanyInput } from './api';

const POLL_MS = 60_000;
const MIN_LOADING_MS = 1200; // чтобы экран загрузки не мелькал

export function App() {
  if (!isInTelegram) return <NotInTelegram />;
  return <Game />;
}

function Game() {
  const [game, setGame] = useState<GameState | null>(null);
  const [loginError, setLoginError] = useState<string | null>(null);
  const [summary, setSummary] = useState<LoginResult['summary']>(null);
  const [seasonResult, setSeasonResult] = useState<SeasonResult | null>(null);
  const [tab, setTab] = useState<Tab>('empire');
  const [serverOffset, setServerOffset] = useState(0);
  const [sheet, setSheet] = useState<SheetKind | null>(null);
  const [busy, setBusy] = useState(false);
  const [toast, setToast] = useState<{ text: string; error?: boolean } | null>(null);
  const [formError, setFormError] = useState<string | null>(null);
  const toastTimer = useRef<number>();

  const showToast = useCallback((text: string, error = false) => {
    setToast({ text, error });
    window.clearTimeout(toastTimer.current);
    toastTimer.current = window.setTimeout(() => setToast(null), 2600);
  }, []);

  const login = useCallback(async () => {
    setLoginError(null);
    try {
      const [res] = await Promise.all([api.login(), wait(MIN_LOADING_MS)]);
      setGame(res);
      setServerOffset(new Date(res.server_time).getTime() - Date.now());
      setSeasonResult(res.season_result);
      const hasNews = res.summary?.items.some((i) => i.sold > 0 || i.produced > 0);
      if (hasNews) setSummary(res.summary);
    } catch (e) {
      setLoginError((e as Error).message);
    }
  }, []);

  useEffect(() => {
    login();
  }, [login]);

  // Пока игра открыта, раз в минуту подтягиваем свежие продажи.
  useEffect(() => {
    if (!game) return;
    const id = window.setInterval(() => {
      if (document.visibilityState === 'visible') api.state().then(setGame).catch(() => {});
    }, POLL_MS);
    return () => window.clearInterval(id);
  }, [game !== null]); // eslint-disable-line react-hooks/exhaustive-deps

  /** Выполнить действие на сервере и показать новое состояние. */
  const run = useCallback(
    async <R,>(fn: () => Promise<GameState & { result: R }>, success?: (r: R) => string) => {
      if (busy) return false;
      setBusy(true);
      try {
        const res = await fn();
        setGame(res);
        notify('success');
        if (success) showToast(success(res.result));
        return true;
      } catch (e) {
        notify('error');
        showToast((e as Error).message, true);
        return false;
      } finally {
        setBusy(false);
      }
    },
    [busy, showToast],
  );

  const tutorialStep = game?.player.tutorial_step ?? 3;
  const advanceTutorial = useCallback(
    (step: number) => {
      api.tutorial(step).then(setGame).catch(() => {});
      if (step === 3) showToast('Обучение пройдено! Дальше — сам.');
    },
    [showToast],
  );

  // Шаг 1 → 2: кофейня открыта (в том числе если была открыта раньше).
  const ownsCoffee = game?.businesses.some((b) => b.type === 'coffee') ?? false;
  useEffect(() => {
    if (game?.company && tutorialStep === 0 && ownsCoffee) advanceTutorial(1);
  }, [game?.company, tutorialStep, ownsCoffee, advanceTutorial]);

  const createCompany = async (company: CompanyInput) => {
    setBusy(true);
    setFormError(null);
    try {
      setGame(await api.createCompany(company));
      notify('success');
    } catch (e) {
      notify('error');
      setFormError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  if (loginError) {
    return (
      <LoadingScreen>
        <section className="card">
          <h2>Не получилось войти</h2>
          <p className="hint">{loginError}</p>
          <button className="button" onClick={login}>
            Попробовать снова
          </button>
        </section>
      </LoadingScreen>
    );
  }

  if (!game) return <LoadingScreen />;

  // null — компании ещё нет; undefined — сервер ещё не обновлён (тогда играем как раньше).
  if (game.company === null) {
    return <CompanyForm busy={busy} error={formError} onSubmit={createCompany} />;
  }

  const pending = game.businesses.reduce((s, b) => s + b.pending_revenue, 0);
  const owned = new Set(game.businesses.map((b) => b.type));
  const seasonLeft = game.season
    ? new Date(game.season.ends_at).getTime() - (Date.now() + serverOffset)
    : 0;

  return (
    <main className="screen">
      <header className="topbar">
        <span className="wordmark">CAPITAL</span>
      </header>

      {tab === 'market' && <MarketTab game={game} />}
      {tab === 'rating' && <Leaderboard season={game.season} serverOffset={serverOffset} />}
      {tab === 'profile' && <ProfileTab game={game} />}

      {tab === 'empire' && (
      <>
      <section className="card capital">
        <div className="capital-row">
          <div>
            <div className="stat-label">Деньги</div>
            <div className="capital-value">{money(game.player.cash)}</div>
          </div>
          <div className="right">
            <div className="stat-label">В кассах</div>
            <div className="pending-value">{money(pending)}</div>
          </div>
        </div>
        <button
          className="button"
          data-tour="collect"
          disabled={pending === 0 || busy}
          onClick={async () => {
            if (await run(api.collect, (sum) => `+${money(sum)} в капитал`)) {
              if (tutorialStep === 2) advanceTutorial(3);
            }
          }}
        >
          {pending > 0 ? `Забрать выручку ${money(pending)}` : 'Касса пуста'}
        </button>
        <TickTimer serverTime={game.server_time} />
        <div className="season-line" onClick={() => setTab('rating')}>
          <span>Капитал: <b>{money(game.capital)}</b></span>
          {game.season && (
            <span>
              Сезон {game.season.number} · {seasonLeft > 0 ? `ещё ${duration(seasonLeft)}` : 'итоги'} ›
            </span>
          )}
        </div>
      </section>

      {game.effects.length > 0 && (
        <div className="effects">
          {game.effects.map((e, i) => (
            <span key={i} className={`effect ${e.mult < 1 && e.kind === 'demand' ? 'bad' : ''}`}>
              {e.label} · {duration(new Date(e.until).getTime() - (Date.now() + serverOffset))}
            </span>
          ))}
        </div>
      )}

      {game.decision && (
        <DecisionCard
          decision={game.decision}
          busy={busy}
          onChoose={(option) => run(() => api.decide(option), (text) => text)}
        />
      )}

      {game.catalog.map((item) => (
        <BusinessCard
          key={item.type}
          item={item}
          business={game.businesses.find((b) => b.type === item.type)}
          market={game.markets.find((m) => m.market === item.market)}
          cash={game.player.cash}
          hasBakery={owned.has('bakery')}
          hasShop={owned.has('shop')}
          busy={busy}
          onOpen={() => setSheet({ kind: 'open', type: item.type })}
          onAction={(kind) => setSheet({ kind, type: item.type } as SheetKind)}
        />
      ))}
      </>
      )}

      {sheet && (
        <ActionSheet
          sheet={sheet}
          game={game}
          busy={busy}
          onClose={() => setSheet(null)}
          onOpenBusiness={async (type: BusinessType) => {
            const name = game.catalog.find((c) => c.type === type)?.name;
            if (await run(() => api.openBusiness(type), () => `${name} открыта!`)) setSheet(null);
          }}
          onRestock={async (type, qty) => {
            if (await run(() => api.restock(type, qty), () => 'Склад пополнен')) setSheet(null);
          }}
          onTransfer={async (qty) => {
            if (await run(() => api.transferBread(qty), () => 'Хлеб доставлен в магазин')) setSheet(null);
          }}
          onSetPrice={async (type, price) => {
            if (await run(() => api.setPrice(type, price), () => 'Цена изменена')) {
              setSheet(null);
              if (tutorialStep === 1 && type === 'coffee') advanceTutorial(2);
            }
          }}
        />
      )}

      {summary && (
        <AwaySummary
          summary={summary}
          catalog={game.catalog}
          pending={pending}
          busy={busy}
          onCollect={async () => {
            if (await run(api.collect, (sum) => `+${money(sum)} в капитал`)) setSummary(null);
          }}
          onClose={() => setSummary(null)}
        />
      )}

      {seasonResult && !summary && (
        <SeasonResultModal result={seasonResult} onClose={() => setSeasonResult(null)} />
      )}

      {tab === 'empire' && tutorialStep < 3 && !sheet && !summary && !seasonResult && (
        <Tutorial
          step={tutorialSteps(game, pending)[tutorialStep]}
          index={tutorialStep}
          total={3}
          onSkip={() => advanceTutorial(3)}
        />
      )}

      {toast && (
        <div className={`toast ${toast.error ? 'toast-error' : ''}`} role="status">
          {toast.error ? <CircleAlert size={20} /> : <CircleCheck size={20} />}
          {toast.text}
        </div>
      )}

      <BottomNav tab={tab} onChange={setTab} />
    </main>
  );
}

function tutorialSteps(game: GameState, pending: number): TutorialStep[] {
  const coffee = game.businesses.find((b) => b.type === 'coffee');
  const third: TutorialStep =
    pending > 0
      ? {
          target: 'collect',
          title: 'Забери первую выручку',
          text: 'В кассе уже есть деньги. Нажми, чтобы перевести их в капитал.',
        }
      : coffee && coffee.stock === 0
        ? {
            target: 'restock-coffee',
            title: 'Закупи кофе',
            text: 'Без товара продаж не будет. Пополни склад — и покупатели потянутся.',
          }
        : {
            target: 'collect',
            title: 'Дождись первой продажи',
            text: 'Покупатели приходят каждые 5 минут. Когда в кассе появится выручка, забери её здесь.',
          };
  return [
    {
      target: 'open-coffee',
      title: 'Открой первую кофейню',
      text: 'Кофейня — самый быстрый бизнес для старта: дешёвый вход и хорошая наценка.',
    },
    {
      target: 'price-coffee',
      title: 'Поставь цену',
      text: 'Дешевле рынка — больше покупателей, дороже — больше прибыли с каждой чашки.',
    },
    third,
  ];
}

function wait(ms: number) {
  return new Promise((resolve) => window.setTimeout(resolve, ms));
}

function NotInTelegram() {
  return (
    <LoadingScreen>
      <section className="card">
        <h2>Открой игру в Telegram</h2>
        <p className="hint" style={{ margin: 0 }}>
          CAPITAL работает только внутри Telegram: так мы узнаём, кто ты, без паролей. Открой бота
          и нажми кнопку «Играть».
        </p>
      </section>
    </LoadingScreen>
  );
}
