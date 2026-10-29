import { Suspense, lazy, useCallback, useEffect, useRef, useState } from 'react';
import { api, type BrigadeId, type Business, type BusinessType, type CatalogItem, type GameState, type LoginResult, type Product, type SeasonResult, type Source } from './api';
import { BusinessCard } from './components/BusinessCard';
import { ActionSheet, type SheetKind } from './components/ActionSheet';
import { AwaySummary } from './components/AwaySummary';
import { AppHeader } from './components/AppHeader';
import { CapitalCard } from './components/CapitalCard';
import { DecisionCard } from './components/DecisionCard';
import { Leaderboard } from './components/Leaderboard';
import { SeasonResultModal } from './components/SeasonResultModal';
import { BottomNav, type Tab } from './components/BottomNav';
import { LoadingScreen } from './components/LoadingScreen';
import { MarketTab } from './components/MarketTab';
import { ProfileTab } from './components/ProfileTab';
import { DevPanel } from './components/DevPanel';
import { NotificationsSheet } from './components/NotificationsSheet';
import { CatalogSheet } from './components/CatalogSheet';
import { MarketplaceCard, PvzCard } from './components/OnlineCards';
import { TransferSheet } from './components/TransferSheet';
import { MapTab } from './components/MapTab';
import { BuildsCard } from './components/Builds';
import { AdStrip, AgencyCard, CampaignSheet } from './components/Ads';
import { RepairCard, UpgradeSheet, UpgradeStrip } from './components/Repair';
import { streetLife, streetVan, streetViews } from './street/views';
import Street2D from './street/Street2D';
import { setGraphics, useGraphics, useSimpleStreet } from './graphics';
import { duration, money } from './format';
import { feel, isInTelegram, notify, setHapticsEnabled, type Feel } from './telegram';
import { CircleAlert, CircleCheck, Plus } from 'lucide-react';
import { CompanyForm } from './components/CompanyForm';
import { Tutorial, type TutorialStep } from './components/Tutorial';
import type { CompanyInput } from './api';

// 3D-улица грузится отдельным файлом, уже после основного интерфейса.
const Street = lazy(() => import('./street/Street'));

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
  const tabRef = useRef(tab);
  tabRef.current = tab;
  const [serverOffset, setServerOffset] = useState(0);
  const [sheet, setSheet] = useState<SheetKind | null>(null);
  const [busy, setBusy] = useState(false);
  const [toast, setToast] = useState<{ text: string; error?: boolean } | null>(null);
  const [formError, setFormError] = useState<string | null>(null);
  const [editingCompany, setEditingCompany] = useState(false);
  const [showNotifs, setShowNotifs] = useState(false);
  const [catalogOpen, setCatalogOpen] = useState(false);
  const [transferring, setTransferring] = useState(false);
  const [buyToMarketplace, setBuyToMarketplace] = useState(false);

  const [sellPreset, setSellPreset] = useState<Source | null>(null);
  const clearSellPreset = useCallback(() => setSellPreset(null), []);
  const [productPreset, setProductPreset] = useState<Product | null>(null);
  const clearProductPreset = useCallback(() => setProductPreset(null), []);
  // Окно запуска рекламы: undefined — закрыто; null — без выбранного бизнеса.
  const [adFor, setAdFor] = useState<BusinessType | null | undefined>(undefined);
  const [upgradeFor, setUpgradeFor] = useState<BusinessType | null>(null);
  const graphics = useGraphics();
  // Карта строится при первом открытии вкладки и дальше живёт скрытой, чтобы не строить город заново.
  const [mapOpened, setMapOpened] = useState(false);
  // «Следить за стройкой» из «Империи»: открыть карту и наехать на участок.
  const [mapFocus, setMapFocus] = useState<{ i: number; j: number; k: number; n: number } | null>(null);
  useEffect(() => {
    if (tab === 'map') setMapOpened(true);
  }, [tab]);
  const simpleStreet = useSimpleStreet();

  // Настройка вибрации хранится на сервере.
  const hapticsSetting = game?.player.haptics;
  useEffect(() => {
    if (hapticsSetting !== undefined) setHapticsEnabled(hapticsSetting);
  }, [hapticsSetting]);
  const toastTimer = useRef<number>();

  const showToast = useCallback((text: string, error = false) => {
    setToast({ text, error });
    window.clearTimeout(toastTimer.current);
    toastTimer.current = window.setTimeout(() => setToast(null), 2600);
  }, []);

  // Новые уведомления (например, «Твой лот продан») — всплывающим сообщением и вибрацией.
  const lastNotif = useRef<number | null>(null);
  const newestNotif = game?.notifications?.[0];
  useEffect(() => {
    if (!newestNotif) return;
    if (lastNotif.current !== null && newestNotif.id > lastNotif.current && !newestNotif.read) {
      // Конец стройки на открытой карте показывает сама карта (конфетти и тост «Готово»).
      if (!(tabRef.current === 'map' && newestNotif.text.startsWith('Стройка завершена'))) {
        showToast(newestNotif.text);
        feel('collect');
      }
    }
    lastNotif.current = Math.max(lastNotif.current ?? 0, newestNotif.id);
  }, [newestNotif, showToast]);

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

  // Стройка подошла к концу — обновляем состояние сразу, не дожидаясь минутного опроса.
  const nextBuildEnd = game?.builds?.reduce((m, b) => Math.min(m, new Date(b.ends_at).getTime()), Infinity) ?? Infinity;
  useEffect(() => {
    if (!Number.isFinite(nextBuildEnd)) return;
    const wait = Math.max(1000, nextBuildEnd - (Date.now() + serverOffset) + 1500);
    if (wait > 2 ** 31 - 1) return;
    const id = window.setTimeout(() => api.state().then(setGame).catch(() => {}), wait);
    return () => window.clearTimeout(id);
  }, [nextBuildEnd, serverOffset]);

  /** Выполнить действие на сервере и показать новое состояние. */
  const run = useCallback(
    async <R,>(
      fn: () => Promise<GameState & { result: R }>,
      success?: (r: R) => string,
      kind: Feel | ((res: GameState) => Feel) = 'default',
    ) => {
      if (busy) return false;
      setBusy(true);
      try {
        const res = await fn();
        setGame(res);
        feel(typeof kind === 'function' ? kind(res) : kind);
        const text = success?.(res.result);
        if (text) showToast(text);
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

  const updateCompany = async (company: CompanyInput) => {
    setBusy(true);
    setFormError(null);
    try {
      setGame(await api.updateCompany(company));
      notify('success');
      setEditingCompany(false);
      showToast('Компания обновлена');
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

  if (editingCompany && game.company) {
    return (
      <CompanyForm
        initial={game.company}
        busy={busy}
        error={formError}
        onSubmit={updateCompany}
        onCancel={() => {
          setFormError(null);
          setEditingCompany(false);
        }}
      />
    );
  }

  const pending = game.businesses.reduce((s, b) => s + b.pending_revenue, 0);
  const isAdmin = game.is_admin === true;
  const owned = new Set(game.businesses.map((b) => b.type));
  const bizNames = Object.fromEntries(game.catalog.map((c) => [c.type, c.name]));

  /** Тап по зданию на улице: своё → прокрутить к карточке и подсветить её, участок → открыть бизнес. */
  const selectOnStreet = (type: BusinessType, has: boolean) => {
    if (has) {
      const el = document.getElementById(`biz-${type}`);
      if (!el) return;
      el.scrollIntoView({ behavior: 'smooth', block: 'center' });
      el.classList.remove('biz-flash');
      void el.offsetWidth;
      el.classList.add('biz-flash');
    } else if (game.catalog.some((c) => c.type === type)) {
      setSheet({ kind: 'open', type });
    } else {
      setCatalogOpen(true);
    }
  };

  /** 3D тормозит на этом телефоне (FPS ниже 25 дольше 5 секунд) — переходим на простую графику. */
  const onSlowStreet = () => {
    setGraphics('2d');
    showToast('Включили простую графику: 3D на этом телефоне тормозит. Вернуть можно в профиле');
  };

  const collect = async () => {
    if (await run(api.collect, (sum) => `+${money(sum)} в капитал`, 'collect')) {
      if (tutorialStep === 2) advanceTutorial(3);
    }
  };

  /** Карточка бизнеса на «Империи». */
  const renderCard = (item: CatalogItem) => {
    const business = game.businesses.find((b) => b.type === item.type);
    const adStrip = (b: Business) => (
      <>
        <AdStrip business={b} ads={game.ads} serverOffset={serverOffset} busy={busy} onOpen={() => setAdFor(b.type)} />
        <UpgradeStrip
          business={b}
          game={game}
          serverOffset={serverOffset}
          busy={busy}
          onOpen={() => setUpgradeFor(b.type)}
        />
      </>
    );
    if (business && item.type === 'repair') {
      return (
        <RepairCard
          key={item.type}
          item={item}
          business={business}
          game={game}
          serverOffset={serverOffset}
          busy={busy}
          onSetPrice={(pct) => run(() => api.setRepairPrice(pct), (r) => r)}
        />
      );
    }
    if (business && item.type === 'agency') {
      return (
        <AgencyCard
          key={item.type}
          item={item}
          business={business}
          ads={game.ads}
          busy={busy}
          extra={adStrip(business)}
          onLaunch={() => setAdFor(null)}
          onSell={() => {
            setSellPreset('agency');
            setTab('market');
          }}
        />
      );
    }
    if (business && item.type === 'marketplace') {
      return (
        <MarketplaceCard
          key={item.type}
          item={item}
          business={business}
          extra={adStrip(business)}
          rivals={game.npc_niches?.marketplace}
          busy={busy}
          onTransfer={() => setTransferring(true)}
          onBuyOnMarket={() => {
            setBuyToMarketplace(true);
            setTab('market');
          }}
        />
      );
    }
    if (business && item.type === 'pvz') {
      return (
        <PvzCard key={item.type} item={item} business={business} extra={adStrip(business)} rivals={game.npc_niches?.pvz} />
      );
    }
    return (
      <BusinessCard
        key={item.type}
        item={item}
        business={business}
        market={game.markets.find((m) => m.market === item.market)}
        cash={game.player.cash}
        hasBakery={owned.has('bakery')}
        hasShop={owned.has('shop')}
        extra={business ? adStrip(business) : undefined}
        busy={busy}
        onOpen={() => setSheet({ kind: 'open', type: item.type })}
        onAction={(kind) => {
          if (kind === 'sell') {
            setSellPreset(item.type as Source);
            setTab('market');
            return;
          }
          setSheet({ kind, type: item.type } as SheetKind);
        }}
      />
    );
  };

  return (
    <main className="screen">
      <AppHeader
        game={game}
        serverOffset={serverOffset}
        onBell={
          game.notifications
            ? () => {
                setShowNotifs(true);
                if (game.unread) api.notificationsRead().then(setGame).catch(() => {});
              }
            : undefined
        }
      />

      {tab === 'market' && (
        <MarketTab
          game={game}
          onState={setGame}
          onToast={showToast}
          sellPreset={sellPreset}
          onSellPresetUsed={clearSellPreset}
          buyToMarketplace={buyToMarketplace}
          onBuyToMarketplaceOff={() => setBuyToMarketplace(false)}
          productPreset={productPreset}
          onProductPresetUsed={clearProductPreset}
        />
      )}
      {tab === 'dev' && isAdmin && <DevPanel game={game} onState={setGame} onToast={showToast} />}
      {mapOpened && (
        <div hidden={tab !== 'map'}>
          <MapTab
            game={game}
            active={tab === 'map'}
            isAdmin={isAdmin}
            focus={mapFocus}
            onToast={showToast}
            serverOffset={serverOffset}
            onSlow={graphics === 'auto' ? onSlowStreet : undefined}
            onBuy={(type, plot, brigade) =>
              run(
                () => api.openBusiness(type, plot, brigade),
                (r) => r || `Открыт новый бизнес: ${bizNames[type] ?? type}`,
                'purchase',
              )
            }
            onUpgrade={(type) => setUpgradeFor(type)}
            onOpenCard={(type) => {
              setTab('empire');
              window.setTimeout(() => selectOnStreet(type, true), 80);
            }}
          />
        </div>
      )}
      {tab === 'rating' && <Leaderboard season={game.season} serverOffset={serverOffset} game={game} />}
      {tab === 'profile' && (
        <ProfileTab game={game} onEditCompany={() => setEditingCompany(true)} onToast={showToast} />
      )}

      {/* Улица живёт, пока открыта игра: на других вкладках она скрыта и не рисуется, но и не строится заново. */}
      <div hidden={tab !== 'empire'}>
        {simpleStreet ? (
          <Street2D views={streetViews(game)} life={streetLife(game)} names={bizNames} onSelect={selectOnStreet} />
        ) : (
          <Suspense fallback={<StreetPlaceholder />}>
            <Street
              views={streetViews(game)}
              life={streetLife(game)}
              showFps={isAdmin}
              active={tab === 'empire'}
              onSlow={graphics === 'auto' ? onSlowStreet : undefined}
              low={graphics === 'low'}
              onSelect={selectOnStreet}
            />
          </Suspense>
        )}
      </div>

      {tab === 'empire' && (
      <>
      <CapitalCard game={game} serverOffset={serverOffset} pending={pending} busy={busy} onCollect={collect} />

      <BuildsCard
        game={game}
        serverOffset={serverOffset}
        onShow={(b) => {
          if (b.i === null || b.j === null || b.k === null) return;
          setMapFocus({ i: b.i, j: b.j, k: b.k, n: Date.now() });
          setTab('map');
        }}
      />

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
          onChoose={(option) =>
            run(
              () => api.decide(option),
              (text) => text,
              (res) => (res.decision?.success === false ? 'decision-bad' : 'decision'),
            )
          }
        />
      )}

      <h2 className="section-title">
        <span>Мои бизнесы</span>
        <span className="stat-label">
          {game.businesses.length} из {game.catalog.length}
        </span>
      </h2>

      {game.catalog
        .filter((item) => owned.has(item.type) || (game.businesses.length === 0 && (item.category ?? 'classic') === 'classic'))
        .map((item) => {
          const card = renderCard(item);
          return (
            <div key={item.type} id={`biz-${item.type}`} className="biz-anchor">
              {card}
            </div>
          );
        })}

      <button className="button secondary" onClick={() => setCatalogOpen(true)}>
        <Plus size={18} /> Открыть новый бизнес
      </button>
      </>
      )}

      {sheet && (
        <ActionSheet
          sheet={sheet}
          game={game}
          busy={busy}
          onClose={() => setSheet(null)}
          onOpenBusiness={async (type: BusinessType, brigade?: BrigadeId) => {
            const name = game.catalog.find((c) => c.type === type)?.name;
            // Сервер отвечает текстом («Стройка началась…»); старый сервер — ничем.
            if (await run(() => api.openBusiness(type, undefined, brigade), (r) => r || `Бизнес «${name}» открыт!`, 'purchase')) setSheet(null);
          }}
          onRestock={async (type, qty) => {
            if (await run(() => api.restock(type, qty), () => 'Склад пополнен', 'purchase')) {
              setSheet(null);
              streetVan(type as Parameters<typeof streetVan>[0]);
            }
          }}
          onTransfer={async (qty) => {
            if (await run(() => api.transferBread(qty), () => 'Хлеб доставлен в магазин', 'purchase')) {
              setSheet(null);
              streetVan('shop');
            }
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
            if (await run(api.collect, (sum) => `+${money(sum)} в капитал`, 'collect')) setSummary(null);
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

      {catalogOpen && (
        <CatalogSheet
          game={game}
          onClose={() => setCatalogOpen(false)}
          onPick={(type) => {
            setCatalogOpen(false);
            setSheet({ kind: 'open', type });
          }}
        />
      )}

      {transferring && (
        <TransferSheet
          game={game}
          busy={busy}
          onClose={() => setTransferring(false)}
          onTransfer={async (p) => {
            if (await run(() => api.marketplaceTransfer(p), (r) => r, 'purchase')) {
              setTransferring(false);
              streetVan('marketplace');
            }
          }}
        />
      )}

      {adFor !== undefined && game.ads && (
        <CampaignSheet
          game={game}
          ads={game.ads}
          preset={adFor ?? undefined}
          serverOffset={serverOffset}
          busy={busy}
          onClose={() => setAdFor(undefined)}
          onOwn={async (type) => {
            if (await run(() => api.applyCampaign(type), (r) => r, 'purchase')) setAdFor(undefined);
          }}
          onNpc={async (type, npc) => {
            if (await run(() => api.buyNpcCampaign(type, npc), (r) => r, 'purchase')) setAdFor(undefined);
          }}
          onMarket={() => {
            setAdFor(undefined);
            setProductPreset('campaign');
            setTab('market');
          }}
        />
      )}

      {upgradeFor && (
        <UpgradeSheet
          game={game}
          type={upgradeFor}
          busy={busy}
          onClose={() => setUpgradeFor(null)}
          onOrder={async (contractor) => {
            if (await run(() => api.orderUpgrade(upgradeFor, contractor), (r) => r, 'purchase')) setUpgradeFor(null);
          }}
        />
      )}

      {showNotifs && <NotificationsSheet game={game} onClose={() => setShowNotifs(false)} />}

      {toast && (
        <div className={`toast ${toast.error ? 'toast-error' : ''}`} role="status">
          {toast.error ? <CircleAlert size={20} /> : <CircleCheck size={20} />}
          {toast.text}
        </div>
      )}

      <BottomNav tab={tab} onChange={setTab} dev={isAdmin} />
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

/** 2D-заглушка, пока грузится 3D-улица. */
function StreetPlaceholder() {
  return (
    <div className="street-stage street-placeholder">
      <span>Строим улицу…</span>
    </div>
  );
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
