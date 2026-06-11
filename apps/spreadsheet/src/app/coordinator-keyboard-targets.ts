export function isNameBoxKeyboardTarget(target: HTMLElement | null): boolean {
  if (!target) return false;
  const nameBox = target.closest('[data-testid="name-box"]');
  return nameBox instanceof HTMLInputElement || nameBox instanceof HTMLTextAreaElement;
}
