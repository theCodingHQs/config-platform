/**
 * Waits between reconnect attempts: 1 s, 2 s, 4 s … up to 30 s, with a little jitter so many
 * connections that dropped together don't all retry at the same moment.
 */
export class Backoff {
  private attempt = 0;

  constructor(
    private readonly baseMs = 1000,
    private readonly maxMs = 30_000,
  ) {}

  nextDelayMs(): number {
    const delay = Math.min(this.maxMs, this.baseMs * 2 ** this.attempt);
    this.attempt += 1;
    return Math.round(delay * (0.8 + Math.random() * 0.4));
  }

  reset(): void {
    this.attempt = 0;
  }
}
