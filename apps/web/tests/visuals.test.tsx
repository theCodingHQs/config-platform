import React from 'react';
import { describe, it, expect, afterEach } from 'vitest';
import { render, cleanup } from '@testing-library/react';
import { VisualDefinitionSchema, type VisualElement } from '@config-platform/schema';
import { SHAPES, shapeOf } from '../src/visuals/shapes';
import { defaultProps, resolveElement } from '../src/visuals/resolve-props';
import { VisualScene, drawOrder } from '../src/visuals/VisualScene';
import { VISUAL_TEMPLATES } from '../src/visuals/templates';
import { editorReducer, newElementId, type EditorState } from '../src/studio/visuals/editor-state';

afterEach(() => cleanup());

const live = (values: Record<string, unknown>) => ({ live: { line1: values }, liveInfo: { connected: true, tags: {}, connections: {} } });
const el = (over: Partial<VisualElement> = {}): VisualElement => ({ id: 'e1', type: 'conveyor', x: 0, y: 0, scale: 1, flip: false, props: {}, bindings: {}, ...over });

describe('property values', () => {
  const conveyor = shapeOf('conveyor')!;
  const machine = shapeOf('machine')!;

  it('uses defaults, then set values, then bindings', () => {
    const { props, problems } = resolveElement(conveyor, el({ props: { length: 6 }, bindings: { speed: 'live.line1.speed / 40', running: 'live.line1.status == "running"' } }), live({ speed: 60, status: 'stopped' }));
    expect(props).toMatchObject({ length: 6, width: 1, speed: 1.5, running: false });
    expect(problems).toEqual({});
  });

  it('keeps numbers inside the property range', () => {
    expect(resolveElement(conveyor, el({ bindings: { speed: 'live.line1.speed' } }), live({ speed: 500 })).props.speed).toBe(5);
  });

  it('matches a status case-insensitively and explains a value it does not know', () => {
    expect(resolveElement(machine, el({ type: 'machine', bindings: { status: 'live.line1.status' } }), live({ status: 'ALARM' })).props.status).toBe('alarm');
    const odd = resolveElement(machine, el({ type: 'machine', bindings: { status: 'live.line1.status' } }), live({ status: 'paused' }));
    expect(odd.props.status).toBe('running');
    expect(odd.problems.status).toMatch(/"paused" isn't one of running, idle/);
  });

  it('keeps the set value when a binding has no value yet or is broken', () => {
    const waiting = resolveElement(conveyor, el({ props: { speed: 2 }, bindings: { speed: 'live.line1.speed' } }), live({}));
    expect(waiting.props.speed).toBe(2);
    expect(waiting.problems.speed).toMatch(/no value yet/);
    const broken = resolveElement(conveyor, el({ bindings: { speed: 'live.line1.speed *' } }), live({ speed: 1 }));
    expect(broken.props.speed).toBe(1);
    expect(broken.problems.speed).toBeTruthy();
  });

  it('only accepts colours from the palette', () => {
    const r = resolveElement(conveyor, el({ bindings: { color: 'live.line1.speed > 40 ? "red" : "magenta"' } }), live({ speed: 10 }));
    expect(r.props.color).toBe('steel');
    expect(r.problems.color).toMatch(/isn't one of the colours/);
  });

  it('ignores bindings when shown without live data (thumbnails)', () => {
    expect(resolveElement(conveyor, el({ bindings: { running: 'false' } }), null).props.running).toBe(true);
  });
});

describe('shape library', () => {
  it('every shape has a unique type and valid defaults, and draws', () => {
    expect(new Set(SHAPES.map((s) => s.type)).size).toBe(SHAPES.length);
    const elements = SHAPES.map((s, i) => el({ id: `s${i}`, type: s.type, x: 100 + i * 40, y: 100, props: defaultProps(s) }));
    for (const s of SHAPES) {
      const { props, problems } = resolveElement(s, { props: defaultProps(s), bindings: {} }, null);
      expect(problems).toEqual({});
      expect(Object.keys(props).sort()).toEqual(s.props.map((p) => p.name).sort());
    }
    const { container } = render(<VisualScene definition={{ width: 1200, height: 700, grid: 'isometric', elements }} scope={null} />);
    expect(container.querySelectorAll('[data-element-id]')).toHaveLength(SHAPES.length);
  });

  it('draws floor zones first and nearer shapes over further ones', () => {
    const far = el({ id: 'far', x: 0, y: 0 });
    const near = el({ id: 'near', x: 0, y: 300 });
    const zone = el({ id: 'zone', type: 'zone', x: 0, y: 600 });
    expect(drawOrder([near, zone, far]).map((e) => e.id)).toEqual(['zone', 'far', 'near']);
  });
});

describe('templates', () => {
  it('are valid drawings with known shapes', () => {
    for (const t of VISUAL_TEMPLATES) {
      const def = VisualDefinitionSchema.parse(t.build());
      expect(def.elements.every((e) => shapeOf(e.type))).toBe(true);
      expect(new Set(def.elements.map((e) => e.id)).size).toBe(def.elements.length);
    }
  });

  it('the assembly line moves with the Line 1 tags', () => {
    const def = VISUAL_TEMPLATES.find((t) => t.id === 'assembly-line')!.build();
    const { container, getByText, rerender } = render(<VisualScene definition={def} scope={live({ speed: 45, status: 'running', count: 1250 })} />);
    const belt = () => container.querySelector('[data-element-id="infeed"] > g')!;
    expect(belt().getAttribute('class')).toBeNull();
    expect(getByText('Line 1: running')).toBeTruthy();
    expect(getByText('45 pcs/min')).toBeTruthy();
    rerender(<VisualScene definition={def} scope={live({ speed: 45, status: 'stopped', count: 1250 })} />);
    expect(belt().getAttribute('class')).toBe('vis-paused');
    expect(getByText('Line 1: stopped')).toBeTruthy();
  });
});

describe('editor history', () => {
  const start = editorReducer({} as EditorState, { type: 'load', name: 'V', definition: { width: 1200, height: 700, grid: 'isometric', elements: [] } });

  it('a drag is one undo step; undo and redo restore it', () => {
    let s = editorReducer(start, { type: 'add', element: el() });
    expect(s.selectedId).toBe('e1');
    for (const x of [10, 20, 30]) s = editorReducer(s, { type: 'update', id: 'e1', patch: { x }, group: 'drag-1' });
    expect(s.past).toHaveLength(2);
    s = editorReducer(s, { type: 'undo' });
    expect(s.definition.elements[0].x).toBe(0);
    s = editorReducer(s, { type: 'redo' });
    expect(s.definition.elements[0].x).toBe(30);
    s = editorReducer(s, { type: 'undo' });
    s = editorReducer(s, { type: 'undo' });
    expect(s.definition.elements).toEqual([]);
    expect(s.selectedId).toBeNull();
  });

  it('tracks unsaved changes and a new change clears redo', () => {
    let s = editorReducer(start, { type: 'rename', name: 'Line 1' });
    expect(s.dirty).toBe(true);
    s = editorReducer(s, { type: 'saved' });
    expect(s.dirty).toBe(false);
    s = editorReducer(s, { type: 'undo' });
    s = editorReducer(s, { type: 'canvas', patch: { grid: 'none' } });
    expect(s.future).toEqual([]);
    expect(s.name).toBe('V');
  });

  it('gives new elements ids not already used', () => {
    expect(newElementId([el({ id: 'e1' }), el({ id: 'e3' })])).toBe('e4');
    expect(newElementId([el({ id: 'e2' })])).toBe('e3');
    expect(newElementId([el({ id: 'e2' }), el({ id: 'e3' })])).toBe('e4');
  });
});
