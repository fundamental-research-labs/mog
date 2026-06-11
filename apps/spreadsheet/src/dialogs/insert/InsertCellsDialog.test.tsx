import { jest } from '@jest/globals';

import React from 'react';
import { fireEvent, render, screen, within } from '@testing-library/react';
import '@testing-library/jest-dom';
import {
  DIALOG_ACTION_APPLY_DELAY_MS,
  getPendingDialogActionForTest,
} from './dialog-action-scheduler';

const dispatchMock = jest.fn();
const closeInsertCellsDialog = jest.fn();
const deps = { workbook: {} };

jest.unstable_mockModule('@mog/shell', () => ({
  Button: ({
    children,
    onClick,
  }: {
    children: React.ReactNode;
    onClick?: () => void;
    variant?: string;
    ref?: React.Ref<HTMLButtonElement>;
  }) => (
    <button type="button" onClick={onClick}>
      {children}
    </button>
  ),
  Dialog: ({
    children,
    open,
  }: {
    children: React.ReactNode;
    open?: boolean;
    onClose?: () => void;
    dialogId?: string;
    width?: number;
    initialFocusRef?: React.RefObject<HTMLButtonElement>;
    onEnterKeyDown?: () => void;
  }) =>
    open === false ? null : (
      <div role="dialog" aria-modal="true">
        {children}
      </div>
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
  RadioGroup: ({
    name,
    value,
    onChange,
    options,
  }: {
    name: string;
    value: string;
    onChange: (value: string) => void;
    options: Array<{ value: string; label: string }>;
    orientation?: string;
    'aria-label'?: string;
  }) => (
    <div role="radiogroup">
      {options.map((option) => (
        <label key={option.value}>
          <input
            type="radio"
            name={name}
            checked={value === option.value}
            onChange={() => onChange(option.value)}
          />
          {option.label}
        </label>
      ))}
    </div>
  ),
}));

jest.unstable_mockModule('../../internal-api', () => ({
  dispatch: dispatchMock,
  useUIStore: (selector: (state: unknown) => unknown) =>
    selector({
      insertCellsDialog: {
        isOpen: true,
        mode: 'delete',
        direction: 'up',
        range: { startRow: 17, startCol: 27, endRow: 17, endCol: 27 },
      },
      closeInsertCellsDialog,
    }),
}));

jest.unstable_mockModule('../../hooks/toolbar/use-action-dependencies', () => ({
  useActionDependencies: () => deps,
}));

const { InsertCellsDialog } = await import('./InsertCellsDialog');

describe('InsertCellsDialog', () => {
  beforeEach(() => {
    jest.useFakeTimers();
    dispatchMock.mockClear();
    closeInsertCellsDialog.mockClear();
  });

  afterEach(() => {
    jest.runOnlyPendingTimers();
    jest.useRealTimers();
  });

  it('closes before dispatching the OK action after the dialog close delay', async () => {
    render(<InsertCellsDialog />);

    const dialog = screen.getByRole('dialog');
    fireEvent.click(within(dialog).getByLabelText(/Entire row/i));
    fireEvent.click(within(dialog).getByRole('button', { name: /^OK$/ }));

    expect(closeInsertCellsDialog).toHaveBeenCalledTimes(1);
    expect(dispatchMock).not.toHaveBeenCalled();
    const pendingAction = getPendingDialogActionForTest();
    expect(pendingAction).toBeInstanceOf(Promise);

    jest.advanceTimersByTime(DIALOG_ACTION_APPLY_DELAY_MS - 1);
    expect(dispatchMock).not.toHaveBeenCalled();

    jest.advanceTimersByTime(1);
    await pendingAction;

    expect(dispatchMock).toHaveBeenCalledTimes(1);
    expect(dispatchMock).toHaveBeenCalledWith('DELETE_ROWS', deps);
    expect(getPendingDialogActionForTest()).toBeUndefined();
  });
});
