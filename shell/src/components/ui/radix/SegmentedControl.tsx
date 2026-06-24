/**
 * SegmentedControl — horizontal pill-group for single selection.
 *
 * Built on @radix-ui/react-radio-group (single-choice radio semantics)
 * styled as a horizontal segmented control. Replaces the hand-rolled
 * shell/src/components/ui/SegmentControl.tsx — Radix handles arrow-key
 * navigation, roving tabindex, and accessibility for free.
 *
 * The active pill is rendered with --color-ss-primary as its background;
 * inactive pills stay neutral. Styling matches the existing visual
 * contract used by AlignmentGroup and the form-control-styling corpus.
 *
 */

import * as RadixRadioGroup from '@radix-ui/react-radio-group';
import type { ReactNode } from 'react';
import { Tooltip } from './Tooltip';

export interface SegmentedControlOption {
  /** Value that uniquely identifies this segment */
  value: string;
  /** Display label */
  label: ReactNode;
  /** Optional accessible label when label is not plain text */
  ariaLabel?: string;
  /**
   * DOM `id` forwarded to the rendered radio item. Required when external
   * systems locate the segment via `document.getElementById(...)` — e.g.
   * the ribbon keytip overlay positioning.
   */
  id?: string;
  /** Tooltip title shown on hover/focus */
  tooltip?: string;
  /** Optional shortcut shown muted alongside the tooltip title */
  tooltipShortcut?: string;
  /** Whether this option is disabled */
  disabled?: boolean;
}

export interface SegmentedControlProps {
  /** Segment options */
  options: SegmentedControlOption[];
  /** Currently selected value */
  value: string;
  /** Called when a segment is selected */
  onChange?: (value: string) => void;
  /** Used to build data-testid="segment-control-{id}" */
  id: string;
  /** Additional CSS classes for the root */
  className?: string;
  /** Accessible label for the group */
  ariaLabel?: string;
  /** Disable all options */
  disabled?: boolean;
}

const groupClasses = [
  'inline-flex items-center',
  'rounded-ss-sm border border-transparent',
  'bg-transparent overflow-hidden',
].join(' ');

const itemClasses = [
  'relative inline-flex items-center justify-center',
  'px-2 h-6 text-ribbon font-medium',
  'cursor-pointer select-none',
  'transition-colors duration-100',
  // Inactive state
  'bg-transparent text-ss-text-secondary',
  'hover:bg-ss-surface-hover hover:text-ss-text',
  // Active state — Radix sets data-state="checked" on the active item
  'data-[state=checked]:bg-ss-primary',
  'data-[state=checked]:text-white',
  // Disabled
  'data-[disabled]:opacity-40 data-[disabled]:cursor-not-allowed',
  // Focus
  'focus:outline-none focus-visible:ring-2 focus-visible:ring-ss-primary focus-visible:z-10',
].join(' ');

export function SegmentedControl({
  options,
  value,
  onChange,
  id,
  className = '',
  ariaLabel,
  disabled,
}: SegmentedControlProps) {
  return (
    <RadixRadioGroup.Root
      value={value}
      onValueChange={onChange}
      orientation="horizontal"
      disabled={disabled}
      aria-label={ariaLabel}
      data-testid={`segment-control-${id}`}
      className={[groupClasses, className].filter(Boolean).join(' ')}
    >
      {options.map((opt) => {
        // Place the Tooltip *inside* the Item, around the label, so that
        // RadixTooltip.Trigger's asChild does NOT merge its
        // `data-state="open|closed"` onto the Item (which would clobber
        // RadixRadioGroup's own `data-state="checked|unchecked"` and break
        // the `data-[state=checked]:*` styling). Wrapping a benign inner
        // span isolates the tooltip's state on a node we don't style off.
        const content = opt.tooltip ? (
          <Tooltip title={opt.tooltip} shortcut={opt.tooltipShortcut}>
            <span className="inline-flex items-center justify-center">{opt.label}</span>
          </Tooltip>
        ) : (
          opt.label
        );
        return (
          <RadixRadioGroup.Item
            key={opt.value}
            id={opt.id}
            value={opt.value}
            disabled={opt.disabled}
            aria-label={opt.ariaLabel}
            className={itemClasses}
          >
            {content}
          </RadixRadioGroup.Item>
        );
      })}
    </RadixRadioGroup.Root>
  );
}
