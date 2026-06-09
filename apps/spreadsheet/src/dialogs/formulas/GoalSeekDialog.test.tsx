import { jest } from '@jest/globals';

import React from 'react';
import { render, screen } from '@testing-library/react';
import '@testing-library/jest-dom';

const closeGoalSeekDialog = jest.fn();
const setGoalSeekSetCell = jest.fn();
const setGoalSeekToValue = jest.fn();
const setGoalSeekByChangingCell = jest.fn();
const resetGoalSeekState = jest.fn();
const dispatch = jest.fn();

const rangeInputProps: Array<{
  dialogId: string;
  inputId: string;
  rangePickerMode?: string;
  label?: string;
  value: string;
  onChange: (value: string) => void;
}> = [];

const minimizableDialogProps: Array<{
  dialogId: string;
  title: string;
  open?: boolean;
}> = [];

const uiState = {
  goalSeekDialog: {
    isOpen: true,
    setCell: '',
    toValue: '',
    byChangingCell: '',
    status: 'idle',
    result: null,
  },
  closeGoalSeekDialog,
  setGoalSeekSetCell,
  setGoalSeekToValue,
  setGoalSeekByChangingCell,
  resetGoalSeekState,
};

jest.unstable_mockModule('../../internal-api', () => ({
  CollapsibleRangeInput: (props: (typeof rangeInputProps)[number]) => {
    rangeInputProps.push(props);
    return (
      <input
        aria-label={props.label}
        value={props.value}
        onChange={(event) => props.onChange(event.currentTarget.value)}
      />
    );
  },
  MinimizableDialog: ({
    children,
    ...props
  }: {
    children: React.ReactNode;
    dialogId: string;
    title: string;
    open?: boolean;
  }) => {
    minimizableDialogProps.push(props);
    return props.open === false ? null : (
      <div role="dialog" data-dialog-id={props.dialogId} data-title={props.title}>
        {children}
      </div>
    );
  },
  useDispatch: () => dispatch,
  useUIStore: (selector: (state: typeof uiState) => unknown) => selector(uiState),
}));

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
  Input: (props: React.ComponentProps<'input'>) => <input {...props} />,
}));

const { GoalSeekDialog } = await import('./GoalSeekDialog');

describe('GoalSeekDialog', () => {
  beforeEach(() => {
    rangeInputProps.length = 0;
    minimizableDialogProps.length = 0;
    closeGoalSeekDialog.mockClear();
    setGoalSeekSetCell.mockClear();
    setGoalSeekToValue.mockClear();
    setGoalSeekByChangingCell.mockClear();
    resetGoalSeekState.mockClear();
    dispatch.mockClear();
  });

  test('uses the minimizable range-picker dialog path for single-cell inputs', () => {
    render(<GoalSeekDialog />);

    expect(screen.getByRole('dialog')).toHaveAttribute('data-dialog-id', 'goal-seek-dialog');
    expect(minimizableDialogProps).toHaveLength(1);
    expect(minimizableDialogProps[0]).toMatchObject({
      dialogId: 'goal-seek-dialog',
      title: 'Goal Seek',
      open: true,
    });
    expect(
      rangeInputProps.map(({ inputId, rangePickerMode }) => ({ inputId, rangePickerMode })),
    ).toEqual([
      { inputId: 'goal-seek-set-cell', rangePickerMode: 'single-cell' },
      { inputId: 'goal-seek-by-changing', rangePickerMode: 'single-cell' },
    ]);
  });
});
