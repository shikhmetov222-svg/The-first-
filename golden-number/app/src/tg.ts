// Обёртка над Telegram WebApp SDK. Вне Telegram все методы безопасно ничего не делают.

interface TgWebApp {
  initData: string;
  version: string;
  ready(): void;
  expand(): void;
  isVersionAtLeast(v: string): boolean;
  setHeaderColor?(c: string): void;
  setBackgroundColor?(c: string): void;
  setBottomBarColor?(c: string): void;
  disableVerticalSwipes?(): void;
  showConfirm?(msg: string, cb: (ok: boolean) => void): void;
  HapticFeedback?: {
    impactOccurred(s: 'light' | 'medium' | 'heavy' | 'rigid' | 'soft'): void;
    notificationOccurred(t: 'error' | 'success' | 'warning'): void;
    selectionChanged(): void;
  };
  BackButton?: { show(): void; hide(): void; onClick(cb: () => void): void };
}

const wa: TgWebApp | undefined = (window as unknown as { Telegram?: { WebApp?: TgWebApp } }).Telegram?.WebApp;
const at = (v: string) => !!wa && wa.isVersionAtLeast(v);

export const initData = (): string => wa?.initData ?? '';

export function setupTelegram(bg: string) {
  if (!wa) return;
  wa.ready();
  wa.expand();
  // Игра всегда в своей тёмной теме — красим шапку и фон Telegram под неё.
  if (at('6.1')) {
    wa.setHeaderColor?.(bg);
    wa.setBackgroundColor?.(bg);
  }
  if (at('7.10')) wa.setBottomBarColor?.(bg);
  if (at('7.7')) wa.disableVerticalSwipes?.(); // свайп вниз не закрывает игру посреди прокрутки
}

const hf = () => (at('6.1') ? wa?.HapticFeedback : undefined);
export const haptic = {
  tick: () => hf()?.impactOccurred('light'),
  medium: () => hf()?.impactOccurred('medium'),
  heavy: () => hf()?.impactOccurred('heavy'),
  select: () => hf()?.selectionChanged(),
  success: () => hf()?.notificationOccurred('success'),
  error: () => hf()?.notificationOccurred('error'),
};

let backHandler: (() => void) | null = null;
export function backButton(show: boolean, onClick?: () => void) {
  const bb = at('6.1') ? wa?.BackButton : undefined;
  if (!bb) return;
  if (onClick && !backHandler) {
    backHandler = onClick;
    bb.onClick(() => backHandler?.());
  }
  show ? bb.show() : bb.hide();
}

export function confirmDialog(msg: string): Promise<boolean> {
  if (wa?.showConfirm && at('6.2')) return new Promise((res) => wa.showConfirm!(msg, res));
  return Promise.resolve(window.confirm(msg));
}
