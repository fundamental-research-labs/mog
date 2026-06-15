import { jest } from '@jest/globals';

import React, { act } from 'react';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import '@testing-library/jest-dom';
import {
  clearPendingDialogActionForTest,
  getPendingDialogActionForTest,
} from '../dialog-action-scheduler';

jest.unstable_mockModule('@mog/shell', () => ({
  Button: ({
    children,
    disabled,
    onClick,
  }: {
    children: React.ReactNode;
    disabled?: boolean;
    onClick?: () => void;
    variant?: string;
  }) => (
    <button type="button" disabled={disabled} onClick={onClick}>
      {children}
    </button>
  ),
  Checkbox: ({
    checked,
    label,
    onChange,
  }: {
    checked: boolean;
    label: React.ReactNode;
    onChange: (checked: boolean) => void;
  }) => (
    <label>
      <input
        type="checkbox"
        checked={checked}
        onChange={(event) => onChange(event.currentTarget.checked)}
      />
      {label}
    </label>
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
    size?: string;
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
  SectionLabel: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
}));

const closeRemoveDuplicatesDialog = jest.fn();

jest.unstable_mockModule('../../internal-api', () => ({
  useUIStore: (selector: (state: unknown) => unknown) =>
    selector({
      removeDuplicatesDialogOpen: true,
      closeRemoveDuplicatesDialog,
    }),
}));

const { RemoveDuplicatesDialog } = await import('./RemoveDuplicatesDialog');

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

describe('RemoveDuplicatesDialog', () => {
  beforeEach(() => {
    closeRemoveDuplicatesDialog.mockClear();
    clearPendingDialogActionForTest();
  });

  afterEach(() => {
    clearPendingDialogActionForTest();
  });

  it('tracks async remove work until the result and OK phase render', async () => {
    const remove = deferred<{
      duplicatesFound: number;
      duplicatesRemoved: number;
      uniqueValuesRemaining: number;
    }>();
    const onRemove = jest.fn(() => remove.promise);

    render(
      <RemoveDuplicatesDialog
        range={{ startRow: 20, startCol: 13, endRow: 25, endCol: 14 }}
        columnHeaders={[
          { col: 13, header: 'Key' },
          { col: 14, header: 'Amount' },
        ]}
        detectedHeaders={true}
        onRemove={onRemove}
      />,
    );

    const dialog = screen.getByRole('dialog');
    const removeButton = within(dialog).getByRole('button', { name: /^Remove Duplicates$/ });
    await waitFor(() => expect(removeButton).not.toBeDisabled());
    fireEvent.click(removeButton);

    const pendingAction = getPendingDialogActionForTest();
    expect(pendingAction).toBeInstanceOf(Promise);
    await waitFor(() => expect(onRemove).toHaveBeenCalledTimes(1));
    expect(within(dialog).queryByRole('button', { name: /^OK$/ })).not.toBeInTheDocument();

    await act(async () => {
      remove.resolve({
        duplicatesFound: 2,
        duplicatesRemoved: 2,
        uniqueValuesRemaining: 3,
      });
      await pendingAction;
    });

    expect(getPendingDialogActionForTest()).toBeUndefined();
    expect(
      within(dialog).getByText(/2 duplicates removed; 3 unique values remain/i),
    ).toBeInTheDocument();

    fireEvent.click(within(dialog).getByRole('button', { name: /^OK$/ }));

    expect(closeRemoveDuplicatesDialog).toHaveBeenCalledTimes(1);
  });
});
