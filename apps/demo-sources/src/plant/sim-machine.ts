/**
 * One simulated machine: mostly running, now and then idle, rarely in alarm or stopped. Speed,
 * temperature, power and the part counter follow the status the way a real machine's would.
 */
import type { MachineStatus } from '../catalog.js';

export interface MachineReading {
  status: MachineStatus;
  /** parts/min */
  speed: number;
  /** °C */
  temperature: number;
  /** parts made so far */
  count: number;
  /** kW */
  power: number;
}

export interface MachineProfile {
  ratedSpeed: number;
  baseTemperature: number;
}

/** Chance per second of leaving each status, and where to */
const TRANSITIONS: Record<MachineStatus, Array<[MachineStatus, number]>> = {
  running: [['idle', 0.006], ['alarm', 0.0025], ['stopped', 0.001]],
  idle: [['running', 0.06]],
  alarm: [['running', 0.035]],
  stopped: [['running', 0.02]],
};

const round = (n: number, d = 1) => Math.round(n * 10 ** d) / 10 ** d;

export class SimMachine {
  private status: MachineStatus = 'running';
  private parts = 0;
  private speed = 0;
  private temperature: number;

  constructor(
    private readonly profile: MachineProfile,
    private readonly random: () => number = Math.random,
  ) {
    this.temperature = profile.baseTemperature;
  }

  /** Moves the machine on by `dtSec` seconds */
  tick(dtSec = 1): MachineReading {
    this.status = this.nextStatus(dtSec);
    const { ratedSpeed, baseTemperature } = this.profile;
    const targetSpeed = this.status === 'running' ? ratedSpeed * (0.9 + this.random() * 0.15) : 0;
    // Machines ramp up and down rather than jump
    this.speed += (targetSpeed - this.speed) * Math.min(1, dtSec * 0.5);
    if (this.speed < 0.05) this.speed = 0;
    this.parts += (this.speed / 60) * dtSec;
    const targetTemp = baseTemperature + (this.status === 'running' ? 32 : 0) + (this.status === 'alarm' ? 18 : 0);
    this.temperature += (targetTemp - this.temperature) * Math.min(1, dtSec * 0.05) + (this.random() - 0.5) * 0.2;
    return this.reading();
  }

  reading(): MachineReading {
    const power = this.status === 'running' ? 3 + this.speed * 0.4 : this.status === 'stopped' ? 0.2 : 0.8;
    return {
      status: this.status,
      speed: round(this.speed),
      temperature: round(this.temperature),
      count: Math.floor(this.parts),
      power: round(power, 2),
    };
  }

  private nextStatus(dtSec: number): MachineStatus {
    let r = this.random();
    for (const [next, perSecond] of TRANSITIONS[this.status]) {
      const p = 1 - (1 - perSecond) ** dtSec;
      if (r < p) return next;
      r -= p;
    }
    return this.status;
  }
}
