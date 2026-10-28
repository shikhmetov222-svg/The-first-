import { useState, type ReactNode } from 'react';
import { capOf } from '../market';
import { LevelTag } from './Repair';
import { Bot, Info, Megaphone, Rocket, ShoppingCart, Upload } from 'lucide-react';
import type { AdsConfig, Business, BusinessType, CatalogItem, GameState } from '../api';
import { ADVERTISABLE } from '../content';
import { count, duration, money } from '../format';
import { BizIcon } from './BizIcon';

/** Активные кампании бизнеса (с учётом сдвига часов сервера). */
export function activeAds(business: Business, serverOffset: number): number[] {
  const now = Date.now() + serverOffset;
  return (business.ads ?? []).map((u) => new Date(u).getTime() - now).filter((ms) => ms > 0);
}

/**
 * Полоска рекламы на карточке бизнеса: мегафон и таймер, если реклама идёт,
 * иначе — кнопка «Реклама +25%».
 */
export function AdStrip({
  business, ads, serverOffset, busy, onOpen,
}: {
  business: Business;
  ads: AdsConfig | undefined;
  serverOffset: number;
  busy: boolean;
  onOpen: () => void;
}) {
  if (!ads || !ADVERTISABLE.includes(business.type)) return null;
  const left = activeAds(business, serverOffset);
  const boost = Math.round(ads.boost * 100);
  if (left.length === 0) {
    return (
      <button className="ad-strip ad-off" disabled={busy || business.listed} onClick={onOpen}>
        <Megaphone size={15} /> Запустить рекламу · +{boost}% спроса
      </button>
    );
  }
  return (
    <button className="ad-strip ad-on" disabled={busy || business.listed} onClick={onOpen}>
      <Megaphone size={15} />
      <span>
        Реклама{left.length > 1 ? ` ×${left.length}` : ''} · +{boost * left.length}% спроса
      </span>
      <span className="ad-timer">ещё {duration(Math.max(...left))}</span>
    </button>
  );
}

/** Карточка рекламного агентства: готовые кампании, прогресс следующей, кнопки. */
export function AgencyCard({
  item, business, ads, busy, onLaunch, onSell, extra,
}: {
  extra?: ReactNode;
  item: CatalogItem;
  business: Business;
  ads: AdsConfig | undefined;
  busy: boolean;
  onLaunch: () => void;
  onSell: () => void;
}) {
  const cap = capOf(item, business);
  const full = business.stock >= cap;
  const progress = Math.min(1, business.progress ?? 0);
  const per = ads?.minutes_per_campaign ?? 30;
  const minutesLeft = Math.max(1, Math.ceil((1 - progress) * per));
  const pct = Math.min(100, (business.stock / cap) * 100);

  return (
    <section className="card biz">
      <div className="biz-head">
        <BizIcon type="agency" />
        <div className="grow">
          <h3>
            {item.name} <LevelTag business={business} />
          </h3>
          <div className="stat-label">1 кампания за {Math.round(per / (1 + 0.1 * ((business.level ?? 1) - 1)))} мин</div>
        </div>
        <div className="right">
          <div className="stat-label small">готово</div>
          <div className="kassa">{count(business.stock)} шт.</div>
        </div>
      </div>
      {extra}
      <div className="biz-columns">
        <div className="meter">
          <div className="bar-text">
            <span>Склад кампаний</span>
            <span>
              {count(business.stock)}/{count(cap)}
            </span>
          </div>
          <div className="bar-track">
            <div className="bar-fill" style={{ width: `${pct}%` }} />
          </div>
        </div>
        <div className="meter">
          <div className="bar-text">
            <span>Следующая</span>
            <span className={full ? 'warn' : ''}>{business.listed ? 'пауза' : full ? 'склад полон' : `≈ ${minutesLeft} мин`}</span>
          </div>
          <div className="bar-track">
            <div className="bar-fill" style={{ width: `${full ? 0 : progress * 100}%` }} />
          </div>
        </div>
      </div>
      {full && !business.listed && (
        <p className="hint small" style={{ margin: 0 }}>
          Склад полон — агентство ждёт. Запусти рекламу или продай кампании на рынке.
        </p>
      )}
      <div className="actions">
        <button className="button light small" disabled={busy || business.listed || business.stock < 1} onClick={onLaunch}>
          <Rocket size={16} /> Запустить
        </button>
        <button className="button small secondary" disabled={busy || business.listed || business.stock < 1} onClick={onSell}>
          <Upload size={16} /> На рынок
        </button>
      </div>
    </section>
  );
}

/**
 * Запуск рекламы: выбрать бизнес и откуда взять кампанию —
 * своё агентство (бесплатно), NPC-агентство или рынок игроков.
 */
export function CampaignSheet({
  game, ads, preset, serverOffset, busy, onOwn, onNpc, onMarket, onClose,
}: {
  game: GameState;
  ads: AdsConfig;
  preset?: BusinessType;
  serverOffset: number;
  busy: boolean;
  onOwn: (type: BusinessType) => void;
  onNpc: (type: BusinessType, npc?: number) => void;
  onMarket: () => void;
  onClose: () => void;
}) {
  const targets = game.businesses.filter((b) => ADVERTISABLE.includes(b.type) && !b.listed);
  const [type, setType] = useState<BusinessType | undefined>(
    targets.find((b) => b.type === preset)?.type ?? targets[0]?.type,
  );
  const target = targets.find((b) => b.type === type);
  const running = target ? activeAds(target, serverOffset).length : 0;
  const slots = ads.max - running;
  const agency = game.businesses.find((b) => b.type === 'agency');
  const own = agency && !agency.listed ? agency.stock : 0;
  const hours = ads.minutes % 60 === 0 ? `${ads.minutes / 60} ч` : `${ads.minutes} мин`;

  return (
    <div className="backdrop" onClick={onClose}>
      <div className="sheet" onClick={(e) => e.stopPropagation()}>
        <div className="sheet-handle" />
        <h2>
          <Megaphone size={22} /> Реклама
        </h2>
        <p className="hint small" style={{ margin: 0 }}>
          <Info size={13} /> +{Math.round(ads.boost * 100)}% спроса на {hours}. На один бизнес — не больше {ads.max}{' '}
          кампаний сразу.
        </p>
        {targets.length === 0 ? (
          <p className="warning">Рекламировать нечего: открой кофейню, магазин, маркетплейс или ПВЗ.</p>
        ) : (
          <>
            <div className="dev-row">
              {targets.map((b) => {
                const n = activeAds(b, serverOffset).length;
                return (
                  <button
                    key={b.type}
                    className={`chip ${b.type === type ? 'chip-active' : ''}`}
                    onClick={() => setType(b.type)}
                  >
                    {game.catalog.find((c) => c.type === b.type)?.name} · {n}/{ads.max}
                  </button>
                );
              })}
            </div>
            {slots <= 0 ? (
              <p className="warning">На этом бизнесе уже {ads.max} кампании — дождись, пока одна закончится.</p>
            ) : (
              <div className="ad-options">
                {agency && (
                  <button className="ad-option" disabled={busy || own < 1 || !type} onClick={() => type && onOwn(type)}>
                    <BizIcon type="agency" size={18} />
                    <span className="grow">
                      <b>Своё агентство</b>
                      <span className="stat-label">готово {count(own)} шт.</span>
                    </span>
                    <b className="up">бесплатно</b>
                  </button>
                )}
                {(ads.npc ?? [{ id: undefined as number | undefined, name: ads.npc_name, price: ads.npc_price }]).map((n) => (
                  <button
                    key={n.name}
                    className="ad-option"
                    disabled={busy || game.player.cash < n.price || !type}
                    onClick={() => type && onNpc(type, n.id)}
                  >
                    <span className="logo-fallback bot-logo">
                      <Bot size={18} />
                    </span>
                    <span className="grow">
                      <b>«{n.name}»</b>
                      <span className="stat-label">
                        {n.name === ads.npc_name ? 'NPC-агентство, всегда есть' : 'NPC-агентство, пока в городе мало игроков'}
                      </span>
                    </span>
                    <b>{money(n.price)}</b>
                  </button>
                ))}
                <button className="ad-option" disabled={busy} onClick={onMarket}>
                  <span className="logo-fallback">
                    <ShoppingCart size={18} />
                  </span>
                  <span className="grow">
                    <b>У игроков</b>
                    <span className="stat-label">обычно дешевле — смотри рынок</span>
                  </span>
                  <b>→</b>
                </button>
              </div>
            )}
          </>
        )}
        <button className="button ghost" onClick={onClose}>
          Отмена
        </button>
      </div>
    </div>
  );
}
