export function isNameBoxKeyboardTarget(target: HTMLElement | null): boolean {
  return Boolean(target?.closest('[data-testid="name-box"]'));
}

export function shouldYieldEditingNavigationKeyToTarget(
  e: Pick<KeyboardEvent, 'key'>,
  target: HTMLElement | null,
): boolean {
  return isNameBoxKeyboardTarget(target) && (e.key === 'Enter' || e.key === 'Escape');
}
