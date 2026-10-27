# CAPITAL

Многопользовательский бизнес-симулятор в Telegram Mini App.

- `app/` — фронтенд (React + Vite + TypeScript), хостинг Netlify.
- `supabase/` — сервер: база Postgres и Edge Functions (появится на этапе 2).

Вся игровая логика и деньги — только на сервере. Клиент отправляет действия и показывает результат.

## Локальный запуск фронтенда

```bash
cd app
npm install
npm run dev
```
