import '@testing-library/jest-dom';

import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

import { SettingsDialog } from '../SettingsDialog';

describe('SettingsDialog', () => {
  it('defaults the appearance mode picker to Light when no mode is provided', async () => {
    const user = userEvent.setup();

    render(<SettingsDialog open onClose={jest.fn()} />);

    await user.click(screen.getByRole('tab', { name: 'Appearance' }));

    const lightOption = screen.getByRole('radio', { name: 'Light' });
    const darkOption = screen.getByRole('radio', { name: 'Dark' });
    const systemOption = screen.getByRole('radio', { name: 'System' });

    expect(lightOption).toBeChecked();
    expect(darkOption).not.toBeChecked();
    expect(systemOption).not.toBeChecked();
  });

  it('uses a provided appearance mode as the controlled selection', async () => {
    const user = userEvent.setup();

    render(<SettingsDialog open onClose={jest.fn()} appearanceMode="system" />);

    await user.click(screen.getByRole('tab', { name: 'Appearance' }));

    const themeGroup = screen.getByText('Theme').closest('section');
    expect(themeGroup).not.toBeNull();
    expect(within(themeGroup!).getByRole('radio', { name: 'System' })).toBeChecked();
  });

  it('renders About links as external anchors with stable public targets', async () => {
    const user = userEvent.setup();

    render(<SettingsDialog open onClose={jest.fn()} />);

    await user.click(screen.getByRole('tab', { name: 'About' }));

    expect(screen.getByRole('link', { name: 'Documentation' })).toHaveAttribute(
      'href',
      'https://github.com/fundamental-research-labs/mog/tree/main/docs',
    );
    expect(screen.getByRole('link', { name: 'GitHub Repository' })).toHaveAttribute(
      'href',
      'https://github.com/fundamental-research-labs/mog',
    );
    expect(screen.getByRole('link', { name: 'Report an Issue' })).toHaveAttribute(
      'href',
      'https://github.com/fundamental-research-labs/mog/issues/new',
    );

    for (const link of screen.getAllByRole('link')) {
      expect(link).toHaveAttribute('target', '_blank');
      expect(link).toHaveAttribute('rel', 'noopener noreferrer');
    }
  });
});
