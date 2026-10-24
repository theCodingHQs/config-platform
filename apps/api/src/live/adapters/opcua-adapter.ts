/**
 * OPC UA source: subscribes to the configured nodes; whenever one changes, sends every latest
 * value as one JSON message, e.g. { "speed": 41.5, "state": "running" }.
 */
import {
  AttributeIds,
  ClientMonitoredItem,
  ClientSubscription,
  MessageSecurityMode,
  OPCUAClient,
  SecurityPolicy,
  TimestampsToReturn,
  UserTokenType,
  type ClientSession,
  type DataValue,
} from 'node-opcua-client';
import type { AdapterEvents, AdapterSettings, LiveAdapter } from './adapter-types.js';
import { Backoff } from './backoff.js';
import { describeConnectionError } from './connection-errors.js';

/** OPC UA values as plain JSON: numbers, text, yes/no, dates as ISO text */
export function plainOpcUaValue(value: unknown): unknown {
  if (value === null || value === undefined) return null;
  if (value instanceof Date) return value.toISOString();
  if (typeof value === 'bigint') return Number(value);
  if (ArrayBuffer.isView(value)) return Array.from(value as unknown as ArrayLike<number>);
  if (typeof value === 'object') {
    const text = (value as { text?: unknown }).text; // LocalizedText
    return typeof text === 'string' ? text : String(value);
  }
  return value;
}

export function createOpcUaAdapter(settings: AdapterSettings, events: AdapterEvents): LiveAdapter {
  const endpoint = String(settings.endpointUrl);
  const nodes = settings.nodes as Array<{ key: string; nodeId: string }>;
  const sampling = Number(settings.samplingMs) || 1000;
  const backoff = new Backoff();
  const latest: Record<string, unknown> = {};
  let client: OPCUAClient | null = null;
  let session: ClientSession | null = null;
  let subscription: ClientSubscription | null = null;
  let retry: NodeJS.Timeout | null = null;
  let stopped = false;

  const teardown = async () => {
    await subscription?.terminate().catch(() => undefined);
    await session?.close().catch(() => undefined);
    await client?.disconnect().catch(() => undefined);
    subscription = null;
    session = null;
    client = null;
  };

  const connect = async () => {
    if (stopped) return;
    events.onState('connecting');
    client = OPCUAClient.create({
      applicationName: 'ConfigPlatform live data',
      securityMode: MessageSecurityMode[settings.securityMode as keyof typeof MessageSecurityMode] ?? MessageSecurityMode.None,
      securityPolicy: SecurityPolicy[settings.securityPolicy as keyof typeof SecurityPolicy] ?? SecurityPolicy.None,
      endpointMustExist: false,
      keepSessionAlive: true,
      // Our own backoff handles the first connection; the library handles drops after it
      connectionStrategy: { initialDelay: 1000, maxDelay: 30_000, maxRetry: 1 },
    });
    client.on('connection_lost', () => events.onState('disconnected'));
    client.on('connection_reestablished', () => events.onState('connected'));
    try {
      await client.connect(endpoint);
      session = await client.createSession(
        settings.username ? { type: UserTokenType.UserName, userName: String(settings.username), password: String(settings.password ?? '') } : undefined,
      );
      subscription = ClientSubscription.create(session, {
        requestedPublishingInterval: sampling,
        requestedLifetimeCount: 100,
        requestedMaxKeepAliveCount: 10,
        maxNotificationsPerPublish: 1000,
        publishingEnabled: true,
        priority: 10,
      });
      for (const { key, nodeId } of nodes) {
        const item = ClientMonitoredItem.create(
          subscription,
          { nodeId, attributeId: AttributeIds.Value },
          { samplingInterval: sampling, discardOldest: true, queueSize: 1 },
          TimestampsToReturn.Both,
        );
        item.on('changed', (dataValue: DataValue) => {
          latest[key] = plainOpcUaValue(dataValue.value?.value);
          events.onMessage({ payload: JSON.stringify(latest) });
        });
        item.on('err', (message: string) => events.onWarning(`"${key}" (${nodeId}) can't be watched: ${message}`));
      }
      backoff.reset();
      events.onState('connected');
    } catch (err) {
      events.onState('error', describeConnectionError(err, endpoint.replace(/^opc\.tcp/i, 'tcp')));
      await teardown();
      if (!stopped) retry = setTimeout(() => void connect(), backoff.nextDelayMs());
    }
  };

  return {
    start: () => void connect(),
    async stop() {
      stopped = true;
      if (retry) clearTimeout(retry);
      await teardown();
    },
  };
}
