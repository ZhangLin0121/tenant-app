# Repository Guidelines

## Project Structure & Module Organization
- `tenant-dashboard/`: Node.js/Express API with Mongoose and Puppeteer. Entry: `index.js`; env config: `.env` (see `.env.example`). Models in `models/`, routes in `routes/`, services in `services/`.
- `tenant-frontend/`: Vue 3 + Vite + Tailwind UI. Entry: `src/main.js`; components in `src/components/`. Vite dev server proxies `/api` to backend.
- `scripts/`: Local MongoDB helpers (`mongo-up.sh`, `mongo-down.sh`).
- `start.sh`: One-command local startup for both apps. `ecosystem.config.js`: PM2 production setup.

## Build, Test, and Development Commands
- Install deps:
  - Backend: `cd tenant-dashboard && npm i` (or `pnpm i`)
  - Frontend: `cd tenant-frontend && pnpm i` (or `npm i`)
- Start MongoDB: `bash scripts/mongo-up.sh` (URI: `mongodb://127.0.0.1:27017/tenantDB`)
- Run locally: `./start.sh` (frontend on `5173`, backend on `5001`)
- Direct runs:
  - Backend: `node tenant-dashboard/index.js`
  - Frontend: `cd tenant-frontend && pnpm run dev`
- No formal test suite yet; see Testing Guidelines below for expectations.

## Coding Style & Naming Conventions
- Indentation: 2 spaces; include semicolons in JS.
- Frontend: Vue components `PascalCase` (e.g., `StudentsTable.vue`); composables/utilities `camelCase.js`.
- Backend: files follow `<domain>.<type>.js` (e.g., `tenant.model.js`, `tenant.routes.js`). Functions/vars use `camelCase`.
- Formatting/Linting: Prettier and ESLint in `tenant-frontend` (`npm run lint` if configured). Keep code consistent in backend; prefer Prettier style.

## Testing Guidelines
- Frameworks: none configured. For new logic, add lightweight tests where practical or include a reproducible script.
- Manual checks:
  - API: `curl http://localhost:5001/api/tenants` and `curl -X POST http://localhost:5001/api/sync`.
  - UI: run `pnpm run dev` and verify tables, filters, and sync indicators.
- Keep changes small and covered by clear steps to verify.

## Commit & Pull Request Guidelines
- Commits: use Conventional Commits when possible (e.g., `feat: add tenant sync status`, `fix: handle missing idCard`).
- Branches: `feat/...`, `fix/...`, `chore/...`.
- PRs must include:
  - What & why (linked issue if any) and how to verify.
  - Local run steps (commands) and screenshots/GIFs for UI changes.
  - Notes on env vars (`tenant-dashboard/.env`) and any data migration.

## Security & Configuration Tips
- Never commit secrets. Copy `tenant-dashboard/.env.example` to `.env` and fill values.
- Puppeteer on macOS uses system Chrome; ensure Chrome is installed. Rotate credentials if leaked.
