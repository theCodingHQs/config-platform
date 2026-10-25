import React, { useState } from 'react';
import { describe, it, expect, afterEach } from 'vitest';
import { render, cleanup, fireEvent, screen } from '@testing-library/react';
import { suggest, type SuggestEntry } from '../src/components/expression-input/suggest';
import { ExpressionInput } from '../src/components/expression-input/ExpressionInput';
import { SuggestionsProvider } from '../src/components/expression-input/suggestions-context';

afterEach(() => cleanup());

const entries: SuggestEntry[] = [
  { path: 'live.ht.wagon.position', detail: 'mm · Heat treatment simulator', value: 12000 },
  { path: 'live.ht.wagon.busy', value: 'yes' },
  { path: 'live.ht.phf.heat' },
  { path: 'live.line1.speed' },
  { path: 'inputs.status', detail: 'symbol input' },
];
const functions = [{ name: 'scale', signature: 'scale(value, from, to, newFrom, newTo)', detail: 'Map a range' }];
const at = (text: string, caret = text.length) => suggest(text, caret, entries, functions);
const labels = (text: string, caret?: number) => at(text, caret)?.items.map((s) => s.label);

describe('expression suggestions', () => {
  it('offers the next part of a name, groups first', () => {
    expect(labels('live.')).toEqual(['ht', 'line1']);
    expect(labels('live.ht.')).toEqual(['phf', 'wagon']);
    expect(at('live.ht.wagon.')!.items).toEqual([
      { insert: 'live.ht.wagon.busy', label: 'busy', detail: undefined, value: 'yes', kind: 'value' },
      { insert: 'live.ht.wagon.position', label: 'position', detail: 'mm · Heat treatment simulator', value: 12000, kind: 'value' },
    ]);
    expect(at('live.h')!.items[0]).toMatchObject({ insert: 'live.ht.', kind: 'group' });
  });

  it('works inside formulas and offers top-level names and functions', () => {
    expect(labels('scale(live.ht.wa')).toEqual(['wagon']);
    expect(labels('live.line1.speed > 3 && inp')).toEqual(['inputs']);
    expect(labels('sc')).toEqual(['scale(value, from, to, newFrom, newTo)']);
    // Typed part found inside a name too ("pos" in "position")
    expect(labels('live.ht.wagon.sit')).toEqual(['position']);
  });

  it('replaces the whole name under the cursor', () => {
    const r = at('live.ht.wag == 1', 'live.ht.wa'.length)!;
    expect([r.start, r.end]).toEqual([0, 'live.ht.wag'.length]);
  });

  it('stays quiet in quoted text, numbers, and finished names', () => {
    expect(at('live.ht.phf.status == "live.')).toBeNull();
    expect(at('0.5')).toBeNull();
    expect(at('live.ht.phf.heat')).toBeNull();
  });
});

function Harness() {
  const [v, setV] = useState('');
  return (
    <SuggestionsProvider value={{ entries, functions }}>
      <ExpressionInput aria-label="Binding" value={v} onChange={setV} />
      <output data-testid="value">{v}</output>
    </SuggestionsProvider>
  );
}

describe('expression input', () => {
  it('picks suggestions with the keyboard and keeps going into groups', async () => {
    render(<Harness />);
    const input = screen.getByLabelText('Binding') as HTMLInputElement;
    fireEvent.change(input, { target: { value: 'live.', selectionStart: 5 } });
    expect(screen.getAllByRole('option').map((o) => o.textContent)).toEqual(['▸ht', '▸line1']);
    fireEvent.keyDown(input, { key: 'Enter' });
    expect(screen.getByTestId('value').textContent).toBe('live.ht.');
    await new Promise((r) => requestAnimationFrame(() => r(null)));
    // The list moves on to live.ht's children
    expect(screen.getAllByRole('option').map((o) => o.textContent)).toEqual(['▸phf', '▸wagon']);
    fireEvent.keyDown(input, { key: 'ArrowDown' });
    fireEvent.keyDown(input, { key: 'Tab' });
    expect(screen.getByTestId('value').textContent).toBe('live.ht.wagon.');
    fireEvent.keyDown(input, { key: 'Escape' });
    expect(screen.queryByRole('listbox')).toBeNull();
    // Typing past a name (a space, an operator) doesn't reopen the list; Ctrl+Space does
    fireEvent.change(input, { target: { value: 'live.ht.wagon.busy ', selectionStart: 19 } });
    expect(screen.queryByRole('listbox')).toBeNull();
    fireEvent.keyDown(input, { key: ' ', ctrlKey: true });
    expect(screen.getAllByRole('option').length).toBeGreaterThan(0);
  });
});
