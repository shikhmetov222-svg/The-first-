// Единый конфиг игры «Золотой номер».
// Этот файл используют и сервер (Edge Function), и клиент (только для подписей).
// Всё, что влияет на деньги, сервер считает сам — клиентские копии чисел ничего не решают.
//
// ПРЕФИКСЫ. Коды операторов взяты из национальных планов нумерации. Из-за переноса номеров
// (MNP) реальный оператор по коду не определяется — в игре это просто «выпавший» код.
// Если регулятор переназначит коды — правим только здесь.
//
// КУРСЫ ВАЛЮТ — игровые константы (сколько ₽ стоит 1 единица местной валюты), не биржевые.

export const BASE_COST_RUB = 1000; // цена прокрутки при ставке ×1 и множителе страны ×1
export const BASE_VALUE_RUB = 380; // цена обычного номера при тех же условиях
export const STAKES = [1, 2, 5, 10] as const;
// Калибровка под среднюю отдачу ≈90% ставки (проверка: npm run sim в папке app).
export const PATTERN_CHANCE = 0.066; // доля «узорных» номеров при генерации (~7%)
/** Шанс выпадения кода из одинаковых цифр (777, 999, 44…) — одинаковый во всех странах, иначе
 *  отдача зависела бы от того, сколько таких кодов у страны. */
export const BEAUTIFUL_CODE_CHANCE = 0.02;
export const SUB_LEN = 7; // длина абонентской части во всех странах игры

export const KASSA_RATE_PER_HOUR = 0.03; // 3% цены номера в час
export const KASSA_CAP_HOURS = 8; // касса копится максимум 8 часов

export const START_BALANCE_RUB = 10_000;
export const BAILOUT_RUB = 5_000; // помощь, если игрок разорился (раз в BAILOUT_COOLDOWN_H)
export const BAILOUT_COOLDOWN_H = 4;

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
    id: 'ae', name: 'ОАЭ', flag: '🇦🇪', code: '+971', cur: 'AED', rate: 22, mul: 5, lvl: 8,
    grp: [' ', 4],
    ops: [
      { name: 'e&', prefixes: p('50', '54', '56') },
      { name: 'du', prefixes: p('52', '55', '58') },
    ],
  },
];

export const countryById = (id: string): Country | undefined => COUNTRIES.find((c) => c.id === id);

/** Множители узоров для evaluate(). Берётся самый дорогой сработавший узор. */
export const RARITY = {
  round: 1500, // 0000001 / 7000000
  allSame: 800, // 7777777
  ladder: 150, // 1234567 / 9876543
  run6: 200, // 6–7 одинаковых подряд
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
  run4: 40, tail3: 30, mirror: 12, pairs: 8, twoDigits: 6, t9: 12, run5: 5, ladder: 1.2, run6: 0.8, allSame: 0.25, round: 0.08,
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
