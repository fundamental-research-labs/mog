/**
 * Document-level keyup capture handler factory.
 *
 * Extracted from `CoordinatorProvider.tsx` so the
 * `preventDefault`/`stopPropagation`-on-`handled=true` contract is
 * unit-testable independently of the heavyweight `KeyboardCaptureSetup`
 * useEffect (which depends on a live coordinator, UI store, and
 * workbook). The Windows Alt-menu suppression that justifies this
 * contract is documented at the call site.
 */
export function createKeyUpCapture(
  handleKeyUp: (e: KeyboardEvent) => boolean,
): (e: KeyboardEvent) => void {
  return (e: KeyboardEvent) => {
    const handled = handleKeyUp(e);
    if (handled) {
      e.preventDefault();
      e.stopPropagation();
    }
  };
}
