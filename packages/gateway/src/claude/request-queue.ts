const activeQueries = new Map<string, any>();
const cancelledSessions = new Set<string>();

export function setActiveQuery(sessionKey: string, query: any): void {
  activeQueries.set(sessionKey, query);
}

export function clearActiveQuery(sessionKey: string): void {
  activeQueries.delete(sessionKey);
}

export function getActiveQuery(sessionKey: string): any {
  return activeQueries.get(sessionKey);
}

export function cancelSession(sessionKey: string): void {
  cancelledSessions.add(sessionKey);
  const query = activeQueries.get(sessionKey);
  if (query && typeof query.interrupt === 'function') {
    query.interrupt();
  }
}

export function isCancelled(sessionKey: string): boolean {
  return cancelledSessions.has(sessionKey);
}

export function uncancelSession(sessionKey: string): void {
  cancelledSessions.delete(sessionKey);
}
