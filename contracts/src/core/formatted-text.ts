import type { FormattedText } from './core';

/** Create a FormattedText from a raw string (use only at producer boundaries). */
export function asFormattedText(s: string): FormattedText {
  return s as unknown as FormattedText;
}

/** Unwrap FormattedText to a plain string (use only for rendering/display). */
export function displayString(text: FormattedText): string {
  return text as unknown as string;
}

/** Unwrap FormattedText | null to string | null. */
export function displayStringOrNull(text: FormattedText | null): string | null {
  return text as unknown as string | null;
}
