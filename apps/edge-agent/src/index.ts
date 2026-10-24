#!/usr/bin/env node
/**
 * ConfigPlatform edge agent: runs live connections inside the factory network and connects out
 * to the app. Configure with CONFIG_PLATFORM_URL and CONFIG_PLATFORM_AGENT_TOKEN.
 */
import { readFileSync } from 'node:fs';
import { AgentLink } from './agent-link.js';
import { agentSocketUrl, ConfigError, readConfig } from './config.js';
import { ConnectionRunner } from './connection-runner.js';
import { log } from './log.js';

const version: string = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8')).version;

let config;
try {
  config = readConfig();
} catch (err) {
  if (err instanceof ConfigError) {
    console.error(`The agent can't start:\n${err.message}`);
    process.exit(2);
  }
  throw err;
}

log.info(`ConfigPlatform edge agent ${version}, connecting to ${config.platformUrl}`);
let link: AgentLink | null = null;
const runner = new ConnectionRunner((message) => link?.send(message));
link = new AgentLink({
  url: agentSocketUrl(config.platformUrl),
  token: config.token,
  version,
  onMessage: (message) => {
    if (message.type === 'config') {
      log.info(`Running ${message.connections.length} connection${message.connections.length === 1 ? '' : 's'}`);
      void runner.apply(message.connections);
    }
  },
});
link.start();

const shutdown = async (signal: string) => {
  log.info(`${signal}: stopping`);
  link?.stop();
  await runner.stopAll();
  process.exit(0);
};
process.on('SIGINT', () => void shutdown('SIGINT'));
process.on('SIGTERM', () => void shutdown('SIGTERM'));
