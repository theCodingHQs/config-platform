/**
 * Runs the real edge agent next to the stand-in sources, as it would run on a PC inside the
 * factory network: it connects out to the app, gets its connections, and reads the Modbus device
 * itself. Its output is prefixed so it can be told apart.
 */
import { spawn, type ChildProcess } from 'node:child_process';
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

export function startEdgeAgent(platformUrl: string, token: string, log = console.log): () => Promise<void> {
  const entry = fileURLToPath(import.meta.resolve('@config-platform/edge-agent'));
  if (!existsSync(entry)) {
    log('Edge agent not built yet: run "pnpm --filter @config-platform/edge-agent build", then start again.');
    return async () => {};
  }
  let child: ChildProcess | null = null;
  let stopping = false;
  const run = () => {
    child = spawn(process.execPath, [entry], {
      env: { ...process.env, CONFIG_PLATFORM_URL: platformUrl, CONFIG_PLATFORM_AGENT_TOKEN: token },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    const prefix = (chunk: Buffer) => String(chunk).trimEnd().split('\n').forEach((line) => log(`[edge agent] ${line}`));
    child.stdout?.on('data', prefix);
    child.stderr?.on('data', prefix);
    child.on('exit', (code) => {
      if (stopping) return;
      log(`[edge agent] stopped (exit ${code}); starting it again in 5 s`);
      setTimeout(run, 5000);
    });
  };
  run();
  return async () => {
    stopping = true;
    child?.kill();
  };
}
