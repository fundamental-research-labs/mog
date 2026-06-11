export function isNameBoxKeyboardTarget(target: HTMLElement | null): boolean {
  return Boolean(target?.closest('[data-testid="name-box"]'));
}
