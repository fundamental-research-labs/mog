/**
 * Helpers for document-level keydown capture.
 */

export function isNameBoxKeyboardTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  return Boolean(target.closest('[data-testid="name-box"]'));
}
