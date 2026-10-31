import { createHmac } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { verifyInitData } from '../../supabase/functions/_shared/telegram.ts';

const TOKEN = '123456:TEST-TOKEN-NOT-REAL';

function sign(fields: Record<string, string>, token = TOKEN): string {
  const dcs = Object.entries(fields).map(([k, v]) => `${k}=${v}`).sort().join('\n');
  const secret = createHmac('sha256', 'WebAppData').update(token).digest();
  const hash = createHmac('sha256', secret).update(dcs).digest('hex');
  return new URLSearchParams({ ...fields, hash }).toString();
}

const now = Math.floor(Date.now() / 1000);
const user = JSON.stringify({ id: 42, first_name: 'Аня' });

describe('подпись Telegram initData', () => {
  it('верная подпись — пользователь', async () => {
    const u = await verifyInitData(sign({ auth_date: String(now), user, query_id: 'q' }), TOKEN);
    expect(u?.id).toBe(42);
  });

  it('чужой токен — отказ', async () => {
    expect(await verifyInitData(sign({ auth_date: String(now), user }, '999:OTHER'), TOKEN)).toBeNull();
  });

  it('подменённый пользователь — отказ', async () => {
    const data = sign({ auth_date: String(now), user }).replace('42', '43');
    expect(await verifyInitData(data, TOKEN)).toBeNull();
  });

  it('старше суток — отказ', async () => {
    expect(await verifyInitData(sign({ auth_date: String(now - 2 * 86400), user }), TOKEN)).toBeNull();
  });

  it('пустая строка — отказ', async () => {
    expect(await verifyInitData('', TOKEN)).toBeNull();
  });
});
