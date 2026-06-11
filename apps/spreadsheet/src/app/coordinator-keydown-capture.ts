export function keyboardEventTargetElement(e: KeyboardEvent): HTMLElement | null {
  return e.target instanceof HTMLElement ? e.target : null;
}

export function isEditableKeyboardTarget(target: HTMLElement | null): boolean {
  if (!target) return false;
  return Boolean(
    target.closest('input, textarea, select, [contenteditable="true"], [role="textbox"]'),
  );
}

export function isDialogKeyboardTarget(target: HTMLElement | null): boolean {
  if (!target) return false;
  return Boolean(target.closest('[role="dialog"]'));
}

export function isNativeEditableShortcut(e: KeyboardEvent, target: HTMLElement | null): boolean {
  if (!isEditableKeyboardTarget(target)) return false;
  if (!(e.ctrlKey || e.metaKey) || e.altKey) return false;

  const key = e.key.toLowerCase();
  return key === 'c' || key === 'x' || key === 'v' || key === 'z' || key === 'y';
}

export function isSpreadsheetManagedEditableTarget(target: HTMLElement | null): boolean {
  if (!target) return false;
  if (!isEditableKeyboardTarget(target)) return false;
  return Boolean(
    target.closest('[data-spreadsheet-container]') ||
      target.closest('[data-testid="formula-bar-input"]'),
  );
}

export function shouldDeferToExternalEditableTarget(target: HTMLElement | null): boolean {
  return isEditableKeyboardTarget(target) && !isSpreadsheetManagedEditableTarget(target);
}
