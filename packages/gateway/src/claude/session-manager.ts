interface Session {
  claudeSessionId?: string;
  workingDirectory: string;
  messages: Array<{ role: string; content: string }>;
  lastActivity: number;
}

const sessions = new Map<string, Session>();

const DEFAULT_WORKSPACE = process.env.WORKSPACE_DIR || process.cwd();

export function getSession(sessionKey: string): Session {
  let session = sessions.get(sessionKey);
  if (!session) {
    session = {
      workingDirectory: DEFAULT_WORKSPACE,
      messages: [],
      lastActivity: Date.now(),
    };
    sessions.set(sessionKey, session);
  }
  session.lastActivity = Date.now();
  return session;
}

export function clearSession(sessionKey: string): void {
  sessions.delete(sessionKey);
}

export function setClaudeSessionId(sessionKey: string, id: string): void {
  const session = getSession(sessionKey);
  session.claudeSessionId = id;
}

export function getClaudeSessionId(sessionKey: string): string | undefined {
  return sessions.get(sessionKey)?.claudeSessionId;
}
