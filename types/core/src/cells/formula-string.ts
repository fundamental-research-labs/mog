/**
 * Branded types for formula strings.
 *
 * The spreadsheet engine uses two distinct formula string formats:
 *
 * - **FormulaA1**: Has the `=` prefix (`"=SUM(A1:B10)"`).
 *   Produced by Rust's `to_a1_string()`, returned in `ActiveCellData.formula`.
 *   Used for: formula bar display, search, sending to Rust's `process_input`.
 *
 * - **FormulaTemplate**: No `=` prefix (`"SUM(A1:B10)"`).
 *   Produced by `IdentityFormula.template`, `CellEdit.formula`.
 *   Used for: wire format for incremental updates, internal storage.
 *
 * These branded types make it a **compile-time error** to pass one where
 * the other is expected, eliminating the "double-equals" class of bugs.
 */

// =============================================================================
// Branded Types
// =============================================================================

declare const formulaA1Brand: unique symbol;
declare const formulaTemplateBrand: unique symbol;

/**
 * A formula string WITH the `=` prefix: `"=SUM(A1:B10)"`, `"=A1+A2"`.
 *
 * This is the display/input format used at the Rust-TS boundary and in the UI.
 */
export type FormulaA1 = string & { readonly [formulaA1Brand]: true };

/**
 * A formula template WITHOUT the `=` prefix: `"SUM(A1:B10)"`, `"A1+A2"`.
 *
 * This is the internal storage format used by `IdentityFormula.template`
 * and `CellEdit.formula` in the wire protocol.
 */
export type FormulaTemplate = string & { readonly [formulaTemplateBrand]: true };

// =============================================================================
// Constructors
// =============================================================================
