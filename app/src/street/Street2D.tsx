// Простая графика улицы: заранее отрендеренные картинки зданий (scripts/render-street2d.mjs) вместо 3D.
// Для телефонов без WebGL или слишком медленных для 3D. Показывает те же данные: уровни, район, погоду, щит,
// монетки с выручки и фургон после пополнения склада. Без three.js — грузится сразу.
import { useEffect, useRef, useState, useSyncExternalStore } from 'react';
import meta from './street2d.json';
import {
  SLOT_TYPES,
  isDaytime,
  streetBus,
  streetDev,
  withDev,
  type GameType,
  type StreetLife,
  type StreetViews,
} from './views';
import { money } from '../format';

const SPRITES = meta as Record<string, { ground: number; x: number; w: number; h: number }>;
const BASE = `${import.meta.env.BASE_URL}street2d/`;
const SLOT_W = 6 * 64; // расстояние между участками на улице (6 единиц мира) в пикселях картинок
const TALLEST = Math.max(...Object.values(SPRITES).map((s) => s.h * s.ground));
const VAN_LABEL: Partial<Record<GameType, string>> = {
  pvz: 'Посылки привезли',
  marketplace: 'Товар на склад',
  agency: 'Привезли баннеры',
  repair: 'Стройматериалы',
};

interface Float {
  id: number;
  slot: number;
  text: string;
  kind: 'coin' | 'van';
}

export default function Street2D({
  views,
  life,
  onSelect,
  readOnly = false,
  names,
}: {
  views: StreetViews;
  life: StreetLife;
  onSelect: (type: GameType, owned: boolean) => void;
  readOnly?: boolean;
  /** Названия бизнесов для подписей и озвучки. */
  names: Partial<Record<GameType, string>>;
}) {
  const dev = useSyncExternalStore(streetDev.subscribe, streetDev.get);
  const data = readOnly ? { views, life } : withDev(views, life, dev);
  const [clockDay, setClockDay] = useState(isDaytime);
  const day = readOnly ? clockDay : (dev.day ?? clockDay);
  const box = useRef<HTMLDivElement>(null);
  const [scale, setScale] = useState(0.4);
  const [floats, setFloats] = useState<Float[]>([]);
  const nextId = useRef(1);

  useEffect(() => {
    const id = window.setInterval(() => setClockDay(isDaytime()), 60_000);
    return () => window.clearInterval(id);
  }, []);

  // Масштаб — чтобы самое высокое здание помещалось по высоте улицы.
  useEffect(() => {
    const el = box.current;
    if (!el) return;
    const ro = new ResizeObserver(() => {
      // На экране — около двух с половиной участков, как в 3D; высокие здания не вылезают за верх.
      setScale(Math.max(0.2, Math.min(el.clientWidth / 2.6 / SLOT_W, (el.clientHeight - 86) / TALLEST)));
    });
    ro.observe(el);
    // Сначала показываем центр улицы, как в 3D (магазин посередине).
    el.scrollLeft = (el.scrollWidth - el.clientWidth) / 2;
    return () => ro.disconnect();
  }, []);

  const float = (slot: number, text: string, kind: Float['kind']) => {
    const id = nextId.current++;
    setFloats((f) => [...f, { id, slot, text, kind }]);
    window.setTimeout(() => setFloats((f) => f.filter((x) => x.id !== id)), kind === 'coin' ? 1600 : 2400);
  };

  // Монетки: у бизнеса появилась новая выручка на тике (первый показ — без монеток).
  const lastSale = useRef<Partial<Record<GameType, string | null>> | null>(null);
  const salesKey = JSON.stringify(data.life.sales);
  useEffect(() => {
    const prev = lastSale.current;
    const now: Partial<Record<GameType, string | null>> = {};
    SLOT_TYPES.forEach((s, i) => {
      const sale = data.life.sales[s.game];
      now[s.game] = sale.at;
      if (prev && sale.at && sale.at !== prev[s.game] && sale.amount > 0 && data.views[s.game].level > 0)
        float(i, `+${money(sale.amount)}`, 'coin');
    });
    lastSale.current = now;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [salesKey]);

  // Фургон после пополнения склада и монетка из панели разработчика — подписью над зданием.
  const viewsRef = useRef(data.views);
  viewsRef.current = data.views;
  useEffect(() => {
    if (readOnly) return;
    const onVan = (e: Event) => {
      const type = (e as CustomEvent<GameType>).detail;
      const i = SLOT_TYPES.findIndex((s) => s.game === type);
      if (i >= 0 && viewsRef.current[type].level > 0) float(i, VAN_LABEL[type] ?? 'Склад пополнен', 'van');
    };
    const onCoin = (e: Event) => {
      const d = (e as CustomEvent<{ type: GameType; amount: number }>).detail;
      const i = SLOT_TYPES.findIndex((s) => s.game === d.type);
      if (i >= 0 && viewsRef.current[d.type].level > 0) float(i, `+${money(d.amount)}`, 'coin');
    };
    streetBus.addEventListener('van', onVan);
    streetBus.addEventListener('coin', onCoin);
    return () => {
      streetBus.removeEventListener('van', onVan);
      streetBus.removeEventListener('coin', onCoin);
    };
  }, [readOnly]);

  const slotW = SLOT_W * scale;
  const groundBottom = 70; // от низа улицы до линии фасадов, px
  const { district, weather, billboard } = data.life;

  return (
    <div
      className={`street-stage street2d ${day ? 'day' : 'night'} d${district} w-${weather}`}
      role="region"
      aria-label={readOnly ? 'Улица компании' : 'Твоя улица'}
    >
      <div className="street2d-scroll" ref={box}>
        <div className="street2d-lane" style={{ width: slotW * (SLOT_TYPES.length + 1) }}>
          <div className="street2d-grass" style={{ height: groundBottom + 150 * scale }} />
          <div className="street2d-houses" style={{ bottom: groundBottom + 150 * scale, height: 260 * scale }} />
          <div className="street2d-walk" style={{ height: groundBottom }} />
          <div className="street2d-road" />
          <div className="street2d-board" style={{ left: slotW * 0.08, borderColor: billboard.color }}>
            <b style={{ color: billboard.color }}>{billboard.lines[0]}</b>
            <span>{billboard.lines[1]}</span>
          </div>
          {SLOT_TYPES.map((s, i) => {
            const v = data.views[s.game];
            const key = v.level > 0 ? `${s.game}-${v.level}` : 'lot';
            const sp = SPRITES[key];
            if (!sp) return null;
            const w = sp.w * scale,
              h = sp.h * scale;
            const cx = slotW * (i + 1);
            const name = names[s.game] ?? '';
            const label = v.level > 0 ? `${name}, уровень ${v.level}` : `Участок под ${name.toLowerCase()} продаётся`;
            return (
              <button
                key={s.game}
                className="street2d-slot"
                style={{ left: cx - sp.x * w, bottom: groundBottom - (1 - sp.ground) * h, width: w, height: h }}
                aria-label={label}
                onClick={() => onSelect(s.game, v.level > 0)}
              >
                <img src={`${BASE}${key}.png`} alt="" width={w} height={h} draggable={false} />
              </button>
            );
          })}
          {SLOT_TYPES.map((s, i) => {
            const v = data.views[s.game];
            return (
              <span key={s.game} className="street2d-tag" style={{ left: slotW * (i + 1) }}>
                {v.level > 0 ? `Ур. ${v.level}` : readOnly ? 'Продаётся' : `Продаётся · ${v.lotPct}%`}
              </span>
            );
          })}
          {floats.map((f) => (
            <span
              key={f.id}
              className={`street2d-float ${f.kind}`}
              style={{ left: slotW * (f.slot + 1), bottom: groundBottom + 40 + 190 * scale }}
            >
              {f.text}
            </span>
          ))}
        </div>
      </div>
      {weather !== 'clear' && <div className={`street2d-weather ${weather}`} aria-hidden />}
    </div>
  );
}
