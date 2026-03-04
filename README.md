# SecuredClaudeBot

Ultra-secure personal AI gateway inspired by OpenClaw. Runs on Android (Termux) or any Node.js server.

## Features

- **Telegram Bot** - Control your AI agent via Telegram
- **Multi-Provider LLM Router** - OpenAI, Anthropic, Google, Ollama, MiniMax, and more
- **Web Dashboard** - Next.js PWA for mission control
- **Agents Management** - Create and manage AI agents with persistent memories
- **Orchestration** - CrewAI Flows for multi-agent task delegation
- **QMD Search** - Vector search across memories, chat history, and agent files
- **RCA Scheduler** - Automated root cause analysis and lessons learned
- **Sandboxed Browser** - Playwright-based web automation
- **Tailscale Integration** - Secure remote access
- **OAuth Integration** - Google, Microsoft, GitHub authentication
- **Audit Logging** - Full activity tracking
- **Security Hardened** - SSRF blocking, path traversal prevention, rate limiting
- **Voice Input** - Whisper transcription for voice notes
- **Command Autocomplete** - Type `/` in chat to see available commands
- **File Attachments** - Paste images or attach files in chat
- **Bot Identity** - Customizable personality via identity, role, and memories

## Architecture

```
┌─────────────────────────────────────────────────────────────┐
│                     SecuredClaudeBot                        │
├─────────────────────────────────────────────────────────────┤
│  packages/gateway    — Node.js 22 + TypeScript            │
│  ├── Socket.io hub for real-time communication           │
│  ├── Telegram bot command handler                         │
│  ├── LLM router (OpenAI, Anthropic, Google, Ollama)    │
│  ├── Agent orchestrator                                  │
│  ├── QMD vector search for memories                      │
│  └── Security: SSRF, path traversal, rate limiting      │
├─────────────────────────────────────────────────────────────┤
│  packages/dashboard   — Next.js 14 PWA                    │
│  ├── Kanban board for task management                    │
│  ├── Chat interface                                      │
│  ├── Agents management                                  │
│  ├── Usage statistics                                   │
│  └── Settings panel                                    │
├─────────────────────────────────────────────────────────────┤
│  packages/playwright — Sandboxed Chromium worker          │
│  ├── Web scraping (scrape, automate, screenshot)          │
│  ├── Isolated from host system                          │
│  └── Communicates via stdin/stdout JSON-RPC              │
├─────────────────────────────────────────────────────────────┤
│  packages/orchestration — Python CrewAI Flows            │
│  ├── SwarmCoordinatorFlow for task delegation            │
│  ├── State persistence with SQLite                      │
│  └── Agent definitions (Brainstormer, Coder, etc.)     │
└─────────────────────────────────────────────────────────────┘
```

## Quick Start

### Prerequisites

- Node.js 22+
- pnpm 10+
- Python 3.11+ (for orchestration)
- (Optional) Telegram bot token from @BotFather

### Installation

```bash
# Clone the repository
git clone https://github.com/benclawbot/SecuredClaudeBot.git
cd SecuredClaudeBot

# Install dependencies
pnpm install

# Build all packages
pnpm build
```

### Configuration

Edit `config.json` in the project root:

```json
{
  "server": {
    "port": 18789,
    "dashboardPort": 3100,
    "host": "127.0.0.1"
  },
  "telegram": {
    "botToken": "your_bot_token",
    "approvedUsers": [your_telegram_id]
  },
  "llm": {
    "primary": {
      "provider": "minimax",
      "model": "M2.5",
      "apiKey": "your_api_key"
    }
  },
  "agents": {
    "directory": "data/agents",
    "enableRcaCron": true
  },
  "playwright": {
    "enabled": true
  },
  "tailscale": {
    "enabled": true
  }
}
```

### Running

```bash
# Start all packages (development)
pnpm dev

# Or start individually:
pnpm --filter @scb/gateway run dev    # Gateway: ws://localhost:18789
pnpm --filter @scb/dashboard run dev  # Dashboard: http://localhost:3100

# For orchestration (separate terminal):
cd packages/orchestration
pip install crewai pydantic sqlalchemy
python -m src.scb_orchestration.server
```

## Packages

### @scb/gateway

The core gateway service.

**Ports:**
- WebSocket: `18789`
- HTTP: `18788` (optional)

**Socket Events:**
- `chat:message` - Send/receive chat messages
- `orchestration:*` - Orchestration control
- `qmd:search` - Vector search queries
- `tailscale:status` - Tailscale status

### @scb/dashboard

Next.js PWA for user interface.

**Ports:**
- Dashboard: `3100`

**Pages:**
- `/` - Dashboard home
- `/chat` - Chat interface
- `/kanban` - Task board (with orchestration)
- `/agents` - Agent management
- `/status` - System status
- `/usage` - Usage statistics
- `/settings` - Configuration
- `/media` - Media files
- `/workflows` - Workflow automation

### @scb/playwright

Sandboxed browser automation worker.

**Commands:**
- `scrape` - Extract page title and text
- `screenshot` - Take a screenshot
- `automate` - Run a sequence of actions

### @scb/orchestration

Python CrewAI Flows for multi-agent orchestration.

**Features:**
- SwarmCoordinatorFlow with human-in-the-loop
- SQLite state persistence
- Agent definitions: Brainstormer, Infra-Architect, StoryWriter, Coder, Tester

## Agents System

Each agent has persistent markdown files:
- `identity.md` - Who the agent is
- `role.md` - Goals, tools, resources
- `memories.md` - Notable events and accomplishments
- `lessons_learned.md` - Root cause analysis and solutions

### Creating an Agent

1. Go to `/agents` in the dashboard
2. Click the + button
3. Enter name and role
4. The agent will initialize with default files

### RCA Scheduler

Automatic Root Cause Analysis runs periodically (configurable) to:
- Analyze warnings in agent memories
- Add lessons learned automatically
- Improve agent performance over time

## Orchestration

Trigger orchestration from:
1. **Dashboard** - Use the Kanban board at `/kanban`
2. **Chat** - Use keywords like "build a project" or commands like `/delegate`

The chatbot will detect delegation requests and start the orchestration workflow.

## Bot Identity

Customize your chatbot's personality by editing files in `data/bot/`:

- `identity.md` - Defines who the chatbot is (personality, tone, values)
- `role.md` - Defines capabilities and available tools
- `memories.md` - Learned information and user preferences

The bot's identity is loaded as a system prompt, so the chatbot will:
- Adopt the defined personality and communication style
- Use the tools and capabilities listed in role.md
- Reference memories when interacting

## QMD Search

Query Memory Data provides semantic search across:
- Agent files (identity, role, memories, lessons)
- Chat history
- Stored memories

Use the `qmd:search` socket event to search.

## Security

### Implemented Protections

1. **SSRF Blocking** - Prevents access to internal networks
2. **Path Traversal Prevention** - Blocks directory traversal attacks
3. **Binary Allowlist** - Only allowed executables can run
4. **Rate Limiting** - Prevents abuse
5. **Audit Logging** - Append-only log of all activities
6. **Encrypted Secrets** - AES-256-GCM encryption with PBKDF2 key derivation

### Audit Events

| Event | Description |
|-------|-------------|
| `auth.login` | Successful login |
| `auth.login_failed` | Failed login attempt |
| `tool.executed` | Tool was executed |
| `tool.blocked` | Tool was blocked |
| `security.ssrf_blocked` | SSRF attack blocked |
| `security.path_traversal` | Path traversal blocked |
| `security.rate_limited` | Rate limit exceeded |
| `agent.spawned` | Agent spawned |
| `agent.completed` | Agent completed |
| `session.created` | New session created |

## Commands (Telegram)

```
/start - Start the bot
/help - Show help message
/status - Check system status
/models - List available LLM models
```

## Development

```bash
# Type check all packages
pnpm build

# Run tests
pnpm --filter @scb/gateway test

# Lint
pnpm lint
```

## Troubleshooting

### Build Errors

If you get TypeScript errors about `document` in playwright:
```bash
# The tsconfig needs "DOM" lib
# Already fixed in packages/playwright/tsconfig.json
```

### Port Conflicts

If ports are already in use:
- Gateway: Edit `config.json` server.port
- Dashboard: Edit `config.json` server.dashboardPort

### Database Issues

Delete the database file and restart:
```bash
rm packages/gateway/data/scb.db
```

### Tailscale

For Tailscale to work without sudo:
```bash
sudo tailscale up  # First time - auth via browser
sudo tailscale set --operator=$USER  # Allow non-sudo access
```

## License

MIT
