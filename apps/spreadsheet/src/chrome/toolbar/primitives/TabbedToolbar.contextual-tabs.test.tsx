import React, { type ReactNode, useEffect } from 'react';
import { jest } from '@jest/globals';
import { act, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { RibbonTabId } from '@mog-sdk/contracts/actions';
import { create, type StoreApi } from 'zustand';

import {
  createActiveRibbonTabSlice,
  type ActiveRibbonTabSlice,
} from '../../../ui-store/slices/ribbon/active-tab';

type TestUIStoreState = ActiveRibbonTabSlice & {
  ribbonCollapsed: boolean;
  displayMode: 'full' | 'tabs-only' | 'auto-hide';
  temporaryShow: boolean;
};

type TestContextualTab = {
  id: RibbonTabId;
  label: string;
};

let currentStore: StoreApi<TestUIStoreState>;
let contextualTabs: TestContextualTab[] = [];

const dispatchMock = jest.fn();
const keyTipRegisterMock = jest.fn();
const keyTipUnregisterMock = jest.fn();

function createTestStore(): StoreApi<TestUIStoreState> {
  return create<TestUIStoreState>()((...args) => ({
    ...createActiveRibbonTabSlice(...args),
    ribbonCollapsed: false,
    displayMode: 'full',
    temporaryShow: false,
  }));
}

function setContextualTabs(tabs: TestContextualTab[]): void {
  contextualTabs = tabs;
}

function applyContextualTabs(tabs: TestContextualTab[]): void {
  setContextualTabs(tabs);
  act(() => {
    currentStore.getState().setContextualTabIds(tabs.map((tab) => tab.id));
  });
}

function Passthrough({ children }: { children?: ReactNode }) {
  return <>{children}</>;
}

function StubRibbon({ testId }: { testId: string }) {
  return <div data-testid={testId} />;
}

jest.unstable_mockModule('../../../internal-api', () => ({
  dispatch: dispatchMock,
  useDocumentContext: () => ({ uiStore: currentStore }),
  useFeatureGate: () => false,
}));

jest.unstable_mockModule('../../../hooks/toolbar/use-action-dependencies', () => ({
  useActionDependencies: () => ({}),
}));

jest.unstable_mockModule('../contextual', () => ({
  useContextualTabs: () => {
    useEffect(() => {
      currentStore.getState().setContextualTabIds(contextualTabs.map((tab) => tab.id));
    }, [contextualTabs]);
    return contextualTabs;
  },
}));

jest.unstable_mockModule('../collapse', () => ({
  RibbonCollapseProvider: Passthrough,
  useRibbonCollapse: () => ({ level: 'full' }),
}));

jest.unstable_mockModule('./AutoHideRibbonTrigger', () => ({
  AutoHideRibbonTrigger: () => null,
  useAutoHideRibbon: () => {},
}));

jest.unstable_mockModule('../keytips', () => ({
  KeyTipOverlay: () => null,
  KeyTipProvider: Passthrough,
  keyTipRegistry: {
    register: keyTipRegisterMock,
    unregister: keyTipUnregisterMock,
  },
}));

jest.unstable_mockModule('../visibility/RibbonVisibilityContext', () => ({
  RibbonVisibilityPathItem: Passthrough,
  RibbonVisibilityTab: Passthrough,
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

jest.unstable_mockModule('../tabs/HomeRibbon', () => ({
  HomeRibbon: () => <StubRibbon testId="home-ribbon" />,
}));

jest.unstable_mockModule('../tabs/InsertRibbon', () => ({
  InsertRibbon: () => <StubRibbon testId="insert-ribbon" />,
}));

jest.unstable_mockModule('../tabs/PageLayoutRibbon', () => ({
  PageLayoutRibbon: () => <StubRibbon testId="page-ribbon" />,
}));

jest.unstable_mockModule('../tabs/FormulasRibbon', () => ({
  FormulasRibbon: () => <StubRibbon testId="formulas-ribbon" />,
}));

jest.unstable_mockModule('../tabs/DataRibbon', () => ({
  DataRibbon: () => <StubRibbon testId="data-ribbon" />,
}));

jest.unstable_mockModule('../tabs/ReviewRibbon', () => ({
  ReviewRibbon: () => <StubRibbon testId="review-ribbon" />,
}));

jest.unstable_mockModule('../tabs/ViewRibbon', () => ({
  ViewRibbon: () => <StubRibbon testId="view-ribbon" />,
}));

jest.unstable_mockModule('../tabs/HelpRibbon', () => ({
  HelpRibbon: () => <StubRibbon testId="help-ribbon" />,
}));

jest.unstable_mockModule('../tabs/TableDesignRibbon', () => ({
  TableDesignRibbon: () => <StubRibbon testId="table-design-ribbon" />,
}));

jest.unstable_mockModule('../contextual/ChartFormatRibbon', () => ({
  ChartFormatRibbon: () => <StubRibbon testId="chart-format-ribbon" />,
}));

jest.unstable_mockModule('../contextual/ChartToolsRibbon', () => ({
  ChartToolsRibbon: () => <StubRibbon testId="chart-design-ribbon" />,
}));

jest.unstable_mockModule('../contextual/PictureToolsRibbon', () => ({
  PictureToolsRibbon: () => <StubRibbon testId="picture-tools-ribbon" />,
}));

jest.unstable_mockModule('../contextual/PivotToolsRibbon', () => ({
  PivotAnalyzeRibbon: () => <StubRibbon testId="pivot-analyze-ribbon" />,
  PivotDesignRibbon: () => <StubRibbon testId="pivot-design-ribbon" />,
}));

jest.unstable_mockModule('../contextual/SlicerToolsRibbon', () => ({
  SlicerToolsRibbon: () => <StubRibbon testId="slicer-tools-ribbon" />,
}));

jest.unstable_mockModule('../contextual/SparklineToolsRibbon', () => ({
  SparklineToolsRibbon: () => <StubRibbon testId="sparkline-tools-ribbon" />,
}));

jest.unstable_mockModule('../../../components/diagram/DiagramDesignTab', () => ({
  DiagramDesignTab: () => <StubRibbon testId="diagram-design-ribbon" />,
}));

jest.unstable_mockModule('../../../components/diagram/DiagramFormatTab', () => ({
  DiagramFormatTab: () => <StubRibbon testId="diagram-format-ribbon" />,
}));

const { TabbedToolbar } = await import('./TabbedToolbar');

function renderToolbar() {
  currentStore = createTestStore();
  applyContextualTabs([]);
  return render(<TabbedToolbar isInTable tableName="Table1" />);
}

async function expectSelectedTab(label: string) {
  await waitFor(() => {
    expect(screen.getByRole('tab', { name: label })).toHaveAttribute('aria-selected', 'true');
  });
}

describe('TabbedToolbar contextual tab semantics', () => {
  beforeEach(() => {
    currentStore = createTestStore();
    applyContextualTabs([]);
    dispatchMock.mockClear();
    keyTipRegisterMock.mockClear();
    keyTipUnregisterMock.mockClear();
  });

  it('auto-selects the first pivot contextual tab on initial contextual entry', async () => {
    const view = renderToolbar();
    await expectSelectedTab('Home');

    applyContextualTabs([
      { id: 'pivot-analyze', label: 'PivotTable Analyze' },
      { id: 'pivot-design', label: 'Design' },
    ]);
    view.rerender(<TabbedToolbar isInTable tableName="Table1" />);

    await expectSelectedTab('PivotTable Analyze');
    expect(currentStore.getState().activeRibbonTab).toBe('pivot-analyze');
    expect(currentStore.getState().activeRibbonTabSelectionSource).toBe('system');
  });

  it('keeps user-clicked Home selected while pivot contextual tabs remain visible', async () => {
    const user = userEvent.setup();
    const view = renderToolbar();

    applyContextualTabs([
      { id: 'pivot-analyze', label: 'PivotTable Analyze' },
      { id: 'pivot-design', label: 'Design' },
    ]);
    view.rerender(<TabbedToolbar isInTable tableName="Table1" />);
    await expectSelectedTab('PivotTable Analyze');

    await user.click(screen.getByRole('tab', { name: 'Home' }));
    await expectSelectedTab('Home');
    expect(currentStore.getState().activeRibbonTabSelectionSource).toBe('user');

    applyContextualTabs([
      { id: 'pivot-analyze', label: 'PivotTable Analyze' },
      { id: 'pivot-design', label: 'Design' },
    ]);
    view.rerender(<TabbedToolbar isInTable tableName="Table1" />);

    await expectSelectedTab('Home');
    expect(currentStore.getState().activeRibbonTab).toBe('home');
  });

  it('repairs active pivot contextual tab to Home when contextual tabs disappear', async () => {
    const view = renderToolbar();

    applyContextualTabs([
      { id: 'pivot-analyze', label: 'PivotTable Analyze' },
      { id: 'pivot-design', label: 'Design' },
    ]);
    view.rerender(<TabbedToolbar isInTable tableName="Table1" />);
    await expectSelectedTab('PivotTable Analyze');

    applyContextualTabs([]);
    view.rerender(<TabbedToolbar isInTable tableName="Table1" />);

    await expectSelectedTab('Home');
    await waitFor(() => {
      expect(screen.queryByRole('tab', { name: 'PivotTable Analyze' })).toBeNull();
    });
  });

  it('applies the same user-Home policy to a non-pivot table contextual tab', async () => {
    const user = userEvent.setup();
    const view = renderToolbar();

    applyContextualTabs([{ id: 'table-design', label: 'Table Design' }]);
    view.rerender(<TabbedToolbar isInTable tableName="Table1" />);
    await expectSelectedTab('Table Design');

    await user.click(screen.getByRole('tab', { name: 'Home' }));
    await expectSelectedTab('Home');

    applyContextualTabs([{ id: 'table-design', label: 'Table Design' }]);
    view.rerender(<TabbedToolbar isInTable tableName="Table1" />);

    await expectSelectedTab('Home');
    expect(currentStore.getState().activeRibbonTab).toBe('home');
  });
});
