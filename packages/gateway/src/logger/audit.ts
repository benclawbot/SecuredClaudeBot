import type { SQLiteDB } from "../memory/sqlite.js";
import { createChildLogger } from "./index.js";

const log = createChildLogger("audit");

export type AuditEvent =
  | "auth.login"
  | "auth.login_failed"
  | "auth.telegram_approved"
  | "auth.telegram_rejected"
  | "tool.executed"
  | "tool.blocked"
  | "security.ssrf_blocked"
  | "security.path_traversal"
  | "security.rate_limited"
  | "security.binary_blocked"
  | "agent.spawned"
  | "agent.completed"
  | "agent.failed"
  | "session.created"
  | "session.reaped"
  | "config.changed"
  | "config.updated";

export interface AuditEntry {
  event: AuditEvent;
  actor: string;
  detail?: string;
  meta?: Record<string, unknown>;
}

const CREATE_TABLE = `
  CREATE TABLE IF NOT EXISTS audit_log (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    timestamp TEXT NOT NULL DEFAULT (datetime('now')),
    event TEXT NOT NULL,
    actor TEXT NOT NULL,
    detail TEXT,
    meta TEXT
  )
`;

export class AuditLog {
  constructor(private db: SQLiteDB) {
    this.db.exec(CREATE_TABLE);
    log.info("Audit log initialized");
  }

  log(entry: AuditEntry): void {
    try {
      this.db.run(
        "INSERT INTO audit_log (event, actor, detail, meta) VALUES (?, ?, ?, ?)",
        [
          entry.event,
          entry.actor,
          entry.detail ?? null,
          entry.meta ? JSON.stringify(entry.meta) : null,
        ]
      );
    } catch (err) {
      log.error({ err, entry }, "Failed to write audit entry");
    }
  }

  query(opts: { limit?: number; event?: AuditEvent } = {}) {
    const limit = opts.limit ?? 100;
    if (opts.event) {
      return this.db.all(
        "SELECT id, strftime('%s', timestamp) * 1000 as ts, event, actor, detail, meta FROM audit_log WHERE event = ? ORDER BY id DESC LIMIT ?",
        [opts.event, limit]
      );
    }
    return this.db.all(
      "SELECT id, strftime('%s', timestamp) * 1000 as ts, event, actor, detail, meta FROM audit_log ORDER BY id DESC LIMIT ?",
      [limit]
    );
  }
}
