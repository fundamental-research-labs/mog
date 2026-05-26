/**
 * Submit Button Component
 *
 * Form submission button with loading state.
 */

import * as React from 'react';

export interface SubmitButtonProps {
  /** Button text */
  text: string;
  /** Whether form is submitting */
  isSubmitting: boolean;
  /** Whether button is disabled */
  disabled?: boolean;
}

/**
 * Form submit button with loading indicator.
 */
export function SubmitButton({
  text,
  isSubmitting,
  disabled,
}: SubmitButtonProps): React.ReactElement {
  const baseClasses =
    'inline-flex items-center justify-center gap-2 px-6 py-2.5 text-body font-medium text-ss-text-inverse border-0 rounded-ss-sm cursor-pointer transition-colors';
  const stateClasses =
    disabled || isSubmitting
      ? 'bg-ss-text-disabled cursor-not-allowed'
      : isSubmitting
        ? 'bg-ss-primary-light'
        : 'bg-ss-primary hover:bg-ss-primary-hover';

  return (
    <button
      type="submit"
      className={`${baseClasses} ${stateClasses}`}
      disabled={disabled || isSubmitting}
    >
      {isSubmitting ? (
        <>
          <span className="w-4 h-4 border-2 border-ss-text-inverse border-t-transparent rounded-full animate-spin" />
          <span>Submitting...</span>
        </>
      ) : (
        text
      )}
    </button>
  );
}
