/**
 * Switch Radix Wrapper
 *
 * Wraps @radix-ui/react-switch with our styling and API.
 * Uses semantic design tokens from tokens.css - never Tailwind defaults.
 *
 * Renders a Radix `<Switch.Root role="switch">` with a thumb child. Track
 * background uses --color-ss-primary on the ON state. Replaces the
 * hand-rolled shell/src/components/ui/ToggleSwitch.tsx — Radix handles
 * keyboard activation (Space/Enter) + accessibility for free.
 *
 */

import * as RadixSwitch from '@radix-ui/react-switch';

export interface SwitchProps {
  /** Current on/off state */
  checked?: boolean;
  /** Default checked state (uncontrolled) */
  defaultChecked?: boolean;
  /** Called when the switch is toggled */
  onChange?: (checked: boolean) => void;
  /** Accessible label */
  label?: string;
  /** Whether the switch is disabled */
  disabled?: boolean;
  /** Additional CSS classes for the root element */
  className?: string;
  /** Forwarded to the root element for test selectors */
  'data-testid'?: string;
  /** Forwarded id */
  id?: string;
  /** Optional aria-label */
  'aria-label'?: string;
}

const trackClasses = [
  'relative inline-flex h-5 w-9 flex-shrink-0',
  'cursor-pointer rounded-full border-2 border-transparent',
  // OFF state background
  'bg-ss-border',
  // ON state background — bg-ss-primary resolves to rgb(33,115,70)
  'data-[state=checked]:bg-ss-primary',
  // Disabled
  'data-[disabled]:opacity-40 data-[disabled]:cursor-not-allowed',
  // Focus ring — box-shadow so getComputedStyle detects it
  'focus:outline-none focus:ring-2 focus:ring-ss-primary focus:ring-offset-1',
].join(' ');

// Thumb moves left/right based on data-state
const thumbClasses = [
  'pointer-events-none inline-block h-4 w-4 rounded-full bg-white shadow-sm',
  // OFF position
  'translate-x-0.5',
  // ON position
  'data-[state=checked]:translate-x-4',
].join(' ');

export function Switch({
  checked,
  defaultChecked,
  onChange,
  label,
  disabled = false,
  className = '',
  'data-testid': dataTestId,
  id,
  'aria-label': ariaLabel,
}: SwitchProps) {
  const root = (
    <RadixSwitch.Root
      id={id}
      checked={checked}
      defaultChecked={defaultChecked}
      onCheckedChange={onChange}
      disabled={disabled}
      data-testid={dataTestId}
      aria-label={ariaLabel}
      className={[trackClasses, className].filter(Boolean).join(' ')}
    >
      <RadixSwitch.Thumb className={thumbClasses} />
    </RadixSwitch.Root>
  );

  if (!label) return root;

  return (
    <label className="inline-flex items-center gap-2 cursor-pointer select-none">
      {root}
      <span className="text-body text-ss-text">{label}</span>
    </label>
  );
}
