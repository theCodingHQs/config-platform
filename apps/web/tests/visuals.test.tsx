import React from 'react';
import { describe, it, expect, afterEach } from 'vitest';
import { render, cleanup } from '@testing-library/react';
import { VisualDefinitionSchema, emptyVisualDefinition, type VisualDefinition, type VisualNode } from '@config-platform/schema';
import { SHAPES, shapeOf } from '../src/visuals/shapes';
import { defaultProps, resolveNode } from '../src/visuals/resolve-props';
import { specsFor } from '../src/visuals/node-specs';
import { VisualScene } from '../src/visuals/VisualScene';
import { VISUAL_TEMPLATES } from '../src/visuals/templates';
import { VISUAL_FUNCTIONS } from '../src/visuals/visual-functions';
import { safeColor } from '../src/visuals/coerce';
import { editorReducer, type EditorState } from '../src/studio/visuals/editor-state';
import { groupNodes, reorderNodes, ungroupNode, updateNodes, withNewIds, allIds } from '../src/studio/visuals/node-tree';
import { dragBox, resizePatch } from '../src/studio/visuals/resize';
import { scalePath, scalePoints } from '../src/studio/visuals/path-scale';
import { dragAttrs, penAttrs, pointsAttrs } from '../src/studio/visuals/tools';
import { parseNodes } from '../src/studio/visuals/clipboard';
import { pickTarget } from '../src/studio/visuals/use-select-gestures';
import { canDrop, moveLayers } from '../src/studio/visuals/layer-moves';
import { snapMove, snapResize } from '../src/studio/visuals/smart-guides';

afterEach(() => cleanup());

const live = (values: Record<string, unknown>) => ({ live: { line1: values }, liveInfo: { connected: true, tags: {}, connections: {} } });
const rect = (over: Partial<VisualNode> = {}): VisualNode => ({ id: 'r1', kind: 'rect', attrs: { x: 10, y: 20, width: 100, height: 40, fill: 'var(--vis-white)' }, ...over });
const def = (nodes: VisualNode[], over: Partial<VisualDefinition> = {}): VisualDefinition => ({ ...emptyVisualDefinition(), nodes, ...over });
const resolve = (n: VisualNode, scope: Record<string, unknown> | null) => resolveNode(n, specsFor(n), scope);

describe('attribute values', () => {
  it('uses defaults, then set values, then rules, then bindings', () => {
    const lamp: VisualNode = {
      id: 'lamp',
      kind: 'ellipse',
      attrs: { rx: 6, ry: 6, fill: 'grey' },
      rules: [{ when: 'live.line1.status == "running"', set: { fill: 'green', rx: 8 }, effect: 'pulse' }],
      bindings: { rx: 'live.line1.speed / 10' },
    };
    const on = resolve(lamp, live({ status: 'running', speed: 50 }));
    expect(on.attrs).toMatchObject({ fill: 'green', rx: 5, ry: 6, opacity: 1, x: 0 });
    expect(on.rulesOn).toEqual([true]);
    expect(on.effects).toEqual([{ type: 'pulse', speed: 1 }]);
    const off = resolve(lamp, live({ status: 'stopped', speed: 50 }));
    expect(off.attrs.fill).toBe('grey');
    expect(off.effects).toEqual([]);
  });

  it('keeps the set value and explains when a binding has no value, is broken or the wrong kind', () => {
    const waiting = resolve(rect({ bindings: { width: 'live.line1.speed' } }), live({}));
    expect(waiting.attrs.width).toBe(100);
    expect(waiting.problems.width).toMatch(/no value yet/);
    const broken = resolve(rect({ bindings: { width: 'live.line1.speed *' } }), live({ speed: 1 }));
    expect(broken.attrs.width).toBe(100);
    expect(broken.problems.width).toBeTruthy();
    const bad = resolve(rect({ rules: [{ when: 'live.line1.on', set: { width: 'wide' } }] }), live({ on: true }));
    expect(bad.problems['rule:0']).toMatch(/Width/);
  });

  it('only accepts colours that load nothing from elsewhere', () => {
    expect(safeColor('#ff0000')).toBe('#ff0000');
    expect(safeColor('var(--vis-red)')).toBe('var(--vis-red)');
    expect(safeColor('url(#gBody)')).toBe('url(#gBody)');
    expect(safeColor('url(https://evil.example/x.svg#a)')).toBeNull();
    const r = resolve(rect({ bindings: { fill: '"url(http://x)"' } }), live({}));
    expect(r.attrs.fill).toBe('var(--vis-white)');
    expect(r.problems.fill).toMatch(/isn't a colour/);
  });

  it('effects run always or while their condition holds; nothing live without a scope', () => {
    const fan: VisualNode = { id: 'f', kind: 'group', attrs: {}, effects: [{ type: 'spin', speed: 2 }, { type: 'blink', when: 'live.line1.alarm' }] };
    expect(resolve(fan, live({ alarm: true })).effects).toEqual([{ type: 'spin', speed: 2 }, { type: 'blink', speed: 1 }]);
    expect(resolve(fan, live({ alarm: false })).effects).toEqual([{ type: 'spin', speed: 2 }]);
    expect(resolve(rect({ bindings: { width: '5' } }), null).attrs.width).toBe(100);
  });

  it('has scale, clamp and pick for bindings', () => {
    expect(VISUAL_FUNCTIONS.scale(15350, 0, 30700, 20, 1380)).toBe(700);
    expect(VISUAL_FUNCTIONS.scale(-5, 0, 10, 0, 100)).toBe(0);
    expect(VISUAL_FUNCTIONS.clamp(120, 0, 100)).toBe(100);
    expect(VISUAL_FUNCTIONS.pick('ALARM', 'running', 'green', 'alarm', 'red', 'grey')).toBe('red');
    expect(VISUAL_FUNCTIONS.pick('paused', 'running', 'green', 'grey')).toBe('grey');
    const cart = resolve(rect({ bindings: { x: 'scale(live.line1.pos, 0, 30700, 20, 1380)' } }), live({ pos: 30700 }));
    expect(cart.attrs.x).toBe(1380);
  });
});

describe('drawing', () => {
  it('draws every kind, groups with their children, and parts', () => {
    const nodes: VisualNode[] = [
      rect(),
      { id: 'e', kind: 'ellipse', attrs: { x: 50, y: 50, rx: 10, ry: 5 } },
      { id: 'l', kind: 'line', attrs: { x2: 30 } },
      { id: 'pl', kind: 'polyline', attrs: { points: '0,0 10,10' } },
      { id: 'pg', kind: 'polygon', attrs: { points: '0,0 10,0 5,8' } },
      { id: 'p', kind: 'path', attrs: { d: 'M0 0L10 10' } },
      { id: 't', kind: 'text', attrs: { text: 'Station A', textAnchor: 'middle' } },
      { id: 'i', kind: 'image', attrs: { href: 'javascript:alert(1)' } },
      { id: 'g', kind: 'group', attrs: { x: 5, fill: 'red' }, children: [{ id: 'c', kind: 'rect', attrs: { width: 4, height: 4 } }] },
      ...SHAPES.map((s, i): VisualNode => ({ id: `part${i}`, kind: 'preset', ref: s.type, attrs: { ...defaultProps(s), x: 100 + i * 40, y: 100 } })),
    ];
    const { container, getByText } = render(<VisualScene definition={def(nodes, { mode: 'isometric' })} scope={null} />);
    expect(container.querySelectorAll('[data-node-id]')).toHaveLength(nodes.length + 1);
    expect(getByText('Station A').getAttribute('text-anchor')).toBe('middle');
    expect(container.querySelector('[data-node-id="g"]')!.getAttribute('transform')).toBe('translate(5 0)');
    expect(container.querySelector('[data-node-id="g"] g[fill="red"] [data-node-id="c"]')).toBeTruthy();
    // An unsafe picture link is never loaded
    expect(container.querySelector('image')).toBeNull();
  });

  it('follows live data: rules recolour, hidden shapes disappear, effects animate', () => {
    const lamp: VisualNode = { id: 'lamp', kind: 'ellipse', attrs: { rx: 6, ry: 6, fill: 'grey' }, rules: [{ when: 'live.line1.status == "alarm"', set: { fill: 'red' }, effect: 'blink' }] };
    const free: VisualNode = { id: 'free', kind: 'text', attrs: { text: 'FREE' }, bindings: { visible: '!live.line1.busy' } };
    const d = def([lamp, free]);
    const { container, queryByText, rerender } = render(<VisualScene definition={d} scope={live({ status: 'alarm', busy: false })} />);
    const ellipse = () => container.querySelector('ellipse')!;
    expect(ellipse().getAttribute('fill')).toBe('red');
    expect(container.querySelector('[data-node-id="lamp"] .vis-fx-blink')).toBeTruthy();
    expect(queryByText('FREE')).toBeTruthy();
    rerender(<VisualScene definition={d} scope={live({ status: 'running', busy: true })} />);
    expect(ellipse().getAttribute('fill')).toBe('grey');
    expect(container.querySelector('.vis-fx-blink')).toBeNull();
    expect(queryByText('FREE')).toBeNull();
  });

  it('prefixes gradient ids so two drawings on a page keep their own', () => {
    const d = def([rect({ attrs: { width: 10, height: 10, fill: 'url(#body)' } })], { paints: [{ id: 'body', type: 'linear', stops: [{ offset: 0, color: 'white' }] }] });
    const { container } = render(<VisualScene definition={d} scope={null} />);
    const id = container.querySelector('linearGradient')!.id;
    expect(id).toMatch(/-body$/);
    expect(container.querySelector('rect[fill^="url"]')!.getAttribute('fill')).toBe(`url(#${id})`);
  });
});

describe('format', () => {
  it('converts first-format drawings to parts in the order they were drawn', () => {
    const old = { width: 900, grid: 'isometric', elements: [{ id: 'm', type: 'machine', x: 300, y: 300 }, { id: 'z', type: 'zone', x: 400, y: 100, props: { length: 5 } }] };
    const d = VisualDefinitionSchema.parse(old);
    expect(d).toMatchObject({ version: 2, mode: 'isometric', grid: true, width: 900 });
    expect(d.nodes.map((n) => n.id)).toEqual(['z', 'm']);
    expect(d.nodes[0]).toMatchObject({ kind: 'preset', ref: 'zone', attrs: { x: 400, y: 100, length: 5 } });
  });

  it('templates and their symbols are valid drawings with known parts', () => {
    for (const t of VISUAL_TEMPLATES) {
      const ids = Object.fromEntries((t.symbols ?? []).map((s) => [s.key, `sym-${s.key}`]));
      const d = VisualDefinitionSchema.parse(t.build(ids));
      expect(d.nodes.every((n) => n.kind !== 'preset' || shapeOf(n.ref!))).toBe(true);
      for (const s of t.symbols ?? []) VisualDefinitionSchema.parse(s.build());
    }
  });

  it('the process line moves its carrier and lights its stations from the line tags', () => {
    const t = VISUAL_TEMPLATES.find((x) => x.id === 'process-line')!;
    const [station, carrier] = t.symbols!.map((s) => s.build());
    const d = t.build({ station: 'st', carrier: 'cr' });
    const symbols = new Map([['st', station], ['cr', carrier]]);
    const scope = { live: { line: { carrier: { position: 30000, loaded: 'yes', moving: 'no', lift: 50 }, station4: { status: 'alarm', level: 90 } } } };
    const { container, getByText, getAllByText } = render(<VisualScene definition={d} scope={scope} symbols={symbols} />);
    expect(container.querySelector('[data-node-id="carrier"]')!.getAttribute('transform')).toBe('translate(1266.3 184)');
    expect(getByText('BUSY')).toBeTruthy();
    expect(getByText('Carrier at 30000 of 30000 mm')).toBeTruthy();
    expect(getAllByText(/^Station [0-9]+$/)).toHaveLength(10);
    // Station 4 is in alarm: its status lamp blinks; the carrier is at the far end, so only that station shows it
    expect(container.querySelector('[data-node-id="station4"] [data-node-id="status"] .vis-fx-blink')).toBeTruthy();
    const here = [...container.querySelectorAll('[data-node-id="carrier-here"] polygon')].map((p) => p.getAttribute('fill'));
    expect(here.filter((f) => f === 'var(--vis-blue)')).toHaveLength(1);
  });
});

describe('editing', () => {
  const a = rect({ id: 'a' });
  const b = rect({ id: 'b', attrs: { x: 200, y: 0, width: 10, height: 10 } });
  const c = rect({ id: 'c' });

  it('groups siblings in place and ungroups them, keeping where they are', () => {
    const grouped = groupNodes([a, b, c], ['a', 'b'], 'g1');
    expect(grouped.map((n) => n.id)).toEqual(['g1', 'c']);
    expect(grouped[0].children!.map((n) => n.id)).toEqual(['a', 'b']);
    const moved = updateNodes(grouped, new Map([['g1', { attrs: { x: 5, y: 7 } }]]));
    const back = ungroupNode(moved, 'g1');
    expect(back.map((n) => n.id)).toEqual(['a', 'b', 'c']);
    expect(back[1].attrs).toMatchObject({ x: 205, y: 7 });
  });

  it('reorders by one step or to the front and back', () => {
    const ids = (ns: VisualNode[]) => ns.map((n) => n.id).join('');
    expect(ids(reorderNodes([a, b, c], ['a'], 'forward'))).toBe('bac');
    expect(ids(reorderNodes([a, b, c], ['c'], 'back'))).toBe('cab');
    expect(ids(reorderNodes([a, b, c], ['a', 'b'], 'front'))).toBe('cab');
    expect(ids(reorderNodes([a, b, c], ['b'], 'backward'))).toBe('bac');
  });

  it('merges attribute changes and drops emptied settings', () => {
    const [n] = updateNodes([rect({ bindings: { x: 'live.a' } })], new Map([['r1', { attrs: { width: 5, fill: undefined }, bindings: {} }]]));
    expect(n.attrs).toEqual({ x: 10, y: 20, width: 5, height: 40 });
    expect(n.bindings).toBeUndefined();
  });

  it('copies get fresh ids all the way down', () => {
    const g: VisualNode = { id: 'g', kind: 'group', attrs: {}, children: [rect({ id: 'rect1' })] };
    const [copy] = withNewIds([g], allIds([g]));
    expect(copy.id).toBe('group1');
    expect(copy.children![0].id).toBe('rect2');
  });

  it('a drag is one undo step; selection follows undo', () => {
    let s = editorReducer({} as EditorState, { type: 'load', name: 'V', definition: def([]) });
    s = editorReducer(s, { type: 'add', nodes: [a] });
    expect(s.selection).toEqual(['a']);
    for (const x of [11, 12, 13]) s = editorReducer(s, { type: 'update', changes: [{ id: 'a', patch: { attrs: { x } } }], group: 'drag' });
    expect(s.past).toHaveLength(2);
    s = editorReducer(s, { type: 'undo' });
    expect(s.definition.nodes[0].attrs.x).toBe(10);
    s = editorReducer(s, { type: 'undo' });
    expect(s.selection).toEqual([]);
    s = editorReducer(s, { type: 'redo' });
    expect(s.dirty).toBe(true);
  });

  it('new shapes go into the open group', () => {
    let s = editorReducer({} as EditorState, { type: 'load', name: 'V', definition: def([{ id: 'g', kind: 'group', attrs: {}, children: [] }]) });
    s = editorReducer(s, { type: 'open', id: 'g' });
    s = editorReducer(s, { type: 'add', nodes: [a] });
    expect(s.definition.nodes[0].children!.map((n) => n.id)).toEqual(['a']);
  });

  it('a click picks the top-level shape, the one inside the open group, or the deepest with Ctrl', () => {
    expect(pickTarget(['g', 'h', 'r'], null, false)).toEqual({ id: 'g', leaveGroup: false });
    expect(pickTarget(['g', 'h', 'r'], 'g', false)).toEqual({ id: 'h', leaveGroup: false });
    expect(pickTarget(['x'], 'g', false)).toEqual({ id: 'x', leaveGroup: true });
    expect(pickTarget(['g', 'h', 'r'], null, true).id).toBe('r');
  });
});

describe('moving layers in the list', () => {
  const ids = (ns: readonly VisualNode[]) => ns.map((n) => n.id).join('');
  const tree = (): VisualNode[] => [
    rect({ id: 'a' }),
    { id: 'g', kind: 'group', attrs: { x: 100 }, children: [rect({ id: 'b' }), rect({ id: 'c' })] },
    rect({ id: 'd' }),
  ];

  it('puts a layer just in front of or just behind another (the list shows the front first)', () => {
    expect(ids(moveLayers(tree(), ['a'], { targetId: 'd', place: 'above' }))).toBe('gda');
    expect(ids(moveLayers(tree(), ['d'], { targetId: 'a', place: 'below' }))).toBe('dag');
    expect(ids(moveLayers(tree(), ['a', 'd'], { targetId: 'g', place: 'above' }))).toBe('gad');
  });

  it('moves layers into and out of groups, at the position given so they stay in place', () => {
    const into = moveLayers(tree(), ['a'], { targetId: 'g', place: 'inside' }, new Map([['a', { x: -90, y: 20 }]]));
    expect(ids(into)).toBe('gd');
    expect(ids(into[0].children!)).toBe('bca');
    expect(into[0].children![2].attrs).toMatchObject({ x: -90, y: 20 });
    const out = moveLayers(tree(), ['b'], { targetId: 'd', place: 'above' });
    expect(ids(out)).toBe('agdb');
    expect(ids(out[1].children!)).toBe('c');
  });

  it('refuses drops into a non-group, into itself, or of a locked layer', () => {
    expect(canDrop(tree(), ['a'], { targetId: 'd', place: 'inside' })).toBe(false);
    expect(canDrop(tree(), ['g'], { targetId: 'b', place: 'above' })).toBe(false);
    expect(canDrop(tree(), ['g'], { targetId: 'g', place: 'inside' })).toBe(false);
    const locked = updateNodes(tree(), new Map([['a', { locked: true }]]));
    expect(canDrop(locked, ['a'], { targetId: 'd', place: 'above' })).toBe(false);
    expect(moveLayers(locked, ['a'], { targetId: 'd', place: 'above' })).toBe(locked);
  });

  it('is one undo step, keeps the moved layers selected and opens the group they went into', () => {
    let s = editorReducer({} as EditorState, { type: 'load', name: 'V', definition: def(tree()) });
    s = editorReducer(s, { type: 'move', ids: ['d'], drop: { targetId: 'g', place: 'inside' } });
    expect(s.selection).toEqual(['d']);
    expect(s.openGroup).toBe('g');
    expect(ids(s.definition.nodes[1].children!)).toBe('bcd');
    s = editorReducer(s, { type: 'undo' });
    expect(ids(s.definition.nodes)).toBe('agd');
  });
});

describe('smart guides', () => {
  const canvas = { width: 1000, height: 600 };
  const other = { x: 100, y: 100, width: 200, height: 100 };

  it('snaps a moved shape to the edges and centre of another, and draws the line across both', () => {
    // Left edge 4 units off the other's left edge; top 3 off its centre line
    const r = snapMove({ x: 104, y: 397, width: 50, height: 50 }, [other], canvas, 6);
    expect(r.dx).toBe(-4);
    expect(r.dy).toBe(null);
    expect(r.guides).toEqual([{ axis: 'x', at: 100, from: 100, to: 447 }]);
    const centred = snapMove({ x: 173, y: 300, width: 50, height: 50 }, [other], canvas, 6);
    expect(centred.dx).toBe(2); // centre 198 → 200
    expect(centred.guides[0]).toMatchObject({ axis: 'x', at: 200 });
  });

  it('lines up with the canvas edges and centre, and leaves far-off shapes alone', () => {
    const r = snapMove({ x: 480, y: 3, width: 50, height: 20 }, [], canvas, 6);
    expect(r.dx).toBe(-5); // centre 505 → 500
    expect(r.dy).toBe(-3); // top → 0
    expect(r.guides.find((g) => g.axis === 'x')).toEqual({ axis: 'x', at: 500, from: 0, to: 600 });
    expect(snapMove({ x: 700, y: 400, width: 10, height: 10 }, [other], { width: 2000, height: 2000 }, 6)).toMatchObject({ dx: null, dy: null, guides: [] });
  });

  it('snaps the dragged edge when resizing, keeping the other edge where it is', () => {
    const r = snapResize({ x: 400, y: 50, width: 96, height: 40 }, 'w', [other], canvas, 6); // left 400 → right edge 300? too far
    expect(r.box).toEqual({ x: 400, y: 50, width: 96, height: 40 });
    const left = snapResize({ x: 303, y: 300, width: 97, height: 40 }, 'w', [other], canvas, 6);
    expect(left.box).toEqual({ x: 300, y: 300, width: 100, height: 40 });
    expect(left.guides[0]).toMatchObject({ axis: 'x', at: 300 });
  });

  it('matches the size of a neighbour when no edge is near', () => {
    const r = snapResize({ x: 600, y: 300, width: 197, height: 40 }, 'e', [other], canvas, 6);
    expect(r.box.width).toBe(200);
    expect(r.sizes).toHaveLength(1);
    expect(r.sizes[0]).toMatchObject({ axis: 'x', size: 200 });
    expect(r.sizes[0].boxes).toHaveLength(2);
  });
});

describe('resizing and drawing', () => {
  it('resizes plain shapes by their own size and scales the rest', () => {
    const from = { x: 10, y: 20, width: 100, height: 40 };
    const to = { x: 10, y: 20, width: 200, height: 20 };
    expect(resizePatch(rect(), from, to, false).attrs).toEqual({ x: 10, y: 20, width: 200, height: 20 });
    const g: VisualNode = { id: 'g', kind: 'group', attrs: { x: 0, y: 0 }, children: [] };
    expect(resizePatch(g, from, to, false).attrs).toMatchObject({ scaleX: 2, scaleY: 0.5, x: 50, y: -10 });
    const p: VisualNode = { id: 'p', kind: 'path', attrs: { x: 10, y: 20, d: 'M0 0 L100 40 a5 5 0 0 1 10 10 Z' } };
    expect(resizePatch(p, from, to, false).attrs!.d).toBe('M0 0L200 20a10 2.5 0 0 1 20 5Z');
  });

  it('drag boxes keep their shape with Shift and flip past the opposite edge', () => {
    const start = { x: 0, y: 0, width: 100, height: 50 };
    expect(dragBox(start, 'se', 100, 0, true, false)).toEqual({ x: 0, y: 0, width: 200, height: 100 });
    expect(dragBox(start, 'e', -150, 0, false, false)).toEqual({ x: -50, y: 0, width: 50, height: 50 });
  });

  it('scales point lists', () => {
    expect(scalePoints('0,0 10,5', 2, 3)).toBe('0,0 20,15');
    expect(scalePath('M1,2 H10 V4', 2, 3)).toBe('M2 6H20V12');
  });

  it('builds shapes from gestures', () => {
    expect(dragAttrs('rect', { x: 50, y: 50 }, { x: 10, y: 20 }, false)).toEqual({ x: 10, y: 20, width: 40, height: 30 });
    expect(dragAttrs('ellipse', { x: 0, y: 0 }, { x: 40, y: 10 }, true)).toEqual({ x: 20, y: 20, rx: 20, ry: 20 });
    expect(dragAttrs('line', { x: 0, y: 0 }, { x: 1, y: 1 }, false)).toBeNull();
    expect(pointsAttrs([{ x: 10, y: 10 }, { x: 20, y: 30 }])).toEqual({ x: 10, y: 10, points: '0,0 10,20' });
    expect(penAttrs([{ p: { x: 0, y: 0 }, h: { x: 10, y: 0 } }, { p: { x: 20, y: 20 } }], false).d).toBe('M0 0 C10 0 20 20 20 20');
  });

  it('pastes only shapes copied from a visual', () => {
    expect(parseNodes('hello')).toBeNull();
    expect(parseNodes(JSON.stringify({ 'config-platform/visual-nodes@1': [rect(), { bad: true }] }))).toEqual([rect()]);
  });
});

describe('range helper', () => {
  it('writes and reads back scale() bindings', async () => {
    const { parseScale, scaleBinding } = await import('../src/studio/visuals/RangeMapper');
    const b = scaleBinding('live.cart.position', ['0', '30700', '20', '1380']);
    expect(b).toBe('scale(live.cart.position, 0, 30700, 20, 1380)');
    expect(parseScale(b)).toEqual({ expr: 'live.cart.position', range: ['0', '30700', '20', '1380'] });
    expect(parseScale('live.x').expr).toBe('live.x');
  });
});

describe('symbols', () => {
  it('each placed copy draws the symbol with its own inputs', async () => {
    const { symbolRefs } = await import('@config-platform/schema');
    const lamp: VisualDefinition = {
      ...emptyVisualDefinition(),
      inputs: [{ name: 'status', type: 'text', default: 'off' }],
      nodes: [{ id: 'l', kind: 'ellipse', attrs: { rx: 5, ry: 5, fill: 'grey' }, rules: [{ when: 'inputs.status == "alarm"', set: { fill: 'red' } }] }],
    };
    const d = def([
      { id: 'a', kind: 'symbol', ref: 'sym', attrs: { x: 10 } },
      { id: 'b', kind: 'symbol', ref: 'sym', attrs: { x: 50 }, bindings: { status: 'live.line1.state' } },
      { id: 'c', kind: 'symbol', ref: 'missing', attrs: {} },
    ]);
    expect(symbolRefs(d.nodes)).toEqual(['sym', 'missing']);
    const { container } = render(<VisualScene definition={d} scope={live({ state: 'alarm' })} symbols={new Map([['sym', lamp]])} />);
    const fills = [...container.querySelectorAll('ellipse')].map((e) => e.getAttribute('fill'));
    expect(fills).toEqual(['grey', 'red']);
    // A symbol that isn't there (yet) shows a placeholder, not an error
    expect(container.querySelector('[data-node-id="c"] rect[stroke-dasharray]')).toBeTruthy();
  });

  it('making a symbol moves the shapes onto its own canvas and keeps the gradients they use', async () => {
    const { symbolFromNodes } = await import('../src/studio/visuals/make-symbol');
    const from = def([], { paints: [{ id: 'body', type: 'linear', stops: [{ offset: 0, color: 'white' }] }, { id: 'unused', type: 'radial', stops: [{ offset: 0, color: 'red' }] }] });
    const made = symbolFromNodes([rect({ attrs: { x: 110, y: 220, width: 50, height: 30, fill: 'url(#body)' } })], { x: 110, y: 220, width: 50, height: 30 }, from);
    expect(made.at).toEqual({ x: 106, y: 216 });
    expect(made.definition).toMatchObject({ width: 58, height: 38, inputs: [], paints: [{ id: 'body' }] });
    expect(made.definition.nodes[0].attrs).toMatchObject({ x: 4, y: 4 });
  });
});

describe('lining up', () => {
  it('aligns edges and spaces shapes evenly', async () => {
    const { alignMoves } = await import('../src/studio/visuals/align');
    const items = [
      { id: 'a', box: { x: 0, y: 0, width: 10, height: 10 } },
      { id: 'b', box: { x: 50, y: 5, width: 20, height: 10 } },
      { id: 'c', box: { x: 100, y: 20, width: 10, height: 10 } },
    ];
    expect([...alignMoves(items, 'top')]).toEqual([['b', { dx: 0, dy: -5 }], ['c', { dx: 0, dy: -20 }]]);
    expect(alignMoves(items, 'right').get('a')).toEqual({ dx: 100, dy: 0 });
    // 110 wide, 40 of shapes: gaps of 35, so b starts at 45
    expect([...alignMoves(items, 'spread-x')]).toEqual([['b', { dx: -5, dy: 0 }]]);
  });
});

describe('SVG import', () => {
  it('brings in shapes, gradients, nested icons, transforms and titles; skips what it cannot show', async () => {
    const { importSvg } = await import('../src/studio/visuals/svg-import');
    const svg = `<svg viewBox="0 0 1400 420"><defs><linearGradient id="gBody" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#ffffff"/><stop offset=".6" stop-color="#eef2f7"/></linearGradient><pattern id="gHaz"/></defs>
      <g><title>Station A</title><rect fill="url(#gBody)" stroke="#9aa8b8" stroke-width="1.3" x="20" y="56" width="112" height="170" rx="4"/>
        <text x="76" y="26" text-anchor="middle" font-size="12" font-weight="700" style="font-family: ui-monospace, Menlo">Station A</text>
        <g transform="translate(41, 231.5)"><svg width="12" height="12" viewBox="0 0 16 16"><circle cx="8" cy="8" r="6" fill="#c3ccd6"/></svg></g>
        <rect x="-6" y="163" width="12" height="217" style="transform-box: fill-box; transform-origin: center bottom; transform: scaleY(0.5)"/>
        <rect x="0" y="0" width="5" height="5" fill="url(#gHaz)"/><use href="#x"/><script>alert(1)</script></g></svg>`;
    const r = importSvg(svg, new Set());
    expect(r).toMatchObject({ width: 1400, height: 420, skipped: { use: 1 } });
    expect(r.paints).toEqual([{ id: 'gBody', type: 'linear', x1: 0, y1: 0, x2: 0, y2: 1, stops: [{ offset: 0, color: '#ffffff' }, { offset: 0.6, color: '#eef2f7' }] }]);
    const [g] = r.nodes;
    expect(g).toMatchObject({ kind: 'group', name: 'Station A' });
    const [body, label, icon, column, hatched] = g.children!;
    expect(body.attrs).toMatchObject({ x: 20, y: 56, width: 112, height: 170, rx: 4, fill: 'url(#gBody)', strokeWidth: 1.3 });
    expect(label.attrs).toMatchObject({ text: 'Station A', fontSize: 12, fontWeight: '700', fontFamily: 'monospace', textAnchor: 'middle' });
    // The icon's 16-unit viewBox is scaled into 12 × 12
    expect(icon.children![0]).toMatchObject({ kind: 'group', attrs: { scaleX: 0.75, scaleY: 0.75, pivot: 'anchor' } });
    // Shrunk to half height around its bottom edge: it now starts half way down
    expect(column.attrs).toMatchObject({ x: -6, y: 271.5, scaleY: 0.5 });
    // A pattern fill can't be shown, so it's left unset rather than broken
    expect(hatched.attrs.fill).toBeUndefined();
  });

  it('refuses text that is not SVG', async () => {
    const { importSvg } = await import('../src/studio/visuals/svg-import');
    expect(() => importSvg('<html><body/></html>', new Set())).toThrow(/isn't an SVG/);
  });

  it('keeps both gradients when an imported one has a name already used', async () => {
    const { mergePaints } = await import('../src/studio/visuals/use-svg-import');
    const mine = { id: 'body', type: 'linear' as const, stops: [{ offset: 0, color: 'red' }] };
    const theirs = { id: 'body', type: 'linear' as const, stops: [{ offset: 0, color: 'blue' }] };
    const { paints, renames } = mergePaints([mine], [theirs, mine]);
    expect(paints.map((p) => p.id)).toEqual(['body', 'body-2']);
    expect(renames.get('body')).toBe('body-2');
  });
});
