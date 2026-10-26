/**
 * Every demo machine that a stand-in source serves, ticking once a second. Sources read the
 * latest readings or listen for each tick.
 */
import { DEMO_MACHINES, type DemoMachine } from '../catalog.js';
import { SimMachine, type MachineReading } from './sim-machine.js';

export type TickListener = (code: string, reading: MachineReading) => void;

export class Plant {
  private readonly machines = new Map<string, SimMachine>();
  private readonly readings = new Map<string, MachineReading>();
  private readonly listeners = new Set<TickListener>();
  private timer: NodeJS.Timeout | null = null;

  constructor(machines: readonly DemoMachine[] = DEMO_MACHINES, random?: () => number) {
    for (const m of machines) {
      const sim = new SimMachine(m, random);
      this.machines.set(m.code, sim);
      this.readings.set(m.code, sim.reading());
    }
  }

  start(intervalMs = 1000): void {
    this.timer ??= setInterval(() => this.tick(intervalMs / 1000), intervalMs);
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }

  tick(dtSec = 1): void {
    for (const [code, sim] of this.machines) {
      const reading = sim.tick(dtSec);
      this.readings.set(code, reading);
      for (const listener of this.listeners) listener(code, reading);
    }
  }

  reading(code: string): MachineReading {
    const r = this.readings.get(code);
    if (!r) throw new Error(`Unknown machine ${code}`);
    return r;
  }

  onTick(listener: TickListener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }
}
