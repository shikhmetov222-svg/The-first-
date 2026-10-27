// Проверка подписи initData от Telegram Mini App.
// https://core.telegram.org/bots/webapps#validating-data-received-via-the-mini-app

export interface TelegramUser {
  id: number;
  first_name: string;
  last_name?: string;
  username?: string;
  language_code?: string;
  /** Параметр из ссылки t.me/<бот>?startapp=... (не часть объекта user — кладём сюда для удобства). */
  start_param?: string;
}

const MAX_AGE_SECONDS = 24 * 60 * 60;
const encoder = new TextEncoder();

async function hmac(key: Uint8Array, data: string): Promise<Uint8Array> {
  const cryptoKey = await crypto.subtle.importKey(
    'raw',
    key,
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  );
  return new Uint8Array(await crypto.subtle.sign('HMAC', cryptoKey, encoder.encode(data)));
}

function toHex(bytes: Uint8Array): string {
  return Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
}

function safeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

/** Возвращает пользователя, если подпись верна и данные свежие, иначе null. */
export async function verifyInitData(
  initData: string,
  botToken: string,
  nowSeconds = Math.floor(Date.now() / 1000),
): Promise<TelegramUser | null> {
  const params = new URLSearchParams(initData);
  const hash = params.get('hash');
  if (!hash) return null;
  params.delete('hash');

  const dataCheckString = [...params.entries()]
    .map(([k, v]) => `${k}=${v}`)
    .sort()
    .join('\n');

  const secretKey = await hmac(encoder.encode('WebAppData'), botToken);
  const expected = toHex(await hmac(secretKey, dataCheckString));
  if (!safeEqual(expected, hash)) return null;

  const authDate = Number(params.get('auth_date'));
  if (!authDate || nowSeconds - authDate > MAX_AGE_SECONDS) return null;

  const userJson = params.get('user');
  if (!userJson) return null;
  const user = JSON.parse(userJson) as TelegramUser;
  if (typeof user.id !== 'number') return null;
  const startParam = params.get('start_param');
  return startParam ? { ...user, start_param: startParam } : user;
}
