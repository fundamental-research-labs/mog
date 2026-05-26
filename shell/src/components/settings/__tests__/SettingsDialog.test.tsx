import '@testing-library/jest-dom';

import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

import { SettingsDialog } from '../SettingsDialog';

describe('SettingsDialog appearance settings', () => {
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
});
