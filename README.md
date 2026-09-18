# Timeblock

Personal productivity & time-blocking app: Google/Outlook calendar sync, recurring daily schedule templates, auto-scheduling, drag-and-drop reorder, start/stop timers, utilization + weekly reports.

## Stack

- **Monorepo:** npm workspaces
- **Backend:** NestJS + Prisma + Supabase Postgres (REST fallback when `:5432` is blocked)
- **Frontend:** React + Vite + TanStack Query + dnd-kit
- **Auth:** Google OAuth + email/password; session cookie; OAuth tokens encrypted at rest

## Local development

```bash
cd timeblock
npm install
cp .env.example apps/server/.env   # fill secrets
npm run db:generate
npm run db:push
npm run dev
```

- Web: http://127.0.0.1:5173 (or the port Vite prints)
- API: http://127.0.0.1:3001/api

If `localhost:5173` looks stale, use **http://127.0.0.1:5173** or run `./kill-5173.sh` then `npm run dev`.

## Production

Single process serves the API and the built SPA (same origin → session cookies work):

```bash
# 1. Set apps/server/.env for production
#    NODE_ENV=production
#    WEB_ORIGIN=https://your.domain
#    SESSION_SECRET=$(openssl rand -base64 48)
#    TOKEN_ENCRYPTION_KEY=$(openssl rand -base64 48)
#    GOOGLE_CALLBACK_URL=https://your.domain/api/auth/google/callback
#    DATABASE_URL=... (must be reachable)

# 2. Build + start
npm run start:prod
# → http://localhost:3001  (SPA + /api)
```

Checklist before go-live:

1. Supabase `DATABASE_URL` reachable (sessions require Postgres in prod)
2. Strong `SESSION_SECRET` + `TOKEN_ENCRYPTION_KEY`
3. `ALLOW_DEV_LOGIN=false`
4. Google OAuth redirect URI matches `GOOGLE_CALLBACK_URL`
5. `WEB_ORIGIN` lists your real HTTPS front-end origin(s)

## Database

```bash
npm run db:generate
npm run db:push
```

## Scripts

| Script | Description |
|--------|-------------|
| `npm run dev` | API + web concurrently |
| `npm run build` | Build all packages |
| `npm run start:prod` | Build + run Nest (serves SPA + API) |
| `npm run db:generate` | Prisma client |
| `npm run db:push` | Push schema to DB |

## App map

| Path | Purpose |
|------|---------|
| `/` | Today timeline, add tasks, drag reorder, timer |
| `/report` | Weekly estimated vs actual |
| `/settings` | Weekday templates, calendar connect/sync |
