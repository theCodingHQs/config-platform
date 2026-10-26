/**
 * Builds the machine monitoring demo in a workspace, through the app's API as an admin would:
 *   - Machine extended with code, type, line, status, data source, targets, limits…; the demo
 *     machines added or filled in; a Machine Downtime entity
 *   - a live connection per machine, one of each kind, and an edge agent for one of them
 *   - live rules: status → machine register, downtime start/end
 *   - MQTT connections for the process area and the order desk; a Customer Order entity that
 *     live rules fill from the order desk
 *   - a Machine symbol and drawings in Studio → Visuals: Plant floor, Machine view, Process
 *     overview, Order desk
 *   - pages Plant Overview, Machine Detail, Connections Showcase, Process Overview in a "Machine
 *     Monitoring" folder, and Order Desk in a "Sales" folder
 * Safe to run again: what exists is kept (connections, rules and the demo pages are refreshed;
 * visuals only when named in --refresh-visuals, since they may have been changed in the editor).
 *
 *   pnpm --filter @config-platform/demo-sources setup -- --email you@example.com --password … [--url http://localhost:4000]
 *     [--refresh-visuals "Process overview,Order desk" | all]
 */
import { DEMO_MACHINES } from '../catalog.js';
import { readState, writeState, type DemoState } from '../demo-config.js';
import { ApiClient } from './api-client.js';
import { connectionPlans } from './connections.js';
import { ensureMachineEntities, ensureMachineRecords } from './machine-entity.js';
import { monitoringPages, publishPages } from './pages/publish.js';
import { rulePlans } from './rules.js';
import { publishVisuals, type Refresh } from './visuals/publish.js';
import { ensureOrderEntity } from './order-entity.js';
import { orderRulePlans } from './order-rules.js';
import { ordersConnection, processConnection } from './site-connections.js';

const AGENT_NAME = 'Demo edge agent';

function args() {
  const argv = process.argv.slice(2);
  const get = (flag: string) => {
    const i = argv.indexOf(flag);
    return i >= 0 ? argv[i + 1] : undefined;
  };
  const email = get('--email') ?? process.env.DEMO_EMAIL;
  const password = get('--password') ?? process.env.DEMO_PASSWORD;
  if (!email || !password) throw new Error('Pass --email and --password of a workspace admin (or set DEMO_EMAIL and DEMO_PASSWORD)');
  const refreshArg = get('--refresh-visuals');
  const refresh: Refresh = refreshArg === 'all' ? 'all' : new Set((refreshArg ?? '').split(',').map((s) => s.trim()).filter(Boolean));
  return { email, password, refresh, url: (get('--url') ?? process.env.DEMO_PLATFORM_URL ?? 'http://localhost:4000').replace(/\/+$/, '') };
}

async function main() {
  const { email, password, url, refresh } = args();
  const log = (line: string) => console.log(`  ${line}`);
  const api = await ApiClient.signIn(url, email, password);
  const previous = readState();
  const state: DemoState = { platformUrl: url, ...(previous?.platformUrl === url ? { push: previous.push, agent: previous.agent } : {}) };
  console.log(`Setting up the machine monitoring demo on ${url}`);

  const { machine, downtime } = await ensureMachineEntities(api, log);
  await ensureMachineRecords(api, machine, log);
  const order = await ensureOrderEntity(api, log);

  // Edge agent (its token is shown once, so a new one is made when we don't have it)
  const agents = await api.get<Array<{ id: string; name: string }>>('/live/agents');
  let agent = agents.find((a) => a.name === AGENT_NAME);
  if (!agent) {
    const created = await api.post<{ id: string; name: string; token: string }>('/live/agents', { name: AGENT_NAME });
    agent = created;
    state.agent = { id: created.id, token: created.token };
    log(`+ edge agent ${AGENT_NAME}`);
  } else if (state.agent?.id !== agent.id) {
    const { token } = await api.post<{ token: string }>(`/live/agents/${agent.id}/token`);
    state.agent = { id: agent.id, token };
    log(`~ edge agent ${AGENT_NAME}: new token`);
  }

  // Connections
  const existing = await api.get<Array<{ id: string; name: string }>>('/live/connections');
  const connectionIds: Record<string, string> = {};
  for (const plan of connectionPlans(agent.id)) {
    const found = existing.find((c) => c.name === plan.input.name);
    let id: string;
    if (found) {
      id = found.id;
      await api.put(`/live/connections/${id}`, plan.input);
      log(`~ connection ${plan.input.name}`);
    } else {
      const created = await api.post<{ id: string; pushToken?: string }>('/live/connections', plan.input);
      id = created.id;
      if (created.pushToken) state.push = { connectionId: id, token: created.pushToken };
      log(`+ connection ${plan.input.name}`);
    }
    if (plan.input.kind === 'http-push' && state.push?.connectionId !== id) {
      const { pushToken } = await api.post<{ pushToken: string }>(`/live/connections/${id}/push-token`);
      state.push = { connectionId: id, token: pushToken };
      log(`~ connection ${plan.input.name}: new push token`);
    }
    connectionIds[plan.machine.code] = id;
  }
  writeState(state);
  for (const input of [processConnection(), ordersConnection()]) {
    const found = existing.find((c) => c.name === input.name);
    if (found) await api.put(`/live/connections/${found.id}`, input);
    else await api.post('/live/connections', input);
    log(`${found ? '~' : '+'} connection ${input.name} (${input.tags.length} tags)`);
  }

  // Rules
  const rules = await api.get<Array<{ id: string; name: string }>>('/live/rules');
  const plans = [...rulePlans(DEMO_MACHINES, machine, downtime), ...orderRulePlans(order)];
  for (const rule of plans) {
    const found = rules.find((r) => r.name === rule.name);
    if (found) await api.put(`/live/rules/${found.id}`, rule);
    else await api.post('/live/rules', rule);
  }
  log(`= ${plans.length} live rules`);

  const visuals = await publishVisuals(api, DEMO_MACHINES, refresh, log);
  await publishPages(api, monitoringPages({ machine, downtime, order, machines: DEMO_MACHINES, connectionIds, visuals }), log);

  console.log('\nDone. Now start the stand-in machines:  pnpm --filter @config-platform/demo-sources start');
}

main().catch((err) => {
  console.error(`Setup failed: ${err.message}`);
  process.exit(1);
});
