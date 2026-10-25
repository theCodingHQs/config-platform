/** The shape library. To add a shape: write its file (see shape-types.ts) and list it here. */
import type { ShapeCategory, ShapeDef } from "./shape-types";
import { conveyor } from "./conveyor";
import { machine } from "./machine";
import { robotArm } from "./robot-arm";
import { fan } from "./fan";
import { tank } from "./tank";
import { pipe } from "./pipe";
import { signalTower } from "./signal-tower";
import { label, valueDisplay } from "./text-shapes";
import { zone, box } from "./layout-shapes";

export const SHAPES: readonly ShapeDef[] = [conveyor, machine, robotArm, fan, tank, pipe, signalTower, label, valueDisplay, zone, box];

const BY_TYPE = new Map(SHAPES.map((s) => [s.type, s]));
export const shapeOf = (type: string): ShapeDef | undefined => BY_TYPE.get(type);

export const SHAPE_CATEGORIES: readonly ShapeCategory[] = ["Conveying", "Machines", "Storage & flow", "Signals & text", "Layout"];

export * from "./shape-types";
