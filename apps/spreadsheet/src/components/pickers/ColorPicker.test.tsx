import { render, screen } from '@testing-library/react';

import type { ThemeDefinition } from '@mog-sdk/contracts/theme';
import { ColorPicker } from './ColorPicker';

function getActiveSwatches(): HTMLElement[] {
  return screen
    .getAllByTestId('color-swatch')
    .filter((swatch) => swatch.getAttribute('aria-pressed') === 'true');
}

describe('ColorPicker active swatch state', () => {
  it('shows one active swatch when the selected standard color also appears in recents', () => {
    render(
      <ColorPicker
        value="#FF0000"
        onChange={() => undefined}
        recentColors={['#FF0000', '#00FF00']}
      />,
    );

    const redSwatches = screen
      .getAllByTestId('color-swatch')
      .filter((swatch) => swatch.getAttribute('data-color')?.toUpperCase() === '#FF0000');

    expect(redSwatches).toHaveLength(2);
    expect(getActiveSwatches()).toHaveLength(1);
    expect(redSwatches[0]).toHaveAttribute('aria-pressed', 'true');
    expect(redSwatches[1]).toHaveAttribute('aria-pressed', 'false');
  });

  it('shows one active swatch when the selected color appears multiple times in the palette', () => {
    const duplicateTheme: ThemeDefinition = {
      name: 'Duplicate light theme',
      colors: {
        dark1: '#000000',
        light1: '#FFFFFF',
        dark2: '#000000',
        light2: '#FFFFFF',
        accent1: '#4472C4',
        accent2: '#ED7D31',
        accent3: '#A5A5A5',
        accent4: '#FFC000',
        accent5: '#5B9BD5',
        accent6: '#70AD47',
        hyperlink: '#0563C1',
        followedHyperlink: '#954F72',
      },
      fonts: {
        majorFont: 'Aptos Display',
        minorFont: 'Aptos',
      },
    };

    render(<ColorPicker value="#FFFFFF" onChange={() => undefined} theme={duplicateTheme} />);

    const whiteSwatches = screen
      .getAllByTestId('color-swatch')
      .filter((swatch) => swatch.getAttribute('data-color')?.toUpperCase() === '#FFFFFF');

    expect(whiteSwatches.length).toBeGreaterThan(1);
    expect(getActiveSwatches()).toHaveLength(1);
    expect(whiteSwatches[0]).toHaveAttribute('aria-pressed', 'true');
  });
});
