import { jest } from '@jest/globals';

import '@testing-library/jest-dom';
import { fireEvent, render, screen } from '@testing-library/react';
import type { InputHTMLAttributes, ReactNode } from 'react';

const mockDispatch = jest.fn();
const uiState = {
  ribbonDropdowns: {} as Record<string, boolean>,
  openRibbonDropdown: jest.fn((id: string) => {
    uiState.ribbonDropdowns[id] = true;
  }),
  closeRibbonDropdown: jest.fn((id: string) => {
    uiState.ribbonDropdowns[id] = false;
  }),
};

jest.unstable_mockModule('@mog/grid-renderer', () => ({
  DARK_STYLES: {},
  LIGHT_STYLES: {},
  MEDIUM_STYLES: { medium2: {} },
  getTableStyleColors: () => ({
    headerBackground: '#111111',
    rowBackground1: '#ffffff',
    rowBackground2: '#eeeeee',
  }),
}));

jest.unstable_mockModule('@mog/shell', () => ({
  Checkbox: ({
    checked,
    onChange,
    label,
  }: {
    checked: boolean;
    onChange: () => void;
    label?: string;
  }) => <input aria-label={label} type="checkbox" checked={checked} onChange={onChange} />,
  Input: (props: InputHTMLAttributes<HTMLInputElement>) => <input {...props} />,
}));

jest.unstable_mockModule('../../../../internal-api', () => ({
  useUIStore: <T,>(selector: (state: typeof uiState) => T) => selector(uiState),
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
    title,
    'aria-label': ariaLabel,
  }: {
    label?: string;
    onClick?: () => void;
    disabled?: boolean;
    title?: string;
    'aria-label'?: string;
  }) => (
    <button
      type="button"
      aria-label={ariaLabel ?? label ?? title}
      disabled={disabled}
      onClick={onClick}
    >
      {label ?? title}
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
  ConvertToRangeIcon: () => null,
  DeleteTableIcon: () => null,
  DropdownArrowIcon: () => null,
  PivotTableIcon: () => null,
  RemoveDuplicatesIcon: () => null,
  SlicerIcon: () => null,
  TableIcon: () => null,
}));

const { TableDesignRibbon } = await import('../TableDesignRibbon');

function renderRibbon(onRenameTable = jest.fn()) {
  render(
    <TableDesignRibbon
      tableName="Table1"
      stylePreset="medium2"
      showBandedRows={true}
      showBandedColumns={false}
      showFirstColumnHighlight={false}
      showLastColumnHighlight={false}
      hasHeaderRow={true}
      hasTotalRow={false}
      showFilterButtons={true}
      onRenameTable={onRenameTable}
      onSetStylePreset={jest.fn()}
      onToggleBandedRows={jest.fn()}
      onToggleBandedColumns={jest.fn()}
      onToggleFirstColumnHighlight={jest.fn()}
      onToggleLastColumnHighlight={jest.fn()}
      onToggleHeaderRow={jest.fn()}
      onToggleTotalRow={jest.fn()}
      onToggleFilterButtons={jest.fn()}
      onDeleteTable={jest.fn()}
      onConvertToRange={jest.fn()}
    />,
  );
}

describe('TableDesignRibbon', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    uiState.ribbonDropdowns = {};
  });

  it.each(['Bad Name', '', '   ', '1Table', 'Bad-Name', 'A1', 'XFD1048576'])(
    'resets invalid table name %p on blur without renaming',
    (invalidName) => {
      const onRenameTable = jest.fn();
      renderRibbon(onRenameTable);

      const input = screen.getByLabelText('Table Name') as HTMLInputElement;
      fireEvent.change(input, { target: { value: invalidName } });
      fireEvent.blur(input);

      expect(onRenameTable).not.toHaveBeenCalled();
      expect(input).toHaveValue('Table1');
    },
  );

  it('commits a valid changed table name on blur', () => {
    const onRenameTable = jest.fn();
    renderRibbon(onRenameTable);

    const input = screen.getByLabelText('Table Name');
    fireEvent.change(input, { target: { value: 'Sales_Table2' } });
    fireEvent.blur(input);

    expect(onRenameTable).toHaveBeenCalledWith('Sales_Table2');
  });
});
