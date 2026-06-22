import { jest } from '@jest/globals';
import { fireEvent, render, screen } from '@testing-library/react';
import React from 'react';

import type { SheetTabInfo } from '../../../internal-api';

jest.unstable_mockModule('@mog/icons', () => ({
  CheckmarkSvg: (props: React.SVGProps<SVGSVGElement>) => (
    <svg data-testid="selection-checkmark" {...props} />
  ),
}));

jest.unstable_mockModule('@mog/shell', () => ({
  Button: ({
    children,
    variant: _variant,
    ...props
  }: React.ButtonHTMLAttributes<HTMLButtonElement> & { variant?: string }) => (
    <button type="button" {...props}>
      {children}
    </button>
  ),
  Dialog: ({ children, open }: { children: React.ReactNode; open: boolean }) =>
    open ? <div role="dialog">{children}</div> : null,
  DialogBody: ({ children, ...props }: React.HTMLAttributes<HTMLDivElement>) => (
    <div {...props}>{children}</div>
  ),
  DialogFooter: ({ children, ...props }: React.HTMLAttributes<HTMLDivElement>) => (
    <div {...props}>{children}</div>
  ),
  DialogHeader: ({ children, ...props }: React.HTMLAttributes<HTMLDivElement>) => (
    <div {...props}>{children}</div>
  ),
  Input: (props: React.InputHTMLAttributes<HTMLInputElement>) => <input {...props} />,
}));

const { MoveOrCopySheetDialog } = await import('../MoveOrCopySheetDialog');
const { UnhideSheetDialog } = await import('../UnhideSheetDialog');

function sheets(): SheetTabInfo[] {
  return [
    { id: 'sheet1', name: 'Sheet1' },
    { id: 'sheet2', name: 'Sheet2' },
    { id: 'sheet3', name: 'Sheet3' },
  ] as unknown as SheetTabInfo[];
}

function hiddenSheets(): SheetTabInfo[] {
  return [
    { id: 'hidden1', name: 'Hidden1', hidden: true },
    { id: 'hidden2', name: 'Hidden2', hidden: true },
  ] as unknown as SheetTabInfo[];
}

describe('MoveOrCopySheetDialog selection', () => {
  it('keeps the clicked destination selected across equal sheet-list rerenders', () => {
    const onMove = jest.fn();
    const props = {
      isOpen: true,
      sourceSheetId: 'sheet1',
      sourceSheetName: 'Sheet1',
      sheets: sheets(),
      onClose: jest.fn(),
      onMove,
      onCopy: jest.fn(),
    };
    const { rerender } = render(<MoveOrCopySheetDialog {...props} />);

    fireEvent.click(screen.getByRole('option', { name: /Sheet2/ }));
    rerender(<MoveOrCopySheetDialog {...props} sheets={sheets()} />);

    expect(screen.getByRole('option', { name: /Sheet2/ })).toHaveAttribute('aria-selected', 'true');
    expect(screen.getByRole('option', { name: /move to end/i })).toHaveAttribute(
      'aria-selected',
      'false',
    );

    fireEvent.click(screen.getByRole('button', { name: 'OK' }));
    expect(onMove).toHaveBeenCalledWith('sheet1', 'sheet2');
  });

  it('does not clobber an edited copy name across equal sheet-list rerenders', () => {
    const props = {
      isOpen: true,
      sourceSheetId: 'sheet1',
      sourceSheetName: 'Sheet1',
      sheets: sheets(),
      onClose: jest.fn(),
      onMove: jest.fn(),
      onCopy: jest.fn(),
    };
    const { rerender } = render(<MoveOrCopySheetDialog {...props} />);

    fireEvent.click(screen.getByTestId('create-copy-checkbox'));
    const input = screen.getByTestId('new-sheet-name-input');
    fireEvent.change(input, { target: { value: 'Custom Copy' } });

    rerender(<MoveOrCopySheetDialog {...props} sheets={sheets()} />);

    expect(screen.getByTestId('new-sheet-name-input')).toHaveValue('Custom Copy');
  });
});

describe('UnhideSheetDialog selection', () => {
  it('keeps the clicked hidden sheet selected across equal hidden-list rerenders', () => {
    const onUnhide = jest.fn();
    const props = {
      isOpen: true,
      hiddenSheets: hiddenSheets(),
      onUnhide,
      onClose: jest.fn(),
    };
    const { rerender } = render(<UnhideSheetDialog {...props} />);

    fireEvent.click(screen.getByRole('option', { name: /Hidden2/ }));
    rerender(<UnhideSheetDialog {...props} hiddenSheets={hiddenSheets()} />);

    expect(screen.getByRole('option', { name: /Hidden2/ })).toHaveAttribute(
      'aria-selected',
      'true',
    );
    fireEvent.click(screen.getByRole('button', { name: 'OK' }));
    expect(onUnhide).toHaveBeenCalledWith('hidden2');
  });
});
