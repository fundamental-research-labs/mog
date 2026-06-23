import '@testing-library/jest-dom';

import { jest } from '@jest/globals';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { ReactNode } from 'react';

type SidePanelContent = 'index' | 'formula-references' | 'version-history';

let versionControlEnabled = true;

const mockDispatch = jest.fn();
const mockKeyTipRegister = jest.fn();
const mockKeyTipUnregister = jest.fn();

const uiState = {
  showAllComments: false,
  activeSheetId: 'sheet-1',
  sidePanelContent: 'index' as SidePanelContent,
  setSidePanelVisible: jest.fn(),
  setSidePanelContent: jest.fn((content: SidePanelContent) => {
    uiState.sidePanelContent = content;
  }),
  setCommentsPanelVisible: jest.fn(),
  setFormulaBarVisible: jest.fn(),
};

const uiStoreApi = {
  getState: () => uiState,
};

jest.unstable_mockModule('../../../../internal-api', () => ({
  dispatch: mockDispatch,
  useActiveCell: () => ({ row: 0, col: 0 }),
  useActiveSheetId: () => 'sheet-1',
  useFeatureGate: (_category: string, key: string) =>
    key === 'versionControl' ? versionControlEnabled : true,
  useUIStore: <T,>(selector: (state: typeof uiState) => T) => selector(uiState),
  useWorkbook: () => ({
    diagnostics: {
      getFormulaReferences: jest.fn(),
    },
    getSheetById: jest.fn(),
  }),
}));

jest.unstable_mockModule('../../../../infra/context', () => ({
  useFeatureGate: (_category: string, key: string) =>
    key === 'versionControl' ? versionControlEnabled : true,
  useUIStore: <T,>(selector: (state: typeof uiState) => T) => selector(uiState),
  useUIStoreApi: () => uiStoreApi,
}));

jest.unstable_mockModule('../../../../actions', () => ({
  dispatch: mockDispatch,
}));

jest.unstable_mockModule('../../../../hooks/comments/use-comments', () => ({
  useComments: () => ({ hasComments: true }),
}));

jest.unstable_mockModule('../../../../hooks/selection/use-selection-actions', () => ({
  useSelectionActions: () => ({
    setSelection: jest.fn(),
  }),
}));

jest.unstable_mockModule('../../../../hooks/structure/use-sheet-protection', () => ({
  useSheetProtection: () => ({ protection: { isProtected: false } }),
}));

jest.unstable_mockModule('../../../../hooks/structure/use-workbook-protection', () => ({
  useWorkbookStructureProtection: () => false,
}));

jest.unstable_mockModule('../../../../hooks/toolbar/use-action-dependencies', () => ({
  useActionDependencies: () => ({}),
}));

jest.unstable_mockModule('../../keytips', () => ({
  keyTipRegistry: {
    register: mockKeyTipRegister,
    unregister: mockKeyTipUnregister,
  },
}));

jest.unstable_mockModule('../../primitives/ToolbarGroup', () => ({
  ToolbarGroup: ({ children, label }: { children: ReactNode; label: string }) => (
    <section aria-label={label}>{children}</section>
  ),
}));

jest.unstable_mockModule('../../primitives/RibbonButton', () => ({
  RibbonButton: ({
    id,
    label,
    onClick,
    disabled,
    title,
    'aria-label': ariaLabel,
    'data-testid': testId,
    'data-action': action,
  }: {
    id?: string;
    label: string;
    onClick?: () => void;
    disabled?: boolean;
    title?: string;
    'aria-label'?: string;
    'data-testid'?: string;
    'data-action'?: string;
  }) => (
    <button
      type="button"
      id={id}
      disabled={disabled}
      title={title}
      aria-label={ariaLabel}
      data-testid={testId}
      data-action={action}
      onClick={onClick}
    >
      {label}
    </button>
  ),
}));

jest.unstable_mockModule('../../primitives/ToolbarIcons', () => ({
  CommentIcon: () => null,
  ProtectSheetIcon: () => null,
  ProtectWorkbookIcon: () => null,
  SpellCheckIcon: () => null,
}));

jest.unstable_mockModule('../../../version-control/VersionHistoryPanel', () => ({
  VersionHistoryPanel: ({ onClose }: { onClose: () => void }) => (
    <aside data-testid="panel-version-history">
      <button type="button" onClick={onClose}>
        Close
      </button>
    </aside>
  ),
}));

const { ReviewRibbon } = await import('../ReviewRibbon');
const { SidePanel } = await import('../../../side-panel/SidePanel');

describe('Version History entry gate', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    versionControlEnabled = true;
    uiState.showAllComments = false;
    uiState.activeSheetId = 'sheet-1';
    uiState.sidePanelContent = 'index';
  });

  it('exposes the Review ribbon entrypoint when version control is enabled', async () => {
    const user = userEvent.setup();
    render(<ReviewRibbon />);

    const entrypoint = screen.getByTestId('review-version-history');

    expect(entrypoint).toBeEnabled();
    expect(entrypoint).toHaveAttribute('data-action', 'open-version-history');
    expect(mockKeyTipRegister).toHaveBeenCalledWith({
      key: 'V',
      tabId: 'review',
      elementId: 'review-version-history',
    });

    await user.click(entrypoint);
    expect(uiState.setSidePanelContent).toHaveBeenCalledWith('version-history');
    expect(uiState.setSidePanelVisible).toHaveBeenCalledWith(true);

    uiState.setSidePanelContent.mockClear();
    uiState.setSidePanelVisible.mockClear();
    entrypoint.focus();
    await user.keyboard('{Enter}');
    expect(uiState.setSidePanelContent).toHaveBeenCalledWith('version-history');
    expect(uiState.setSidePanelVisible).toHaveBeenCalledWith(true);
  });

  it('hides the Review ribbon entrypoint when version control is disabled', () => {
    versionControlEnabled = false;

    render(<ReviewRibbon />);

    expect(screen.queryByTestId('review-version-history')).not.toBeInTheDocument();
    expect(mockKeyTipRegister).not.toHaveBeenCalledWith({
      key: 'V',
      tabId: 'review',
      elementId: 'review-version-history',
    });
  });

  it('exposes the side-panel entrypoint when version control is enabled', async () => {
    const user = userEvent.setup();
    render(<SidePanel />);

    const entrypoint = screen.getByTestId('panel-side-version-history');

    expect(entrypoint).toBeEnabled();
    expect(entrypoint).toHaveAttribute('data-action', 'open-version-history');

    await user.click(entrypoint);
    expect(uiState.setSidePanelContent).toHaveBeenCalledWith('version-history');

    uiState.setSidePanelContent.mockClear();
    entrypoint.focus();
    await user.keyboard('{Enter}');
    expect(uiState.setSidePanelContent).toHaveBeenCalledWith('version-history');
  });

  it('blocks stale side-panel version history content when version control is disabled', async () => {
    versionControlEnabled = false;
    uiState.sidePanelContent = 'version-history';

    render(<SidePanel />);

    expect(screen.getByTestId('panel-side')).toBeInTheDocument();
    expect(screen.queryByTestId('panel-side-version-history')).not.toBeInTheDocument();
    expect(screen.queryByTestId('panel-version-history')).not.toBeInTheDocument();
    await waitFor(() => expect(uiState.setSidePanelContent).toHaveBeenCalledWith('index'));
  });
});
