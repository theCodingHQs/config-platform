/**
 * Runs the connections the app assigns to this agent, with the same connectors the app server
 * uses. Each new config is compared with what's running: new connections start, removed ones
 * stop, changed ones restart, unchanged ones keep running.
 */
import type { AgentConnectionConfig, AgentToServer } from '@config-platform/schema';
import { CONNECTORS, type AdapterFactory, type ConnectorKind, type LiveAdapter } from '@config-platform/live-connectors';
import { log } from './log.js';

interface Running {
  config: AgentConnectionConfig;
  /** To spot a changed connection */
  fingerprint: string;
  adapter: LiveAdapter;
}

export class ConnectionRunner {
  private readonly running = new Map<string, Running>();

  constructor(
    private readonly report: (message: AgentToServer) => void,
    private readonly connectors: Record<string, AdapterFactory> = CONNECTORS,
  ) {}

  async apply(configs: AgentConnectionConfig[]): Promise<void> {
    const wanted = new Map(configs.map((c) => [c.id, c]));
    for (const [id, r] of this.running) {
      const next = wanted.get(id);
      if (!next || JSON.stringify(next) !== r.fingerprint) await this.stop(id);
    }
    for (const config of configs) if (!this.running.has(config.id)) this.start(config);
  }

  async stopAll(): Promise<void> {
    await Promise.all([...this.running.keys()].map((id) => this.stop(id)));
  }

  ids(): string[] {
    return [...this.running.keys()];
  }

  private start(config: AgentConnectionConfig): void {
    const factory = this.connectors[config.kind as ConnectorKind];
    if (!factory) {
      this.report({ type: 'state', connectionId: config.id, state: 'error', error: `This agent can't run "${config.kind}" connections. Update the agent.` });
      return;
    }
    const id = config.id;
    const adapter = factory(
      config.settings,
      {
        onMessage: ({ payload, topic }) => {
          const binary = Buffer.isBuffer(payload);
          this.report({ type: 'message', connectionId: id, payload: binary ? payload.toString('base64') : payload, encoding: binary ? 'base64' : 'utf8', topic });
        },
        onState: (state, error) => this.report({ type: 'state', connectionId: id, state, error }),
        onWarning: (warning) => this.report({ type: 'warning', connectionId: id, warning }),
      },
      { connectionId: id },
    );
    this.running.set(id, { config, fingerprint: JSON.stringify(config), adapter });
    log.info(`Starting ${config.kind} connection ${id}`);
    adapter.start();
  }

  private async stop(id: string): Promise<void> {
    const r = this.running.get(id);
    if (!r) return;
    this.running.delete(id);
    log.info(`Stopping connection ${id}`);
    await r.adapter.stop().catch((err) => log.warn(`Stopping ${id} failed: ${err?.message || err}`));
  }
}
