/** Helpers for APIs that require a concrete named-range referent. */
export function stripFormulaPrefix(reference: string): string {
  return reference.startsWith('=') ? reference.slice(1) : reference;
}

export function isApiVisibleNamedRangeReference(reference: string): boolean {
  return !stripFormulaPrefix(reference).toUpperCase().includes('#REF!');
}
