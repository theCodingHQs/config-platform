import React from 'react';
import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { CardPropsSchema, ModalPropsSchema, DEFAULT_CONTENT_GAP } from '@config-platform/schema';
import { CardComponent } from '../src/components/card';
import { contentLayout } from '../src/components/content-layout';

describe('Container content layout (card / modal)', () => {
  it('spaces card children with the default gap in a vertical column', () => {
    render(
      <CardComponent title="Machine register" variant="bordered" padding="md">
        <div>Filters</div>
        <div>Table</div>
      </CardComponent>,
    );
    const body = screen.getByTestId('card-body');
    expect(body).toHaveClass('content-layout-vertical');
    expect(body.style.display).toBe('flex');
    expect(body.style.flexDirection).toBe('column');
    expect(body.style.gap).toBe(`${DEFAULT_CONTENT_GAP}px`);
  });

  it('applies custom gap, direction, alignment and wrapping', () => {
    render(
      <CardComponent variant="default" padding="sm" direction="horizontal" gap={24} align="center" justify="space-between" wrap>
        <div>A</div>
        <div>B</div>
      </CardComponent>,
    );
    const body = screen.getByTestId('card-body');
    expect(body).toHaveClass('content-layout-horizontal');
    expect(body.style).toMatchObject({
      flexDirection: 'row',
      gap: '24px',
      alignItems: 'center',
      justifyContent: 'space-between',
      flexWrap: 'wrap',
    });
  });

  it('accepts string gaps such as CSS tokens', () => {
    expect(contentLayout({ gap: 'var(--spacing-3)' }).style.gap).toBe('var(--spacing-3)');
    expect(contentLayout({ gap: 0 }).style.gap).toBe('0px');
  });

  it('validates content layout props on card and modal, and keeps existing nodes valid', () => {
    expect(CardPropsSchema.parse({ gap: 12, direction: 'horizontal', wrap: true })).toMatchObject({ gap: 12, direction: 'horizontal', wrap: true });
    expect(CardPropsSchema.safeParse({ direction: 'diagonal' }).success).toBe(false);
    expect(ModalPropsSchema.parse({ openStateKey: 'open', gap: 8 })).toMatchObject({ gap: 8 });
    // Existing cards/modals without layout props still parse (defaults applied at render)
    expect(CardPropsSchema.parse({ title: 'Old card' }).gap).toBeUndefined();
  });
});
