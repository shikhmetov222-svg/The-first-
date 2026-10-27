// Публичные адреса сервера. Эти значения не секретные: защита — в проверке подписи Telegram на сервере.
export const SUPABASE_URL =
  import.meta.env.VITE_SUPABASE_URL ?? 'https://kadaesapsptfabygjkow.supabase.co';
export const SUPABASE_PUBLISHABLE_KEY =
  import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY ?? 'sb_publishable_zTSUFfg6ex3Zs6GGIUs1bw_C01KUrWj';
