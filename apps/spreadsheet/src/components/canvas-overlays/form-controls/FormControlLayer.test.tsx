import { jest } from '@jest/globals';
import '@testing-library/jest-dom';
import { fireEvent, render, screen } from '@testing-library/react';

import type { ScrollBarControl, SpinnerControl } from '@mog-sdk/contracts/form-controls';

import { FormControlLayer, type ResolvedFormControl } from './FormControlLayer';

function resolved(
  control: ScrollBarControl | SpinnerControl,
  cellValue: unknown,
): ResolvedFormControl {
  return {
    control,
    x: 10,
    y: 20,
    width: control.width,
    height: control.height,
    cellValue,
    linkedCellPosition: { row: 3, col: 7 },
  };
}

describe('FormControlLayer numeric controls', () => {
  it('renders scroll bars as DOM form-control overlays and writes numeric values', () => {
    const onCellValueChange = jest.fn();
    const control: ScrollBarControl = {
      id: 'scroll-1',
      type: 'scrollBar',
      sheetId: 'sheet-1' as never,
      anchor: { cellId: 'cell-a1' as never, xOffset: 0, yOffset: 0 },
      width: 120,
      height: 20,
      enabled: true,
      zIndex: 4,
      name: 'Scroll Bar 46',
      linkedCellId: 'cell-h4' as never,
      min: 1,
      max: 100,
      step: 1,
      page: 10,
      orientation: 'horizontal',
    };

    render(
      <FormControlLayer controls={[resolved(control, 1)]} onCellValueChange={onCellValueChange} />,
    );

    expect(document.querySelector('[data-form-control-id="scroll-1"]')).toHaveAttribute(
      'data-form-control-type',
      'scrollBar',
    );

    fireEvent.click(screen.getByRole('button', { name: 'Increase value' }));
    expect(onCellValueChange).toHaveBeenCalledWith('scroll-1', 2);

    fireEvent.change(screen.getByRole('slider', { name: 'Scroll Bar 46' }), {
      target: { value: '25' },
    });
    expect(onCellValueChange).toHaveBeenCalledWith('scroll-1', 25);
  });

  it('renders spinner controls and clamps decrements to the minimum', () => {
    const onCellValueChange = jest.fn();
    const control: SpinnerControl = {
      id: 'spin-1',
      type: 'spinner',
      sheetId: 'sheet-1' as never,
      anchor: { cellId: 'cell-b2' as never, xOffset: 0, yOffset: 0 },
      width: 18,
      height: 36,
      enabled: true,
      zIndex: 5,
      name: 'Spin Button 1',
      linkedCellId: 'cell-b2' as never,
      min: 0,
      max: 10,
      step: 1,
    };

    render(
      <FormControlLayer controls={[resolved(control, 0)]} onCellValueChange={onCellValueChange} />,
    );

    expect(document.querySelector('[data-form-control-id="spin-1"]')).toHaveAttribute(
      'data-form-control-type',
      'spinner',
    );

    fireEvent.click(screen.getByRole('button', { name: 'Decrease value' }));
    expect(onCellValueChange).toHaveBeenCalledWith('spin-1', 0);
  });
});
