import { jest } from '@jest/globals';

import React from 'react';
import { fireEvent, render, screen, within } from '@testing-library/react';
import '@testing-library/jest-dom';
import {
  clearPendingDialogActionForTest,
  getPendingDialogActionForTest,
} from './dialog-action-scheduler';

const closeInsertTableDialog = jest.fn();
const tablesAdd = jest.fn(async () => undefined);
const undoGroup = jest.fn(async (fn: () => Promise<unknown>) => fn());
const workbook = {
  getSheetById: jest.fn(() => ({
    tables: {
      add: tablesAdd,
    },
  })),
  undoGroup,
};

jest.unstable_mockModule('@mog/grid-renderer', () => ({
  getTableStyleColors: () => ({
    headerBackground: '#4472c4',
    headerText: '#ffffff',
    rowBackground1: '#ffffff',
    rowBackground2: '#d9e2f3',
    dataText: '#000000',
  }),
}));

jest.unstable_mockModule('@mog/shell', () => ({
  Button: ({
    children,
    onClick,
    disabled,
    'data-testid': testId,
  }: {
    children: React.ReactNode;
    onClick?: () => void;
    disabled?: boolean;
    variant?: string;
    'data-testid'?: string;
  }) => (
    <button type="button" onClick={onClick} disabled={disabled} data-testid={testId}>
      {children}
    </button>
  ),
  Checkbox: ({
    checked,
    onChange,
    label,
    'data-testid': testId,
  }: {
    checked: boolean;
    onChange: (checked: boolean) => void;
    label: string;
    'data-testid'?: string;
  }) => (
    <label>
      <input
        type="checkbox"
        checked={checked}
        onChange={(event) => onChange(event.currentTarget.checked)}
        data-testid={testId}
      />
      {label}
    </label>
  ),
  DialogBody: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  DialogFooter: ({ children }: { children: React.ReactNode }) => <footer>{children}</footer>,
  DialogHeader: ({ children, onClose }: { children: React.ReactNode; onClose?: () => void }) => (
    <header>
      {children}
      <button type="button" aria-label="Close" onClick={onClose}>
        Close
      </button>
    </header>
  ),
  FormField: ({
    children,
    label,
    htmlFor,
  }: {
    children: React.ReactNode;
    label: string;
    htmlFor?: string;
    error?: string;
  }) => (
    <label htmlFor={htmlFor}>
      {label}
      {children}
    </label>
  ),
  Label: ({ children }: { children: React.ReactNode; className?: string }) => <div>{children}</div>,
}));

jest.unstable_mockModule('../../internal-api', () => ({
  CollapsibleRangeInput: ({
    value,
    onChange,
    inputId,
    label,
  }: {
    value: string;
    onChange: (value: string) => void;
    inputId?: string;
    label?: string;
  }) => (
    <input
      id={inputId}
      aria-label={label}
      value={value}
      onChange={(event) => onChange(event.currentTarget.value)}
    />
  ),
  MinimizableDialog: ({
    children,
    open,
  }: {
    children: React.ReactNode;
    open?: boolean;
    onClose?: () => void;
    dialogId?: string;
    title?: string;
    width?: string;
    onEnterKeyDown?: () => void;
  }) =>
    open === false ? null : (
      <div role="dialog" aria-modal="true">
        {children}
      </div>
    ),
  useActiveSheetId: () => 'sheet-1',
  useUIStore: (selector: (state: unknown) => unknown) =>
    selector({
      insertTableDialogOpen: true,
      closeInsertTableDialog,
      setTablePreviewRange: jest.fn(),
      insertTableInitialRange: { startRow: 457, startCol: 0, endRow: 479, endCol: 10 },
      insertTableInitialHasHeaders: false,
      insertTableInitialStylePreset: 'medium2',
    }),
  useWorkbook: () => workbook,
}));

const { InsertTableDialog } = await import('./InsertTableDialog');

describe('InsertTableDialog', () => {
  beforeEach(() => {
    jest.useFakeTimers();
    closeInsertTableDialog.mockClear();
    workbook.getSheetById.mockClear();
    undoGroup.mockClear();
    tablesAdd.mockClear();
    clearPendingDialogActionForTest();
  });

  afterEach(() => {
    jest.runOnlyPendingTimers();
    jest.useRealTimers();
  });

  it('closes before creating the table on the next macrotask', async () => {
    render(<InsertTableDialog />);

    const dialog = screen.getByRole('dialog');
    expect(within(dialog).getByLabelText(/Table range/i)).toHaveValue('A458:K480');

    fireEvent.click(within(dialog).getByRole('button', { name: /^OK$/ }));

    expect(closeInsertTableDialog).toHaveBeenCalledTimes(1);
    expect(undoGroup).not.toHaveBeenCalled();
    expect(tablesAdd).not.toHaveBeenCalled();
    const pendingAction = getPendingDialogActionForTest();
    expect(pendingAction).toBeInstanceOf(Promise);

    jest.advanceTimersByTime(0);
    await pendingAction;

    expect(workbook.getSheetById).toHaveBeenCalledWith('sheet-1');
    expect(undoGroup).toHaveBeenCalledTimes(1);
    expect(tablesAdd).toHaveBeenCalledWith('A458:K480', {
      hasHeaders: false,
      style: 'medium2',
    });
    expect(getPendingDialogActionForTest()).toBeUndefined();
  });
});
