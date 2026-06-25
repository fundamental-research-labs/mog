import { fireEvent, render, screen } from '@testing-library/react';

import { ShellHost, type FileExplorerConfig } from '../ShellHost';

jest.mock('../AppSlot', () => ({
  AppSlot: () => <div data-testid="app-slot" />,
}));

jest.mock('../../apps/AppLogoSwitcher', () => ({
  AppLogoSwitcher: () => <div data-testid="app-logo-switcher" />,
}));

jest.mock('../../components/files', () => ({
  FileExplorer: () => <div data-testid="file-explorer" />,
}));

jest.mock('../../context', () => ({
  useShellStore: (selector: (state: { activeAppId: string | null }) => unknown) =>
    selector({ activeAppId: null }),
}));

const kernel = {} as Parameters<typeof ShellHost>[0]['kernel'];

const fileExplorer: FileExplorerConfig = {
  projectName: null,
  projectPath: null,
  fileTree: [],
  activeFilePath: null,
  onFileClick: jest.fn(),
  onToggleFolder: jest.fn(),
  onRefresh: jest.fn(),
};

describe('ShellHost', () => {
  it('reserves layout space for the sidebar collapse control before the app slot', () => {
    render(
      <ShellHost kernel={kernel} header={null} fileExplorer={fileExplorer}>
        <div data-testid="toolbar" />
      </ShellHost>,
    );

    const collapseButton = screen.getByRole('button', { name: 'Collapse sidebar' });
    const rail = screen.getByTestId('shell-sidebar-collapse-rail');
    const appSlot = screen.getByTestId('app-slot');
    const main = appSlot.closest('main');

    expect(rail).toContainElement(collapseButton);
    expect(rail).toHaveClass('w-5');
    expect(collapseButton).not.toHaveClass('absolute');
    expect(rail.compareDocumentPosition(main as Node) & Node.DOCUMENT_POSITION_FOLLOWING).not.toBe(
      0,
    );

    fireEvent.click(collapseButton);

    expect(screen.getByRole('button', { name: 'Expand sidebar' })).toBeInTheDocument();
    expect(rail).toHaveClass('w-5');
  });
});
