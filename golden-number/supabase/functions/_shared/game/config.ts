// Единый конфиг игры «Золотой номер».
// Этот файл используют и сервер (Edge Function), и клиент (только для подписей).
// Всё, что влияет на деньги, сервер считает сам — клиентские копии чисел ничего не решают.
//
// ПРЕФИКСЫ. Коды операторов взяты из национальных планов нумерации. Из-за переноса номеров
// (MNP) реальный оператор по коду не определяется — в игре это просто «выпавший» код.
// Если регулятор переназначит коды — правим только здесь.
//
// КУРСЫ ВАЛЮТ — игровые константы (сколько ₽ стоит 1 единица местной валюты), не биржевые.

// ======================= БАЛАНС =======================
// Все числа баланса — здесь. Проверка: в папке app `npm run sim` (отдача) и `node scripts/balance.ts` (30 дней).
// Сервер передаёт нужные константы в SQL-функции параметрами; две, что зашиты в SQL (касса), сверяет тест.

// --- Прокрутка ---
export const BASE_COST_RUB = 1000; // цена прокрутки при ставке ×1 и множителе страны ×1
export const BASE_VALUE_RUB = 380; // цена обычного номера при тех же условиях
export const STAKES = [1, 2, 5, 10] as const;
/** Ставка открывается на уровне. Отдача у всех ставок одинаковая; высокая даёт больше опыта. */
export const STAKE_LEVEL: Record<number, number> = { 1: 1, 2: 2, 5: 4, 10: 7 };
/** Множитель опыта за ставку (меньше самой ставки — опыт за рубль у ×1 выгоднее, но медленнее). */
export const STAKE_XP: Record<number, number> = { 1: 1, 2: 1.6, 5: 3, 10: 5 };
// Доля «узорных» номеров. 5,8% → обычная прокрутка ≈83% ставки; вместе с удачей (100-я ×10) ≈86%
// у обычного игрока и ≈92% у того, кто заходит в счастливые часы.
export const PATTERN_CHANCE = 0.058;
/** Шанс выпадения кода из одинаковых цифр (777, 999, 44…) — одинаковый во всех странах, иначе
 *  отдача зависела бы от того, сколько таких кодов у страны. */
export const BEAUTIFUL_CODE_CHANCE = 0.02;
export const SUB_LEN = 7; // длина абонентской части во всех странах игры

// --- Удача: узорные номера выпадают в N раз чаще, цены не меняются ---
/** Счастливые часы по Москве (час начала): 13:00–14:00 и 20:00–21:00. */
export const HAPPY_HOURS_MSK = [13, 20];
export const HAPPY_LUCK = 2;
/** Удача счастливого часа действует на первые N прокруток в каждом таком часе. */
export const HAPPY_SPINS = 10;
/** Каждая N-я прокрутка — удача ×LUCKY_LUCK (только она, следующая снова обычная). */
export const LUCKY_EVERY = 100;
export const LUCKY_LUCK = 10;
/** Защита от «99 раз по минимуму, потом ×10»: на прокрутке с удачей ставка не выше средней
 *  за последние ~100 прокруток (скользящее среднее с весом 1/100). */
export const AVG_BET_WEIGHT = 0.01;
export const AVG_BET_START_RUB = 1000;

// --- Начало игры ---
export const START_BALANCE_RUB = 10_000;
/** Гарантии первых прокруток: N-я прокрутка аккаунта не ниже указанного тира. */
export const ONBOARDING_GUARANTEE: Record<number, 'nice' | 'rare'> = { 2: 'nice', 6: 'rare' };

// --- Касса и витрина ---
export const KASSA_RATE_PER_HOUR = 0.01; // 1% цены номера в час (ЗАШИТО В SQL: gn_kassa_total)
export const KASSA_CAP_HOURS = 12; // копится максимум 12 часов — переживает ночь (ЗАШИТО В SQL)
export const SLOTS_START = 6; // мест на витрине у нового игрока
export const SLOTS_MAX = 24;
/** Цена следующего места витрины, ₽: 4 000, 5 800, 8 410… (×1,45 за каждое купленное). */
export const slotPriceRub = (extraBought: number) => Math.round(4000 * Math.pow(1.45, extraBought));
/** Продажа номера из коллекции — 70% цены (оставлять выгодно, если номер пролежит > 30 ч). */
export const SELL_BACK = 0.7;

// --- Ежедневный бонус, бесплатные прокрутки, помощь ---
export const DAILY_BASE_RUB = 1500; // +500 за каждый день подряд, максимум +3000 (на 7-й день)
export const DAILY_STEP_RUB = 500;
export const DAILY_MAX_STREAK = 6;
export const FREE_SPIN_EVERY_H = 4; // бесплатная прокрутка (ставка ×1) раз в 4 часа
export const FREE_SPIN_MAX = 2; // копится не больше двух
export const BAILOUT_RUB = 3_000; // помощь, если денег нет совсем и продавать нечего
export const BAILOUT_COOLDOWN_H = 24;

// --- Опыт и уровни ---
/** Опыта до следующего уровня: 80, 226, 416, 640, 894, … */
export const XP_BASE = 80;
export const XP_POW = 1.5;

// --- Друзья ---
export const BOT_USERNAME = 'simmmcardd_bot';
/** Ссылка-приглашение открывает игру сразу: t.me/<бот>?startapp=r<telegram id>. */
export const inviteLink = (telegramId: number) => `https://t.me/${BOT_USERNAME}?startapp=r${telegramId}`;
export const REF_NEW_SPINS = 10; // бесплатных прокруток приглашённому сразу
export const REF_AFTER_SPINS = 30; // друг засчитывается, когда сделает столько прокруток (защита от накрутки)
export const REF_REWARD_RUB = 5000; // пригласившему за каждого засчитанного друга
export const REF_REWARD_SPINS = 3;

// --- Что оставлять себе ---
/** Правило: невыбранный номер при следующей прокрутке уходит в коллекцию, если подходит, иначе продаётся. */
export type KeepRule =
  | { mode: 'tier'; tier: 'nice' | 'rare' | 'epic' | 'legend' }
  | { mode: 'price'; from: number; to: number | null } // копейки
  | { mode: 'none' };
export const KEEP_RULE_DEFAULT: KeepRule = { mode: 'tier', tier: 'rare' };

// --- Рынок между игроками ---
export const MARKET_FEE = 0.05; // комиссия с продажи — сгорает
export const MARKET_MIN_PRICE = 0.5; // цена лота: от 50% …
export const MARKET_MAX_PRICE = 5; // … до 500% оценки номера
export const MARKET_MAX_LOTS = 5; // одновременно выставлено у одного игрока
export const MARKET_MAX_BUYS_PER_SELLER = 3; // покупок у одного продавца за сутки (против перекачки денег)

export interface PrefixRule {
  code: string;
  /** Если задано — первые цифры номера, которые относятся к этому оператору (код делят несколько операторов).
   *  Цифры, не закреплённые ни за кем, остаются у выпавшего оператора. */
  first?: string;
}

export interface Operator {
  name: string; // только название текстом: без логотипов и фирменных цветов
  prefixes: PrefixRule[];
}

export interface Country {
  id: string;
  name: string;
  flag: string;
  code: string; // код страны
  cur: string; // обозначение валюты
  rate: number; // ₽ за 1 единицу валюты (игровой курс)
  mul: number; // множитель цен страны
  lvl: number; // уровень открытия
  /** Разбивка 7 цифр после первых трёх: разделитель или число цифр. */
  grp: (string | number)[];
  ops: Operator[];
}

const p = (...codes: string[]): PrefixRule[] => codes.map((code) => ({ code }));

export const COUNTRIES: Country[] = [
  {
    // Источник: реестр Российской системы и плана нумерации (Минцифры/Россвязь),
    // DEF-коды 9xx — https://opendata.digital.gov.ru/registry/numeric/downloads
    // МТС: 910–919, 980–989; Билайн: 903, 905, 906, 909, 960–968;
    // МегаФон: 920–939, 999; T2: 900–902, 904, 908, 950–953, 977, 991–996.
    id: 'ru', name: 'Россия', flag: '🇷🇺', code: '+7', cur: '₽', rate: 1, mul: 1, lvl: 1,
    grp: ['-', 2, '-', 2],
    ops: [
      { name: 'МТС', prefixes: p('910', '915', '916', '985') },
      { name: 'Билайн', prefixes: p('903', '905', '906', '909', '965') },
      { name: 'МегаФон', prefixes: p('920', '925', '926', '929', '999') },
      { name: 'T2', prefixes: p('900', '950', '951', '977') },
    ],
  },
  {
    // Источник: план нумерации Казахстана (зона 7, коды 7xx), ITU-T E.164 national numbering plan;
    // сводка — https://en.wikipedia.org/wiki/Telephone_numbers_in_Kazakhstan
    // Kcell/activ: 701, 702, 775, 778; Beeline: 705, 771, 776, 777;
    // Tele2 и Altel (одна компания «Мобайл Телеком-Сервис»): 707, 747 и 700, 708.
    id: 'kz', name: 'Казахстан', flag: '🇰🇿', code: '+7', cur: '₸', rate: 0.18, mul: 1.2, lvl: 1,
    grp: ['-', 2, '-', 2],
    ops: [
      { name: 'Kcell', prefixes: p('701', '702', '775', '778') },
      { name: 'Beeline', prefixes: p('705', '771', '776', '777') },
      { name: 'Tele2', prefixes: p('707', '747') },
      { name: 'Altel', prefixes: p('700', '708') },
    ],
  },
  {
    // Источник: план нумерации Беларуси (Минсвязи РБ), сводка — https://ru.ruwiki.ru/wiki/%2B375
    // Код 29 поделён по первой цифре номера: A1 — 29 1/3/6/8/9, МТС — 29 2/5/7
    // (https://www.mycountrymobile.com/de/country-code/belarus/). A1: 44, МТС: 33, life:) — 25.
    id: 'by', name: 'Беларусь', flag: '🇧🇾', code: '+375', cur: 'Br', rate: 27, mul: 1.5, lvl: 2,
    grp: ['-', 2, '-', 2],
    ops: [
      { name: 'A1', prefixes: [{ code: '29', first: '13689' }, { code: '44' }] },
      { name: 'МТС', prefixes: [{ code: '29', first: '257' }, { code: '33' }] },
      { name: 'life:)', prefixes: p('25') },
    ],
  },
  {
    // Источник: план нумерации Узбекистана, https://en.wikipedia.org/wiki/Telephone_numbers_in_Uzbekistan
    // и список кодов на сайте Ucell — https://ucell.uz/en/information/how_to_call
    // Beeline: 90, 91; Ucell: 93, 94, 50; Mobiuz: 97, 88; Uzmobile: 99, 95, 77.
    id: 'uz', name: 'Узбекистан', flag: '🇺🇿', code: '+998', cur: 'сум', rate: 0.0072, mul: 1.5, lvl: 3,
    grp: ['-', 2, '-', 2],
    ops: [
      { name: 'Beeline', prefixes: p('90', '91') },
      { name: 'Ucell', prefixes: p('93', '94', '50') },
      { name: 'Mobiuz', prefixes: p('97', '88') },
      { name: 'Uzmobile', prefixes: p('99', '95', '77') },
    ],
  },
  {
    // Источник: отчёт BTK (регулятор Турции) о плане нумерации, 2023;
    // сводка — https://en.wikipedia.org/wiki/Telephone_numbers_in_Turkey
    // Turkcell: 530–539; Vodafone: 540–549; Türk Telekom: 500–509, 551–559.
    id: 'tr', name: 'Турция', flag: '🇹🇷', code: '+90', cur: '₺', rate: 2.4, mul: 2.5, lvl: 5,
    grp: [' ', 2, ' ', 2],
    ops: [
      { name: 'Turkcell', prefixes: p('530', '532', '533', '535') },
      { name: 'Vodafone', prefixes: p('541', '542', '544', '545') },
      { name: 'Türk Telekom', prefixes: p('505', '506', '552', '555') },
    ],
  },
  {
    // Источник: план нумерации ОАЭ (TDRA), https://en.wikipedia.org/wiki/Telephone_numbers_in_the_United_Arab_Emirates
    // e& (Etisalat): 50, 54, 56; du: 52, 55, 58.
    id: 'ae', name: 'ОАЭ', flag: '🇦🇪', code: '+971', cur: 'AED', rate: 22, mul: 5, lvl: 9,
    grp: [' ', 4],
    ops: [
      { name: 'e&', prefixes: p('50', '54', '56') },
      { name: 'du', prefixes: p('52', '55', '58') },
    ],
  },
];

export const countryById = (id: string): Country | undefined => COUNTRIES.find((c) => c.id === id);

/** Множители узоров для evaluate(). Берётся самый дорогой сработавший узор. */
// Легендарные (≥500) выпадают чаще (см. GEN_WEIGHTS), но стоят меньше, чем в прототипе
// (было ×1500/×800): игрок их видит (≈1 из 1000 прокруток), а один номер не ломает экономику.
export const RARITY = {
  round: 600, // 0000001 / 7000000
  allSame: 500, // 7777777
  ladder: 120, // 1234567 / 9876543
  run6: 150, // 6–7 одинаковых подряд
  run5: 40,
  run4: 5,
  mirror: 12, // 1238321
  pairs: 8, // x121212
  twoDigits: 6, // только две разные цифры
  tailLadder: 2, // хвост 4 цифр лесенкой
  tail3: 1.5, // три одинаковые в конце
  t9Short: 2, // T9-слово до 5 букв
  t9Long: 3, // T9-слово от 6 букв
  beautifulCode: 2, // код из одинаковых цифр
};
export type Rarity = typeof RARITY;

/** Веса шаблонов «узорных» номеров (порядок — как GEN в logic.ts). */
export const GEN_WEIGHTS = {
  run4: 40, tail3: 30, mirror: 12, pairs: 8, twoDigits: 6, t9: 12, run5: 5, ladder: 1.5, run6: 0.8, allSame: 1, round: 0.3,
};
export type GenWeights = typeof GEN_WEIGHTS;

export interface Tier {
  id: 'legend' | 'epic' | 'rare' | 'nice' | 'common';
  min: number;
  name: string;
}

// От высшего к низшему: тир — первый, у которого min ≤ множитель.
export const TIERS: Tier[] = [
  { id: 'legend', min: 500, name: 'Легендарный' },
  { id: 'epic', min: 40, name: 'Эпический' },
  { id: 'rare', min: 6, name: 'Редкий' },
  { id: 'nice', min: 1.5, name: 'Красивый' },
  { id: 'common', min: 0, name: 'Обычный' },
];

export const tierFor = (mul: number): Tier => TIERS.find((t) => mul >= t.min)!;

// T9 — русская раскладка кнопочных телефонов.
export const T9: Record<string, string> = {};
for (const [d, letters] of [
  ['2', 'АБВГ'], ['3', 'ДЕЁЖЗ'], ['4', 'ИЙКЛ'], ['5', 'МНОП'],
  ['6', 'РСТУ'], ['7', 'ФХЦЧ'], ['8', 'ШЩЪЫ'], ['9', 'ЬЭЮЯ'],
] as const) {
  for (const l of letters) T9[l] = d;
}

export interface T9Word {
  w: string; // слово
  c: string; // его цифры
}

// Длинные слова проверяются первыми.
export const WORDS: T9Word[] = [
  'КОТИК', 'ПИЦЦА', 'ДЕНЬГИ', 'МАМА', 'ПАПА', 'БАБЛО', 'УДАЧА', 'ЗОЛОТО', 'ДРУГ', 'БОСС', 'ЛЮБОВЬ', 'ЗВОНОК',
  'АЛЛО', 'ПРИВЕТ', 'КЕКС', 'ТОРТ', 'КОФЕ', 'ЗИМА', 'ЛЕТО', 'МЕЧТА', 'БАРСИК', 'МУРКА', 'ШАРИК', 'ЗАЙКА',
  'БАНК', 'КЛАД', 'ТАЧКА', 'ВОЛГА', 'СИМКА',
]
  .map((w) => ({ w, c: [...w].map((l) => T9[l]).join('') }))
  .sort((a, b) => b.c.length - a.c.length);

// ======================= ДОСТИЖЕНИЯ =======================
// Прогресс считает сервер по истории прокруток (gn_stats); награду выдаёт только сервер.

export type AchKind =
  | { t: 'spins'; n: number }
  | { t: 'tier'; tier: Tier['id'] }
  | { t: 'ops'; country: string } // все операторы страны
  | { t: 'countries'; n: number }
  | { t: 't9'; n: number }
  | { t: 'code'; n: number } // номера с кодом из одинаковых цифр
  | { t: 'value'; rub: number } // стоимость коллекции
  | { t: 'friends'; n: number };

export interface Achievement {
  id: string;
  group: 'Прокрутки' | 'Редкость' | 'Коллекции регионов' | 'Узоры' | 'Витрина' | 'Друзья';
  title: string;
  kind: AchKind;
  rewardRub: number;
  rewardSpins?: number;
}

export const ACHIEVEMENTS: Achievement[] = [
  { id: 'spins10', group: 'Прокрутки', title: '10 прокруток', kind: { t: 'spins', n: 10 }, rewardRub: 500 },
  { id: 'spins100', group: 'Прокрутки', title: '100 прокруток', kind: { t: 'spins', n: 100 }, rewardRub: 3000, rewardSpins: 2 },
  { id: 'spins500', group: 'Прокрутки', title: '500 прокруток', kind: { t: 'spins', n: 500 }, rewardRub: 15000 },
  { id: 'spins2000', group: 'Прокрутки', title: '2 000 прокруток', kind: { t: 'spins', n: 2000 }, rewardRub: 50000 },
  { id: 'tierNice', group: 'Редкость', title: 'Первый «Красивый»', kind: { t: 'tier', tier: 'nice' }, rewardRub: 500 },
  { id: 'tierRare', group: 'Редкость', title: 'Первый «Редкий»', kind: { t: 'tier', tier: 'rare' }, rewardRub: 2000 },
  { id: 'tierEpic', group: 'Редкость', title: 'Первый «Эпический»', kind: { t: 'tier', tier: 'epic' }, rewardRub: 10000, rewardSpins: 2 },
  { id: 'tierLegend', group: 'Редкость', title: 'Первый «Легендарный»', kind: { t: 'tier', tier: 'legend' }, rewardRub: 30000, rewardSpins: 5 },
  { id: 'opsRu', group: 'Коллекции регионов', title: 'Все операторы России', kind: { t: 'ops', country: 'ru' }, rewardRub: 5000 },
  { id: 'opsKz', group: 'Коллекции регионов', title: 'Все операторы Казахстана', kind: { t: 'ops', country: 'kz' }, rewardRub: 6000 },
  { id: 'opsBy', group: 'Коллекции регионов', title: 'Все операторы Беларуси', kind: { t: 'ops', country: 'by' }, rewardRub: 7500 },
  { id: 'opsUz', group: 'Коллекции регионов', title: 'Все операторы Узбекистана', kind: { t: 'ops', country: 'uz' }, rewardRub: 9000 },
  { id: 'opsTr', group: 'Коллекции регионов', title: 'Все операторы Турции', kind: { t: 'ops', country: 'tr' }, rewardRub: 15000 },
  { id: 'opsAe', group: 'Коллекции регионов', title: 'Все операторы ОАЭ', kind: { t: 'ops', country: 'ae' }, rewardRub: 25000 },
  { id: 'countries6', group: 'Коллекции регионов', title: 'Номер из каждой страны', kind: { t: 'countries', n: 6 }, rewardRub: 20000, rewardSpins: 3 },
  { id: 't9w1', group: 'Узоры', title: 'Первое T9-слово', kind: { t: 't9', n: 1 }, rewardRub: 1000 },
  { id: 't9w5', group: 'Узоры', title: '5 разных T9-слов', kind: { t: 't9', n: 5 }, rewardRub: 8000 },
  { id: 't9w15', group: 'Узоры', title: '15 разных T9-слов', kind: { t: 't9', n: 15 }, rewardRub: 30000, rewardSpins: 3 },
  { id: 'code1', group: 'Узоры', title: 'Красивый код (777, 44…)', kind: { t: 'code', n: 1 }, rewardRub: 2000 },
  { id: 'code10', group: 'Узоры', title: '10 красивых кодов', kind: { t: 'code', n: 10 }, rewardRub: 15000 },
  { id: 'value100k', group: 'Витрина', title: 'Коллекция на 100 000 ₽', kind: { t: 'value', rub: 100_000 }, rewardRub: 5000 },
  { id: 'value1m', group: 'Витрина', title: 'Коллекция на 1 000 000 ₽', kind: { t: 'value', rub: 1_000_000 }, rewardRub: 30000 },
  { id: 'friends1', group: 'Друзья', title: 'Первый друг', kind: { t: 'friends', n: 1 }, rewardRub: 3000 },
  { id: 'friends3', group: 'Друзья', title: '3 друга', kind: { t: 'friends', n: 3 }, rewardRub: 10000, rewardSpins: 3 },
  { id: 'friends10', group: 'Друзья', title: '10 друзей', kind: { t: 'friends', n: 10 }, rewardRub: 40000, rewardSpins: 10 },
];
