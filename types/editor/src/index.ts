/**
 * @mog/types-editor — Editor surface types.
 *
 * Tier 1 of the domain graph. Depends on:
 * - @mog/types-core (CellId, CellRange, CellValue, SheetId, IdentityRangeRef)
 * - @mog/types-commands (CellSchema — cell editor dispatch)
 * - @mog/types-viewport (CellCoord — selection coords)
 * - @mog/types-objects (CellAnchor — form controls anchor as floating objects)
 * - @mog-sdk/types-document (Platform — keyboard customization is platform-aware)
 *
 * Contains (absorbed from contracts/src/):
 * - editor/      — cell editor (drag, editor, form-controls)
 * - keyboard/    — physical keys, input, actions, customization,
 *                  binding + display utils, excel-reference, shortcuts
 * - selection/   — behavior registry + types (SelectionDirection now owned here)
 * - fill/        — fill options, custom lists
 * - context-menu/ — menu state
 * - ribbon/      — collapse configs + types
 * - accessibility/ — ARIA + announcement types
 * - actions/     — unified action system types + comment actions
 *
 * One non-trivial move: SelectionDirection used to live in
 * contracts/src/machines/types.ts (Tier 2). It's a leaf type with no
 * dependencies and logically belongs with selection. Moving it here lets
 * selection/types.ts stop reaching up into Tier 2. machines/types.ts still
 * re-exports it for back-compat.
 */

export {};
