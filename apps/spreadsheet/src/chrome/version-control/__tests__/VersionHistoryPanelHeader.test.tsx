import '@testing-library/jest-dom';

import { jest } from '@jest/globals';
import { render, screen } from '@testing-library/react';
import { createRef } from 'react';

import { VersionHistoryPanelHeader } from '../VersionHistoryPanelSections';

describe('VersionHistoryPanelHeader', () => {
  it('keeps panel chrome compact without a redundant Version History heading', () => {
    render(
      <VersionHistoryPanelHeader
        closeButtonRef={createRef<HTMLButtonElement>()}
        onClose={jest.fn()}
        onRefresh={jest.fn(async () => undefined)}
        refreshDisabled={false}
        refreshInProgress={false}
      />,
    );

    expect(screen.queryByRole('heading', { name: 'Version History' })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Refresh version history' })).toBeEnabled();
    expect(screen.getByRole('button', { name: 'Close version history' })).toBeEnabled();
  });
});
