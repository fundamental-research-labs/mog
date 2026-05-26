/**
 * Default categorical color palette (similar to D3 category10).
 *
 * Extracted into a standalone leaf module (no intra-package imports) so that
 * other modules can reference the palette without creating circular
 * dependencies.  The previous location in `encoding-resolver.ts` caused a
 * TDZ crash under Turbopack because the import chain
 *   encoding-resolver -> utils/colors -> types/chart-types -> encoding-resolver
 * tried to read this const before it was initialized.
 */
export const DEFAULT_CATEGORY_COLORS = [
  '#1f77b4',
  '#ff7f0e',
  '#2ca02c',
  '#d62728',
  '#9467bd',
  '#8c564b',
  '#e377c2',
  '#7f7f7f',
  '#bcbd22',
  '#17becf',
];
