/**
 * Public API visibility for imported defined names.
 *
 * XLSX hydration preserves opaque and broken defined names in storage so export
 * can round-trip the original workbook package. Public API consumers should
 * only see names that have a usable referent.
 */
export function stripFormulaPrefix(reference: string): string {
  return reference.startsWith('=') ? reference.slice(1) : reference;
}

export function isApiVisibleNamedRangeReference(reference: string): boolean {
  return !stripFormulaPrefix(reference).toUpperCase().includes('#REF!');
}
