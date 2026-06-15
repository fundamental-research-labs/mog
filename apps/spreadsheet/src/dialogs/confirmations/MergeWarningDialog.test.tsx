import { jest } from '@jest/globals';

import React from 'react';
import { fireEvent, render, screen } from '@testing-library/react';
import '@testing-library/jest-dom';
import { clearPendingDialogActionForTest } from '../dialog-action-scheduler';

const dispatchMock = jest.fn(async () => ({ handled: true }));
const deps = {};

let mergeWarningDialog = {
  isOpen: true,
  pendingRange: { startRow: 0, startCol: 0, endRow: 0, endCol: 1 },
  sheetId: 'sheet-1',
  cellsWithData: [{ row: 0, col: 1 }],
  mergeType: 'mergeAndCenter',
};

jest.unstable_mockModule('@mog/shell', () => ({
  Button: ({
    children,
    disabled,
    onClick,
    'data-confirm-button': dataConfirmButton,
  }: {
    children: React.ReactNode;
    disabled?: boolean;
    onClick?: () => void;
    variant?: string;
    'data-confirm-button'?: string;
  }) => (
    <button
      type="button"
      disabled={disabled}
      onClick={onClick}
      data-confirm-button={dataConfirmButton}
    >
      {children}
    </button>
  ),
  Dialog: ({
    children,
    open,
    dialogId,
  }: {
    children: React.ReactNode;
    open?: boolean;
    onClose?: () => void;
    dialogId?: string;
    width?: string;
    onEnterKeyDown?: () => void;
  }) =>
    open === false ? null : (
      <div role="dialog" aria-modal="true" data-dialog-id={dialogId}>
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
}));

jest.unstable_mockModule('../../internal-api', () => ({
  dispatch: dispatchMock,
  useUIStore: (selector: (state: unknown) => unknown) =>
    selector({
      mergeWarningDialog,
    }),
}));

jest.unstable_mockModule('../../hooks/toolbar/use-action-dependencies', () => ({
  useActionDependencies: () => deps,
}));

const { MergeWarningDialog } = await import('./MergeWarningDialog');

describe('MergeWarningDialog', () => {
  beforeEach(() => {
    jest.useFakeTimers();
    dispatchMock.mockClear();
    clearPendingDialogActionForTest();
    mergeWarningDialog = {
      isOpen: true,
      pendingRange: { startRow: 0, startCol: 0, endRow: 0, endCol: 1 },
      sheetId: 'sheet-1',
      cellsWithData: [{ row: 0, col: 1 }],
      mergeType: 'mergeAndCenter',
    };
  });

  afterEach(() => {
    clearPendingDialogActionForTest();
    jest.clearAllTimers();
    jest.useRealTimers();
  });

  it('reenables confirmation when the mounted dialog closes and reopens', () => {
    const { rerender } = render(<MergeWarningDialog />);

    const ok = screen.getByRole('button', { name: /^OK$/ });
    expect(ok).not.toBeDisabled();
    fireEvent.click(ok);
    expect(ok).toBeDisabled();

    mergeWarningDialog = {
      ...mergeWarningDialog,
      isOpen: false,
    };
    rerender(<MergeWarningDialog />);
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();

    mergeWarningDialog = {
      isOpen: true,
      pendingRange: { startRow: 1, startCol: 0, endRow: 1, endCol: 2 },
      sheetId: 'sheet-1',
      cellsWithData: [{ row: 1, col: 1 }],
      mergeType: 'mergeAndCenter',
    };
    rerender(<MergeWarningDialog />);

    expect(screen.getByRole('button', { name: /^OK$/ })).not.toBeDisabled();
  });
});
