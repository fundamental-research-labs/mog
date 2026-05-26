/**
 * @mog/types-data — Structured-data features: tables, filters, sorting,
 * pivot, charts, grouping, sparklines, named ranges, slicers, trace arrows.
 *
 * Tier 1 of the domain graph. Depends on:
 * - @mog/types-core (CellId, CellFormat, CellRange, CellValue, SheetId, IdentityFormula)
 * - @mog/types-commands (BaseEvent, StructureChangeSource — sorting events)
 * - @mog/types-formatting (CF rules, re-exported by data/ barrel for back-compat)
 * - @mog/types-objects (ObjectPosition — slicers are floating objects)
 *
 * Contains (absorbed from contracts/src/data/):
 * - charts, filter, grouping, named-ranges, pivot, slicers, sorting,
 *   sparklines, tables, trace-arrows
 *
 * data/conditional-format.ts is NOT here — those CF rule types were pulled
 * up into @mog/types-formatting/conditional-format/rules to avoid a
 * types-formatting <-> types-data cycle. The types-data/data/ barrel
 * re-exports them so the public surface is unchanged.
 *
 * Consumers should prefer the precise subpath.
 */

export {};
