# FastBot

Ultra-secure personal AI gateway. Runs on Android (Termux) or any Node.js server.

## Architecture
- **Monorepo**: pnpm workspaces with 3 packages
  - `packages/gateway` — Node.js 22 + TypeScript, Socket.io hub, Telegram bot, LLM router, agent orchestrator
  - `packages/dashboard` — Next.js 14 PWA + Tailwind + shadcn/ui
  - `packages/playwright` — Sandboxed Chromium worker for web automation

## Key Commands
- `pnpm dev` — Start all packages in development mode
- `pnpm build` — Build all packages
- `pnpm --filter @fastbot/gateway run dev` — Start gateway only
- `pnpm --filter @fastbot/dashboard run dev` — Start dashboard only

## Conventions
- TypeScript strict mode everywhere
- ESM (`"type": "module"`) for gateway and playwright packages
- All secrets encrypted with AES-256-GCM, key derived via PBKDF2 from user PIN
- Config validated with Zod schemas at startup
- Logging via pino with automatic secret redaction
- Security: SSRF blocking, path traversal prevention, binary allowlist, rate limiting, append-only audit log

## Ports
- Gateway WebSocket: 18789
- Dashboard: 3100
