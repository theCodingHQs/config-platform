/**
 * The last few messages of a connection, as received and as decoded, with any tag-rule errors.
 * The Live screen shows them so a builder can see what a source sends while writing tag rules.
 */
export interface LoggedMessage {
  at: string;
  topic?: string;
  /** The payload as text, shortened */
  raw: string;
  /** Decoded message (or the reason it couldn't be decoded) */
  message?: unknown;
  decodeError?: string;
  ruleErrors?: Array<{ tag: string; error: string }>;
}

const MAX_RAW = 2000;

export class MessageLog {
  private readonly entries: LoggedMessage[] = [];

  constructor(private readonly size = 20) {}

  /** Adds an entry (newest first) and returns it as kept */
  add(entry: Omit<LoggedMessage, 'raw'> & { raw: string | Buffer }): LoggedMessage {
    const text = typeof entry.raw === 'string' ? entry.raw : entry.raw.toString('utf8');
    const kept = { ...entry, raw: text.length > MAX_RAW ? `${text.slice(0, MAX_RAW)}…` : text };
    this.entries.unshift(kept);
    if (this.entries.length > this.size) this.entries.pop();
    return kept;
  }

  /** Newest first */
  list(): LoggedMessage[] {
    return [...this.entries];
  }
}
