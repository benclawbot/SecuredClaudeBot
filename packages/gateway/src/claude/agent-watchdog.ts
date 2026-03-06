export class AgentWatchdog {
  private timer?: NodeJS.Timeout;
  private lastActivity = Date.now();

  constructor(private options: {
    warnAfterSeconds?: number;
    onWarning?: (sinceMsg: number, total: number) => void;
    onTimeout?: () => void;
    timeoutMs?: number;
  }) {}

  start(): void {
    this.lastActivity = Date.now();
    if (this.options.warnAfterSeconds) {
      this.timer = setInterval(() => {
        const elapsed = Date.now() - this.lastActivity;
        if (this.options.onWarning) {
          this.options.onWarning(elapsed, elapsed);
        }
      }, this.options.warnAfterSeconds * 1000);
    }
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer);
  }

  recordActivity(_type: string): void {
    this.lastActivity = Date.now();
  }
}
