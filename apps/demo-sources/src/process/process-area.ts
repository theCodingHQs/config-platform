/**
 * A simulated liquid process area, read once a second like a control system's overview:
 *   three storage tanks → blend tank → three conditioners (in parallel) → day tank → two screens
 *   → feed tank (+ two additive dosing pumps) → the line unit, whose drain water goes to a
 *   recovery tank and back to the blend tank; screen rejects go to a reject tank.
 * Levels drift around their set points, pumps and conditioners follow them, and two upsets come
 * round every few minutes so alarms can be seen: storage tank TK-12 runs low (its pump trips),
 * and conditioner C-3 trips on overload.
 */

export type UnitStatus = 'running' | 'stopped' | 'alarm';

export interface StorageTank { level: number; solids: number; pump: UnitStatus; flow: number }
export interface Conditioner { status: UnitStatus; load: number; power: number; flow: number }
export interface Screen { inlet: number; outlet: number; reject: number }

export interface ProcessState {
  tk11: StorageTank;
  tk12: StorageTank;
  tk13: StorageTank;
  tk20: { level: number; solids: number; temperature: number; agitator: UnitStatus; pump: UnitStatus; flow: number };
  c1: Conditioner;
  c2: Conditioner;
  c3: Conditioner;
  tk30: { level: number; solids: number; pump: UnitStatus; flow: number };
  s1: Screen;
  s2: Screen;
  tk40: { level: number; pump: UnitStatus; flow: number };
  add1: { rate: number; pump: UnitStatus };
  add2: { rate: number; pump: UnitStatus };
  unit: { status: UnitStatus; speed: number; zone1: number; zone2: number; zone3: number; zone4: number; zone5: number; zone6: number; dry1: number; dry2: number; dry3: number; dry4: number; moisture: number; output: number };
  tk50: { level: number; pump: UnitStatus; flow: number };
  tk60: { level: number };
  totals: { throughput: number; made: number; power: number; alarms: number };
}

/** The numbers and texts of a state, by dotted path: "tk11.level" → 57.2 */
export function flattenState(state: ProcessState): Record<string, number | string> {
  const out: Record<string, number | string> = {};
  for (const [unit, values] of Object.entries(state)) for (const [key, v] of Object.entries(values)) out[`${unit}.${key}`] = v as number | string;
  return out;
}

const round = (n: number, d = 1) => Math.round(n * 10 ** d) / 10 ** d;
const clamp = (n: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, n));

/** Seconds each upset takes to come round, and how long the trip lasts */
const LOW_TANK_PERIOD = 260;
const TRIP_PERIOD = 190;
const TRIP_LENGTH = 28;

export class ProcessArea {
  private t = 0;
  private made = 0;
  private readonly levels = { tk11: 62, tk12: 55, tk13: 70, tk20: 64, tk30: 58, tk40: 66, tk50: 48, tk60: 22 };

  constructor(private readonly random: () => number = Math.random) {}

  private noise(size: number): number {
    return (this.random() - 0.5) * 2 * size;
  }

  /** A level that wanders slowly round its set point */
  private wander(key: keyof ProcessArea['levels'], setPoint: number, swing: number, period: number, dt: number): number {
    const target = setPoint + swing * Math.sin((2 * Math.PI * this.t) / period);
    const level = this.levels[key] + (target - this.levels[key]) * Math.min(1, 0.08 * dt) + this.noise(0.3);
    return (this.levels[key] = clamp(level, 0, 100));
  }

  tick(dt = 1): ProcessState {
    this.t += dt;
    const n = (base: number, size: number, d = 1) => round(base + this.noise(size), d);

    // TK-12 runs low for a while every few minutes; its pump trips below 12 %
    const lowPhase = this.t % LOW_TANK_PERIOD;
    const draining = lowPhase > LOW_TANK_PERIOD - 70;
    const tk12Target = draining ? 6 : 55;
    this.levels.tk12 = clamp(this.levels.tk12 + (tk12Target - this.levels.tk12) * Math.min(1, (draining ? 0.05 : 0.04) * dt) + this.noise(0.3), 0, 100);
    const tk12Pump: UnitStatus = this.levels.tk12 < 12 ? 'alarm' : 'running';

    const storage = (key: 'tk11' | 'tk13', setPoint: number, period: number, flow: number, solids: number): StorageTank => ({
      level: round(this.wander(key, setPoint, 12, period, dt)),
      solids: n(solids, 0.08, 2),
      pump: 'running',
      flow: n(flow, 6, 0),
    });
    const tk11 = storage('tk11', 62, 300, 420, 4.2);
    const tk13 = storage('tk13', 68, 420, 310, 3.6);
    const tk12: StorageTank = { level: round(this.levels.tk12), solids: n(4.8, 0.1, 2), pump: tk12Pump, flow: tk12Pump === 'running' ? n(360, 6, 0) : 0 };

    const blendIn = tk11.flow + tk12.flow + tk13.flow;
    const tk20Level = this.wander('tk20', tk12Pump === 'running' ? 64 : 52, 6, 240, dt);
    const tk20 = { level: round(tk20Level), solids: n(4.1, 0.06, 2), temperature: n(46, 0.4), agitator: 'running' as UnitStatus, pump: 'running' as UnitStatus, flow: round(blendIn * 0.97 + this.noise(5), 0) };

    // C-3 trips on overload now and then; the other two take more load while it's down
    const tripped = this.t % TRIP_PERIOD > TRIP_PERIOD - TRIP_LENGTH;
    const share = tripped ? 0.5 : 1 / 3;
    const conditioner = (load: number, rated: number, on: boolean): Conditioner =>
      on ? { status: 'running', load: n(load, 2.5, 0), power: n((load / 100) * rated, 3), flow: round(tk20.flow * share + this.noise(4), 0) } : { status: 'alarm', load: 0, power: 0, flow: 0 };
    const c1 = conditioner(tripped ? 88 : 72, 250, true);
    const c2 = conditioner(tripped ? 86 : 70, 250, true);
    const c3 = conditioner(74, 250, !tripped);

    const tk30 = { level: round(this.wander('tk30', 58, 10, 330, dt)), solids: n(3.9, 0.05, 2), pump: 'running' as UnitStatus, flow: n(1010, 12, 0) };
    const screen = (inlet: number): Screen => {
      const i = n(inlet, 2);
      return { inlet: i, outlet: round(i - (14 + this.noise(1.5))), reject: n(38, 3, 0) };
    };
    const s1 = screen(215);
    const s2 = screen(208);
    const tk40 = { level: round(this.wander('tk40', 66, 7, 200, dt)), pump: 'running' as UnitStatus, flow: n(940, 10, 0) };
    const add1 = { rate: n(42, 1.2), pump: 'running' as UnitStatus };
    const add2 = { rate: n(18.5, 0.8), pump: (Math.floor(this.t / 150) % 4 === 3 ? 'stopped' : 'running') as UnitStatus };

    const speed = n(tripped ? 742 : 768, 2, 0);
    const output = round((speed / 768) * 12.4 + this.noise(0.1), 2);
    this.made += (output / 3600) * dt;
    const unit = {
      status: 'running' as UnitStatus,
      speed,
      zone1: n(8.2, 0.3), zone2: n(14.6, 0.4), zone3: n(22.4, 0.5), zone4: n(31.0, 0.6), zone5: n(38.5, 0.6), zone6: n(44.1, 0.7),
      dry1: n(92, 0.8, 0), dry2: n(108, 0.8, 0), dry3: n(118, 1, 0), dry4: n(104, 0.8, 0),
      moisture: n(tripped ? 7.9 : 6.4, 0.15),
      output,
    };
    const tk50 = { level: round(this.wander('tk50', 48, 9, 280, dt)), pump: 'running' as UnitStatus, flow: n(820, 10, 0) };
    const tk60 = { level: round(this.wander('tk60', 26, 8, 360, dt)) };

    const units = [tk11.pump, tk12.pump, tk13.pump, c1.status, c2.status, c3.status, add2.pump];
    const totals = {
      throughput: round(output, 1),
      made: round(this.made, 2),
      power: round(c1.power + c2.power + c3.power + 6 * 18 + n(40, 2), 0),
      alarms: units.filter((s) => s === 'alarm').length,
    };
    return { tk11, tk12, tk13, tk20, c1, c2, c3, tk30, s1, s2, tk40, add1, add2, unit, tk50, tk60, totals };
  }
}
