# Always-On Memory Agent Design

> **Goal:** Implement persistent memory for FastBot using the Google Always-On Memory Agent pattern, adapted for our LLM router and existing storage.

## Architecture

```
┌─────────────────────────────────────────────────────────────┐
│                     FastBot Gateway                          │
│  ┌─────────────┐  ┌──────────────┐  ┌──────────────────┐  │
│  │ Claudegram  │  │  Dashboard   │  │ Memory Agent     │  │
│  │   Telegram  │  │   Socket.io  │  │ (Standalone)     │  │
│  └─────────────┘  └──────────────┘  └──────────────────┘  │
│         │                │                   │               │
│         └────────────────┼───────────────────┘               │
│                          ▼                                   │
│               ┌─────────────────────┐                      │
│               │   Memory Orchestrator │                     │
│               └─────────────────────┘                      │
│                    │        │        │                      │
│        ┌──────────┼────────┼────────┼──────────┐            │
│        ▼          ▼        ▼        ▼          ▼            │
│   ┌─────────┐┌───────┐┌──────────┐┌─────────┐              │
│   │  Store  ││ Recall ││Consolidate││ Query  │              │
│   │  Agent  ││ Agent ││  Agent   ││ Agent  │              │
│   └────┬────┘└───┬───┘└────┬─────┘└────┬────┘              │
│        └──────────┼────────┼───────────┘                    │
│                   ▼                                         │
│          ┌──────────────┐                                  │
│          │ SQLite +     │                                  │
│          │ VectorStore  │                                  │
│          └──────────────┘                                  │
└─────────────────────────────────────────────────────────────┘
```

## Components

### 1. Memory Store (SQLite)
- Table: `memories` (id, content, embedding, timestamp, tags, consolidated)
- Table: `insights` (id, content, source_memories, created_at)
- Table: `memory_metadata` (user_id, last_consolidated)

### 2. Store Agent
- Receives user messages via orchestrator
- Generates embeddings via LLM router
- Stores in SQLite + VectorStore
- Tags important memories (explicit keywords, user preferences)

### 3. Recall Agent
- Given a query, searches VectorStore for relevant memories
- Returns top-k memories with relevance scores
- Filters by user_id for multi-user support

### 4. Consolidate Agent (Timer-based)
- Runs every 30 minutes (configurable)
- Finds unconsolidated memories
- Uses LLM to find connections between memories
- Generates cross-cutting insights
- Marks memories as consolidated

### 5. Query Agent
- Receives user query
- Calls Recall to get relevant memories
- Calls Consolidate for recent insights
- Synthesizes answer with LLM router
- Returns with source citations

## Data Flow

### Storing a Memory
1. User sends message → Claudegram processes
2. StoreAgent receives message content
3. Generate embedding via LLM router
4. Store in SQLite + VectorStore
5. Return success (non-blocking)

### Querying Memories
1. User sends "/remember X" or explicit recall request
2. QueryAgent receives request
3. RecallAgent searches VectorStore
4. ConsolidateAgent gets recent insights
5. LLM synthesizes answer
6. Return with citations

### Consolidation (Background)
1. Timer triggers every 30 min
2. ConsolidateAgent fetches unconsolidated memories (last 24h)
3. Groups by semantic similarity
4. LLM generates connections and insights
5. Stores insights, marks memories consolidated

## Configuration

New environment variables:
- `MEMORY_ENABLED=true` - Enable memory agent
- `MEMORY_CONSOLIDATE_INTERVAL=30` - Minutes between consolidation
- `MEMORY_RECALL_TOP_K=5` - Number of memories to recall
- `MEMORY_USER_ENABLED=false` - Enable user-facing /remember commands

## API Surface

```typescript
// In-memory API (not HTTP)
interface MemoryAgent {
  store(userId: string, content: string, metadata?: Record<string, any>): Promise<void>;
  recall(userId: string, query: string, limit?: number): Promise<Memory[]>;
  query(userId: string, question: string): Promise<QueryResponse>;
  consolidate(): Promise<Insight[]>;
}
```

## Integration Points

- **Telegram**: New commands `/remember`, `/recall`, `/insights`
- **Dashboard**: New API endpoint `/api/memory/*`
- **Session Manager**: Auto-store important context on session end

## Testing Strategy

1. Unit tests for Store/Recall/Query agents
2. Integration tests for consolidation timer
3. E2E tests for memory recall in chat

## Files to Create/Modify

- Create: `src/memory/agent/orchestrator.ts`
- Create: `src/memory/agent/store.ts`
- Create: `src/memory/agent/recall.ts`
- Create: `src/memory/agent/consolidate.ts`
- Create: `src/memory/agent/query.ts`
- Modify: `src/index.ts` - Initialize memory agent
- Modify: `src/telegram/bot.ts` - Add memory commands
- Modify: `packages/dashboard/` - Add memory UI
