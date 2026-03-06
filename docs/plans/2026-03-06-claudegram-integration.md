# Claudegram Integration Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Replace FastBot's current chat UI with claudegram's Telegram-based agent interaction, including full configuration integration, authenticated sessions, and per-session project management.

**Architecture:** Copy claudegram's agent code into the gateway, replace dashboard chat UI with claudegram-style interaction (commands: /project, /plan, /explore, /loop, /clear, /continue), extend config schema to support claudegram settings while keeping FastBot's existing features. Authentication remains required (dashboard login).

**Tech Stack:** TypeScript, Next.js, Socket.io, Claude Code SDK (@anthropic-ai/claude-agent-sdk), Zod

---

## Task 1: Extend FastBot Config Schema with Claudegram Settings

**Files:**
- Modify: `packages/gateway/src/config/schema.ts`
- Modify: `packages/gateway/src/config/defaults.ts`

**Step 1: Add claudegram config schema**

Add to `packages/gateway/src/config/schema.ts`:

```typescript
// Claudegram agent config
export const claudegramAgentSchema = z.object({
  /** Path to Claude Code executable */
  claudeExecutablePath: z.string().default('claude'),
  /** Use bundled Claude Code */
  claudeUseBundled: z.boolean().default(true),
  /** SDK log level */
  claudeSdkLogLevel: z.enum(['off', 'basic', 'verbose', 'trace']).default('basic'),
  /** Include partial messages */
  claudeSdkIncludePartial: z.boolean().default(false),
  /** Show reasoning summary */
  claudeReasoningSummary: z.boolean().default(true),
  /** Enable dangerous mode (bypass permissions) */
  dangerousMode: z.boolean().default(false),
  /** Max iterations for loop mode */
  maxLoopIterations: z.number().default(5),
  /** Enable agent watchdog */
  agentWatchdogEnabled: z.boolean().default(true),
  /** Watchdog warning seconds */
  agentWatchdogWarnSeconds: z.number().default(30),
  /** Watchdog log interval seconds */
  agentWatchdogLogSeconds: z.number().default(10),
  /** Query timeout ms (0 = disabled) */
  agentQueryTimeoutMs: z.number().default(0),
  /** Cancel on new message */
  cancelOnNewMessage: z.boolean().default(false),
  /** Show usage in responses */
  contextShowUsage: z.boolean().default(false),
  /** Notify on compaction */
  contextNotifyCompaction: z.boolean().default(true),
  /** Default streaming mode */
  streamingMode: z.enum(['streaming', 'wait']).default('streaming'),
  /** Workspace directory */
  workspaceDir: z.string().default(process.env.HOME || '.'),
});

export const claudegramMediaSchema = z.object({
  /** Enable Reddit fetch */
  redditEnabled: z.boolean().default(true),
  /** Reddit client ID */
  redditClientId: z.string().optional(),
  /** Reddit client secret */
  redditClientSecret: z.string().optional(),
  /** Enable Reddit video download */
  vredditEnabled: z.boolean().default(true),
  /** Enable Medium fetch */
  mediumEnabled: z.boolean().default(true),
  /** Enable media extraction (YouTube, Instagram, TikTok) */
  extractEnabled: z.boolean().default(true),
  /** Enable voice transcription */
  transcribeEnabled: z.boolean().default(true),
  /** Enable TTS */
  ttsEnabled: z.boolean().default(true),
});
```

**Step 2: Add to appConfigSchema**

In `appConfigSchema`, add:
```typescript
export const appConfigSchema = z.object({
  // ... existing fields
  claudegram: z.object({
    agent: claudegramAgentSchema.optional(),
    media: claudegramMediaSchema.optional(),
  }).optional(),
}).transform((val) => ({
  // ... existing transforms
  claudegram: {
    agent: claudegramAgentSchema.parse(val.claudegram?.agent ?? {}),
    media: claudegramMediaSchema.parse(val.claudegram?.media ?? {}),
  },
}));
```

**Step 3: Update defaults.ts**

Add default values.

**Step 4: Run build to verify**

Run: `cd packages/gateway && pnpm build`
Expected: Build succeeds with new config types

**Step 5: Commit**

```bash
git add packages/gateway/src/config/schema.ts packages/gateway/src/config/defaults.ts
git commit -m "feat: extend config with claudegram settings"
```

---

## Task 2: Copy Claudegram Agent Code to Gateway

**Files:**
- Copy: `packages/claudegram/src/claude/*` → `packages/gateway/src/claudegram/claude/`
- Copy: `packages/claudegram/src/providers/*` → `packages/gateway/src/claudegram/providers/`
- Copy: `packages/claudegram/src/utils/*` (needed utilities)

**Step 1: Create directory structure**

```bash
mkdir -p packages/gateway/src/claudegram/claude
mkdir -p packages/gateway/src/claudegram/providers
mkdir -p packages/gateway/src/claudegram/utils
```

**Step 2: Copy files**

Copy from `packages/claudegram/src/`:
- `claude/agent.ts` → `claudegram/claude/agent.ts`
- `claude/session-manager.ts` → `claudegram/claude/session-manager.ts`
- `claude/session-history.ts` → `claudegram/claude/session-history.ts`
- `claude/command-parser.ts` → `claudegram/claude/command-parser.ts`
- `claude/request-queue.ts` → `claudegram/claude/request-queue.ts`
- `claude/agent-watchdog.ts` → `claudegram/claude/agent-watchdog.ts`
- `claude/mcp-tools.ts` → `claudegram/claude/mcp-tools.ts`
- `providers/provider-router.ts` → `claudegram/providers/router.ts`
- `providers/claude-provider.ts` → `claudegram/providers/claude.ts`
- `providers/types.ts` → `claudegram/providers/types.ts`
- `providers/user-preferences.ts` → `claudegram/providers/preferences.ts`
- `config.ts` → `claudegram/config.ts`

**Step 3: Fix imports**

Update all imports to reference the new paths (keep relative imports within each module).

**Step 4: Run build to verify**

Run: `cd packages/gateway && pnpm build`
Expected: Build succeeds

**Step 5: Commit**

```bash
git add packages/gateway/src/claudegram/
git commit -m "feat: copy claudegram agent code to gateway"
```

---

## Task 3: Create Gateway Chat Socket Handler

**Files:**
- Create: `packages/gateway/src/claudegram/chat-handler.ts`

**Step 1: Write the chat handler**

```typescript
import { Server, Socket } from 'socket.io';
import { sendToAgent, sendLoopToAgent, clearConversation } from './claudegram/claude/agent.js';
import { sessionManager } from './claudegram/claude/session-manager.js';
import { config } from './claudegram/config.js';

interface ChatMessage {
  role: 'user' | 'assistant';
  content: string;
  ts: number;
}

export function setupChatHandler(io: Server, socket: Socket) {
  const userId = socket.data.userId;

  // Join user's session room
  socket.join(`user:${userId}`);

  // Get or create session for this user
  let sessionKey = `dashboard:${userId}`;
  let session = sessionManager.getSession(sessionKey);

  // Initialize session if not exists
  if (!session) {
    const workspaceDir = config.workspaceDir || process.env.HOME || '.';
    session = sessionManager.createSession(sessionKey, workspaceDir);
  }

  // Send session joined event
  const history = sessionManager.getSessionHistory(sessionKey, 50);
  const messages: ChatMessage[] = history.map((entry, i) => ({
    role: i % 2 === 0 ? 'user' : 'assistant',
    content: entry.lastMessagePreview,
    ts: new Date(entry.lastActivity).getTime(),
  }));

  socket.emit('session:joined', {
    sessionId: session.conversationId,
    messages,
  });

  // Handle chat messages
  socket.on('chat:message', async (data: { content: string }) => {
    const { content } = data;

    // Check for commands
    if (content.startsWith('/project ')) {
      const newPath = content.slice(9).trim();
      session = sessionManager.setWorkingDirectory(sessionKey, newPath);
      clearConversation(sessionKey);
      socket.emit('chat:message', {
        role: 'assistant',
        content: `✅ Project set to: ${newPath}`,
        ts: Date.now(),
      });
      return;
    }

    if (content === '/clear') {
      clearConversation(sessionKey);
      socket.emit('chat:message', {
        role: 'assistant',
        content: '✅ Conversation cleared',
        ts: Date.now(),
      });
      return;
    }

    if (content === '/resume' || content === '/continue') {
      const lastSession = sessionManager.resumeLastSession(sessionKey);
      if (lastSession) {
        socket.emit('chat:message', {
          role: 'assistant',
          content: `✅ Resumed session for: ${lastSession.workingDirectory}`,
          ts: Date.now(),
        });
      } else {
        socket.emit('chat:message', {
          role: 'assistant',
          content: 'No previous session found',
          ts: Date.now(),
        });
      }
      return;
    }

    // Emit user message
    socket.emit('chat:message', {
      role: 'user',
      content,
      ts: Date.now(),
    });

    // Start streaming
    socket.emit('chat:stream:start');

    try {
      let command: 'plan' | 'explore' | 'loop' | undefined;
      if (content.startsWith('/plan ')) {
        command = 'plan';
        content = content.slice(6);
      } else if (content.startsWith('/explore ')) {
        command = 'explore';
        content = content.slice(9);
      } else if (content.startsWith('/loop ')) {
        command = 'loop';
        content = content.slice(6);
      }

      const response = command === 'loop'
        ? await sendLoopToAgent(sessionKey, content)
        : await sendToAgent(sessionKey, content, { command });

      // Stream response in chunks
      const chunks = response.text.match(/.{1,100}/g) || [response.text];
      for (const chunk of chunks) {
        socket.emit('chat:stream:chunk', { chunk });
        await new Promise(r => setTimeout(r, 30));
      }

      socket.emit('chat:stream:end');

      // Emit final message
      socket.emit('chat:message', {
        role: 'assistant',
        content: response.text,
        ts: Date.now(),
      });

    } catch (error) {
      socket.emit('chat:stream:end');
      socket.emit('chat:message', {
        role: 'assistant',
        content: `Error: ${error instanceof Error ? error.message : 'Unknown error'}`,
        ts: Date.now(),
      });
    }
  });

  // Handle session info request
  socket.on('session:info', () => {
    const session = sessionManager.getSession(sessionKey);
    socket.emit('session:info', {
      workingDirectory: session?.workingDirectory,
      conversationId: session?.conversationId,
      history: sessionManager.getSessionHistory(sessionKey, 10),
    });
  });
}
```

**Step 2: Register in main gateway**

In `packages/gateway/src/index.ts`, import and call the handler.

**Step 3: Run build**

Run: `cd packages/gateway && pnpm build`
Expected: Build succeeds

**Step 4: Commit**

```bash
git add packages/gateway/src/claudegram/chat-handler.ts
git commit -m "feat: add claudegram chat socket handler"
```

---

## Task 4: Replace Dashboard Chat Page

**Files:**
- Replace: `packages/dashboard/app/chat/page.tsx`

**Step 1: Write new chat page**

Replace the entire file with claudegram-style UI (see full code in implementation - commands: /project, /continue, /resume, /plan, /explore, /loop, /clear).

Key features:
- Command suggestions dropdown
- Project name in header
- Session info display
- Streaming responses

**Step 2: Verify build**

Run: `cd packages/dashboard && pnpm build`
Expected: Build succeeds

**Step 3: Commit**

```bash
git add packages/dashboard/app/chat/page.tsx
git commit -m "feat: replace dashboard chat with claudegram UI"
```

---

## Task 5: Remove Old Chat Code

**Files:**
- Remove: `packages/gateway/src/orchestration/chat-integration.ts`
- Review: Other socket handlers that may conflict

**Step 1: Identify old chat files**

```bash
grep -r "chat:" packages/gateway/src --include="*.ts" | grep -v "claudegram"
```

**Step 2: Remove identified files**

Delete any files that are no longer needed.

**Step 3: Commit**

```bash
git rm packages/gateway/src/orchestration/chat-integration.ts
git commit -m "refactor: remove old chat integration"
```

---

## Task 6: Add Settings Page for Claudegram Config

**Files:**
- Create: `packages/dashboard/app/settings/claudegram/page.tsx`

**Step 1: Create settings page**

Add UI for claudegram-specific settings (workspace directory, streaming mode, model defaults, etc.)

**Step 2: Commit**

```bash
git add packages/dashboard/app/settings/
git commit -m "feat: add claudegram settings page"
```

---

## Task 7: Build and Test

**Step 1: Build all packages**

```bash
pnpm build
```

**Step 2: Start services**

```bash
pnpm dev
```

**Step 3: Test the chat**

1. Open dashboard at http://localhost:3100
2. Login
3. Navigate to /chat
4. Use /project to set a directory
5. Send a message
6. Verify streaming response

**Step 4: Test commands**

- /project /path - should set project
- /continue or /resume - should restore session
- /plan task - should enter plan mode
- /explore question - should enter explore mode
- /loop task - should enter iterative mode
- /clear - should clear conversation

---

## Plan Complete

Two execution options:

**1. Subagent-Driven (this session)** - I dispatch fresh subagent per task, review between tasks, fast iteration

**2. Parallel Session (separate)** - Open new session with executing-plans, batch execution with checkpoints

Which approach?
