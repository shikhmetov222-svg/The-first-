// Настройки подключения к Supabase для командной игры.
//
// Сюда кладём ТОЛЬКО два публичных значения. Секретных ключей здесь быть не должно
// (ключи service_role и sb_secret_… сюда не вставлять никогда).
// Публичный ключ можно хранить в репозитории: без правил в базе (supabase/schema.sql) он ничего не даёт.
//
// Где взять значения: Supabase → твой проект → Project Settings → API Keys
//   supabaseUrl — «Project URL», выглядит как https://abcdefgh.supabase.co
//   supabaseKey — «Publishable key», начинается с sb_publishable_…
//
// Если вместо значений стоят заглушки YOUR_…, командная игра выключена, а одиночная работает как раньше.
window.COLONY_CONFIG = {
  supabaseUrl: 'https://nwitfifdtkfhmkpjdxrf.supabase.co',
  supabaseKey: 'sb_publishable_OdN00OmZ_PlI8PzhfFuSVg_ZLSlmz8w',
};
