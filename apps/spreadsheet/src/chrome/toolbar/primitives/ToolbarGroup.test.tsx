import '@testing-library/jest-dom';
import { render, screen } from '@testing-library/react';

import { ToolbarGroup } from './ToolbarGroup';

function getGroupContent(label: string): HTMLElement {
  const group = screen.getByRole('group', { name: label });
  const content = group.querySelector('[data-ribbon-group-content]');
  if (!(content instanceof HTMLElement)) {
    throw new Error(`Missing ribbon group content for ${label}`);
  }
  return content;
}

describe('ToolbarGroup dialog launcher layout', () => {
  it('reserves a command-safe gutter for normal-mode dialog launchers', () => {
    render(
      <ToolbarGroup
        label="Number"
        dialogLauncher={{
          ariaLabel: 'Number Format Settings',
          onClick: () => {},
        }}
      >
        <button type="button">Decrease Decimal</button>
      </ToolbarGroup>,
    );

    expect(getGroupContent('Number')).toHaveClass('pr-5');
  });

  it('does not add launcher gutter spacing to groups without launchers', () => {
    render(
      <ToolbarGroup label="Clipboard">
        <button type="button">Paste</button>
      </ToolbarGroup>,
    );

    expect(getGroupContent('Clipboard')).not.toHaveClass('pr-5');
  });
});
