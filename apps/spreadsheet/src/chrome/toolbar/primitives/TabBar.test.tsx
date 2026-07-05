import { jest } from '@jest/globals';
import { render, screen, within } from '@testing-library/react';

jest.unstable_mockModule('zustand', () => ({
  useStore: (store: { getState: () => unknown }, selector: (state: unknown) => unknown) =>
    selector(store.getState()),
}));

jest.unstable_mockModule('../../../internal-api', () => ({
  dispatch: jest.fn(),
  useDocumentContext: () => ({
    uiStore: {
      getState: () => ({ displayMode: 'full' }),
      subscribe: () => () => {},
    },
  }),
  useFeatureGate: (_scope: string, capability: string) =>
    ['fileMenu', 'save', 'undo', 'redo'].includes(capability),
}));

jest.unstable_mockModule('../../../hooks/toolbar/use-action-dependencies', () => ({
  useActionDependencies: () => ({}),
}));

jest.unstable_mockModule('../keytips', () => ({
  keyTipRegistry: {
    register: jest.fn(),
    unregister: jest.fn(),
  },
}));

jest.unstable_mockModule('./RibbonCollapseToggle', () => ({
  RibbonCollapseToggle: () => null,
}));

jest.unstable_mockModule('./RibbonDisplayOptions', () => ({
  RibbonDisplayOptions: () => null,
}));

jest.unstable_mockModule('./ToolbarIcons', () => ({
  ChevronDownIcon: () => null,
  DownloadIcon: () => null,
  PdfIcon: () => null,
  PrintIcon: () => null,
  RedoIcon: () => null,
  SaveIcon: () => null,
  SpinnerIcon: () => null,
  UndoIcon: () => null,
}));

jest.unstable_mockModule('../../collab/AvatarList', () => ({
  AvatarList: () => null,
}));

jest.unstable_mockModule('../../collab/CollaborateButton', () => ({
  CollaborateButton: () => null,
}));

jest.unstable_mockModule('../../collab/use-collab-store', () => ({
  useCollabStore: (selector: (state: unknown) => unknown) =>
    selector({
      enabled: false,
      participants: new Map(),
      config: null,
    }),
}));

const { TabBar } = await import('./TabBar');

describe('TabBar text wrapping', () => {
  it('keeps the File trigger and ribbon tab labels on one line as widths shrink', () => {
    render(
      <TabBar
        tabs={[
          { id: 'home', label: 'Home' },
          { id: 'page', label: 'Page Layout' },
        ]}
        activeTab="home"
        onTabChange={jest.fn()}
        onFileClick={jest.fn()}
      />,
    );

    expect(screen.getByTestId('file-menu-trigger')).toHaveClass(
      'flex-shrink-0',
      'whitespace-nowrap',
    );
    expect(screen.getByRole('tab', { name: 'Home' })).toHaveClass(
      'flex-shrink-0',
      'whitespace-nowrap',
    );
    expect(screen.getByRole('tab', { name: 'Page Layout' })).toHaveClass(
      'flex-shrink-0',
      'whitespace-nowrap',
    );
    expect(screen.getByRole('tablist', { name: 'Command bar tabs' })).toHaveClass(
      'flex-1',
      'min-w-0',
      'overflow-x-auto',
    );
    expect(screen.getByTestId('tabbar-command-cluster')).toHaveClass('hidden', 'flex-shrink-0');
    expect(screen.getByTestId('tabbar-command-cluster')).not.toHaveClass('min-[720px]:flex');
  });

  it('renders Save as a persistent quick-access command next to Undo', () => {
    render(
      <TabBar
        tabs={[
          { id: 'home', label: 'Home' },
          { id: 'page', label: 'Page Layout' },
        ]}
        activeTab="home"
        onTabChange={jest.fn()}
        onFileClick={jest.fn()}
        onSave={jest.fn()}
        onUndo={jest.fn()}
        onRedo={jest.fn()}
        canUndo
        canRedo
      />,
    );

    const quickAccess = screen.getByTestId('tabbar-quick-access');
    expect(within(quickAccess).getByRole('button', { name: 'Save' })).not.toHaveClass('hidden');
    expect(
      within(quickAccess)
        .getAllByRole('button')
        .map((button) => button.getAttribute('aria-label')),
    ).toEqual(['Save', 'Undo', 'Redo']);
    expect(
      within(screen.getByTestId('tabbar-command-cluster')).queryByRole('button', {
        name: 'Save',
      }),
    ).toBeNull();
  });
});
