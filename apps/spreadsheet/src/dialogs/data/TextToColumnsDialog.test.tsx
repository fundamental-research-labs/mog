import { jest } from '@jest/globals';

import React from 'react';
import { fireEvent, render, screen, within } from '@testing-library/react';
import '@testing-library/jest-dom';

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
    label: string;
    onChange: (checked: boolean) => void;
    className?: string;
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
  DialogFooter: ({ children }: { children: React.ReactNode; layout?: string }) => (
    <footer>{children}</footer>
  ),
  DialogHeader: ({
    children,
    onClose,
  }: {
    children: React.ReactNode;
    onClose?: () => void;
    className?: string;
  }) => (
    <header>
      {children}
      <button type="button" aria-label="Close" onClick={onClose}>
        Close
      </button>
    </header>
  ),
  Input: (props: React.ComponentProps<'input'>) => <input {...props} />,
  RadioGroup: ({
    name,
    value,
    onChange,
    options,
  }: {
    name: string;
    value: string;
    onChange: (value: string) => void;
    options: Array<{ value: string; label: string; description?: string }>;
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
  SectionLabel: ({
    children,
  }: {
    children: React.ReactNode;
    size?: string;
    className?: string;
  }) => <div>{children}</div>,
  Select: ({
    value,
    onChange,
    options,
  }: {
    value: string;
    onChange: (value: string) => void;
    options: Array<{ value: string; label: string }>;
    size?: string;
  }) => (
    <select value={value} onChange={(event) => onChange(event.currentTarget.value)}>
      {options.map((option) => (
        <option key={option.value} value={option.value}>
          {option.label}
        </option>
      ))}
    </select>
  ),
}));

const closeTextToColumnsDialog = jest.fn();

jest.unstable_mockModule('../../internal-api', () => ({
  useUIStore: (selector: (state: unknown) => unknown) =>
    selector({
      textToColumnsDialogOpen: true,
      closeTextToColumnsDialog,
    }),
}));

const { TextToColumnsDialog } = await import('./TextToColumnsDialog');

describe('TextToColumnsDialog', () => {
  beforeEach(() => {
    closeTextToColumnsDialog.mockClear();
  });

  test('shows raw selected source text on step 1 and split preview on step 2', () => {
    render(
      <TextToColumnsDialog
        range={{ startRow: 0, startCol: 0, endRow: 0, endCol: 0 }}
        onSourcePreview={() => [['Alpha,Beta,Gamma']]}
        onPreview={() => [['Alpha', 'Beta', 'Gamma']]}
        onConvert={() => ({ rowsProcessed: 0, columnsCreated: 0 })}
      />,
    );

    const dialog = screen.getByRole('dialog');
    expect(within(dialog).getByText('Preview of selected data:')).toBeInTheDocument();
    expect(within(dialog).getByText('Alpha,Beta,Gamma')).toBeInTheDocument();
    expect(within(dialog).queryByText('AlphaBetaGamma')).not.toBeInTheDocument();

    fireEvent.click(within(dialog).getByRole('button', { name: /Next/ }));

    expect(within(dialog).getByText('Data preview:')).toBeInTheDocument();
    expect(within(dialog).getByText('Alpha')).toBeInTheDocument();
    expect(within(dialog).getByText('Beta')).toBeInTheDocument();
    expect(within(dialog).getByText('Gamma')).toBeInTheDocument();
  });
});
