/** The agent's settings, from environment variables (or a .env file next to it). */
export interface AgentConfig {
  /** The app's address, e.g. https://apps.yourcompany.com */
  platformUrl: string;
  /** The agent's token from Studio → Live → Edge agents */
  token: string;
}

export class ConfigError extends Error {}

export function readConfig(env: Record<string, string | undefined> = process.env): AgentConfig {
  const platformUrl = (env.CONFIG_PLATFORM_URL ?? '').trim().replace(/\/+$/, '');
  const token = (env.CONFIG_PLATFORM_AGENT_TOKEN ?? '').trim();
  const problems: string[] = [];
  if (!platformUrl) problems.push('CONFIG_PLATFORM_URL is missing: the app address, e.g. https://apps.yourcompany.com');
  else if (!/^https?:\/\//i.test(platformUrl)) problems.push('CONFIG_PLATFORM_URL must start with https:// (or http:// for testing)');
  if (!token) problems.push('CONFIG_PLATFORM_AGENT_TOKEN is missing: the token shown when the agent was created in Studio → Live → Edge agents');
  else if (!token.startsWith('la_')) problems.push("CONFIG_PLATFORM_AGENT_TOKEN doesn't look like an agent token (they start with la_)");
  if (problems.length) throw new ConfigError(problems.join('\n'));
  return { platformUrl, token };
}

/** wss://…/api/live/agent from https://… */
export function agentSocketUrl(platformUrl: string): string {
  return `${platformUrl.replace(/^http/i, 'ws')}/api/live/agent`;
}
