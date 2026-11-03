// Telegram-бот онлайн-записи к мастеру. Один код на всех мастеров.
// Telegram присылает обновления на .../booking-bot?m=<код мастера>
// с заголовком X-Telegram-Bot-Api-Secret-Token (свой секрет у каждого бота).

import postgres from "npm:postgres@3.4.5";

const sql = postgres(Deno.env.get("SUPABASE_DB_URL")!, {
  prepare: false,
  max: 4,
  idle_timeout: 20,
  connect_timeout: 10,
});

// deno-lint-ignore no-explicit-any
type Row = Record<string, any>;
type Btn = { text: string; callback_data: string };
type InlineKb = { inline_keyboard: Btn[][] };
type User = { uid: string; chat: string; first: string; username: string | null; admin: boolean };

// ---------------------------------------------------------------- форматирование
const WD_SHORT = ["Пн", "Вт", "Ср", "Чт", "Пт", "Сб", "Вс"];
const WD_FULL = ["понедельник", "вторник", "среда", "четверг", "пятница", "суббота", "воскресенье"];
const WD_TITLE = ["Понедельник", "Вторник", "Среда", "Четверг", "Пятница", "Суббота", "Воскресенье"];
const MON_GEN = ["января", "февраля", "марта", "апреля", "мая", "июня", "июля", "августа", "сентября", "октября", "ноября", "декабря"];
const MON_SHORT = ["янв", "фев", "мар", "апр", "мая", "июн", "июл", "авг", "сен", "окт", "ноя", "дек"];

const esc = (s: unknown) =>
  String(s ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

function parts(d: string) {
  const [y, m, dd] = d.split("-").map(Number);
  return { y, m, d: dd, wd: (new Date(Date.UTC(y, m - 1, dd)).getUTCDay() + 6) % 7 };
}
const dateLong = (d: string) => { const p = parts(d); return `${WD_FULL[p.wd]}, ${p.d} ${MON_GEN[p.m - 1]}`; };
const dateShort = (d: string) => { const p = parts(d); return `${WD_SHORT[p.wd]} ${p.d} ${MON_SHORT[p.m - 1]}`; };
const dm = (d: string) => { const p = parts(d); return `${String(p.d).padStart(2, "0")}.${String(p.m).padStart(2, "0")}`; };
const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);
const price = (n: number) => `${Number(n).toLocaleString("ru-RU")} ₽`;
function dur(min: number) {
  const h = Math.floor(min / 60), m = min % 60;
  if (!h) return `${m} мин`;
  return m ? `${h} ч ${m} мин` : `${h} ч`;
}
function todayIn(tz: string) {
  return new Intl.DateTimeFormat("en-CA", { timeZone: tz, year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date());
}
function addDays(d: string, n: number) {
  const p = parts(d);
  return new Date(Date.UTC(p.y, p.m - 1, p.d + n)).toISOString().slice(0, 10);
}
const chunk = <T,>(a: T[], n: number) => a.reduce<T[][]>((r, x, i) => (i % n ? r[r.length - 1].push(x) : r.push([x]), r), []);

// "15.11", "15.11.2026", "сегодня", "завтра" -> "YYYY-MM-DD"
function findDates(text: string, today: string): string[] | null {
  const out: string[] = [];
  const low = text.toLowerCase();
  if (low.includes("сегодня")) out.push(today);
  if (low.includes("завтра")) out.push(addDays(today, 1));
  for (const mt of text.matchAll(/(\d{1,2})[.\/](\d{1,2})(?:[.\/](\d{2,4}))?/g)) {
    const d = +mt[1], m = +mt[2];
    let y = mt[3] ? +mt[3] : parts(today).y;
    if (y < 100) y += 2000;
    const dt = new Date(Date.UTC(y, m - 1, d));
    if (dt.getUTCMonth() !== m - 1 || dt.getUTCDate() !== d) return null;
    let iso = dt.toISOString().slice(0, 10);
    if (!mt[3] && iso < today) iso = new Date(Date.UTC(y + 1, m - 1, d)).toISOString().slice(0, 10);
    out.push(iso);
  }
  return out;
}
// "14:00-16:00" -> ["14:00","16:00"]
function findTimeRange(text: string): [string, string] | null {
  const mt = text.match(/(\d{1,2})[:.](\d{2})\s*(?:-|–|—|до)\s*(\d{1,2})[:.](\d{2})/);
  if (!mt) return null;
  const [h1, m1, h2, m2] = [+mt[1], +mt[2], +mt[3], +mt[4]];
  if (h1 > 23 || h2 > 23 || m1 > 59 || m2 > 59) return null;
  const a = h1 * 60 + m1, b = h2 * 60 + m2;
  if (b <= a) return null;
  const f = (h: number, m: number) => `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`;
  return [f(h1, m1), f(h2, m2)];
}
function normalizePhone(s: string): string | null {
  let d = s.replace(/\D/g, "");
  if (d.length === 11 && d[0] === "8") d = "7" + d.slice(1);
  if (d.length === 10 && d[0] === "9") d = "7" + d;
  if (d.length < 10 || d.length > 15) return null;
  return "+" + d;
}
function safeEqual(a: string, b: string) {
  if (a.length !== b.length || !a.length) return false;
  let r = 0;
  for (let i = 0; i < a.length; i++) r |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return r === 0;
}

// ---------------------------------------------------------------- Telegram
class Bot {
  constructor(public m: Row) {}

  // deno-lint-ignore no-explicit-any
  async api(method: string, payload: Record<string, unknown>): Promise<any> {
    if (this.m.dry_run) {
      await sql`insert into booking.test_log(master_id, method, payload) values (${this.m.id}, ${method}, ${sql.json(payload as never)})`;
      return { ok: true, result: { message_id: 1 } };
    }
    try {
      const r = await fetch(`https://api.telegram.org/bot${this.m.bot_token}/${method}`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(payload),
      });
      const j = await r.json().catch(() => ({ ok: false, description: `http ${r.status}` }));
      if (!j.ok) console.error(`telegram ${method} failed: ${j.description}`);
      return j;
    } catch (e) {
      console.error(`telegram ${method} error: ${(e as Error).message}`);
      return { ok: false };
    }
  }

  send(chat: string, text: string, markup?: unknown) {
    return this.api("sendMessage", {
      chat_id: chat, text, parse_mode: "HTML", link_preview_options: { is_disabled: true },
      ...(markup ? { reply_markup: markup } : {}),
    });
  }

  // Редактирует сообщение с кнопками, если оно есть, иначе отправляет новое.
  async show(chat: string, msgId: number | undefined, text: string, kb?: InlineKb) {
    if (msgId) {
      const r = await this.api("editMessageText", {
        chat_id: chat, message_id: msgId, text, parse_mode: "HTML",
        link_preview_options: { is_disabled: true },
        reply_markup: kb ?? { inline_keyboard: [] },
      });
      if (r.ok || String(r.description ?? "").includes("not modified")) return;
    }
    await this.send(chat, text, kb);
  }
}

const menuKb = (admin: boolean) => ({
  keyboard: admin
    ? [[{ text: "📅 Сегодня" }, { text: "🗓 Неделя" }], [{ text: "⚙️ Управление" }], [{ text: "💅 Записаться" }, { text: "📋 Мои записи" }]]
    : [[{ text: "💅 Записаться" }, { text: "📋 Мои записи" }]],
  resize_keyboard: true,
  is_persistent: true,
});
const kb = (rows: Btn[][]): InlineKb => ({ inline_keyboard: rows });
const b = (text: string, data: string): Btn => ({ text, callback_data: data });

// ---------------------------------------------------------------- данные
async function getSession(c: Bot, u: User) {
  const [s] = await sql`select state, data from booking.sessions where master_id = ${c.m.id} and tg_id = ${u.uid}`;
  return s ? { state: s.state as string | null, data: (s.data ?? {}) as Row } : { state: null, data: {} as Row };
}
async function setSession(c: Bot, u: User, state: string | null, data: Row = {}) {
  await sql`
    insert into booking.sessions(master_id, tg_id, state, data, updated_at)
    values (${c.m.id}, ${u.uid}, ${state}, ${sql.json(data as never)}, now())
    on conflict (master_id, tg_id) do update set state = excluded.state, data = excluded.data, updated_at = now()`;
}
const clearSession = (c: Bot, u: User) => setSession(c, u, null, {});

async function ensureClient(c: Bot, u: User) {
  const [r] = await sql`
    insert into booking.clients(master_id, tg_id, username) values (${c.m.id}, ${u.uid}, ${u.username})
    on conflict (master_id, tg_id) do update set username = excluded.username
    returning id::text, name, phone`;
  return r;
}
async function getService(c: Bot, id: string) {
  if (!/^\d+$/.test(id ?? "")) return null;
  const [s] = await sql`select id::text, name, price, duration_min, active from booking.services where id = ${id} and master_id = ${c.m.id}`;
  return s ?? null;
}
async function getBooking(c: Bot, id: string) {
  if (!/^\d+$/.test(id ?? "")) return null;
  const tz = c.m.tz;
  const [r] = await sql`
    select bk.id::text, bk.status, bk.service_name, bk.price,
           to_char(bk.starts_at at time zone ${tz}, 'YYYY-MM-DD') as d,
           to_char(bk.starts_at at time zone ${tz}, 'HH24:MI') as t1,
           to_char(bk.ends_at   at time zone ${tz}, 'HH24:MI') as t2,
           bk.starts_at > now() as future,
           cl.tg_id::text as tg, cl.name, cl.phone, cl.username
    from booking.bookings bk join booking.clients cl on cl.id = bk.client_id
    where bk.id = ${id} and bk.master_id = ${c.m.id}`;
  return r ?? null;
}
function bookingText(c: Bot, r: Row, withAddress = true) {
  let t = `💅 ${esc(r.service_name)}\n📅 ${dateLong(r.d)}\n🕐 ${r.t1}–${r.t2}\n💰 ${price(r.price)}`;
  if (withAddress && c.m.address) t += `\n📍 ${esc(c.m.address)}`;
  return t;
}
const clientLink = (r: Row) => `<a href="tg://user?id=${r.tg}">${esc(r.name || "Клиент")}</a>`;
function clientLine(r: Row) {
  let t = `👤 ${clientLink(r)}`;
  if (r.phone) t += ` · ${esc(r.phone)}`;
  if (r.username) t += ` · @${esc(r.username)}`;
  return t;
}

// ---------------------------------------------------------------- клиент
async function cmdStart(c: Bot, u: User) {
  await clearSession(c, u);
  const m = c.m;
  let t = `Здравствуйте${u.first ? ", " + esc(u.first) : ""}! 👋\n\n`;
  t += m.greeting ? `${esc(m.greeting)}\n\n` : "Это онлайн-запись к мастеру:\n";
  t += `💅 <b>${esc(m.name)}</b> · ${esc(m.title)}\n`;
  if (m.address) t += `📍 ${esc(m.address)}\n`;
  t += "\nЗдесь можно за минуту записаться на удобное время, посмотреть свои записи или отменить их. " +
    "Напоминание придёт за сутки и за 2 часа до визита ⏰";
  if (u.admin) {
    t += "\n\n🔑 <b>Вы — мастер этого бота.</b>\nВам доступны кнопки «📅 Сегодня», «🗓 Неделя» и «⚙️ Управление» " +
      "(услуги, цены, график, выходные). Новые записи и отмены будут приходить сюда.";
  }
  await c.send(u.chat, t, menuKb(u.admin));
  await c.send(u.chat, "Готовы записаться? 👇", kb([[b("💅 Записаться", "book")]]));
}

async function showServices(c: Bot, u: User, msgId?: number) {
  const svcs = await sql`
    select id::text, name, price, duration_min from booking.services
    where master_id = ${c.m.id} and active order by sort, id`;
  if (!svcs.length) return c.show(u.chat, msgId, "Пока нет доступных услуг 🙏 Загляните чуть позже.");
  const lines = svcs.map((s) => `• <b>${esc(s.name)}</b> — ${price(s.price)}, ${dur(s.duration_min)}`).join("\n");
  await c.show(u.chat, msgId, `💅 <b>Выберите услугу:</b>\n\n${lines}`,
    kb(svcs.map((s) => [b(`${s.name} · ${price(s.price)}`, `svc:${s.id}`)])));
}

async function showDates(c: Bot, u: User, svcId: string, msgId?: number) {
  const s = await getService(c, svcId);
  if (!s || !s.active) return showServices(c, u, msgId);
  const days = await sql`select d::text as d from booking.available_dates(${c.m.id}, ${svcId})`;
  let t = `💅 <b>${esc(s.name)}</b>\n💰 ${price(s.price)} · ⏱ ${dur(s.duration_min)}\n\n`;
  const rows = chunk(days.map((r) => b(dateShort(r.d), `day:${svcId}:${r.d}`)), 3);
  if (days.length) t += "📅 Выберите удобный день:";
  else t += `😔 К сожалению, в ближайшие ${c.m.booking_days} дней свободных окошек нет. Попробуйте позже или выберите другую услугу.`;
  rows.push([b("⬅️ К услугам", "book")]);
  await c.show(u.chat, msgId, t, kb(rows));
}

async function showTimes(c: Bot, u: User, svcId: string, d: string, msgId?: number, prefix = "") {
  const s = await getService(c, svcId);
  if (!s || !s.active || !/^\d{4}-\d{2}-\d{2}$/.test(d ?? "")) return showServices(c, u, msgId);
  const slots = await sql`
    select extract(epoch from starts_at)::bigint::text as ts, label
    from booking.free_slots(${c.m.id}, ${svcId}, ${d}::date)`;
  let t = `${prefix}💅 <b>${esc(s.name)}</b> · ${dur(s.duration_min)}\n📅 ${cap(dateLong(d))}\n\n`;
  t += slots.length ? "🕐 Выберите время:" : "На этот день свободного времени уже нет 😔 Выберите другой день.";
  const rows = chunk(slots.map((r) => b(r.label, `t:${svcId}:${r.ts}`)), 4);
  rows.push([b("⬅️ Другой день", `svc:${svcId}`)]);
  await c.show(u.chat, msgId, t, kb(rows));
}

async function pickTime(c: Bot, u: User, svcId: string, ts: string, msgId?: number) {
  if (!/^\d+$/.test(svcId ?? "") || !/^\d+$/.test(ts ?? "")) return showServices(c, u, msgId);
  const data = { svc: svcId, ts };
  const cl = await ensureClient(c, u);
  if (!cl.name) {
    await c.show(u.chat, msgId, "Отлично, время выбрано ✅\nОсталось совсем чуть-чуть 🙂");
    return askName(c, u, data);
  }
  if (!cl.phone) {
    await c.show(u.chat, msgId, "Отлично, время выбрано ✅");
    return askPhone(c, u, data);
  }
  await setSession(c, u, "confirm", data);
  await showConfirm(c, u, msgId);
}

async function askName(c: Bot, u: User, data: Row) {
  await setSession(c, u, "ask_name", data);
  const markup = u.first
    ? { keyboard: [[{ text: u.first.slice(0, 50) }]], resize_keyboard: true, one_time_keyboard: true }
    : { remove_keyboard: true };
  await c.send(u.chat, "Как к вам обращаться? Напишите, пожалуйста, ваше имя ✍️", markup);
}

async function askPhone(c: Bot, u: User, data: Row) {
  await setSession(c, u, "ask_phone", data);
  await c.send(u.chat,
    "📱 Поделитесь номером телефона — нажмите кнопку ниже 👇\nИли напишите номер вручную, например <code>+7 999 123-45-67</code>",
    { keyboard: [[{ text: "📱 Поделиться номером", request_contact: true }]], resize_keyboard: true, one_time_keyboard: true });
}

async function slotInfo(c: Bot, ts: string, minutes: number) {
  const tz = c.m.tz;
  const [r] = await sql`
    select to_char(to_timestamp(${ts}::double precision) at time zone ${tz}, 'YYYY-MM-DD') as d,
           to_char(to_timestamp(${ts}::double precision) at time zone ${tz}, 'HH24:MI') as t1,
           to_char((to_timestamp(${ts}::double precision) + make_interval(mins => ${minutes}::int)) at time zone ${tz}, 'HH24:MI') as t2`;
  return r;
}

async function showConfirm(c: Bot, u: User, msgId?: number) {
  const ss = await getSession(c, u);
  const s = ss.state === "confirm" ? await getService(c, ss.data.svc) : null;
  if (!s || !s.active) {
    await clearSession(c, u);
    return c.show(u.chat, msgId, "Что-то пошло не так 🙈 Давайте начнём заново.", kb([[b("💅 Записаться", "book")]]));
  }
  const cl = await ensureClient(c, u);
  const si = await slotInfo(c, ss.data.ts, s.duration_min);
  const t = "📝 <b>Проверьте, всё ли верно:</b>\n\n" +
    `💅 ${esc(s.name)}\n📅 ${cap(dateLong(si.d))}\n🕐 ${si.t1}–${si.t2}\n💰 ${price(s.price)}\n` +
    (c.m.address ? `📍 ${esc(c.m.address)}\n` : "") +
    `👤 ${esc(cl.name)}, ${esc(cl.phone)}`;
  await c.show(u.chat, msgId, t, kb([
    [b("✅ Подтвердить запись", "ok")],
    [b("✏️ Изменить имя или телефон", "chg")],
    [b("✖️ Отмена", "nope")],
  ]));
}

async function doConfirm(c: Bot, u: User, msgId?: number) {
  const ss = await getSession(c, u);
  if (ss.state !== "confirm") {
    return c.show(u.chat, msgId, "Эта заявка уже оформлена или устарела. Загляните в «📋 Мои записи» или начните заново.",
      kb([[b("📋 Мои записи", "my")], [b("💅 Записаться", "book")]]));
  }
  const cl = await ensureClient(c, u);
  const [r] = await sql`
    select booking.create_booking(${c.m.id}, ${cl.id}, ${ss.data.svc}, to_timestamp(${ss.data.ts}::double precision)) as res`;
  const res = r.res as Row;
  if (res.ok) {
    await clearSession(c, u);
    const bk = await getBooking(c, String(res.id));
    await c.show(u.chat, msgId,
      `🎉 <b>Вы записаны!</b>\n\n${bookingText(c, bk!)}\n\nНапомним за сутки и за 2 часа до визита ⏰\nОтменить запись можно в «📋 Мои записи».`,
      kb([[b("📋 Мои записи", "my")]]));
    await c.send(String(c.m.admin_tg_id),
      `🆕 <b>Новая запись!</b>\n\n📅 ${cap(dateLong(bk!.d))}, ${bk!.t1}–${bk!.t2}\n💅 ${esc(bk!.service_name)} · ${price(bk!.price)}\n${clientLine(bk!)}`,
      kb([[b("❌ Отменить эту запись", `acx:${bk!.id}`)]]));
    return;
  }
  if (res.error === "slot_taken") {
    const s = await getService(c, ss.data.svc);
    await setSession(c, u, null, {});
    if (!s) return showServices(c, u, msgId);
    const si = await slotInfo(c, ss.data.ts, s.duration_min);
    return showTimes(c, u, ss.data.svc, si.d, msgId, "😔 Ой, это время только что заняли. Выберите, пожалуйста, другое.\n\n");
  }
  if (res.error === "limit") {
    await clearSession(c, u);
    return c.show(u.chat, msgId,
      `У вас уже ${res.count} активные записи — это максимум 🙂\nЕсли нужно, отмените одну из них в «📋 Мои записи».`,
      kb([[b("📋 Мои записи", "my")]]));
  }
  await clearSession(c, u);
  return c.show(u.chat, msgId, "Не получилось записать 😔 Эта услуга сейчас недоступна. Попробуйте выбрать заново.",
    kb([[b("💅 Записаться", "book")]]));
}

async function myBookings(c: Bot, u: User, msgId?: number) {
  const tz = c.m.tz;
  const rows = await sql`
    select bk.id::text, bk.service_name, bk.price,
           to_char(bk.starts_at at time zone ${tz}, 'YYYY-MM-DD') as d,
           to_char(bk.starts_at at time zone ${tz}, 'HH24:MI') as t1,
           to_char(bk.ends_at   at time zone ${tz}, 'HH24:MI') as t2
    from booking.bookings bk join booking.clients cl on cl.id = bk.client_id
    where bk.master_id = ${c.m.id} and cl.tg_id = ${u.uid} and bk.status = 'active' and bk.starts_at > now()
    order by bk.starts_at`;
  if (!rows.length) {
    return c.show(u.chat, msgId, "У вас пока нет предстоящих записей 🙂", kb([[b("💅 Записаться", "book")]]));
  }
  let t = "📋 <b>Ваши записи:</b>\n";
  for (const r of rows) t += `\n📅 ${cap(dateLong(r.d))}, ${r.t1}–${r.t2}\n💅 ${esc(r.service_name)} · ${price(r.price)}\n`;
  if (c.m.address) t += `\n📍 ${esc(c.m.address)}\n`;
  t += "\nЧтобы отменить запись, нажмите на кнопку ниже.";
  const btns = rows.map((r) => [b(`❌ Отменить: ${dateShort(r.d)}, ${r.t1}`, `cx:${r.id}`)]);
  btns.push([b("💅 Записаться ещё", "book")]);
  await c.show(u.chat, msgId, t, kb(btns));
}

async function askCancel(c: Bot, u: User, id: string, msgId?: number) {
  const bk = await getBooking(c, id);
  if (!bk || bk.tg !== u.uid || bk.status !== "active" || !bk.future) {
    return c.show(u.chat, msgId, "Эта запись уже отменена или прошла.", kb([[b("📋 Мои записи", "my")]]));
  }
  await c.show(u.chat, msgId, `Отменить запись?\n\n${bookingText(c, bk, false)}`,
    kb([[b("Да, отменить", `cxy:${id}`)], [b("Нет, оставить", "my")]]));
}

async function doCancel(c: Bot, u: User, id: string, msgId?: number) {
  if (!/^\d+$/.test(id ?? "")) return;
  const upd = await sql`
    update booking.bookings bk set status = 'cancelled_by_client', cancelled_at = now()
    from booking.clients cl
    where bk.id = ${id} and bk.master_id = ${c.m.id} and cl.id = bk.client_id and cl.tg_id = ${u.uid}
      and bk.status = 'active' and bk.starts_at > now()
    returning bk.id`;
  if (!upd.length) {
    return c.show(u.chat, msgId, "Эта запись уже отменена или прошла.", kb([[b("📋 Мои записи", "my")]]));
  }
  const bk = await getBooking(c, id);
  await c.show(u.chat, msgId, "✅ Запись отменена.\n\nБудем рады видеть вас в другой раз! 💅", kb([[b("💅 Записаться снова", "book")]]));
  await c.send(String(c.m.admin_tg_id),
    `❌ <b>Клиент отменил запись</b>\n\n📅 ${cap(dateLong(bk!.d))}, ${bk!.t1}–${bk!.t2}\n💅 ${esc(bk!.service_name)}\n${clientLine(bk!)}\n\nЭто время снова свободно для записи.`);
}

// ---------------------------------------------------------------- мастер
async function adminList(c: Bot, u: User, days: number, msgId?: number) {
  const tz = c.m.tz;
  const today = todayIn(tz);
  const rows = await sql`
    select bk.id::text, bk.service_name, bk.price,
           to_char(bk.starts_at at time zone ${tz}, 'YYYY-MM-DD') as d,
           to_char(bk.starts_at at time zone ${tz}, 'HH24:MI') as t1,
           to_char(bk.ends_at   at time zone ${tz}, 'HH24:MI') as t2,
           cl.tg_id::text as tg, cl.name, cl.phone, cl.username
    from booking.bookings bk join booking.clients cl on cl.id = bk.client_id
    where bk.master_id = ${c.m.id} and bk.status = 'active'
      and bk.starts_at >= (${today}::date)::timestamp at time zone ${tz}
      and bk.starts_at <  (${today}::date + ${days}::int)::timestamp at time zone ${tz}
    order by bk.starts_at
    limit 60`;
  let t = days === 1 ? `📅 <b>Сегодня, ${dateLong(today)}</b>\n` : `🗓 <b>Записи на 7 дней</b> (с ${dm(today)} по ${dm(addDays(today, 6))})\n`;
  if (!rows.length) t += days === 1 ? "\nЗаписей нет — можно выдохнуть ☕️" : "\nНа ближайшую неделю записей пока нет.";
  let lastD = "";
  for (const r of rows) {
    if (days > 1 && r.d !== lastD) { t += `\n<b>${cap(dateLong(r.d))}</b>\n`; lastD = r.d; }
    else if (days === 1 && !lastD) { t += "\n"; lastD = r.d; }
    t += `🕐 ${r.t1}–${r.t2} · ${esc(r.service_name)} · ${price(r.price)}\n${clientLine(r)}\n\n`;
  }
  if (t.length > 3800) t = t.slice(0, 3800) + "\n…";
  const btns = rows.slice(0, 40).map((r) =>
    [b(`❌ ${days === 1 ? "" : dm(r.d) + " "}${r.t1} ${String(r.name ?? "").slice(0, 20)}`, `acx:${r.id}`)]);
  btns.push([b("🔄 Обновить", `lst:${days}`), b(days === 1 ? "🗓 Неделя" : "📅 Сегодня", `lst:${days === 1 ? 7 : 1}`)]);
  if (rows.length) t += "Чтобы отменить запись клиента, нажмите на неё ниже.";
  await c.show(u.chat, msgId, t, kb(btns));
}

async function adminAskCancel(c: Bot, u: User, id: string, msgId?: number) {
  const bk = await getBooking(c, id);
  if (!bk || bk.status !== "active") {
    return c.show(u.chat, msgId, "Эта запись уже отменена.", kb([[b("📅 Сегодня", "lst:1"), b("🗓 Неделя", "lst:7")]]));
  }
  await c.show(u.chat, msgId,
    `Отменить запись клиента?\n\n${clientLine(bk)}\n${bookingText(c, bk, false)}\n\nКлиент получит уведомление об отмене.`,
    kb([[b("Да, отменить", `acxy:${id}`)], [b("Нет, оставить", "lst:7")]]));
}

async function adminDoCancel(c: Bot, u: User, id: string, msgId?: number) {
  if (!/^\d+$/.test(id ?? "")) return;
  const upd = await sql`
    update booking.bookings set status = 'cancelled_by_master', cancelled_at = now()
    where id = ${id} and master_id = ${c.m.id} and status = 'active' returning id`;
  const back = kb([[b("📅 Сегодня", "lst:1"), b("🗓 Неделя", "lst:7")]]);
  if (!upd.length) return c.show(u.chat, msgId, "Эта запись уже отменена.", back);
  const bk = await getBooking(c, id);
  if (bk!.future) {
    await c.send(bk!.tg,
      `😔 <b>Запись отменена мастером</b>\n\n${bookingText(c, bk!, false)}\n\nПриносим извинения за неудобства! Выберите, пожалуйста, другое время 👇`,
      kb([[b("💅 Записаться", "book")]]));
  }
  await c.show(u.chat, msgId, `✅ Запись отменена${bk!.future ? ", клиент получил уведомление" : ""}.`, back);
}

async function adminMenu(c: Bot, u: User, msgId?: number) {
  await clearSession(c, u);
  await c.show(u.chat, msgId, "⚙️ <b>Управление</b>\n\nЧто хотите сделать?", kb([
    [b("🚫 Закрыть дни", "adm:days"), b("⏰ Закрыть часы", "adm:hours")],
    [b("📌 Закрытые даты", "adm:blocks")],
    [b("💅 Услуги и цены", "adm:svcs"), b("🕐 График", "adm:wh")],
    [b("📍 Адрес", "adm:addr")],
  ]));
}
const backToAdmin = kb([[b("⬅️ Отмена", "adm")]]);

async function adminPrompt(c: Bot, u: User, what: string, msgId?: number) {
  switch (what) {
    case "days":
      await setSession(c, u, "blk_days");
      return c.show(u.chat, msgId,
        "🚫 <b>Закрыть дни</b>\n\nНапишите дату или период, когда вы не работаете:\n" +
        "• <code>15.11</code> — один день\n• <code>20.11-30.11</code> — отпуск\n• <code>завтра</code>", backToAdmin);
    case "hours":
      await setSession(c, u, "blk_time");
      return c.show(u.chat, msgId,
        "⏰ <b>Закрыть часы</b>\n\nНапишите дату и время, например:\n" +
        "• <code>15.11 14:00-16:00</code>\n• <code>сегодня 18:00-20:00</code>", backToAdmin);
    case "addr":
      await setSession(c, u, "addr");
      return c.show(u.chat, msgId,
        `📍 <b>Адрес</b>\n\nСейчас: ${c.m.address ? esc(c.m.address) : "не указан"}\n\n` +
        "Напишите адрес — он будет в приветствии, подтверждении и напоминаниях.\nЧтобы убрать адрес, отправьте <code>-</code>", backToAdmin);
    case "blocks": return showBlocks(c, u, msgId);
    case "svcs": return showAdminServices(c, u, msgId);
    case "wh": return showWorkHours(c, u, msgId);
    default: return adminMenu(c, u, msgId);
  }
}

async function conflictsText(c: Bot, rangeSql: ReturnType<typeof sql>) {
  const tz = c.m.tz;
  const rows = await sql`
    select bk.id::text, to_char(bk.starts_at at time zone ${tz}, 'YYYY-MM-DD') as d,
           to_char(bk.starts_at at time zone ${tz}, 'HH24:MI') as t1, cl.name
    from booking.bookings bk join booking.clients cl on cl.id = bk.client_id
    where bk.master_id = ${c.m.id} and bk.status = 'active' and tstzrange(bk.starts_at, bk.ends_at) && ${rangeSql}
    order by bk.starts_at`;
  if (!rows.length) return { text: "", btns: [] as Btn[][] };
  return {
    text: "\n\n⚠️ На это время уже есть записи — они остались в силе. Если нужно, отмените их (клиенты получат уведомление):",
    btns: rows.slice(0, 20).map((r) => [b(`❌ ${dm(r.d)} ${r.t1} ${String(r.name ?? "").slice(0, 20)}`, `acx:${r.id}`)]),
  };
}

async function handleAdminText(c: Bot, u: User, state: string, data: Row, text: string) {
  const tz = c.m.tz;
  const today = todayIn(tz);

  if (state === "blk_days") {
    const ds = findDates(text, today);
    if (!ds || !ds.length || ds.length > 2) {
      return c.send(u.chat, "Не получилось распознать дату 🙈 Напишите, например, <code>15.11</code> или <code>20.11-30.11</code>", backToAdmin);
    }
    const [d1, d2] = ds.length === 2 ? [ds[0], ds[1]].sort() : [ds[0], ds[0]];
    if (d1 < today) return c.send(u.chat, "Эта дата уже прошла. Напишите будущую дату 🙂", backToAdmin);
    if ((Date.parse(d2) - Date.parse(d1)) / 864e5 > 92) return c.send(u.chat, "Слишком длинный период (больше 3 месяцев). Разбейте его на части.", backToAdmin);
    const range = sql`tstzrange((${d1}::date)::timestamp at time zone ${tz}, (${d2}::date + 1)::timestamp at time zone ${tz})`;
    await sql`insert into booking.blocks(master_id, period, reason) values (${c.m.id}, ${range}, 'days')`;
    await clearSession(c, u);
    const cf = await conflictsText(c, range);
    const label = d1 === d2 ? cap(dateLong(d1)) : `с ${dm(d1)} по ${dm(d2)}`;
    return c.send(u.chat, `✅ Готово! Закрыто: <b>${label}</b>.\nКлиенты не смогут записаться на это время.${cf.text}`,
      kb([...cf.btns, [b("📌 Закрытые даты", "adm:blocks"), b("⬅️ Управление", "adm")]]));
  }

  if (state === "blk_time") {
    const tr = findTimeRange(text);
    const rest = tr ? text.replace(/(\d{1,2})[:.](\d{2})\s*(?:-|–|—|до)\s*(\d{1,2})[:.](\d{2})/, " ") : text;
    const ds = findDates(rest, today);
    if (!tr || !ds || ds.length !== 1) {
      return c.send(u.chat, "Не получилось распознать 🙈 Напишите, например, <code>15.11 14:00-16:00</code>", backToAdmin);
    }
    const d = ds[0];
    if (d < today) return c.send(u.chat, "Эта дата уже прошла. Напишите будущую дату 🙂", backToAdmin);
    const range = sql`tstzrange((${d}::date + ${tr[0]}::time) at time zone ${tz}, (${d}::date + ${tr[1]}::time) at time zone ${tz})`;
    await sql`insert into booking.blocks(master_id, period, reason) values (${c.m.id}, ${range}, 'hours')`;
    await clearSession(c, u);
    const cf = await conflictsText(c, range);
    return c.send(u.chat, `✅ Готово! Закрыто: <b>${cap(dateLong(d))}, ${tr[0]}–${tr[1]}</b>.${cf.text}`,
      kb([...cf.btns, [b("📌 Закрытые даты", "adm:blocks"), b("⬅️ Управление", "adm")]]));
  }

  if (state === "addr") {
    const v = text === "-" ? null : text.slice(0, 200);
    await sql`update booking.masters set address = ${v} where id = ${c.m.id}`;
    c.m.address = v;
    await clearSession(c, u);
    return c.send(u.chat, v ? `✅ Адрес сохранён: ${esc(v)}` : "✅ Адрес убран.", kb([[b("⬅️ Управление", "adm")]]));
  }

  if (state === "svc_add" || state === "svc_edit") {
    const p = text.split(/[;|]/).map((x) => x.trim());
    let mins = NaN;
    if (p.length === 3) {
      const tm = p[2].match(/^(\d{1,2})[:.](\d{2})$/);
      mins = tm ? +tm[1] * 60 + +tm[2] : parseInt(p[2].replace(/\D/g, ""), 10);
    }
    const pr = p.length === 3 ? parseInt(p[1].replace(/\D/g, ""), 10) : NaN;
    if (p.length !== 3 || !p[0] || p[0].length > 60 || !(pr >= 0 && pr <= 1_000_000) || !(mins >= 10 && mins <= 600)) {
      return c.send(u.chat,
        "Не получилось распознать 🙈 Напишите одной строкой через точку с запятой:\n<code>Название; цена; минуты</code>\n" +
        "Например: <code>Маникюр + гель-лак; 2200; 120</code>", kb([[b("⬅️ К услугам", "adm:svcs")]]));
    }
    if (state === "svc_add") {
      await sql`
        insert into booking.services(master_id, name, price, duration_min, sort)
        values (${c.m.id}, ${p[0]}, ${pr}, ${mins},
                (select coalesce(max(sort), 0) + 1 from booking.services where master_id = ${c.m.id}))`;
    } else {
      await sql`update booking.services set name = ${p[0]}, price = ${pr}, duration_min = ${mins}
                where id = ${data.id} and master_id = ${c.m.id}`;
    }
    await clearSession(c, u);
    await c.send(u.chat, `✅ Сохранено: <b>${esc(p[0])}</b> — ${price(pr)}, ${dur(mins)}`);
    return showAdminServices(c, u);
  }

  if (state === "wh_edit") {
    const wd = Number(data.wd);
    const low = text.toLowerCase();
    if (/выходн|нет|^-$/.test(low)) {
      await sql`delete from booking.work_hours where master_id = ${c.m.id} and weekday = ${wd}`;
    } else {
      const tr = findTimeRange(text);
      if (!tr) {
        return c.send(u.chat, "Не получилось распознать 🙈 Напишите, например, <code>10:00-20:00</code> или <code>выходной</code>",
          kb([[b("⬅️ К графику", "adm:wh")]]));
      }
      await sql`
        insert into booking.work_hours(master_id, weekday, start_time, end_time) values (${c.m.id}, ${wd}, ${tr[0]}, ${tr[1]})
        on conflict (master_id, weekday) do update set start_time = excluded.start_time, end_time = excluded.end_time`;
    }
    await clearSession(c, u);
    return showWorkHours(c, u, undefined, "✅ Сохранено!\n\n");
  }
}

async function showBlocks(c: Bot, u: User, msgId?: number) {
  await clearSession(c, u);
  const tz = c.m.tz;
  const rows = await sql`
    select id::text,
           to_char(lower(period) at time zone ${tz}, 'YYYY-MM-DD') as d1,
           to_char(lower(period) at time zone ${tz}, 'HH24:MI') as t1,
           to_char(upper(period) at time zone ${tz}, 'YYYY-MM-DD') as d2,
           to_char(upper(period) at time zone ${tz}, 'HH24:MI') as t2,
           to_char((upper(period) at time zone ${tz}) - interval '1 day', 'YYYY-MM-DD') as d2m
    from booking.blocks where master_id = ${c.m.id} and upper(period) > now()
    order by lower(period) limit 30`;
  const label = (r: Row) => {
    if (r.t1 === "00:00" && r.t2 === "00:00") return r.d1 === r.d2m ? `${dm(r.d1)} (весь день)` : `${dm(r.d1)}–${dm(r.d2m)} (дни)`;
    return r.d1 === r.d2 ? `${dm(r.d1)} ${r.t1}–${r.t2}` : `${dm(r.d1)} ${r.t1} – ${dm(r.d2)} ${r.t2}`;
  };
  let t = "📌 <b>Закрытые даты и часы</b>\n\n";
  t += rows.length ? rows.map((r) => `• ${label(r)}`).join("\n") + "\n\nНажмите, чтобы снова открыть для записи:" : "Ничего не закрыто — все рабочие дни открыты для записи.";
  const btns = rows.map((r) => [b(`🗑 ${label(r)}`, `ubl:${r.id}`)]);
  btns.push([b("🚫 Закрыть дни", "adm:days"), b("⏰ Закрыть часы", "adm:hours")]);
  btns.push([b("⬅️ Управление", "adm")]);
  await c.show(u.chat, msgId, t, kb(btns));
}

async function showAdminServices(c: Bot, u: User, msgId?: number) {
  await clearSession(c, u);
  const svcs = await sql`
    select id::text, name, price, duration_min from booking.services
    where master_id = ${c.m.id} and active order by sort, id`;
  let t = "💅 <b>Услуги и цены</b>\n\n";
  t += svcs.length ? svcs.map((s) => `• ${esc(s.name)} — ${price(s.price)}, ${dur(s.duration_min)}`).join("\n") : "Услуг пока нет.";
  t += "\n\nНажмите на услугу, чтобы изменить или удалить её.";
  const btns = svcs.map((s) => [b(s.name, `sv:${s.id}`)]);
  btns.push([b("➕ Добавить услугу", "sva")]);
  btns.push([b("⬅️ Управление", "adm")]);
  await c.show(u.chat, msgId, t, kb(btns));
}

async function showWorkHours(c: Bot, u: User, msgId?: number, prefix = "") {
  await clearSession(c, u);
  const rows = await sql`
    select weekday, to_char(start_time, 'HH24:MI') as s, to_char(end_time, 'HH24:MI') as e
    from booking.work_hours where master_id = ${c.m.id}`;
  const map = new Map(rows.map((r) => [Number(r.weekday), `${r.s}–${r.e}`]));
  let t = `${prefix}🕐 <b>График работы</b>\n\n`;
  for (let i = 1; i <= 7; i++) t += `${WD_SHORT[i - 1]}: ${map.get(i) ?? "выходной"}\n`;
  t += "\nНажмите на день, чтобы изменить часы.\nРазовые выходные и отпуск — через «🚫 Закрыть дни».";
  const days = [1, 2, 3, 4, 5, 6, 7].map((i) => b(WD_SHORT[i - 1], `wd:${i}`));
  await c.show(u.chat, msgId, t, kb([days.slice(0, 4), days.slice(4), [b("⬅️ Управление", "adm")]]));
}

// ---------------------------------------------------------------- маршрутизация
async function onCallback(c: Bot, u: User, data: string, msgId: number) {
  const [a, p1, p2] = data.split(":");
  switch (a) {
    case "book": await clearSession(c, u); return showServices(c, u, msgId);
    case "svc": return showDates(c, u, p1, msgId);
    case "day": return showTimes(c, u, p1, p2, msgId);
    case "t": return pickTime(c, u, p1, p2, msgId);
    case "ok": return doConfirm(c, u, msgId);
    case "nope":
      await clearSession(c, u);
      return c.show(u.chat, msgId, "Хорошо, запись не оформлена. Если передумаете — нажмите «💅 Записаться» 🙂",
        kb([[b("💅 Записаться", "book")]]));
    case "chg": {
      const ss = await getSession(c, u);
      if (ss.state !== "confirm") return showServices(c, u, msgId);
      await c.show(u.chat, msgId, "Хорошо, давайте уточним данные 🙂");
      return askName(c, u, ss.data);
    }
    case "my": await clearSession(c, u); return myBookings(c, u, msgId);
    case "cx": return askCancel(c, u, p1, msgId);
    case "cxy": return doCancel(c, u, p1, msgId);
  }

  if (!u.admin) return;
  switch (a) {
    case "lst": return adminList(c, u, p1 === "7" ? 7 : 1, msgId);
    case "acx": return adminAskCancel(c, u, p1, msgId);
    case "acxy": return adminDoCancel(c, u, p1, msgId);
    case "adm": return p1 ? adminPrompt(c, u, p1, msgId) : adminMenu(c, u, msgId);
    case "ubl":
      if (/^\d+$/.test(p1 ?? "")) await sql`delete from booking.blocks where id = ${p1} and master_id = ${c.m.id}`;
      return showBlocks(c, u, msgId);
    case "sv": {
      const s = await getService(c, p1);
      if (!s) return showAdminServices(c, u, msgId);
      return c.show(u.chat, msgId, `💅 <b>${esc(s.name)}</b>\n💰 ${price(s.price)} · ⏱ ${dur(s.duration_min)}`, kb([
        [b("✏️ Изменить", `sve:${s.id}`), b("🗑 Удалить", `svd:${s.id}`)],
        [b("⬅️ К услугам", "adm:svcs")],
      ]));
    }
    case "sva":
      await setSession(c, u, "svc_add");
      return c.show(u.chat, msgId,
        "➕ <b>Новая услуга</b>\n\nНапишите одной строкой через точку с запятой:\n<code>Название; цена; минуты</code>\n\n" +
        "Например: <code>Педикюр; 2500; 90</code>", kb([[b("⬅️ К услугам", "adm:svcs")]]));
    case "sve": {
      const s = await getService(c, p1);
      if (!s) return showAdminServices(c, u, msgId);
      await setSession(c, u, "svc_edit", { id: s.id });
      return c.show(u.chat, msgId,
        `✏️ <b>${esc(s.name)}</b>\n\nНапишите новые данные одной строкой:\n<code>Название; цена; минуты</code>\n\n` +
        `Сейчас: <code>${esc(s.name)}; ${s.price}; ${s.duration_min}</code>\n(можно скопировать и поправить)`,
        kb([[b("⬅️ К услугам", "adm:svcs")]]));
    }
    case "svd": {
      const s = await getService(c, p1);
      if (!s) return showAdminServices(c, u, msgId);
      return c.show(u.chat, msgId, `Удалить услугу «${esc(s.name)}»?\nУже существующие записи на неё сохранятся.`,
        kb([[b("Да, удалить", `svdy:${s.id}`)], [b("Нет", `sv:${s.id}`)]]));
    }
    case "svdy":
      if (/^\d+$/.test(p1 ?? "")) await sql`delete from booking.services where id = ${p1} and master_id = ${c.m.id}`;
      return showAdminServices(c, u, msgId);
    case "wd": {
      const wd = Number(p1);
      if (!(wd >= 1 && wd <= 7)) return showWorkHours(c, u, msgId);
      await setSession(c, u, "wh_edit", { wd });
      return c.show(u.chat, msgId,
        `🕐 <b>${WD_TITLE[wd - 1]}</b>\n\nНапишите часы работы, например <code>10:00-20:00</code>\nили слово <code>выходной</code>`,
        kb([[b("⬅️ К графику", "adm:wh")]]));
    }
  }
}

async function onMessage(c: Bot, u: User, msg: Row) {
  const text: string = (msg.text ?? "").trim();
  const ss = await getSession(c, u);

  // Номер телефона кнопкой «Поделиться номером»
  if (msg.contact) {
    if (ss.state !== "ask_phone") return c.send(u.chat, "Спасибо! 🙂", menuKb(u.admin));
    return savePhone(c, u, ss.data, String(msg.contact.phone_number ?? ""));
  }

  if (/^\/start(\s|$|@)/.test(text)) return cmdStart(c, u);
  if (text === "/book" || text === "💅 Записаться") { await clearSession(c, u); return showServices(c, u); }
  if (text === "/my" || text === "📋 Мои записи") { await clearSession(c, u); return myBookings(c, u); }
  if (u.admin) {
    if (text === "/today" || text === "📅 Сегодня") { await clearSession(c, u); return adminList(c, u, 1); }
    if (text === "/week" || text === "🗓 Неделя") { await clearSession(c, u); return adminList(c, u, 7); }
    if (text === "/admin" || text === "⚙️ Управление") return adminMenu(c, u);
  }
  if (text.startsWith("/")) return c.send(u.chat, "Такой команды нет 🙂 Воспользуйтесь кнопками меню ниже.", menuKb(u.admin));
  if (!text) return c.send(u.chat, "Я понимаю только текст и кнопки 🙂", menuKb(u.admin));

  if (ss.state === "ask_name") {
    const name = text.replace(/\s+/g, " ").slice(0, 50);
    if (name.length < 2) return c.send(u.chat, "Напишите, пожалуйста, имя (хотя бы 2 буквы) 🙂");
    await sql`update booking.clients set name = ${name} where master_id = ${c.m.id} and tg_id = ${u.uid}`;
    return askPhone(c, u, ss.data);
  }
  if (ss.state === "ask_phone") return savePhone(c, u, ss.data, text);

  if (u.admin && ss.state) {
    const r = await handleAdminText(c, u, ss.state, ss.data, text);
    if (r !== undefined) return r;
  }
  return c.send(u.chat, "Воспользуйтесь, пожалуйста, кнопками меню ниже 👇", menuKb(u.admin));
}

async function savePhone(c: Bot, u: User, data: Row, raw: string) {
  const phone = normalizePhone(raw);
  if (!phone) {
    return c.send(u.chat, "Не похоже на номер телефона 🙈 Нажмите «📱 Поделиться номером» или напишите номер, например <code>+7 999 123-45-67</code>");
  }
  await ensureClient(c, u);
  await sql`update booking.clients set phone = ${phone} where master_id = ${c.m.id} and tg_id = ${u.uid}`;
  await c.send(u.chat, "Спасибо! 👍", menuKb(u.admin));
  if (data?.svc && data?.ts) {
    await setSession(c, u, "confirm", data);
    return showConfirm(c, u);
  }
  await clearSession(c, u);
}

async function handleUpdate(c: Bot, upd: Row) {
  const cq = upd.callback_query;
  const msg = cq?.message ?? upd.message;
  const from = cq?.from ?? upd.message?.from;
  if (!msg || !from || msg.chat?.type !== "private" || from.is_bot) return;
  const u: User = {
    uid: String(from.id),
    chat: String(msg.chat.id),
    first: String(from.first_name ?? "").trim(),
    username: from.username ?? null,
    admin: String(from.id) === String(c.m.admin_tg_id),
  };
  if (cq) {
    await c.api("answerCallbackQuery", { callback_query_id: cq.id });
    return onCallback(c, u, String(cq.data ?? ""), msg.message_id);
  }
  return onMessage(c, u, msg);
}

// ---------------------------------------------------------------- вход
Deno.serve(async (req) => {
  if (req.method !== "POST") return new Response("ok");
  const slug = new URL(req.url).searchParams.get("m") ?? "";
  const secret = req.headers.get("x-telegram-bot-api-secret-token") ?? "";
  if (!/^[a-z0-9_-]{2,32}$/.test(slug) || !secret) return new Response("forbidden", { status: 403 });

  const [m] = await sql`
    select m.*, m.id::text as id, m.admin_tg_id::text as admin_tg_id, s.bot_token, s.webhook_secret
    from booking.masters m join booking.master_secrets s on s.master_id = m.id
    where m.slug = ${slug} and m.active`;
  if (!m || !safeEqual(secret, m.webhook_secret)) return new Response("forbidden", { status: 403 });

  let upd: Row;
  try { upd = await req.json(); } catch { return new Response("bad request", { status: 400 }); }

  try {
    await handleUpdate(new Bot(m), upd);
  } catch (e) {
    console.error(`update ${upd?.update_id} failed: ${(e as Error).stack ?? e}`);
  }
  return new Response("ok");
});
