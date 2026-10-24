# ConfigPlatform edge agent

Runs live connections (OPC UA, Modbus TCP, MQTT, WebSocket, HTTP polling) **inside the factory
network** and sends what they read to ConfigPlatform. It only connects **out** to the app over a
secure WebSocket, so no inbound ports or VPN are needed.

## What you need

- A PC, server or virtual machine on the factory network that can reach the machines (PLCs,
  meters, OPC UA servers, the MQTT broker) **and** the app's address over HTTPS (port 443).
- Docker, or Node.js 22 or newer.
- An agent token: in ConfigPlatform, **Studio → Live → Edge agents → New agent**. The token is
  shown once; keep it like a password.

## Run with Docker (recommended)

```sh
docker run -d --name configplatform-agent --restart unless-stopped \
  -e CONFIG_PLATFORM_URL=https://apps.yourcompany.com \
  -e CONFIG_PLATFORM_AGENT_TOKEN=la_... \
  configplatform/edge-agent
```

## Run with Node.js

```sh
CONFIG_PLATFORM_URL=https://apps.yourcompany.com \
CONFIG_PLATFORM_AGENT_TOKEN=la_... \
node dist/index.js
```

On Windows, run it as a service (for example with NSSM) so it starts with the PC.

## Settings

| Variable | What it is |
| --- | --- |
| `CONFIG_PLATFORM_URL` | The app's address, as people open it in the browser |
| `CONFIG_PLATFORM_AGENT_TOKEN` | The agent's token (starts with `la_`) |

## How it works

1. The agent connects to `wss://<app>/api/live/agent` with its token, and keeps reconnecting if
   the network drops.
2. In ConfigPlatform, set a connection's **Runs on** to this agent. The app sends the agent that
   connection's settings (passwords included, over the encrypted connection).
3. The agent connects to the machine and sends each message back. Tags, rules and pages work
   exactly as for connections run by the app itself.

The Edge agents list shows whether each agent is online. Only one copy of an agent may run with a
token: a second copy replaces the first. Making a new token disconnects the old one.

## Building

From the repository root: `pnpm install`, then
`pnpm --filter @config-platform/edge-agent... build` (builds the shared packages too), or the
Docker image: `docker build -f apps/edge-agent/Dockerfile -t configplatform/edge-agent .`
