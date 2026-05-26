/**
 * Spreadsheet shortcut compatibility reference.
 *
 * This module intentionally does not vendor third-party shortcut tables or
 * prose. Compatibility coverage should be generated from first-party shortcut
 * definitions and behavior tests, with external products referenced only for
 * nominative interoperability context.
 */

export interface ExcelShortcutReference {
  /** Unique ID for this reference entry. */
  id: string;
  /** Windows shortcut binding used for compatibility analysis. */
  windowsBinding: string;
  /** Mac shortcut binding used for compatibility analysis. */
  macBinding: string;
  /** First-party behavior description. */
  description: string;
  /** Internal compatibility grouping. */
  msCategory: string;
  /** Our mapping status. */
  status: 'mapped' | 'mapped-disabled' | 'unmapped' | 'deferred' | 'not-applicable';
  /** Our internal shortcut ID if mapped. */
  mappedToId?: string;
  /** Notes on any discrepancies. */
  notes?: string;
}

export const EXCEL_REFERENCE: ExcelShortcutReference[] = [];

export interface ExcelShortcutCoverage {
  total: number;
  mapped: number;
  mappedDisabled: number;
  unmapped: number;
  deferred: number;
  notApplicable: number;
  coverage: number;
  gaps: ExcelShortcutReference[];
}

export function getShortcutCoverage(): ExcelShortcutCoverage {
  const mapped = EXCEL_REFERENCE.filter((r) => r.status === 'mapped').length;
  const mappedDisabled = EXCEL_REFERENCE.filter((r) => r.status === 'mapped-disabled').length;
  const unmapped = EXCEL_REFERENCE.filter((r) => r.status === 'unmapped');
  const deferred = EXCEL_REFERENCE.filter((r) => r.status === 'deferred').length;
  const notApplicable = EXCEL_REFERENCE.filter((r) => r.status === 'not-applicable').length;
  const applicableTotal = EXCEL_REFERENCE.length - notApplicable;

  return {
    total: EXCEL_REFERENCE.length,
    mapped,
    mappedDisabled,
    unmapped: unmapped.length,
    deferred,
    notApplicable,
    coverage: applicableTotal > 0 ? ((mapped + mappedDisabled) / applicableTotal) * 100 : 0,
    gaps: unmapped,
  };
}

export const getReferenceCoverage = getShortcutCoverage;

export function getReferenceByCategory(category: string): ExcelShortcutReference[] {
  return EXCEL_REFERENCE.filter((r) => r.msCategory === category);
}

export function getReferenceCategories(): string[] {
  const categories = new Set(EXCEL_REFERENCE.map((r) => r.msCategory));
  return Array.from(categories).sort();
}

export function getReferenceByMappedId(mappedToId: string): ExcelShortcutReference[] {
  return EXCEL_REFERENCE.filter((r) => r.mappedToId === mappedToId);
}

export function getImplementationGaps(): ExcelShortcutReference[] {
  return EXCEL_REFERENCE.filter((r) => r.status === 'unmapped');
}
