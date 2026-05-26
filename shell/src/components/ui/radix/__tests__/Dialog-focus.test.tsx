import '@testing-library/jest-dom';

import { useState } from 'react';

import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

import { Dialog, DialogBody, DialogFooter, DialogHeader } from '../Dialog';

function TriggerlessDialogHarness() {
  const [open, setOpen] = useState(false);

  return (
    <>
      <div
        tabIndex={0}
        data-testid="spreadsheet"
        onKeyDown={(event) => {
          if (event.key === 'f' && event.ctrlKey) {
            event.preventDefault();
            setOpen(true);
          }
        }}
      >
        Spreadsheet
      </div>
      <Dialog open={open} onOpenChange={setOpen} dialogId="find-replace">
        <DialogHeader onClose={() => setOpen(false)}>Find</DialogHeader>
        <DialogBody>
          <input aria-label="Find what" />
        </DialogBody>
      </Dialog>
    </>
  );
}

function ConfirmFocusDialogHarness() {
  const [open, setOpen] = useState(false);
  const [confirmCount, setConfirmCount] = useState(0);
  const [closeCount, setCloseCount] = useState(0);

  const handleClose = () => {
    setCloseCount((count) => count + 1);
    setOpen(false);
  };

  return (
    <>
      <button type="button" onClick={() => setOpen(true)}>
        Open
      </button>
      <div data-testid="confirm-count">{confirmCount}</div>
      <div data-testid="close-count">{closeCount}</div>
      <Dialog open={open} onOpenChange={setOpen} dialogId="confirm-default">
        <DialogHeader onClose={handleClose}>Confirm changes</DialogHeader>
        <DialogBody>
          <p>Apply this change?</p>
        </DialogBody>
        <DialogFooter>
          <button type="button" onClick={handleClose}>
            Cancel
          </button>
          <button
            type="button"
            data-confirm-button="true"
            onClick={() => setConfirmCount((count) => count + 1)}
          >
            Apply
          </button>
        </DialogFooter>
      </Dialog>
    </>
  );
}

describe('Dialog focus management', () => {
  it('marks modal content with aria-modal', () => {
    render(<TriggerlessDialogHarness />);

    const spreadsheet = screen.getByTestId('spreadsheet');
    spreadsheet.focus();
    fireEvent.keyDown(spreadsheet, { key: 'f', ctrlKey: true });

    expect(screen.getByRole('dialog')).toHaveAttribute('aria-modal', 'true');
  });

  it('overlay and content opt into pointer events for shell portal hit testing', () => {
    render(<TriggerlessDialogHarness />);

    const spreadsheet = screen.getByTestId('spreadsheet');
    spreadsheet.focus();
    fireEvent.keyDown(spreadsheet, { key: 'f', ctrlKey: true });

    expect(screen.getByTestId('dialog-overlay')).toHaveClass('pointer-events-auto');
    expect(screen.getByRole('dialog')).toHaveClass('pointer-events-auto');
  });

  it('restores focus to the previously focused element when opened without a trigger', async () => {
    render(<TriggerlessDialogHarness />);

    const spreadsheet = screen.getByTestId('spreadsheet');
    spreadsheet.focus();
    expect(spreadsheet).toHaveFocus();

    fireEvent.keyDown(spreadsheet, { key: 'f', ctrlKey: true });
    const dialog = screen.getByRole('dialog');
    expect(dialog).toBeInTheDocument();

    fireEvent.keyDown(document.activeElement ?? dialog, { key: 'Escape' });

    await waitFor(() => {
      expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    });
    await waitFor(() => {
      expect(spreadsheet).toHaveFocus();
    });
  });

  it('focuses the default confirm button so Enter confirms instead of closing header chrome', async () => {
    const user = userEvent.setup();
    render(<ConfirmFocusDialogHarness />);

    await user.click(screen.getByRole('button', { name: 'Open' }));

    const confirmButton = screen.getByRole('button', { name: 'Apply' });
    await waitFor(() => {
      expect(confirmButton).toHaveFocus();
    });

    await user.keyboard('{Enter}');

    expect(screen.getByTestId('confirm-count')).toHaveTextContent('1');
    expect(screen.getByTestId('close-count')).toHaveTextContent('0');
    expect(screen.getByRole('dialog')).toBeInTheDocument();
  });
});
