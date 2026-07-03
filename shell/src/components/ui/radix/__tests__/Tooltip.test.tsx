import '@testing-library/jest-dom';

import { fireEvent, render, screen, waitFor } from '@testing-library/react';

import { Tooltip, TooltipProvider } from '../Tooltip';

function tooltipContent(): HTMLElement {
  const element = document.querySelector('[data-radix-popper-content-wrapper] [data-side]');
  if (!(element instanceof HTMLElement)) {
    throw new Error('Tooltip content was not mounted');
  }
  return element;
}

describe('Tooltip pointer events', () => {
  it('keeps descriptive tooltips pointer-transparent', async () => {
    render(
      <TooltipProvider delayDuration={0}>
        <Tooltip
          title="Insert"
          description="Insert cells, rows, columns, or sheets"
          delayDuration={0}
        >
          <button type="button">Insert</button>
        </Tooltip>
      </TooltipProvider>,
    );

    fireEvent.focus(screen.getByRole('button', { name: 'Insert' }));

    await waitFor(() => expect(tooltipContent()).toHaveClass('pointer-events-none'));
  });

  it('allows pointer events when the tooltip contains an interactive link', async () => {
    render(
      <TooltipProvider delayDuration={0}>
        <Tooltip title="Help" learnMoreUrl="https://example.com" delayDuration={0}>
          <button type="button">Help</button>
        </Tooltip>
      </TooltipProvider>,
    );

    fireEvent.focus(screen.getByRole('button', { name: 'Help' }));

    await waitFor(() => expect(tooltipContent()).toHaveClass('pointer-events-auto'));
  });
});
