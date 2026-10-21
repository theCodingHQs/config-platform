import React, { useState } from 'react';
import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { IconPicker } from '../src/components/icon-picker';

describe('IconPicker', () => {
  it('clearable mode shows a placeholder, picks an icon and clears back to none', async () => {
    const onChange = vi.fn();
    function Harness() {
      const [icon, setIcon] = useState<string | undefined>(undefined);
      return (
        <IconPicker
          clearable
          id="stat-icon"
          label="Stat Icon (optional)"
          value={icon}
          onChange={(next) => {
            onChange(next);
            setIcon(next);
          }}
        />
      );
    }
    const user = userEvent.setup();
    render(<Harness />);

    // Label is associated with the trigger, which shows the empty state
    const trigger = screen.getByLabelText('Stat Icon (optional)');
    expect(trigger).toHaveTextContent('No icon');

    await user.click(trigger);
    await user.type(screen.getByPlaceholderText(/Search all/i), 'Gauge');
    await user.click(screen.getByTitle(/\(Gauge\)$/));
    expect(onChange).toHaveBeenLastCalledWith('Gauge');
    expect(screen.getByLabelText('Stat Icon (optional)')).toHaveTextContent('Gauge');

    await user.click(screen.getByLabelText('Stat Icon (optional)'));
    await user.click(screen.getByRole('button', { name: 'No icon' }));
    expect(onChange).toHaveBeenLastCalledWith(undefined);
    expect(screen.getByLabelText('Stat Icon (optional)')).toHaveTextContent('No icon');
  });

  it('required mode (entity icons) offers no "No icon" choice', async () => {
    const user = userEvent.setup();
    render(<IconPicker value="Database" onChange={() => {}} label="Entity Icon" />);
    await user.click(screen.getByLabelText('Entity Icon'));
    expect(screen.queryByRole('button', { name: 'No icon' })).not.toBeInTheDocument();
  });
});
