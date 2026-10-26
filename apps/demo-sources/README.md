# Demo sources

Stand-in machines for every kind of live connection, and a setup that builds a machine
monitoring demo in a workspace. Use it to try live pages, rules and visuals, or to show a
customer, without any hardware.

| Machine | Fed by | Stand-in |
|---|---|---|
| m01 CNC Mill 01 | OPC UA | OPC UA server, `opc.tcp://localhost:4840/demo` |
| m02 CNC Mill 02 | Edge agent (Modbus TCP) | the real edge agent, reading registers 100–106 |
| m03 Lathe L-03 | Modbus TCP | Modbus device, `localhost:5020`, registers 0–6 |
| m04 Press P-04 | MQTT | MQTT broker, `mqtt://localhost:1883`, topics `plant/line2/m04/...` |
| m05 Injection Mold M-05 | WebSocket | gateway, `ws://localhost:8765` (token + subscribe message) |
| m06 Welding Cell W-06 | HTTP polling | REST API, `http://localhost:8780/api/machines/m06` |
| m07 Paint Line PL-07 | HTTP push | a device posting to the connection's own address |
| m08 Assembly A-08 | Simulator | none, the app makes the values up |

Every connection maps its own message shape to the same tags,
`machines.<code>.status / speed / temperature / count / power`.

## Run it

With the app running (API on port 4000):

```sh
# once: extends Machine, adds the machines, connections, rules and pages
pnpm demo:setup -- --email admin@example.com --password '…' [--url http://localhost:4000]

# then, whenever you want the machines running
pnpm demo:sources
```

Setup is safe to run again. It keeps existing entities, fields and records. It refreshes the
demo's connections, rules and pages, matched by name and route.

The HTTP push token and the edge agent token are shown only once by the app. Setup saves them in
`.demo-state.json`, which is git-ignored, and `start` reads them from there.

Ports can be changed with `DEMO_WS_PORT`, `DEMO_MQTT_PORT`, `DEMO_OPCUA_PORT`, `DEMO_MODBUS_PORT`
and `DEMO_HTTP_PORT`, and the host the app reaches them on with `DEMO_SOURCE_HOST`. Run setup
again after changing them.

## What the demo shows

- **Machine Monitoring → Plant Overview**: live machine cards, plant totals from live values,
  register counts that update on every open screen when a machine is added or changed, and
  downtime logged by live rules.
- **Machine Detail**: one machine's configuration (a record) compared with what it is doing now,
  with a live drawing of the picked machine.
- **Connections Showcase**: what each kind is for, how it's wired, the tag rule it needs, and its
  connection state.

## The drawings

Setup also saves three visuals in Studio → Visuals. **Machine** is a symbol: the machine itself,
drawn for its type (CNC, lathe, press, molding, welding, painting, assembly), a stack light lit in
its status colour, and an operator display with its name, status, speed, temperature and parts
made. What moves follows live data: spindles and chucks turn while running, the press ram comes
down once per part, the robot sparks, spray flows, parts ride the conveyor.

**Plant floor** places eight copies of it, one per machine, each wired to its own
`machines.<code>.*` tags, with plant totals underneath. **Machine view** places one copy that
follows the machine picked on the Machine Detail page and takes its type, target and temperature
limit from the machine register. Change the symbol once and both drawings change.
