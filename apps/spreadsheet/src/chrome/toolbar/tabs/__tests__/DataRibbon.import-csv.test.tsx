import { jest } from '@jest/globals';

import '@testing-library/jest-dom';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import type { ReactNode } from 'react';

const mockSetCells = jest.fn();
const mockGetSheetById = jest.fn(() => ({ setCells: mockSetCells }));
const mockWorkbook = { getSheetById: mockGetSheetById };
const mockDispatch = jest.fn();
let mockHostCommands: {
  getOwner: jest.Mock;
  request: jest.Mock;
} | null = null;

const uiState = {
  validationCirclesVisible: false,
  ribbonDropdowns: {} as Record<string, boolean>,
  openRibbonDropdown: jest.fn((id: string) => {
    uiState.ribbonDropdowns[id] = true;
  }),
  closeRibbonDropdown: jest.fn((id: string) => {
    uiState.ribbonDropdowns[id] = false;
  }),
};

jest.unstable_mockModule('../../../../internal-api', () => ({
  useActiveCell: () => ({ row: 3, col: 2 }),
  useUIStore: <T,>(selector: (state: typeof uiState) => T) => selector(uiState),
}));

jest.unstable_mockModule('../../../../infra/context', () => ({
  useActiveSheetId: () => 'sheet-1',
  useSpreadsheetHostCommandsOptional: () => mockHostCommands,
  useWorkbook: () => mockWorkbook,
}));

jest.unstable_mockModule('../../../../hooks/data/use-filter-actions', () => ({
  useFilterActions: () => ({ canClearFilters: false, canReapplyFilters: false }),
}));

jest.unstable_mockModule('../../../../hooks/data/use-grouping-actions', () => ({
  useGroupingActions: () => ({
    canGroup: false,
    canUngroup: false,
    canShowDetail: false,
    canHideDetail: false,
  }),
}));

jest.unstable_mockModule('../../../../hooks/toolbar/use-action-dependencies', () => ({
  useDispatch: () => mockDispatch,
}));

jest.unstable_mockModule('../../keytips', () => ({
  keyTipRegistry: {
    register: jest.fn(),
    unregister: jest.fn(),
  },
}));

jest.unstable_mockModule('../../primitives/ToolbarGroup', () => ({
  ToolbarGroup: ({ children, label }: { children: ReactNode; label: string }) => (
    <section aria-label={label}>{children}</section>
  ),
}));

jest.unstable_mockModule('../../primitives/RibbonButton', () => ({
  RibbonButton: ({
    label,
    onClick,
    disabled,
  }: {
    label: string;
    onClick?: () => void;
    disabled?: boolean;
  }) => (
    <button type="button" disabled={disabled} onClick={onClick}>
      {label}
    </button>
  ),
}));

jest.unstable_mockModule('../../primitives/RibbonDropdown', () => ({
  RibbonDropdownPanel: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  RibbonDropdownItem: ({ children, onClick }: { children: ReactNode; onClick?: () => void }) => (
    <button type="button" role="menuitem" onClick={onClick}>
      {children}
    </button>
  ),
}));

jest.unstable_mockModule('../../primitives/ToolbarIcons', () => ({
  AdvancedFilterIcon: () => null,
  CircleInvalidDataIcon: () => null,
  ClearFilterIcon: () => null,
  ConsolidateIcon: () => null,
  DataValidationIcon: () => null,
  FilterIcon: () => null,
  FlashFillIcon: () => null,
  ForecastSheetIcon: () => null,
  GetDataIcon: () => null,
  GroupIcon: () => null,
  HideDetailIcon: () => null,
  ReapplyFilterIcon: () => null,
  RemoveDuplicatesIcon: () => null,
  SettingsIcon: () => null,
  ShowDetailIcon: () => null,
  SortAscIcon: () => null,
  SortDescIcon: () => null,
  SubtotalIcon: () => null,
  TextToColumnsIcon: () => null,
  UngroupIcon: () => null,
}));

jest.unstable_mockModule('@mog/shell', () => ({
  DropdownMenu: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  DropdownMenuContent: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  DropdownMenuItem: ({ children, onSelect }: { children: ReactNode; onSelect?: () => void }) => (
    <button type="button" onClick={onSelect}>
      {children}
    </button>
  ),
  DropdownMenuTrigger: ({ children }: { children: ReactNode }) => <>{children}</>,
}));

const { DataRibbon } = await import('../DataRibbon');

function installInputSpy() {
  const originalCreateElement = document.createElement.bind(document);
  const inputs: HTMLInputElement[] = [];

  jest.spyOn(document, 'createElement').mockImplementation(((
    tagName: string,
    options?: ElementCreationOptions,
  ) => {
    const element = originalCreateElement(tagName, options);
    if (tagName.toLowerCase() === 'input') {
      inputs.push(element as HTMLInputElement);
      jest.spyOn(element as HTMLInputElement, 'click').mockImplementation(() => undefined);
    }
    return element;
  }) as typeof document.createElement);

  return inputs;
}

function makeCsvFile(text: string): File {
  const file = new File([text], 'data.csv', { type: 'text/csv' });
  Object.defineProperty(file, 'text', { value: jest.fn(async () => text) });
  return file;
}

function selectCsvFile(input: HTMLInputElement, file: File) {
  Object.defineProperty(input, 'files', {
    value: [file],
    configurable: true,
  });
  fireEvent.change(input);
}

describe('DataRibbon CSV import', () => {
  beforeEach(() => {
    jest.restoreAllMocks();
    jest.clearAllMocks();
    mockHostCommands = null;
    uiState.validationCirclesVisible = false;
    uiState.ribbonDropdowns = {};
  });

  it('imports selected CSV values into the active worksheet by default', async () => {
    const inputs = installInputSpy();
    render(<DataRibbon />);

    fireEvent.click(screen.getByRole('menuitem', { name: 'From CSV' }));
    selectCsvFile(inputs[0], makeCsvFile('Name,Score\nAlice,10'));

    await waitFor(() =>
      expect(mockSetCells).toHaveBeenCalledWith([
        { row: 0, col: 0, value: 'Name' },
        { row: 0, col: 1, value: 'Score' },
        { row: 1, col: 0, value: 'Alice' },
        { row: 1, col: 1, value: '10' },
      ]),
    );
    expect(mockGetSheetById).toHaveBeenCalledWith('sheet-1');
  });

  it('uses the shared CSV parser coverage for BOMs, quoted commas, escaped quotes, and row breaks', async () => {
    const inputs = installInputSpy();
    render(<DataRibbon />);

    fireEvent.click(screen.getByRole('menuitem', { name: 'From CSV' }));
    selectCsvFile(
      inputs[0],
      makeCsvFile('\ufeffName,Note\r\nAlice,"hello, ""spreadsheet"""\r\nBob,"line 1\r\nline 2"'),
    );

    await waitFor(() =>
      expect(mockSetCells).toHaveBeenCalledWith([
        { row: 0, col: 0, value: 'Name' },
        { row: 0, col: 1, value: 'Note' },
        { row: 1, col: 0, value: 'Alice' },
        { row: 1, col: 1, value: 'hello, "spreadsheet"' },
        { row: 2, col: 0, value: 'Bob' },
        { row: 2, col: 1, value: 'line 1\nline 2' },
      ]),
    );
  });

  it('delegates host-owned CSV import without writing cells', () => {
    mockHostCommands = {
      getOwner: jest.fn(() => 'host'),
      request: jest.fn(),
    };
    const inputs = installInputSpy();
    render(<DataRibbon />);

    fireEvent.click(screen.getByRole('menuitem', { name: 'From CSV' }));

    expect(mockHostCommands.request).toHaveBeenCalledWith({
      command: 'import',
      format: 'csv',
      source: 'data-ribbon',
    });
    expect(inputs).toHaveLength(0);
    expect(mockSetCells).not.toHaveBeenCalled();
  });

  it('delegates caller-owned CSV import without writing cells', () => {
    const onImportCsv = jest.fn();
    const inputs = installInputSpy();
    const file = makeCsvFile('Name,Score\nAlice,10');
    render(<DataRibbon onImportCsv={onImportCsv} />);

    fireEvent.click(screen.getByRole('menuitem', { name: 'From CSV' }));
    selectCsvFile(inputs[0], file);

    expect(onImportCsv).toHaveBeenCalledWith(file);
    expect(mockSetCells).not.toHaveBeenCalled();
  });

  it('exposes Forecast Sheet as a visible enabled command that opens the forecast action', () => {
    render(<DataRibbon />);

    const forecastSheetButton = screen.getByRole('button', { name: 'Forecast Sheet' });

    expect(forecastSheetButton).toBeVisible();
    expect(forecastSheetButton).toBeEnabled();

    fireEvent.click(forecastSheetButton);

    expect(mockDispatch).toHaveBeenCalledWith('OPEN_FORECAST_SHEET_DIALOG');
  });
});
