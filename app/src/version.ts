// Свежая версия сайта: если на сайте уже новая сборка, а Telegram открыл старую копию — перезагружаемся.
// Перезагрузка — не чаще раза в минуту, чтобы не зациклиться, если сайт ещё раздаёт старый файл.
const KEY = 'capital.reloaded_at';

export async function ensureFreshVersion(): Promise<void> {
  if (import.meta.env.DEV) return;
  try {
    const res = await fetch(`${import.meta.env.BASE_URL}version.json?t=${Date.now()}`, { cache: 'no-store' });
    if (!res.ok) return;
    const { build } = (await res.json()) as { build?: string };
    if (!build || build === __BUILD__) return;
    const last = Number(sessionStorage.getItem(KEY) ?? 0);
    if (Date.now() - last < 60_000) return;
    sessionStorage.setItem(KEY, String(Date.now()));
    const url = new URL(window.location.href);
    url.searchParams.set('v', build);
    window.location.replace(url.toString());
  } catch {
    // нет сети или хранилища — играем на том, что загрузилось
  }
}
