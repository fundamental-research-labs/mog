/**
 * NumericOverlayControl
 *
 * Interactive numeric form controls rendered as HTML overlays.
 */

import { memo, useCallback, type SyntheticEvent } from 'react';

import type {
  ScrollBarControl,
  SliderControl,
  SpinnerControl,
} from '@mog-sdk/contracts/form-controls';

type NumericControl = ScrollBarControl | SliderControl | SpinnerControl;

export interface NumericOverlayControlProps {
  control: NumericControl;
  cellValue: unknown;
  width: number;
  height: number;
  onCellValueChange: (controlId: string, value: unknown) => void;
}

function finiteNumber(value: unknown): number | undefined {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'string' && value.trim() !== '') {
    const parsed = Number(value);
    if (Number.isFinite(parsed)) return parsed;
  }
  return undefined;
}

function numericBounds(control: NumericControl): {
  min: number;
  max: number;
  step: number;
  page: number;
} {
  const min = finiteNumber(control.min) ?? 0;
  const max = Math.max(min, finiteNumber(control.max) ?? 100);
  const step = Math.max(1, finiteNumber(control.step) ?? 1);
  const page =
    control.type === 'scrollBar' && finiteNumber(control.page) != null
      ? Math.max(step, finiteNumber(control.page) ?? step)
      : step;
  return { min, max, step, page };
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

function currentNumber(cellValue: unknown, min: number, max: number): number {
  return clamp(finiteNumber(cellValue) ?? min, min, max);
}

const chromeStyle = {
  border: '1px solid #ababab',
  backgroundColor: '#f3f3f3',
  boxSizing: 'border-box' as const,
  fontFamily: 'Calibri, Arial, sans-serif',
};

const buttonStyle = {
  ...chromeStyle,
  width: 16,
  minWidth: 16,
  height: '100%',
  padding: 0,
  color: '#333',
  fontSize: 10,
  lineHeight: 1,
  cursor: 'pointer',
};

export const NumericOverlayControl = memo(function NumericOverlayControl({
  control,
  cellValue,
  width,
  height,
  onCellValueChange,
}: NumericOverlayControlProps) {
  const { min, max, step, page } = numericBounds(control);
  const value = currentNumber(cellValue, min, max);
  const isEnabled = control.enabled && max > min;
  const orientation =
    control.type === 'spinner' ? 'vertical' : (control.orientation ?? 'horizontal');
  const isVertical = orientation === 'vertical';

  const writeValue = useCallback(
    (nextValue: number) => {
      if (!isEnabled) return;
      onCellValueChange(control.id, clamp(nextValue, min, max));
    },
    [control.id, isEnabled, max, min, onCellValueChange],
  );

  const stopGridEventPropagation = useCallback((event: SyntheticEvent) => {
    event.stopPropagation();
  }, []);

  if (control.type === 'spinner') {
    return (
      <div
        style={{
          ...chromeStyle,
          width,
          height,
          display: 'flex',
          flexDirection: 'column',
          pointerEvents: 'auto',
          overflow: 'hidden',
        }}
        data-no-grid-pointer="true"
        data-testid={`form-control-spinner-${control.id}`}
        aria-label={control.name ?? 'Spinner'}
      >
        <button
          type="button"
          disabled={!isEnabled}
          onClick={() => writeValue(value + step)}
          onPointerDown={stopGridEventPropagation}
          onMouseDown={stopGridEventPropagation}
          style={{
            ...buttonStyle,
            width: '100%',
            minWidth: 0,
            flex: 1,
            borderWidth: '0 0 1px 0',
            cursor: isEnabled ? 'pointer' : 'default',
          }}
          aria-label="Increase value"
        >
          +
        </button>
        <button
          type="button"
          disabled={!isEnabled}
          onClick={() => writeValue(value - step)}
          onPointerDown={stopGridEventPropagation}
          onMouseDown={stopGridEventPropagation}
          style={{
            ...buttonStyle,
            width: '100%',
            minWidth: 0,
            flex: 1,
            borderWidth: 0,
            cursor: isEnabled ? 'pointer' : 'default',
          }}
          aria-label="Decrease value"
        >
          -
        </button>
      </div>
    );
  }

  if (control.type === 'slider') {
    return (
      <div
        style={{
          width,
          height,
          display: 'flex',
          alignItems: 'center',
          gap: 4,
          pointerEvents: 'auto',
          overflow: 'hidden',
        }}
        data-no-grid-pointer="true"
        data-testid={`form-control-slider-${control.id}`}
      >
        <input
          type="range"
          min={min}
          max={max}
          step={step}
          value={value}
          disabled={!isEnabled}
          onChange={(event) => writeValue(Number(event.currentTarget.value))}
          onPointerDown={stopGridEventPropagation}
          onMouseDown={stopGridEventPropagation}
          style={{
            flex: 1,
            minWidth: 0,
            accentColor: '#217346',
          }}
          aria-label={control.name ?? 'Slider'}
        />
        {control.showValue && (
          <span
            style={{
              minWidth: 24,
              fontSize: 11,
              color: '#333',
              textAlign: 'right',
              fontFamily: 'Calibri, Arial, sans-serif',
            }}
          >
            {value}
          </span>
        )}
      </div>
    );
  }

  return (
    <div
      style={{
        ...chromeStyle,
        width,
        height,
        display: 'flex',
        flexDirection: isVertical ? 'column' : 'row',
        pointerEvents: 'auto',
        overflow: 'hidden',
      }}
      data-no-grid-pointer="true"
      data-testid={`form-control-scrollbar-${control.id}`}
      aria-label={control.name ?? 'Scroll bar'}
    >
      <button
        type="button"
        disabled={!isEnabled}
        onClick={() => writeValue(value - step)}
        onDoubleClick={() => writeValue(value - page)}
        onPointerDown={stopGridEventPropagation}
        onMouseDown={stopGridEventPropagation}
        style={{
          ...buttonStyle,
          ...(isVertical
            ? { width: '100%', minWidth: 0, height: 14, borderWidth: '0 0 1px 0' }
            : { borderWidth: '0 1px 0 0' }),
          cursor: isEnabled ? 'pointer' : 'default',
        }}
        aria-label="Decrease value"
      >
        {isVertical ? '^' : '<'}
      </button>
      <input
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        disabled={!isEnabled}
        onChange={(event) => writeValue(Number(event.currentTarget.value))}
        onPointerDown={stopGridEventPropagation}
        onMouseDown={stopGridEventPropagation}
        style={{
          flex: 1,
          minWidth: 0,
          minHeight: 0,
          margin: 0,
          padding: 0,
          accentColor: '#bfbfbf',
          ...(isVertical ? { writingMode: 'vertical-rl' as const } : {}),
        }}
        aria-label={control.name ?? 'Scroll bar'}
      />
      <button
        type="button"
        disabled={!isEnabled}
        onClick={() => writeValue(value + step)}
        onDoubleClick={() => writeValue(value + page)}
        onPointerDown={stopGridEventPropagation}
        onMouseDown={stopGridEventPropagation}
        style={{
          ...buttonStyle,
          ...(isVertical
            ? { width: '100%', minWidth: 0, height: 14, borderWidth: '1px 0 0 0' }
            : { borderWidth: '0 0 0 1px' }),
          cursor: isEnabled ? 'pointer' : 'default',
        }}
        aria-label="Increase value"
      >
        {isVertical ? 'v' : '>'}
      </button>
    </div>
  );
});
