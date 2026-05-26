/**
 * GradientPicker Component
 *
 * Excel-like gradient fill picker with:
 * - Preset gradient gallery organized by category
 * - Visual preview swatches
 * - Keyboard navigation
 * - Accessibility support
 *
 * Preset Gradients
 */

import { useCallback, useMemo, useState } from 'react';

import type { GradientFill } from '@mog-sdk/contracts/core';
import {
  GRADIENT_CATEGORY_LABELS,
  GRADIENT_CATEGORY_ORDER,
  PRESET_GRADIENTS,
  getPresetGradientsByCategory,
  gradientFillToCSS,
} from '../../infra/styles/preset-gradients';
import { SectionLabel } from '@mog/shell/components/ui';

// =============================================================================
// GradientSwatch Component
// =============================================================================

interface GradientSwatchProps {
  gradient: GradientFill;
  name: string;
  selected?: boolean;
  focused?: boolean;
  onClick: () => void;
  onMouseEnter?: () => void;
  tabIndex?: number;
}

function GradientSwatch({
  gradient,
  name,
  selected,
  focused,
  onClick,
  onMouseEnter,
  tabIndex = -1,
}: GradientSwatchProps) {
  const cssGradient = gradientFillToCSS(gradient);

  return (
    <button
      type="button"
      onClick={onClick}
      onMouseEnter={onMouseEnter}
      className={`
 w-8 h-8 rounded border cursor-pointer transition-shadow duration-ss-fast outline-none
 ${selected ? 'ring-2 ring-ss-primary border-ss-primary' : 'border-ss-border'}
 ${focused && !selected ? 'ring-2 ring-ss-primary/50' : ''}
 hover:ring-2 hover:ring-ss-primary/50
 `}
      style={{ background: cssGradient }}
      title={name}
      aria-label={`Select ${name} gradient`}
      aria-pressed={selected}
      tabIndex={tabIndex}
    />
  );
}

// =============================================================================
// Component
// =============================================================================

export interface GradientPickerProps {
  /** Currently selected gradient (compare by stops/type/degree) */
  value?: GradientFill;
  /** Called when a gradient is selected, or undefined to clear */
  onChange: (gradient: GradientFill | undefined) => void;
  /** Called when the picker should close */
  onClose?: () => void;
  /** Show "No Gradient" option (for removing gradient) */
  showNoGradient?: boolean;
  /** Label for no gradient option */
  noGradientLabel?: string;
}

/**
 * Check if two gradient fills are equal.
 */
function areGradientsEqual(a?: GradientFill, b?: GradientFill): boolean {
  if (!a || !b) return false;
  if (a.type !== b.type) return false;
  if (a.degree !== b.degree) return false;
  if (a.stops.length !== b.stops.length) return false;

  // Compare stops
  for (let i = 0; i < a.stops.length; i++) {
    const stopA = a.stops[i];
    const stopB = b.stops[i];
    if (
      stopA.position !== stopB.position ||
      stopA.color.toUpperCase() !== stopB.color.toUpperCase()
    ) {
      return false;
    }
  }

  // Compare center for path gradients
  if (a.type === 'path' && b.type === 'path') {
    const centerA = a.center ?? { left: 0.5, top: 0.5 };
    const centerB = b.center ?? { left: 0.5, top: 0.5 };
    if (centerA.left !== centerB.left || centerA.top !== centerB.top) {
      return false;
    }
  }

  return true;
}

export function GradientPicker({
  value,
  onChange,
  onClose,
  showNoGradient = true,
  noGradientLabel = 'No Gradient',
}: GradientPickerProps) {
  const [focusedIndex, setFocusedIndex] = useState<number | null>(null);

  // Build flat array for keyboard navigation
  const allGradients = useMemo(() => PRESET_GRADIENTS.map((g) => g.gradient), []);

  const handleGradientClick = useCallback(
    (gradient: GradientFill) => {
      onChange(gradient);
      onClose?.();
    },
    [onChange, onClose],
  );

  const handleNoGradient = useCallback(() => {
    // When no gradient is selected, we clear by setting undefined
    // The parent component should handle this appropriately
    onChange(undefined);
    onClose?.();
  }, [onChange, onClose]);

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      const cols = 6;
      const totalGradients = allGradients.length;

      if (focusedIndex === null) {
        if (e.key === 'ArrowDown' || e.key === 'ArrowRight') {
          setFocusedIndex(0);
          e.preventDefault();
        }
        return;
      }

      switch (e.key) {
        case 'ArrowRight':
          setFocusedIndex((focusedIndex + 1) % totalGradients);
          e.preventDefault();
          break;
        case 'ArrowLeft':
          setFocusedIndex((focusedIndex - 1 + totalGradients) % totalGradients);
          e.preventDefault();
          break;
        case 'ArrowDown':
          setFocusedIndex(Math.min(focusedIndex + cols, totalGradients - 1));
          e.preventDefault();
          break;
        case 'ArrowUp':
          setFocusedIndex(Math.max(focusedIndex - cols, 0));
          e.preventDefault();
          break;
        case 'Enter':
        case ' ':
          handleGradientClick(allGradients[focusedIndex]);
          e.preventDefault();
          break;
        case 'Escape':
          onClose?.();
          e.preventDefault();
          break;
      }
    },
    [focusedIndex, allGradients, handleGradientClick, onClose],
  );

  // NOTE: Click-outside handling is now managed by the parent Popover/RibbonDropdownPanel.
  // This component is a pure content component and doesn't need its own dismiss logic.

  let gradientIndex = 0;

  return (
    <div
      className="w-[240px] max-h-[400px] overflow-y-auto p-2 bg-ss-surface rounded-ss-md border border-ss-border shadow-ss-md"
      onKeyDown={handleKeyDown}
      role="dialog"
      aria-label="Gradient picker"
    >
      {/* No Gradient Option */}
      {showNoGradient && (
        <button
          type="button"
          onClick={handleNoGradient}
          className="flex items-center gap-2 w-full px-2 py-1.5 rounded bg-transparent cursor-pointer text-dropdown text-text mb-2 hover:bg-ss-surface-hover transition-colors duration-ss-fast"
        >
          {/* No gradient swatch with diagonal line */}
          <div className="w-6 h-6 border border-ss-border rounded bg-ss-surface relative overflow-hidden">
            <svg viewBox="0 0 24 24" className="absolute inset-0 w-full h-full" aria-hidden="true">
              <line x1="3" y1="21" x2="21" y2="3" stroke="var(--color-ss-error)" strokeWidth="2" />
            </svg>
          </div>
          <span>{noGradientLabel}</span>
        </button>
      )}

      {/* Gradient Categories */}
      {GRADIENT_CATEGORY_ORDER.map((category) => {
        const categoryGradients = getPresetGradientsByCategory(category);
        if (categoryGradients.length === 0) return null;

        return (
          <div key={category} className="mb-3">
            <SectionLabel>{GRADIENT_CATEGORY_LABELS[category]}</SectionLabel>
            <div className="grid grid-cols-6 gap-1">
              {categoryGradients.map((preset) => {
                const idx = gradientIndex++;
                return (
                  <GradientSwatch
                    key={preset.id}
                    gradient={preset.gradient}
                    name={preset.name}
                    selected={areGradientsEqual(value, preset.gradient)}
                    focused={focusedIndex === idx}
                    onClick={() => handleGradientClick(preset.gradient)}
                    onMouseEnter={() => setFocusedIndex(idx)}
                    tabIndex={focusedIndex === idx ? 0 : -1}
                  />
                );
              })}
            </div>
          </div>
        );
      })}
    </div>
  );
}
