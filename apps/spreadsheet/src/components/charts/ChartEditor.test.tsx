import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeAll, describe, expect, it, jest } from '@jest/globals';

import type { ChartConfig } from '@mog/charts';

import { ChartEditor } from './ChartEditor';

const BASE_CONFIG: ChartConfig = {
  type: 'column',
  dataRange: 'A1:B4',
};

describe('ChartEditor', () => {
  beforeAll(() => {
    if (!Element.prototype.hasPointerCapture) {
      Element.prototype.hasPointerCapture = () => false;
    }
    if (!Element.prototype.releasePointerCapture) {
      Element.prototype.releasePointerCapture = () => undefined;
    }
    if (!Element.prototype.scrollIntoView) {
      Element.prototype.scrollIntoView = () => undefined;
    }
  });

  function renderEditor() {
    render(
      <ChartEditor
        config={BASE_CONFIG}
        onChange={jest.fn()}
        onClose={jest.fn()}
        onDelete={jest.fn()}
      />,
    );
  }

  it('exposes the visible panel root for chart editor probes', () => {
    renderEditor();

    const panel = screen.getByTestId('chart-editor-panel');
    expect(panel).toBeInTheDocument();
    expect(panel).toHaveTextContent('Edit Chart');
  });

  it('renders the column variant picker as a Radix Select trigger and listbox', async () => {
    const user = userEvent.setup();
    renderEditor();

    const panel = screen.getByTestId('chart-editor-panel');
    const trigger = panel.querySelector('button[role="combobox"]');
    expect(trigger).toBeInstanceOf(HTMLButtonElement);
    expect(trigger).toHaveAttribute('data-state', 'closed');
    expect(trigger).toHaveTextContent('Default');

    await user.click(trigger as HTMLButtonElement);

    expect(trigger).toHaveAttribute('data-state', 'open');
    const listbox = await screen.findByRole('listbox');
    expect(listbox).toBeInTheDocument();
    expect(screen.getByRole('option', { name: 'Default' })).toBeInTheDocument();
    expect(screen.getByRole('option', { name: 'Clustered' })).toBeInTheDocument();
    expect(screen.getByRole('option', { name: 'Stacked' })).toBeInTheDocument();
  });
});
