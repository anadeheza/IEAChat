# AGENTS.md

## Repo layout

- **`backend/`** — Node/Express/TypeScript REST API with Prisma (PostgreSQL). This is the only package with real build logic.
- **`frontend/`** — Static HTML/CSS/JS. No build step; open `index.html` directly or serve statically.
- **`storage/`** — Runtime directory for local attachments and (historically) SQLite. Gitignored.
- Root `package.json` is essentially empty; ignore it.

## Node & TypeScript

- Node **20.x** (`.nvmrc` says `nvm use 20.20.2`).
- `tsconfig.json` uses `module: Node16`, `moduleResolution: node16`, `rootDir: src`, `outDir: dist`.
- Compiled output goes to `backend/dist/`; it is currently checked in but also listed in `.gitignore`.

## Working in `backend/`

All commands assume `cd backend`.

- `npm install` — install deps.
- `npm run dev` — run API via `ts-node src/index.ts` (port 3000 by default).
- `npm run build` — compile `src/` to `dist/` (`tsc`).
- `npm run start` — run compiled `dist/index.js`.
- `npm run import` — console script (`src/console/index.ts`) that imports Flock HTML exports from `backend/data/` into PostgreSQL.
- `npm run db:migrate` — `prisma migrate dev`.
- `npm run db:generate` — regenerate Prisma Client after schema changes.
- `npm run db:studio` — open Prisma Studio.
- `npm run migrate:sqlite-to-postgres` — one-off script (`scripts/migrateSqliteToPostgres.ts`) to migrate a legacy SQLite DB.

## Environment & secrets

- Config lives in `backend/.env` and `backend/.env.example`.
- **`.env` is committed** (it contains real credentials). Do not assume it is ignored.
- Required variables:
  - `DATABASE_URL` — PostgreSQL connection string.
  - `ALLOWED_ORIGINS` — comma-separated CORS origins (e.g. `http://localhost:5500,https://iea-chat.vercel.app`).
  - `MAIL_*` — SMTP settings for OTP login emails. `MAIL_OVERRIDE_RECIPIENT` redirects all emails to a single address for testing.
  - `MINIO_ENDPOINT`, `MINIO_ACCESS_KEY`, `MINIO_SECRET_KEY`, `MINIO_BUCKET` — optional; if missing, attachments fall back to local `storage/attachments`.
- `APP_NAME` and `PORT` also affect runtime.

## Database & data import

- Schema: `prisma/schema.prisma`. PostgreSQL only.
- Seed: `prisma/seed.ts` (invoked via `npx prisma db seed` or `prisma seed`).
- Import workflow (`npm run import`) expects this folder structure under `backend/data/` (gitignored):
  ```
  data/
    users.json
    channels.json
    users/      # DM HTML exports: <userId>,<name>.html
    groups/     # Group HTML exports: <name>-<channelId>.html
  ```
- `check-migration.js` is a standalone sanity checker for row counts after SQLite→PostgreSQL migration.

## Architecture notes

- Entrypoint: `src/index.ts`. Registers `src/routes/Api.routes.ts` under `/api`.
- Auth is OTP-based via email (`/api/auth/signin`, `/api/auth/verify`). No passwords.
- Attachments:
  - URLs from Flock are stored in `Attachment.url`.
  - Downloader (`src/services/attachmentDownloader.ts`) supports S3-compatible (MinIO/DO Spaces) **or** local fallback to `storage/attachments`.
  - When local, the server exposes `storage/` statically at `/storage`.
- Frontend `window.API_BASE` is hardcoded to `http://localhost:3000/api` in `frontend/index.html`; must be edited for production deploys.

## Testing & quality

- **No test suite, no linter, no formatter, and no CI** are configured. Do not assume `npm test` or `npm run lint` exist.

## Spanish language convention

- UI strings, log output, and README are in Spanish. Keep new user-facing strings in Spanish unless explicitly asked otherwise.
