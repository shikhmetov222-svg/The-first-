import { play, type Sound } from './sound';
// Тонкая обёртка над Telegram WebApp SDK.
// Вне Telegram (обычный браузер) объект тоже существует, но initData пустая.

export interface TelegramUser {
  id: number;
  first_name: string;
  last_name?: string;
  username?: string;
  language_code?: string;
}

interface TelegramWebApp {
  initData: string;
  initDataUnsafe: { user?: TelegramUser };
  colorScheme: 'light' | 'dark';
  setHeaderColor?(color: string): void;
  setBackgroundColor?(color: string): void;
  setBottomBarColor?(color: string): void;
  openTelegramLink?(url: string): void;
  requestWriteAccess?(cb?: (allowed: boolean) => void): void;
  platform: string;
  version: string;
  ready(): void;
  expand(): void;
  disableVerticalSwipes?(): void;
  onEvent(event: string, cb: () => void): void;
  HapticFeedback?: {
    impactOccurred(style: 'light' | 'medium' | 'heavy' | 'rigid' | 'soft'): void;
    notificationOccurred(type: 'success' | 'error' | 'warning'): void;
    selectionChanged(): void;
  };
}

declare global {
  interface Window {
    Telegram?: { WebApp: TelegramWebApp };
  }
}

export const tg: TelegramWebApp | undefined = window.Telegram?.WebApp;

/** true, если приложение реально открыто внутри Telegram. */
export const isInTelegram = Boolean(tg && tg.initData);

// У игры своя тёмная тема: тему Telegram не используем, только красим под неё рамки окна.
const APP_BG = '#0B0C0F';

export function initTelegram() {
  if (!tg) return;
  tg.ready();
  tg.expand();
  tg.disableVerticalSwipes?.();
  try {
    tg.setHeaderColor?.(APP_BG);
    tg.setBackgroundColor?.(APP_BG);
    tg.setBottomBarColor?.(APP_BG);
  } catch {
    // Старые версии Telegram не умеют менять цвета — не страшно.
  }
}

/** Имя, которое показываем на экране. Только для отображения — серверу не доверяем этим данным. */
export function displayName(): string {
  const u = tg?.initDataUnsafe.user;
  if (!u) return 'Гость';
  return u.first_name || u.username || 'Игрок';
}

// Вибрацию можно выключить в профиле.
let hapticsOn = true;
export function setHapticsEnabled(on: boolean) {
  hapticsOn = on;
}

export function haptic(style: 'light' | 'medium' | 'heavy' = 'light') {
  if (hapticsOn) tg?.HapticFeedback?.impactOccurred(style);
}

export function notify(type: 'success' | 'error' | 'warning') {
  play(type === 'success' ? 'success' : type === 'error' ? 'error' : 'bad');
  if (hapticsOn) tg?.HapticFeedback?.notificationOccurred(type);
}

/** Окно «Поделиться» в Telegram. Вне Telegram — обычная вкладка. */
export function shareLink(url: string, text: string) {
  const share = `https://t.me/share/url?url=${encodeURIComponent(url)}&text=${encodeURIComponent(text)}`;
  if (tg?.openTelegramLink) tg.openTelegramLink(share);
  else window.open(share, '_blank');
}

/** Разрешение боту писать игроку (нужно для уведомлений). */
export function requestWriteAccess(): Promise<boolean> {
  return new Promise((resolve) => {
    if (!tg?.requestWriteAccess) return resolve(true);
    try {
      tg.requestWriteAccess((allowed) => resolve(allowed));
    } catch {
      resolve(true);
    }
  });
}

/** Тактильный отклик под событие игры. */
export type Feel = 'collect' | 'purchase' | 'decision' | 'decision-bad' | 'default';

const FEEL_SOUND: Record<Feel, Sound> = {
  collect: 'coin', purchase: 'buy', decision: 'success', 'decision-bad': 'bad', default: 'success',
};

export function feel(kind: Feel) {
  play(FEEL_SOUND[kind]);
  if (!hapticsOn || !tg?.HapticFeedback) return;
  const h = tg.HapticFeedback;
  switch (kind) {
    case 'collect':
      // «Звон кассы»: тяжёлый удар и затем «успех».
      h.impactOccurred('heavy');
      window.setTimeout(() => h.notificationOccurred('success'), 120);
      break;
    case 'purchase':
      h.impactOccurred('medium');
      break;
    case 'decision':
      h.notificationOccurred('success');
      break;
    case 'decision-bad':
      h.notificationOccurred('warning');
      break;
    default:
      h.notificationOccurred('success');
  }
}

export function selectionTick() {
  if (hapticsOn) tg?.HapticFeedback?.selectionChanged?.();
}
