<p align="center">
  <video src="https://github.com/benclawbot/SecuredClaudeBot/raw/master/assets/secureclaudebot-demo.mp4" width="720" autoplay loop muted playsinline>
    Your browser does not support the video tag.
  </video>
</p>

<h1 align="center">SecureClaudebot</h1>

<p align="center">
  <b>Ultra-secure personal AI gateway</b> &mdash; Telegram + Mission Control dashboard<br>
  Inspired by <a href="https://github.com/nicepkg/openclaw">OpenClaw</a> &bull; Runs on Android (Termux), Linux, macOS &amp; Windows
</p>

<p align="center">
  <img src="https://img.shields.io/badge/Node.js-22+-339933?logo=nodedotjs&logoColor=white" alt="Node.js 22+">
  <img src="https://img.shields.io/badge/TypeScript-strict-3178C6?logo=typescript&logoColor=white" alt="TypeScript">
  <img src="https://img.shields.io/badge/Tests-289_passing-brightgreen?logo=vitest" alt="289 tests">
  <img src="https://img.shields.io/badge/License-MIT-blue" alt="MIT License">
  <img src="https://img.shields.io/badge/pnpm-10.30+-F69220?logo=pnpm&logoColor=white" alt="pnpm">
</p>

---

## Table of Contents

- [Overview](#overview)
- [Architecture](#architecture)
- [Features](#features)
  - [Multi-LLM Routing](#multi-llm-routing)
  - [Military-Grade Encryption](#military-grade-encryption)
  - [Security Suite](#security-suite)
  - [Telegram Bot](#telegram-bot)
  - [Mission Control Dashboard](#mission-control-dashboard)
  - [Agent Orchestrator](#agent-orchestrator)
  - [Memory Systems](#memory-systems)
  - [Web Automation](#web-automation)
  - [Integrations](#integrations)
  - [Workflow Engine](#workflow-engine)
  - [Cron Scheduler](#cron-scheduler)
  - [Media Handler](#media-handler)
  - [Diagnostics](#diagnostics)
- [Installation](#installation)
  - [Prerequisites](#prerequisites)
  - [Quick Start](#quick-start)
  - [Termux (Android)](#termux-android)
  - [Environment Variables](#environment-variables)
- [Configuration](#configuration)
- [Usage](#usage)
- [Project Structure](#project-structure)
- [Testing](#testing)
- [Security Model](#security-model)
- [API Reference](#api-reference)

---

## Overview

SecureClaudebot is a self-hosted, privacy-first AI gateway that puts **you** in control. It acts as a secure intermediary between you and multiple LLM providers (Claude, GPT-4o, Gemini, Ollama), accessible through both a Telegram bot and a full-featured web dashboard. Every secret is encrypted at rest with AES-256-GCM, every action is recorded in an append-only audit log, and every external request passes through SSRF protection.

**Why SecureClaudebot?**

- **Own your data** &mdash; Everything runs on your hardware. No third-party servers see your conversations.
- **Multi-LLM with fallback** &mdash; Primary provider goes down? Automatically falls through to the next.
- **Android-native** &mdash; Zero native dependencies (pure JS/WASM SQLite via sql.js) means it runs flawlessly on Termux.
- **289 tests** across 23 test suites &mdash; Battle-tested security, encryption, and session management.

---

## Architecture

SecureClaudebot is a **pnpm monorepo** with three packages that communicate via Socket.io WebSockets and JSON-RPC:

```
                        +---------------------------+
                        |      Telegram Users       |
                        +-------------+-------------+
                                      |
                                      | grammY Bot API
                                      v
+---------------------+    +---------+-----------+    +---------------------+
|                     |    |                     |    |                     |
|   @scb/dashboard    |<-->|    @scb/gateway     |<-->|  @scb/playwright    |
|                     |    |                     |    |                     |
|  Next.js 15 PWA     |    |  Node.js 22 + TS    |    |  Chromium Worker    |
|  React 19           |    |  Socket.io Hub      |    |  JSON-RPC stdin/out |
|  Tailwind CSS 4     |    |  LLM Router         |    |  Headless Browser   |
|  Real-time Hooks    |    |  Security Guard      |    |  SSRF-enforced      |
|  Port 3100          |    |  Agent Orchestrator  |    |                     |
|                     |    |  Port 18789          |    |                     |
+---------------------+    +----------+----------+    +---------------------+
                                      |
                                      | Vercel AI SDK
                                      v
                        +-------------+-------------+
                        |   LLM Providers           |
                        |   Claude | GPT | Gemini   |
                        |   Ollama (local)          |
                        +---------------------------+
```

### Package Breakdown

| Package | Tech Stack | Purpose |
|---------|-----------|---------|
| **`@scb/gateway`** | Node.js 22, TypeScript, Socket.io, grammY, sql.js, Pino | Central hub: LLM routing, sessions, encryption, Telegram bot, security, agents |
| **`@scb/dashboard`** | Next.js 15, React 19, Tailwind CSS 4, Socket.io Client | Mission Control PWA: chat, status, settings, usage analytics, agent Kanban |
| **`@scb/playwright`** | Playwright, Chromium | Sandboxed browser worker for web scraping, screenshots, and automation |

### Key Design Patterns

- **Dependency Injection** &mdash; `GatewayContext` container passed to all services
- **Token Bucket** &mdash; Per-user rate limiting with automatic refill
- **Observer Pattern** &mdash; Socket.io event emitters for real-time state sync
- **Exponential Backoff** &mdash; Supervisor restarts and Telegram reconnection
- **Append-Only Audit Trail** &mdash; Immutable security event log in SQLite
- **Encryption at Rest** &mdash; All secrets encrypted with PIN-derived AES-256-GCM keys

---

## Features

### Multi-LLM Routing

Route requests to any supported LLM with automatic failover:

| Provider | Models | Type |
|----------|--------|------|
| **Anthropic** | Claude Sonnet 4, Claude Haiku | Cloud |
| **OpenAI** | GPT-4o, GPT-4o-mini | Cloud |
| **Google** | Gemini 2.0 Flash | Cloud |
| **Ollama** | Llama 3.2, Mistral, any local model | Local |

- **Streaming responses** via async generators
- **Fallback chain** &mdash; Primary fails? Next provider picks up automatically
- **Usage tracking** with per-model cost estimation
- **Session-scoped** conversation context

### Military-Grade Encryption

Every secret stored in the gateway is encrypted before touching disk:

- **Algorithm**: AES-256-GCM (Galois/Counter Mode) with authenticated encryption
- **Key Derivation**: PBKDF2 with **310,000 iterations** (OWASP 2023 recommendation), SHA-256 digest
- **Salt**: 32 bytes cryptographically random per encryption
- **IV**: 12 bytes random per message (never reused)
- **Wire Format**: `salt(32) | iv(12) | authTag(16) | ciphertext`
- **KeyStore**: Encrypted key-value store backed by SQLite for API keys, tokens, and credentials

### Security Suite

A unified `SecurityGuard` provides defense-in-depth:

| Layer | Protection | Details |
|-------|-----------|---------|
| **SSRF Blocking** | Prevents server-side request forgery | Blocks 127.0.0.0/8, 10.0.0.0/8, 172.16.0.0/12, 192.168.0.0/16, 169.254.0.0/16, IPv6 loopback/link-local |
| **Path Traversal** | Prevents directory escape attacks | Canonical path resolution, allowed-roots whitelist, cross-platform (POSIX + Windows) |
| **Binary Allowlist** | Controls shell execution | Only whitelisted binaries can run: `git`, `node`, `npm`, `pnpm`, `npx`, `ls`, `cat`, `echo` |
| **Rate Limiting** | Token bucket per actor | Telegram: 20 req/min, Dashboard: 60 req/min, auto-cleanup of stale buckets |
| **JWT Authentication** | HMAC-SHA256 tokens | Timing-safe comparison, 24-hour TTL, origin tracking (web/telegram) |
| **Input Sanitization** | Strips malicious content | Null byte removal, control character stripping, newline collapsing, 16KB max message size |
| **Audit Logging** | Immutable event trail | 15 event types logged to append-only SQLite table |

### Telegram Bot

Full-featured Telegram bot powered by grammY:

- **Commands**: `/start` (begin approval flow), `/status` (system health)
- **Approval Flow**: 6-digit codes with 5-minute TTL, max 3 attempts before lockout
- **Pre-approved Users**: Skip approval via config for trusted Telegram user IDs
- **Streaming Chat**: Real-time LLM responses with typing indicators
- **Smart Chunking**: Intelligent message splitting at paragraph/sentence/word boundaries (4096-char Telegram limit)
- **Markdown Support**: Rich formatting with automatic fallback to plain text
- **Auto-Reconnect**: Exponential backoff (2s base, 60s max) on connection loss
- **Shared Sessions**: Same user across Telegram and web shares conversation context

### Mission Control Dashboard

A Next.js 15 Progressive Web App serving as your command center:

| Page | Functionality |
|------|--------------|
| **Home** | Status cards (gateway, sessions, uptime, memory), subsystem health indicators, quick navigation |
| **Chat** | Real-time streaming chat with LLM, session-based message history, auto-scroll, Shift+Enter for newlines |
| **Status** | Live system metrics (auto-refresh 3s), subsystem status grid, security audit log viewer (50 recent entries) |
| **Kanban** | Agent task board with Pending / Active / Done columns |
| **Workflows** | YAML workflow pipeline management |
| **Media** | Media file browser and management |
| **Usage** | Token tracking, cost breakdown by provider, recent 50 API calls with timestamps |
| **Settings** | LLM provider/model/key configuration, Telegram setup, PIN management, danger zone (clear sessions) |

- **PWA-enabled** &mdash; Install on any device as a standalone app
- **Real-time** &mdash; Socket.io hooks (`useChat`, `useStatus`) for live data
- **Dark theme** &mdash; zinc-950 background, designed for extended use

### Agent Orchestrator

Spawn, track, and manage autonomous sub-agents:

- **Concurrency Control** &mdash; Max 5 concurrent agents with automatic queuing
- **Timeout Enforcement** &mdash; 5-minute default via AbortController
- **Progress Tracking** &mdash; 0-100% progress updates
- **Kanban Board** &mdash; Visual task management (pending/running/completed/failed/cancelled)
- **Audit Integration** &mdash; Agent spawn, completion, failure, and cancellation events logged

### Memory Systems

#### Conversation Store
Persistent message history stored in SQLite:
- Append messages with token estimates
- Query by session, actor, or full-text keyword search
- Token usage tracking per actor
- Automatic pruning of old messages

#### Vector Store
Semantic memory with cosine similarity search:
- Support for OpenAI and Ollama embedding providers
- Hybrid search combining keyword + semantic results
- Configurable embedding models (default: `text-embedding-3-small`)

### Web Automation

Sandboxed Playwright worker for browser tasks:

| Task | Description |
|------|------------|
| **Scrape** | Extract title + text content (10KB limit) |
| **Screenshot** | Full-page PNG capture as base64 |
| **Automate** | Click, fill, wait actions on web pages |

- **JSON-RPC** communication over stdin/stdout
- **SSRF enforcement** on all navigated URLs
- **Headless Chromium** with Android-compatible user agent
- **Auto-cleanup** of browser contexts after each task

### Integrations

#### GitHub (via Octokit)
- List repositories (sorted by recent updates)
- List/create issues
- List pull requests
- Fetch file content from repos

#### Google (via googleapis)
- **Calendar**: List upcoming events, create new events
- **Drive**: List and query files with metadata
- **OAuth2**: Full authorization flow with token exchange

### Workflow Engine

YAML-defined multi-step automation pipelines:

```yaml
name: daily-digest
steps:
  - name: fetch-news
    action: scrape
    params:
      url: "https://example.com/feed"
  - name: summarize
    action: llm
    condition: "fetch-news.success == true"
    params:
      prompt: "Summarize: {{fetch-news.output}}"
    onError: skip
    retries: 2
```

- **Conditional execution** with variable-based branching
- **Variable substitution** via `{{variableName}}` syntax
- **Error handling**: stop, skip, or retry on failure
- **Step output chaining** for multi-stage pipelines
- **Audit logging** of workflow execution and results

### Cron Scheduler

Time-based job scheduling powered by Croner:

- Dynamic job registration and removal at runtime
- Enable/disable jobs without removing them
- Run-now capability for immediate execution
- Next-run prediction
- Error tracking per job
- Audit logging on completion and failure

### Media Handler

File storage with security-first validation:

- **MIME whitelist** for allowed file types
- **25MB file size limit**
- Store, read, delete, list, and get statistics
- Organized storage under `data/media/`

### Diagnostics

Built-in health checker (`pnpm doctor`):

| Check | Pass | Warn | Fail |
|-------|------|------|------|
| Node.js version | >= 22 | >= 20 | < 20 |
| Config file | Exists | - | Missing |
| Data directory | Exists | Will be created | - |
| Required packages | All installed | - | Any missing |
| Environment variables | All set | Using config.json | - |
| Ports (18789, 3100) | Available | In use | - |

---

## Installation

### Prerequisites

| Requirement | Minimum | Recommended |
|-------------|---------|-------------|
| **Node.js** | 20.x | 22.x+ |
| **pnpm** | 9.x | 10.30+ |
| **Git** | 2.x | Latest |
| **OS** | Linux, macOS, Windows, Android (Termux) | Any |

### Quick Start

```bash
# 1. Clone the repository
git clone https://github.com/benclawbot/SecuredClaudeBot.git
cd SecuredClaudeBot

# 2. Install dependencies
pnpm install

# 3. Run diagnostics
pnpm doctor

# 4. Create your configuration (see Configuration section)
cp config.example.json config.json
# Edit config.json with your API keys and preferences

# 5. Start all services
pnpm dev
```

This starts three services simultaneously:
- **Gateway** on `ws://127.0.0.1:18789` (Socket.io)
- **Dashboard** on `http://127.0.0.1:3100` (Next.js)
- **Playwright** worker (stdin/stdout JSON-RPC)

### Termux (Android)

SecureClaudebot is fully compatible with Android via Termux, thanks to sql.js (pure WASM SQLite with zero native dependencies):

```bash
# Install Node.js and pnpm
pkg install nodejs-lts git
npm install -g pnpm

# Clone and install
git clone https://github.com/benclawbot/SecuredClaudeBot.git
cd SecuredClaudeBot
pnpm install

# Start the gateway
pnpm dev
```

### Environment Variables

Override any config value with environment variables:

| Variable | Description | Example |
|----------|------------|---------|
| `SCB_PIN` | Encryption PIN (min 4 chars) | `mySecurePin123` |
| `SCB_TELEGRAM_TOKEN` | Telegram bot token from @BotFather | `123456:ABC-DEF...` |
| `SCB_LLM_PROVIDER` | Primary LLM provider | `anthropic` |
| `SCB_LLM_API_KEY` | API key for primary provider | `sk-ant-...` |
| `SCB_LLM_MODEL` | Model name | `claude-sonnet-4-20250514` |
| `SCB_PORT` | Gateway WebSocket port | `18789` |
| `SCB_GITHUB_TOKEN` | GitHub personal access token | `ghp_...` |

---

## Configuration

SecureClaudebot uses a `config.json` file validated by Zod schemas at startup. All fields have sensible defaults where possible:

```jsonc
{
  "server": {
    "port": 18789,           // Gateway WebSocket port
    "dashboardPort": 3100,   // Dashboard Next.js port
    "host": "127.0.0.1"     // Bind address
  },
  "telegram": {
    "botToken": "YOUR_BOT_TOKEN",
    "approvedUsers": [],     // Pre-approved Telegram user IDs
    "rateLimit": 20          // Requests per minute per user
  },
  "llm": {
    "primary": {
      "provider": "anthropic",    // anthropic | openai | google | ollama
      "apiKey": "YOUR_API_KEY",
      "model": "claude-sonnet-4-20250514",
      "baseUrl": null             // Optional custom endpoint
    },
    "fallbacks": [
      {
        "provider": "openai",
        "apiKey": "YOUR_OPENAI_KEY",
        "model": "gpt-4o"
      }
    ]
  },
  "security": {
    "pin": "your-pin",       // Auto-generated if missing
    "shellAllowedPaths": [], // Filesystem access whitelist
    "binaryAllowlist": ["git", "node", "npm", "pnpm", "npx", "ls", "cat", "echo"],
    "dashboardRateLimit": 60,
    "jwtSecret": null        // Auto-generated if missing
  },
  "memory": {
    "dbPath": "data/scb.db",
    "embeddingProvider": "openai",
    "embeddingModel": "text-embedding-3-small"
  },
  "google": {                // Optional
    "clientId": "...",
    "clientSecret": "...",
    "refreshToken": "..."
  },
  "github": {                // Optional
    "token": "ghp_..."
  },
  "voice": {                 // Optional
    "provider": "system",    // system | elevenlabs
    "elevenLabsApiKey": "...",
    "voiceId": "..."
  }
}
```

---

## Usage

### Starting the Gateway

```bash
# Start all services (gateway + dashboard + playwright)
pnpm dev

# Start only the gateway
pnpm --filter @scb/gateway run dev

# Start only the dashboard
pnpm --filter @scb/dashboard run dev

# Production build
pnpm build
pnpm --filter @scb/gateway run start
```

### Onboarding Wizard

On first run, the interactive onboarding wizard guides you through setup:

1. **Welcome** &mdash; Introduction and setup overview
2. **PIN** &mdash; Set your encryption PIN (min 4 characters, encrypts all secrets with AES-256-GCM)
3. **Telegram** &mdash; Enter your Telegram bot token from @BotFather (or skip)
4. **LLM Provider** &mdash; Choose: Anthropic, OpenAI, Google, or Ollama
5. **LLM API Key** &mdash; Enter your provider API key (Ollama can skip)
6. **Confirm** &mdash; Review configuration summary
7. **Done** &mdash; Secrets encrypted and saved, gateway ready to launch

### Doctor / Diagnostics

```bash
pnpm doctor
```

Output:
```
  SecureClaudebot Doctor

Running diagnostics...

  OK  Node.js version: v22.x.x (recommended: >= 22)
  OK  Config file: /path/to/config.json
  OK  Data directory: /path/to/data
  OK  Package: grammy — Available
  OK  Package: socket.io — Available
  OK  Package: ai — Available
  OK  Package: sql.js — Available
  OK  Package: pino — Available
  OK  Package: zod — Available
  WARN  Env: SCB_PIN — Not set (using config.json value)
  OK  Env: SCB_TELEGRAM_TOKEN — Set
  OK  Env: SCB_LLM_API_KEY — Set
  OK  Port 18789 — Available
  OK  Port 3100 — Available

  Summary: 13 passed, 1 warnings, 0 failures

  All checks passed. Ready to launch!
```

---

## Project Structure

```
SecuredClaudeBot/
  package.json                    # Root monorepo scripts
  pnpm-workspace.yaml             # Workspace definition
  tsconfig.base.json              # Shared TypeScript config (ES2022, strict)
  config.json                     # Runtime config (gitignored)
  CLAUDE.md                       # Architecture docs
  assets/
    secureclaudebot-demo.mp4      # Demo animation
  packages/
    gateway/                      # @scb/gateway
      package.json
      src/
        index.ts                  # Main entry: HTTP + Socket.io server
        config/
          schema.ts               # Zod validation schemas
          loader.ts               # Config loader (JSON + env overrides)
          defaults.ts             # Constants and default values
        crypto/
          cipher.ts               # AES-256-GCM encrypt/decrypt
          keystore.ts             # Encrypted key-value store
        memory/
          sqlite.ts               # sql.js wrapper with auto-save
          conversations.ts        # Persistent chat history
          vectors.ts              # Cosine similarity vector store
        session/
          manager.ts              # Session management with write locks
        security/
          ssrf.ts                 # SSRF IP blocking
          path.ts                 # Path traversal prevention
          binary.ts               # Binary execution allowlist
          rate-limiter.ts         # Token bucket rate limiter
          guard.ts                # Unified security middleware
          jwt.ts                  # JWT issue/verify (HMAC-SHA256)
        logger/
          index.ts                # Pino logger with secret redaction
          audit.ts                # Append-only audit log (15 event types)
        telegram/
          bot.ts                  # grammY Telegram bot
          approval.ts             # 6-digit approval code system
          chunker.ts              # Smart message chunking
        llm/
          router.ts               # Multi-provider LLM router
          usage.ts                # Token/cost tracking
        agents/
          orchestrator.ts         # Task spawning with concurrency control
        playwright/
          bridge.ts               # JSON-RPC bridge to Chromium worker
        media/
          handler.ts              # File storage with MIME validation
        links/
          parser.ts               # Readability article extraction
        cron/
          scheduler.ts            # Croner-based job scheduling
        integrations/
          github.ts               # Octokit GitHub client
          google.ts               # googleapis Calendar/Drive client
        workflows/
          engine.ts               # YAML pipeline execution engine
        doctor/
          cli.ts                  # Diagnostics / health checks
        onboarding/
          wizard.ts               # 7-step interactive setup wizard
        supervisor.ts             # Process supervisor with watchdog
        e2e/
          integration.test.ts     # Comprehensive E2E test suite
    dashboard/                    # @scb/dashboard
      package.json
      public/
        manifest.json             # PWA manifest
      src/
        app/
          layout.tsx              # Root layout with SocketProvider
          page.tsx                # Home dashboard
          chat/page.tsx           # Streaming chat interface
          status/page.tsx         # System metrics + audit viewer
          settings/page.tsx       # Configuration management
          usage/page.tsx          # Token tracking + costs
          kanban/page.tsx         # Agent task board
          workflows/page.tsx      # Workflow management
          media/page.tsx          # Media browser
        lib/
          types.ts                # Shared TypeScript types
          socket.tsx              # SocketProvider context
          hooks.ts                # useChat() + useStatus() hooks
        components/
          sidebar.tsx             # Navigation sidebar
    playwright/                   # @scb/playwright
      package.json
      src/
        worker.ts                 # Sandboxed Chromium worker
```

---

## Testing

SecureClaudebot has **289 tests** across **23 test suites**, covering every subsystem:

```bash
# Run all tests
pnpm --filter @scb/gateway run test

# Run tests in watch mode
pnpm --filter @scb/gateway run test:watch
```

### Test Suite Breakdown

| Suite | Tests | Coverage |
|-------|------:|----------|
| `cipher.test.ts` | 14 | AES-256-GCM encrypt/decrypt, key derivation, tampering detection |
| `keystore.test.ts` | 11 | Encrypted CRUD, re-keying, listing |
| `sqlite.test.ts` | 7 | Database init, CRUD, persistence, auto-save |
| `manager.test.ts` | 15 | Sessions, write locks, deduplication, reaper |
| `ssrf.test.ts` | 22 | All private IP ranges, IPv6, edge cases |
| `path.test.ts` | 9 | Traversal attacks, allowed roots, normalization |
| `binary.test.ts` | 11 | Allowlist enforcement, path injection, edge cases |
| `rate-limiter.test.ts` | 6 | Token bucket, refill, cleanup |
| `guard.test.ts` | 22 | Unified security: URL, path, binary, rate limit, sanitization |
| `jwt.test.ts` | 10 | Issue, verify, expiry, tampering, timing-safe comparison |
| `audit.test.ts` | 8 | Append-only logging, querying, event types |
| `loader.test.ts` | 7 | Config loading, env overrides, validation |
| `index.test.ts` | 4 | Logger setup, redaction, child loggers |
| `chunker.test.ts` | 10 | Message splitting at paragraph/sentence/word/hard boundaries |
| `approval.test.ts` | 13 | Code generation, verification, TTL, lockout |
| `usage.test.ts` | 10 | Token tracking, cost calculation, aggregation |
| `orchestrator.test.ts` | 15 | Spawning, cancellation, concurrency, timeout, Kanban |
| `conversations.test.ts` | 6 | Message append, search, pruning |
| `vectors.test.ts` | 6 | Cosine similarity, hybrid search |
| `handler.test.ts` | 10 | Media storage, MIME validation, size limits |
| `scheduler.test.ts` | 9 | Cron jobs, enable/disable, run-now |
| `engine.test.ts` | 9 | YAML workflows, conditions, retries, variables |
| `integration.test.ts` | 50+ | Full E2E lifecycle + security penetration tests |

---

## Security Model

### Threat Model

SecureClaudebot assumes the device it runs on is trusted, but the network and external inputs are not. The security model protects against:

1. **SSRF attacks** &mdash; Prevents the gateway from being used to probe internal networks
2. **Path traversal** &mdash; Blocks filesystem escape from allowed directories
3. **Unauthorized execution** &mdash; Only whitelisted binaries can be spawned
4. **Brute force** &mdash; Rate limiting per actor with token bucket algorithm
5. **Token theft** &mdash; JWT with timing-safe HMAC-SHA256 verification
6. **Secret exposure** &mdash; All API keys encrypted with AES-256-GCM at rest
7. **Replay attacks** &mdash; Message deduplication with 1-second debounce window
8. **Session hijacking** &mdash; 30-minute session timeout with automatic reaper
9. **Log tampering** &mdash; Append-only audit log (no update/delete operations)

### Encryption Pipeline

```
User PIN
    |
    v
PBKDF2 (310,000 iterations, SHA-256, 32-byte salt)
    |
    v
256-bit AES Key
    |
    v
AES-256-GCM (12-byte IV, 16-byte auth tag)
    |
    v
Encrypted Blob: salt(32) | iv(12) | authTag(16) | ciphertext
```

### Audit Event Types

| Event | Trigger |
|-------|---------|
| `auth.login` | Successful authentication |
| `auth.login_failed` | Failed authentication attempt |
| `auth.telegram_approved` | Telegram user approved |
| `auth.telegram_rejected` | Telegram user rejected/blocked |
| `tool.executed` | Tool/command executed |
| `tool.blocked` | Tool/command blocked by security |
| `security.ssrf_blocked` | SSRF attempt blocked |
| `security.path_traversal` | Path traversal attempt blocked |
| `security.rate_limited` | Rate limit exceeded |
| `security.binary_blocked` | Unauthorized binary blocked |
| `agent.spawned` | New agent task created |
| `agent.completed` | Agent task finished |
| `agent.failed` | Agent task failed |
| `session.created` | New session started |
| `session.reaped` | Stale session cleaned up |

---

## API Reference

### Socket.io Events

Connect to `ws://127.0.0.1:18789` with a Socket.io client.

#### Client -> Server

| Event | Payload | Description |
|-------|---------|-------------|
| `chat:message` | `{ actorId, content }` | Send a message to the LLM |
| `session:join` | `{ actorId }` | Join/create a session |
| `status:request` | `{}` | Request system status |
| `audit:request` | `{ limit? }` | Query audit log |
| `usage:request` | `{}` | Get usage statistics |
| `settings:update` | `{ section, data }` | Update configuration |
| `settings:change-pin` | `{ currentPin, newPin }` | Change encryption PIN |
| `sessions:clear-all` | `{}` | Clear all active sessions |

#### Server -> Client

| Event | Payload | Description |
|-------|---------|-------------|
| `chat:message` | `{ sessionId, role, content, ts }` | New message in session |
| `chat:stream:start` | `{ sessionId }` | LLM streaming begins |
| `chat:stream:chunk` | `{ sessionId, chunk }` | Streaming text chunk |
| `chat:stream:end` | `{ sessionId }` | LLM streaming complete |
| `chat:error` | `{ error }` | Chat error (rate limit, LLM failure) |
| `session:joined` | `{ sessionId, messages }` | Session joined with history |
| `status:update` | `{ gateway, sessions, uptime, memoryMB, subsystems }` | System status |
| `audit:entries` | `AuditEntry[]` | Audit log entries |
| `usage:data` | `{ totals, byProvider, records }` | Usage statistics |
| `settings:saved` | `{ section, success }` | Settings update confirmation |
| `settings:pin-changed` | `{ success }` | PIN change confirmation |
| `sessions:cleared` | `{}` | Sessions cleared confirmation |

---

## Logging

SecureClaudebot uses Pino for structured JSON logging with automatic secret redaction:

**Redacted fields**: `apiKey`, `api_key`, `secret`, `token`, `password`, `authorization`, `credential`, `pin` (and all nested variants like `*.apiKey`)

```bash
# Logs are written to stdout in development (pretty-printed)
# and to logs/ directory in JSON format for production
```

---

## Supervisor

The built-in supervisor manages service lifecycle:

- **Heartbeat monitoring** every 30 seconds
- **Watchdog** checks every 10 seconds for unresponsive processes
- **Exponential backoff** restart: 2s -> 4s -> 8s -> 16s -> 32s (max 60s)
- **Max 5 restart attempts** before giving up (resets after 2 minutes of stability)
- **Graceful shutdown** on SIGINT/SIGTERM with proper cleanup

---

## Built With

- [Node.js 22](https://nodejs.org/) &mdash; JavaScript runtime
- [TypeScript](https://www.typescriptlang.org/) &mdash; Type-safe development (strict mode)
- [pnpm](https://pnpm.io/) &mdash; Fast, disk-space efficient package manager
- [Socket.io](https://socket.io/) &mdash; Real-time bidirectional communication
- [grammY](https://grammy.dev/) &mdash; Telegram Bot framework
- [Vercel AI SDK](https://sdk.vercel.ai/) &mdash; Multi-provider LLM integration
- [sql.js](https://sql.js.org/) &mdash; Pure JS/WASM SQLite (zero native deps)
- [Next.js 15](https://nextjs.org/) &mdash; React framework for the dashboard
- [React 19](https://react.dev/) &mdash; UI library
- [Tailwind CSS 4](https://tailwindcss.com/) &mdash; Utility-first CSS
- [Playwright](https://playwright.dev/) &mdash; Browser automation
- [Pino](https://getpino.io/) &mdash; High-performance JSON logger
- [Zod](https://zod.dev/) &mdash; TypeScript-first schema validation
- [Vitest](https://vitest.dev/) &mdash; Blazing fast test framework
- [Croner](https://github.com/Hexagon/croner) &mdash; Cron job scheduling
- [Octokit](https://github.com/octokit/rest.js) &mdash; GitHub REST API client
- [googleapis](https://github.com/googleapis/google-api-nodejs-client) &mdash; Google API client

---

<p align="center">
  <b>SecureClaudebot</b> &mdash; Your data, your rules, your AI.
</p>
