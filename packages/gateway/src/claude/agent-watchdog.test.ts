import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { AgentWatchdog } from './agent-watchdog.js';

describe('AgentWatchdog', () => {
  beforeEach(() => { vi.useFakeTimers(); });
  afterEach(() => { vi.useRealTimers(); });

  it('should warn after warning threshold', () => {
    const onWarning = vi.fn();
    const wd = new AgentWatchdog({ warnAfterSeconds: 5, onWarning });
    wd.start();
    vi.advanceTimersByTime(6000);
    expect(onWarning).toHaveBeenCalled();
    wd.stop();
  });
});
