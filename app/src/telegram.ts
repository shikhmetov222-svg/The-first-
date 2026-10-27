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
  platform: string;
  version: string;
  ready(): void;
  expand(): void;
  disableVerticalSwipes?(): void;
  onEvent(event: string, cb: () => void): void;
  HapticFeedback?: {
    impactOccurred(style: 'light' | 'medium' | 'heavy'): void;
    notificationOccurred(type: 'success' | 'error' | 'warning'): void;
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

export function initTelegram() {
  if (!tg) return;
  tg.ready();
  tg.expand();
  tg.disableVerticalSwipes?.();
  applyColorScheme();
  tg.onEvent('themeChanged', applyColorScheme);
}

function applyColorScheme() {
  document.documentElement.dataset.scheme = tg?.colorScheme ?? 'light';
}

/** Имя, которое показываем на экране. Только для отображения — серверу не доверяем этим данным. */
export function displayName(): string {
  const u = tg?.initDataUnsafe.user;
  if (!u) return 'Гость';
  return u.first_name || u.username || 'Игрок';
}

export function haptic(style: 'light' | 'medium' | 'heavy' = 'light') {
  tg?.HapticFeedback?.impactOccurred(style);
}
