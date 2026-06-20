export function isNoGridPointerEvent(
  event: MouseEvent | PointerEvent,
  options: { includePointHitTest?: boolean } = {},
): boolean {
  const target = event.target as HTMLElement | null;
  if (target?.closest?.('[data-no-grid-pointer]')) return true;

  if (options.includePointHitTest === false) return false;

  const doc = target?.ownerDocument ?? (typeof document !== 'undefined' ? document : null);
  if (!doc) return false;

  return doc
    .elementsFromPoint(event.clientX, event.clientY)
    .some((element) => element.closest('[data-no-grid-pointer]') != null);
}
