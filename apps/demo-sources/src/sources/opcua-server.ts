/**
 * A machine controller with an OPC UA server, the way modern PLCs and CNC controls expose data.
 * Each machine is an object with variables, addressed as ns=1;s=<code>.<Variable>:
 *   ns=1;s=m01.Status  ns=1;s=m01.Speed  ns=1;s=m01.Temperature  ns=1;s=m01.PartCount  ns=1;s=m01.Power
 */
import { OPCUAServer } from 'node-opcua-server';
import { DataType, Variant } from 'node-opcua-variant';
import type { Plant } from '../plant/plant.js';
import type { MachineReading } from '../plant/sim-machine.js';

const VARIABLES: Array<{ name: string; type: DataType; read: (r: MachineReading) => string | number }> = [
  { name: 'Status', type: DataType.String, read: (r) => r.status },
  { name: 'Speed', type: DataType.Double, read: (r) => r.speed },
  { name: 'Temperature', type: DataType.Double, read: (r) => r.temperature },
  { name: 'PartCount', type: DataType.UInt32, read: (r) => r.count },
  { name: 'Power', type: DataType.Double, read: (r) => r.power },
];


export async function startOpcUaServer(plant: Plant, port: number, codes: string[]): Promise<() => Promise<void>> {
  const server = new OPCUAServer({ port, resourcePath: '/demo', alternateHostname: ['127.0.0.1', 'localhost'], buildInfo: { productName: 'Demo machine controller' } });
  await server.initialize();
  const addressSpace = server.engine.addressSpace!;
  const ns = addressSpace.getOwnNamespace();
  for (const code of codes) {
    const machine = ns.addObject({ organizedBy: addressSpace.rootFolder.objects, browseName: code.toUpperCase() });
    for (const v of VARIABLES) {
      ns.addVariable({
        componentOf: machine,
        browseName: v.name,
        nodeId: `s=${code}.${v.name}`,
        dataType: v.type,
        minimumSamplingInterval: 500,
        value: { get: () => new Variant({ dataType: v.type, value: v.read(plant.reading(code)) }) },
      });
    }
  }
  await server.start();
  return () => server.shutdown(500);
}
