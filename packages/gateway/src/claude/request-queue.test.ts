import { describe, it, expect } from 'vitest';
import { setActiveQuery, clearActiveQuery, getActiveQuery } from './request-queue.js';

describe('RequestQueue', () => {
  it('should track active query', () => {
    setActiveQuery('user-1', { [Symbol.iterator]: () => ({ next: () => ({ done: true }) }) } as any);
    expect(getActiveQuery('user-1')).toBeDefined();
    clearActiveQuery('user-1');
    expect(getActiveQuery('user-1')).toBeUndefined();
  });
});
