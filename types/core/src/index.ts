/**
 * @mog/types-core — Foundation cell/value types for the spreadsheet.
 *
 * Tier 0 foundation package. Depends only on @mog/types-culture (for the
 * NumberFormatType string-literal union referenced by CellFormat).
 *
 * Contains:
 * - core.ts: CellValue, CellRange, CellAddress, SheetId, CellFormat, etc.
 * - disposable.ts: Disposable interface
 * - result.ts: Result<T, E>
 * - formatted-text.ts: FormattedText branded type + adapters
 * - cells/: cell-identity, cell-style, formula-string, range-ref, rich-text, spill
 * - utils/a1.ts: ParsedCellAddress / ParsedCellRange
 */

export * from './core';
export * from './disposable';
export * from './result';
export * from './formatted-text';

// cells (absorbed from contracts/src/cells/)
export * from './cells/cell-identity';
export * from './cells/cell-style';
export * from './cells/formula-string';
export * from './cells/range-ref';
export * from './cells/rich-text';
export * from './cells/spill';

// document/protection (absorbed from contracts/src/document/protection.ts)
// Absorbed because core.ts has inline `import('../document/protection')` type refs.
export * from './document/protection';
