import { describe, it, expect, beforeEach } from 'vitest';
import { getSession, clearSession } from './session-manager.js';

describe('SessionManager', () => {
  beforeEach(() => {
    clearSession('test-user');
  });

  it('should create a new session', () => {
    const session = getSession('test-user');
    expect(session).toBeDefined();
    expect(session.workingDirectory).toBeDefined();
  });

  it('should persist working directory', () => {
    const session = getSession('test-user');
    session.workingDirectory = '/tmp/test';
    const retrieved = getSession('test-user');
    expect(retrieved.workingDirectory).toBe('/tmp/test');
  });
});
