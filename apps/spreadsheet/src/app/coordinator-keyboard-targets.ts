const KEYBOARD_CAPTURE_DEFER_SELECTOR = '[data-keyboard-capture="defer"]';

export function shouldDeferKeyboardCaptureToTarget(target: HTMLElement | null): boolean {
  if (!target) return false;
  return Boolean(target.closest(KEYBOARD_CAPTURE_DEFER_SELECTOR));
}
