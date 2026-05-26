//! Formula Template Updater for Sheet Renames
//!
//! Port of `spreadsheet-model/src/cells/formula-template-updater.ts` (304 LOC).
//!
//! When a sheet is renamed, formula templates containing cross-sheet references
//! need updating. For example, if "Sheet2" is renamed to "Data", formulas like
//! `'Sheet2'!A1` become `'Data'!A1`. The identity formula system stores templates
//! like `'Sheet2'!{0}` where the sheet NAME is embedded in the template string.
//!
//! ## Pure Functions
//!
//! - [`escape_sheet_name_for_formula`] — format a sheet name for use in formulas
//! - [`template_contains_sheet_ref`] — quick check if a template references a sheet
//! - [`replace_sheet_name_in_template`] — update sheet name in a formula template
//! - [`replace_sheet_name_in_a1_formula`] — update sheet name in an A1 formula string
//!
//! ## Storage Functions
//!
//! - [`update_formula_templates_on_sheet_rename`] — scan all cells and update templates
//!   on sheet rename
//! - [`update_formula_templates_on_named_range_rename`] — scan all cells and update
//!   formula bodies that reference a renamed named range

use std::sync::Arc;

use regex::Regex;
use yrs::{Any, Array, ArrayRef, Doc, Map, MapRef, Out, Transact};

use compute_document::schema::{KEY_CELLS, KEY_FORMULA, KEY_FORMULA_TEMPLATE, KEY_SHEET_ORDER};

// =============================================================================
// Sheet Name Escaping Utilities
// =============================================================================

/// Check if a sheet name needs quoting in Excel formulas.
///
/// Sheet names need quoting if they:
/// - are empty
/// - start with a digit
/// - contain anything other than letters, digits, and underscores
///
/// Re-export from compute_parser — single source of truth for sheet name quoting rules.
fn sheet_name_needs_quoting(name: &str) -> bool {
    compute_parser::needs_quoting(name)
}

/// Escape a sheet name for use in formulas.
///
/// If the name needs quoting, wrap in single quotes and escape internal quotes
/// by doubling them.
///
/// # Examples
/// ```ignore
/// assert_eq!(escape_sheet_name_for_formula("Sheet1"), "Sheet1");
/// assert_eq!(escape_sheet_name_for_formula("My Sheet"), "'My Sheet'");
/// assert_eq!(escape_sheet_name_for_formula("Sheet's Data"), "'Sheet''s Data'");
/// ```
fn escape_sheet_name_for_formula(name: &str) -> String {
    if name.is_empty() {
        return "''".to_string();
    }
    if !sheet_name_needs_quoting(name) {
        return name.to_string();
    }
    // Escape internal single quotes by doubling them, then wrap in single quotes
    let escaped = name.replace('\'', "''");
    format!("'{}'", escaped)
}

/// Escape special regex characters in a string.
fn escape_regex(s: &str) -> String {
    let mut result = String::with_capacity(s.len() * 2);
    for ch in s.chars() {
        match ch {
            '.' | '*' | '+' | '?' | '^' | '$' | '{' | '}' | '(' | ')' | '|' | '[' | ']' | '\\' => {
                result.push('\\');
                result.push(ch);
            }
            _ => result.push(ch),
        }
    }
    result
}

// =============================================================================
// Template Checking and Update Logic
// =============================================================================

/// Check if a formula template contains a reference to a specific sheet name.
///
/// Looks for patterns like:
/// - `SheetName!{0}`
/// - `'Sheet Name'!{0}`
/// - `'Sheet''s Data'!{0}` (escaped quotes)
///
/// This is a simple regex-based check to quickly filter formulas.
///
/// # Arguments
/// - `template` — Formula template string
/// - `sheet_name` — Sheet name to search for (case-sensitive for Excel compatibility)
///
/// # Returns
/// `true` if template likely contains a reference to the sheet
fn template_contains_sheet_ref(template: &str, sheet_name: &str) -> bool {
    if sheet_name.is_empty() || template.is_empty() {
        return false;
    }

    let escaped_name = escape_regex(sheet_name);

    // Pattern 1: Unquoted sheet name (e.g., Sheet1!{0})
    // Use word boundary (\b) before the name
    let unquoted_pattern = format!(r"\b{}!", escaped_name);
    if let Ok(re) = Regex::new(&unquoted_pattern)
        && re.is_match(template)
    {
        return true;
    }

    // Pattern 2: Quoted sheet name (e.g., 'Sheet Name'!{0} or 'Sheet''s Data'!{0})
    let quoted_name = sheet_name.replace('\'', "''");
    let _quoted_pattern = format!("'{}!'", escape_regex(&quoted_name));
    // Actually the pattern should be: '<quotedName>'!
    let quoted_pattern = format!("'{}'!", escape_regex(&quoted_name));
    if let Ok(re) = Regex::new(&quoted_pattern)
        && re.is_match(template)
    {
        return true;
    }

    false
}

/// Replace a sheet name in a formula template string.
///
/// Handles both quoted and unquoted sheet names correctly.
///
/// # Examples
/// ```ignore
/// // Simple unquoted
/// assert_eq!(
///     replace_sheet_name_in_template("Sheet1!{0}", "Sheet1", "Data"),
///     "Data!{0}"
/// );
/// // Quoted to unquoted
/// assert_eq!(
///     replace_sheet_name_in_template("'Sheet2'!{0}", "Sheet2", "Data"),
///     "Data!{0}"
/// );
/// ```
fn replace_sheet_name_in_template(template: &str, old_name: &str, new_name: &str) -> String {
    if old_name.is_empty() || template.is_empty() {
        return template.to_string();
    }

    let new_formatted = escape_sheet_name_for_formula(new_name);
    let replacement = format!("{}!", new_formatted);

    // We need to handle both quoted and unquoted forms of the old name.
    // For example, "Sheet2" could appear as either `Sheet2!` or `'Sheet2'!` in templates.
    let mut result = template.to_string();

    // First, try quoted form: 'OldName'! (with internal quotes doubled)
    let quoted_old = old_name.replace('\'', "''");
    let quoted_pattern = format!("'{}'!", escape_regex(&quoted_old));
    if let Ok(re) = Regex::new(&quoted_pattern) {
        result = re.replace_all(&result, replacement.as_str()).to_string();
    }

    // Then, try unquoted form: OldName! (only if old name doesn't need quoting)
    if !sheet_name_needs_quoting(old_name) {
        let unquoted_pattern = format!("{}!", escape_regex(old_name));
        if let Ok(re) = Regex::new(&unquoted_pattern) {
            result = re.replace_all(&result, replacement.as_str()).to_string();
        }
    }

    result
}

/// Replace sheet name in an A1 formula string.
///
/// This is the same logic as template replacement — update the display string.
///
/// # Arguments
/// - `formula` — A1 formula string (without leading `=`)
/// - `old_name` — Old sheet name
/// - `new_name` — New sheet name
///
/// # Returns
/// Updated formula string
fn replace_sheet_name_in_a1_formula(formula: &str, old_name: &str, new_name: &str) -> String {
    if old_name.is_empty() || formula.is_empty() {
        return formula.to_string();
    }

    let new_formatted = escape_sheet_name_for_formula(new_name);
    let replacement = format!("{}!", new_formatted);

    let mut result = formula.to_string();

    // First, try quoted form: 'OldName'!
    let quoted_old = old_name.replace('\'', "''");
    let quoted_pattern = format!("'{}'!", escape_regex(&quoted_old));
    if let Ok(re) = Regex::new(&quoted_pattern) {
        result = re.replace_all(&result, replacement.as_str()).to_string();
    }

    // Then, try unquoted form: OldName! (only if old name doesn't need quoting)
    if !sheet_name_needs_quoting(old_name) {
        let unquoted_pattern = format!("{}!", escape_regex(old_name));
        if let Ok(re) = Regex::new(&unquoted_pattern) {
            result = re.replace_all(&result, replacement.as_str()).to_string();
        }
    }

    result
}

// =============================================================================
// Yrs Helpers
// =============================================================================

/// Read the sheetOrder array from the workbook map.
fn get_sheet_order_array<T: yrs::ReadTxn>(workbook: &MapRef, txn: &T) -> Option<ArrayRef> {
    match workbook.get(txn, KEY_SHEET_ORDER) {
        Some(Out::YArray(arr)) => Some(arr),
        _ => None,
    }
}

// =============================================================================
// Storage Function
// =============================================================================

/// Information about a cell whose formula template needs updating.
struct CellUpdate {
    /// Hex key of the sheet containing this cell.
    sheet_hex: String,
    /// Hex key of this cell within the cells map.
    cell_hex: String,
    /// New formula template after replacement (None if cell had no template).
    new_template: Option<String>,
    /// New A1 formula after replacement.
    new_formula: String,
}

/// Update formula templates after a sheet rename.
///
/// Scans all cells in all sheets for formula templates that reference `old_name`,
/// and updates them to reference `new_name`. Also updates the A1 formula ("f" key).
///
/// # Arguments
/// - `doc` — The yrs CRDT document
/// - `workbook` — The top-level workbook `MapRef`
/// - `sheets` — The top-level sheets `MapRef`
/// - `old_name` — The previous sheet name
/// - `new_name` — The new sheet name
///
/// # Returns
/// The number of formulas that were updated.
pub fn update_formula_templates_on_sheet_rename(
    doc: &Doc,
    workbook: &MapRef,
    sheets: &MapRef,
    old_name: &str,
    new_name: &str,
) -> u32 {
    if old_name.is_empty() || new_name.is_empty() || old_name == new_name {
        return 0;
    }

    // Pass 1: Read — collect all cells that need updating.
    let updates: Vec<CellUpdate> = {
        let txn = doc.transact();
        let Some(order_arr) = get_sheet_order_array(workbook, &txn) else {
            return 0;
        };
        let len = order_arr.len(&txn);
        let mut updates = Vec::new();

        for i in 0..len {
            if let Some(Out::Any(Any::String(sheet_hex))) = order_arr.get(&txn, i)
                && let Some(Out::YMap(sheet_map)) = sheets.get(&txn, &sheet_hex)
                && let Some(Out::YMap(cells_map)) = sheet_map.get(&txn, KEY_CELLS)
            {
                // Collect cell keys first
                let keys: Vec<String> = cells_map.keys(&txn).map(|k| k.to_string()).collect();

                for cell_hex in &keys {
                    if let Some(Out::YMap(cell_map)) = cells_map.get(&txn, cell_hex.as_str()) {
                        // Read formula template (may not exist for API-set formulas)
                        let template = match cell_map.get(&txn, KEY_FORMULA_TEMPLATE) {
                            Some(Out::Any(Any::String(s))) => Some(s.to_string()),
                            _ => None,
                        };

                        // Read A1 formula
                        let formula = match cell_map.get(&txn, KEY_FORMULA) {
                            Some(Out::Any(Any::String(s))) => s.to_string(),
                            _ => String::new(),
                        };

                        // Quick filter: does the template or formula reference the old sheet?
                        let template_matches = template
                            .as_ref()
                            .map(|t| template_contains_sheet_ref(t, old_name))
                            .unwrap_or(false);
                        let formula_matches =
                            !formula.is_empty() && formula.contains(&format!("{}!", old_name));

                        if !template_matches && !formula_matches {
                            continue;
                        }

                        // Compute new values
                        let new_template = template
                            .as_ref()
                            .map(|t| replace_sheet_name_in_template(t, old_name, new_name));
                        let new_formula =
                            replace_sheet_name_in_a1_formula(&formula, old_name, new_name);

                        updates.push(CellUpdate {
                            sheet_hex: sheet_hex.to_string(),
                            cell_hex: cell_hex.clone(),
                            new_template,
                            new_formula,
                        });
                    }
                }
            }
        }

        updates
    };

    if updates.is_empty() {
        return 0;
    }

    let count = updates.len() as u32;

    // Pass 2: Write — apply all updates in a single transaction.
    {
        let mut txn = doc.transact_mut();

        for update in &updates {
            if let Some(Out::YMap(sheet_map)) = sheets.get(&txn, &update.sheet_hex)
                && let Some(Out::YMap(cells_map)) = sheet_map.get(&txn, KEY_CELLS)
                && let Some(Out::YMap(cell_map)) = cells_map.get(&txn, update.cell_hex.as_str())
            {
                // Update formula template (if cell has one)
                if let Some(ref new_template) = update.new_template {
                    cell_map.insert(
                        &mut txn,
                        KEY_FORMULA_TEMPLATE,
                        Any::String(Arc::from(new_template.as_str())),
                    );
                }

                // Update A1 formula
                cell_map.insert(
                    &mut txn,
                    KEY_FORMULA,
                    Any::String(Arc::from(update.new_formula.as_str())),
                );
            }
        }
    }

    count
}

// =============================================================================
// Named Range Rename
// =============================================================================

/// Walk a formula body and yield each identifier-token byte range that
/// is a *candidate* for named-range rewriting — i.e. NOT inside a string
/// literal, NOT preceded by `!` (sheet prefix), NOT preceded by `'` (the
/// closing quote of a quoted sheet name like `'My Sheet'`), NOT a table
/// name immediately followed by `[` (structured ref), and NOT a function
/// call (followed by `(`).
///
/// This is the structural alternative to the prior flat regex —
/// `(?i)(^|[^A-Za-z0-9_.]){name}($|[^A-Za-z0-9_.])` — which matched
/// inside string literals (`=IF(A1="Region",1,Region)` rewrote both
/// occurrences) and corrupted sheet prefixes (`=Region!A1+Region` rewrote
/// the prefix). table dependency work T2.
///
/// Returns a `Vec<(start_byte, end_byte)>` for each candidate identifier.
/// The caller filters by name-equality (case-insensitive) and rewrites.
///
/// **Limitations** (intentional, documented):
/// - Does not yet emit AST `IdentityFormulaRef::Name(NameId)` nodes —
///   that's a larger structural change in the parser/evaluator/display
///   pipeline. The TODO at
///   `compute/core/crates/types/formula-types/src/identity_formula.rs:300`
///   is the next step. This scanner gets us to the *correct rejection
///   set* (string literals, sheet prefixes, table refs, function names)
///   without that refactor.
/// - LET/LAMBDA bound variables aren't disambiguated from named ranges
///   here; that's a parse-time concern. A LET-binding identifier shadows
///   the workbook name only inside the LET's scope — current rewrite
///   matches the prior legacy string-rewrite behaviour (rewrites both, accepting the
///   over-rewrite for LET-shadowed names). The known-bug audit calls
///   out string literals + sheet prefixes specifically; LET shadowing
///   is a separate finding (not in scope for T2).
fn formula_identifier_candidates(formula: &str) -> Vec<(usize, usize)> {
    let bytes = formula.as_bytes();
    let mut out = Vec::new();
    let mut i = 0;
    while i < bytes.len() {
        let b = bytes[i];
        match b {
            // String literal: `"..."` with `""` for embedded quotes. Skip
            // the entire literal so identifiers inside are not candidates.
            b'"' => {
                i += 1;
                while i < bytes.len() {
                    if bytes[i] == b'"' {
                        // `""` is an escaped quote — consume both.
                        if i + 1 < bytes.len() && bytes[i + 1] == b'"' {
                            i += 2;
                            continue;
                        }
                        i += 1;
                        break;
                    }
                    i += 1;
                }
            }
            // Quoted sheet name: `'My Sheet'` followed by `!`. Skip.
            // (Bare apostrophe inside a formula body is malformed; only
            // the quoted-sheet form is handled here.)
            b'\'' => {
                i += 1;
                while i < bytes.len() {
                    if bytes[i] == b'\'' {
                        // `''` inside a quoted sheet name is an escaped quote.
                        if i + 1 < bytes.len() && bytes[i + 1] == b'\'' {
                            i += 2;
                            continue;
                        }
                        i += 1;
                        break;
                    }
                    i += 1;
                }
            }
            // Identifier start: ASCII letter or `_`.
            _ if b.is_ascii_alphabetic() || b == b'_' => {
                let start = i;
                i += 1;
                while i < bytes.len()
                    && (bytes[i].is_ascii_alphanumeric() || bytes[i] == b'_' || bytes[i] == b'.')
                {
                    i += 1;
                }
                let end = i;
                // Disqualifying suffixes:
                //   `Identifier!`  — sheet prefix (e.g. `Sheet1!A1`).
                //   `Identifier[`  — structured table ref (`Table1[Col]`).
                //   `Identifier(`  — function call (`SUM(...)`).
                //
                // Whitespace before the suffix doesn't change the
                // classification — Excel allows `SUM (A1)`. Skip ASCII
                // whitespace then re-check.
                let mut peek = end;
                while peek < bytes.len() && bytes[peek].is_ascii_whitespace() {
                    peek += 1;
                }
                let next = bytes.get(peek).copied();
                if matches!(next, Some(b'!' | b'[' | b'(')) {
                    continue;
                }
                out.push((start, end));
            }
            // Numeric prefix: skip the digit run so identifiers in
            // expressions like `1Region` don't leak. (`1Region` is not
            // a valid Excel token, but skipping defensively avoids
            // boundary corruption.)
            _ if b.is_ascii_digit() => {
                i += 1;
                while i < bytes.len()
                    && (bytes[i].is_ascii_alphanumeric() || bytes[i] == b'.' || bytes[i] == b'_')
                {
                    i += 1;
                }
            }
            _ => {
                i += 1;
            }
        }
    }
    out
}

/// Check if a formula body references a specific named range.
///
/// Walks identifier candidates via [`formula_identifier_candidates`] and
/// returns `true` iff one matches `name` case-insensitively. String
/// literals, sheet prefixes (`Foo!`), table refs (`Foo[Col]`), and
/// function names (`Foo(...)`) are all excluded — table dependency work T2 fix for
/// the prior flat regex.
fn formula_contains_name_ref(formula: &str, name: &str) -> bool {
    if name.is_empty() || formula.is_empty() {
        return false;
    }
    for (start, end) in formula_identifier_candidates(formula) {
        // Manually slice — bytes are ASCII identifier characters.
        #[allow(clippy::string_slice)]
        let token = &formula[start..end];
        if token.eq_ignore_ascii_case(name) {
            return true;
        }
    }
    false
}

/// Replace a named range identifier in a formula body with a new name.
///
/// Uses [`formula_identifier_candidates`] to identify the rewrite-safe
/// byte ranges, then splices `new_name` in at each match. String
/// literals, sheet prefixes, table refs, and function names are not
/// touched.
///
/// table dependency work T2 — replaces the legacy string-rewrite flat regex which rewrote string
/// literals (`=IF(A1="Region",1,Region)` corrupted) and sheet-prefix
/// tokens (`=Region!A1+Region` corrupted).
fn replace_name_in_formula(formula: &str, old_name: &str, new_name: &str) -> String {
    if formula.is_empty() || old_name.is_empty() {
        return formula.to_string();
    }
    let candidates = formula_identifier_candidates(formula);
    let mut out = String::with_capacity(formula.len());
    let mut cursor = 0;
    for (start, end) in candidates {
        // Skip any candidates we've already passed (shouldn't happen
        // since the scanner returns non-overlapping ranges in order).
        if start < cursor {
            continue;
        }
        #[allow(clippy::string_slice)]
        let token = &formula[start..end];
        if token.eq_ignore_ascii_case(old_name) {
            let Some(prefix) = formula.get(cursor..start) else {
                return formula.to_string();
            };
            out.push_str(prefix);
            out.push_str(new_name);
            cursor = end;
        }
    }
    let Some(suffix) = formula.get(cursor..) else {
        return formula.to_string();
    };
    out.push_str(suffix);
    out
}

/// Walk every formula cell in the in-memory [`crate::mirror::CellMirror`] and
/// rewrite occurrences of `old_name` in the [`formula_types::IdentityFormula::template`]
/// string to `new_name`. Named-range refs aren't AST variants today
/// (`IdentityFormulaRef` has no `Name` arm — see the comment at
/// `compute-core/crates/types/formula-types/src/identity_formula.rs:300`), so
/// references appear literally inside the template (e.g. `template = "MyVal+5"`).
///
/// Pairs with [`update_formula_templates_on_named_range_rename`] which handles
/// the Yrs-persisted side; this function syncs the runtime mirror so
/// `formula_strings` regeneration and the formula-bar render reflect the
/// rename without a re-init.
pub fn update_mirror_formulas_on_named_range_rename(
    mirror: &mut crate::mirror::CellMirror,
    old_name: &str,
    new_name: &str,
) {
    if old_name.is_empty() || new_name.is_empty() || old_name == new_name {
        return;
    }
    // Collect (sheet, cell, new_template) first to avoid borrowing the
    // mirror immutably and mutably at the same time.
    let mut updates: Vec<(cell_types::SheetId, cell_types::CellId, String)> = Vec::new();
    let sheet_ids: Vec<cell_types::SheetId> = mirror.sheet_ids().copied().collect();
    for sheet_id in sheet_ids {
        let Some(sheet) = mirror.get_sheet(&sheet_id) else {
            continue;
        };
        for (cell_id, entry) in sheet.cells_iter() {
            let Some(formula) = &entry.formula else {
                continue;
            };
            if !formula_contains_name_ref(&formula.template, old_name) {
                continue;
            }
            let new_template = replace_name_in_formula(&formula.template, old_name, new_name);
            if new_template != formula.template {
                updates.push((sheet_id, *cell_id, new_template));
            }
        }
    }

    for (_sheet_id, cell_id, new_template) in updates {
        // Use the existing `set_formula` mutation point. Cloning the
        // existing IdentityFormula and overwriting `template` is the
        // smallest-radius edit; refs / flags carry over.
        let new_formula = mirror.get_formula(&cell_id).map(|f| {
            let mut cloned = f.clone();
            cloned.template = new_template;
            cloned
        });
        if let Some(f) = new_formula {
            mirror.set_formula(&cell_id, Some(f));
        }
    }
}

/// Update formula bodies after a named range rename.
///
/// Scans all cells in all sheets for formula text that references `old_name`,
/// and rewrites it to `new_name`. Mirrors the structure of
/// [`update_formula_templates_on_sheet_rename`] but matches names directly
/// (not `Name!` cross-sheet prefixes).
///
/// # Arguments
/// - `doc` — The yrs CRDT document
/// - `workbook` — The top-level workbook `MapRef`
/// - `sheets` — The top-level sheets `MapRef`
/// - `old_name` — The previous named-range name
/// - `new_name` — The new named-range name
///
/// # Returns
/// The number of formulas that were updated.
pub fn update_formula_templates_on_named_range_rename(
    doc: &Doc,
    workbook: &MapRef,
    sheets: &MapRef,
    old_name: &str,
    new_name: &str,
) -> u32 {
    if old_name.is_empty() || new_name.is_empty() || old_name == new_name {
        return 0;
    }

    // Pass 1: Read — collect all cells that need updating.
    let updates: Vec<CellUpdate> = {
        let txn = doc.transact();
        let Some(order_arr) = get_sheet_order_array(workbook, &txn) else {
            return 0;
        };
        let len = order_arr.len(&txn);
        let mut updates = Vec::new();

        for i in 0..len {
            if let Some(Out::Any(Any::String(sheet_hex))) = order_arr.get(&txn, i)
                && let Some(Out::YMap(sheet_map)) = sheets.get(&txn, &sheet_hex)
                && let Some(Out::YMap(cells_map)) = sheet_map.get(&txn, KEY_CELLS)
            {
                let keys: Vec<String> = cells_map.keys(&txn).map(|k| k.to_string()).collect();

                for cell_hex in &keys {
                    if let Some(Out::YMap(cell_map)) = cells_map.get(&txn, cell_hex.as_str()) {
                        let template = match cell_map.get(&txn, KEY_FORMULA_TEMPLATE) {
                            Some(Out::Any(Any::String(s))) => Some(s.to_string()),
                            _ => None,
                        };
                        let formula = match cell_map.get(&txn, KEY_FORMULA) {
                            Some(Out::Any(Any::String(s))) => s.to_string(),
                            _ => String::new(),
                        };

                        // Quick filter
                        let template_matches = template
                            .as_ref()
                            .map(|t| formula_contains_name_ref(t, old_name))
                            .unwrap_or(false);
                        let formula_matches =
                            !formula.is_empty() && formula_contains_name_ref(&formula, old_name);

                        if !template_matches && !formula_matches {
                            continue;
                        }

                        let new_template = template
                            .as_ref()
                            .map(|t| replace_name_in_formula(t, old_name, new_name));
                        let new_formula = if formula.is_empty() {
                            String::new()
                        } else {
                            replace_name_in_formula(&formula, old_name, new_name)
                        };

                        updates.push(CellUpdate {
                            sheet_hex: sheet_hex.to_string(),
                            cell_hex: cell_hex.clone(),
                            new_template,
                            new_formula,
                        });
                    }
                }
            }
        }

        updates
    };

    if updates.is_empty() {
        return 0;
    }

    let count = updates.len() as u32;

    // Pass 2: Write — apply all updates in a single transaction.
    {
        let mut txn = doc.transact_mut();

        for update in &updates {
            if let Some(Out::YMap(sheet_map)) = sheets.get(&txn, &update.sheet_hex)
                && let Some(Out::YMap(cells_map)) = sheet_map.get(&txn, KEY_CELLS)
                && let Some(Out::YMap(cell_map)) = cells_map.get(&txn, update.cell_hex.as_str())
            {
                if let Some(ref new_template) = update.new_template {
                    cell_map.insert(
                        &mut txn,
                        KEY_FORMULA_TEMPLATE,
                        Any::String(Arc::from(new_template.as_str())),
                    );
                }
                if !update.new_formula.is_empty() {
                    cell_map.insert(
                        &mut txn,
                        KEY_FORMULA,
                        Any::String(Arc::from(update.new_formula.as_str())),
                    );
                }
            }
        }
    }

    count
}

// =============================================================================
// Tests
// =============================================================================

#[cfg(test)]
mod tests {
    use super::*;
    use crate::storage::YrsStorage;
    use cell_types::SheetId;
    use formula_types::{IdentityFormula, IdentityFormulaRef};
    use value_types::{CellValue, FiniteF64};

    // -------------------------------------------------------------------
    // Helpers
    // -------------------------------------------------------------------

    fn make_sheet_id(n: u128) -> SheetId {
        SheetId::from_raw(n)
    }

    fn make_cell_id(n: u128) -> cell_types::CellId {
        cell_types::CellId::from_raw(n)
    }

    // -------------------------------------------------------------------
    // Test 1: sheet_name_needs_quoting — simple names
    // -------------------------------------------------------------------

    #[test]
    fn test_sheet_name_needs_quoting_simple() {
        assert!(!sheet_name_needs_quoting("Sheet1"));
        assert!(!sheet_name_needs_quoting("Data"));
        assert!(!sheet_name_needs_quoting("MySheet"));
        assert!(!sheet_name_needs_quoting("_private"));
        assert!(!sheet_name_needs_quoting("a"));
    }

    // -------------------------------------------------------------------
    // Test 2: sheet_name_needs_quoting — names that need quoting
    // -------------------------------------------------------------------

    #[test]
    fn test_sheet_name_needs_quoting_special() {
        assert!(sheet_name_needs_quoting("My Sheet")); // space
        assert!(sheet_name_needs_quoting("2024Data")); // starts with digit
        assert!(sheet_name_needs_quoting("Sheet's")); // apostrophe
        assert!(sheet_name_needs_quoting("Data-2024")); // hyphen
        assert!(sheet_name_needs_quoting("Sheet.1")); // period
        assert!(sheet_name_needs_quoting("")); // empty
    }

    // -------------------------------------------------------------------
    // Test 3: escape_sheet_name_for_formula — plain names
    // -------------------------------------------------------------------

    #[test]
    fn test_escape_sheet_name_plain() {
        assert_eq!(escape_sheet_name_for_formula("Sheet1"), "Sheet1");
        assert_eq!(escape_sheet_name_for_formula("Data"), "Data");
        assert_eq!(escape_sheet_name_for_formula("_test"), "_test");
    }

    // -------------------------------------------------------------------
    // Test 4: escape_sheet_name_for_formula — names with spaces
    // -------------------------------------------------------------------

    #[test]
    fn test_escape_sheet_name_with_spaces() {
        assert_eq!(escape_sheet_name_for_formula("My Sheet"), "'My Sheet'");
        assert_eq!(
            escape_sheet_name_for_formula("Revenue Data"),
            "'Revenue Data'"
        );
    }

    // -------------------------------------------------------------------
    // Test 5: escape_sheet_name_for_formula — names with quotes
    // -------------------------------------------------------------------

    #[test]
    fn test_escape_sheet_name_with_quotes() {
        assert_eq!(
            escape_sheet_name_for_formula("Sheet's Data"),
            "'Sheet''s Data'"
        );
        assert_eq!(escape_sheet_name_for_formula("It's"), "'It''s'");
    }

    // -------------------------------------------------------------------
    // Test 6: escape_sheet_name_for_formula — empty name
    // -------------------------------------------------------------------

    #[test]
    fn test_escape_sheet_name_empty() {
        assert_eq!(escape_sheet_name_for_formula(""), "''");
    }

    // -------------------------------------------------------------------
    // Test 7: template_contains_sheet_ref — matches unquoted
    // -------------------------------------------------------------------

    #[test]
    fn test_template_contains_sheet_ref_unquoted() {
        assert!(template_contains_sheet_ref("Sheet2!{0}+1", "Sheet2"));
        assert!(template_contains_sheet_ref("SUM(Sheet1!{0})", "Sheet1"));
    }

    // -------------------------------------------------------------------
    // Test 8: template_contains_sheet_ref — matches quoted
    // -------------------------------------------------------------------

    #[test]
    fn test_template_contains_sheet_ref_quoted() {
        assert!(template_contains_sheet_ref("'My Sheet'!{0}", "My Sheet"));
        assert!(template_contains_sheet_ref(
            "'Sheet''s Data'!{0}",
            "Sheet's Data"
        ));
    }

    // -------------------------------------------------------------------
    // Test 9: template_contains_sheet_ref — no match
    // -------------------------------------------------------------------

    #[test]
    fn test_template_contains_sheet_ref_no_match() {
        assert!(!template_contains_sheet_ref("Sheet1!{0}", "Sheet2"));
        assert!(!template_contains_sheet_ref("SUM({0})", "Sheet1"));
        assert!(!template_contains_sheet_ref("{0}+{1}", "Data"));
    }

    // -------------------------------------------------------------------
    // Test 10: template_contains_sheet_ref — empty inputs
    // -------------------------------------------------------------------

    #[test]
    fn test_template_contains_sheet_ref_empty() {
        assert!(!template_contains_sheet_ref("", "Sheet1"));
        assert!(!template_contains_sheet_ref("Sheet1!{0}", ""));
        assert!(!template_contains_sheet_ref("", ""));
    }

    // -------------------------------------------------------------------
    // Test 11: replace_sheet_name_in_template — simple unquoted
    // -------------------------------------------------------------------

    #[test]
    fn test_replace_template_simple() {
        assert_eq!(
            replace_sheet_name_in_template("Sheet1!{0}+1", "Sheet1", "Data"),
            "Data!{0}+1"
        );
    }

    // -------------------------------------------------------------------
    // Test 12: replace_sheet_name_in_template — quoted to unquoted
    // -------------------------------------------------------------------

    #[test]
    fn test_replace_template_quoted_to_unquoted() {
        // 'Sheet2'! -> Data! (Sheet2 needs no quoting, but the old ref was quoted)
        assert_eq!(
            replace_sheet_name_in_template("'Sheet2'!{0}", "Sheet2", "Data"),
            "Data!{0}"
        );
    }

    // -------------------------------------------------------------------
    // Test 13: replace_sheet_name_in_template — unquoted to quoted
    // -------------------------------------------------------------------

    #[test]
    fn test_replace_template_unquoted_to_quoted() {
        assert_eq!(
            replace_sheet_name_in_template("Sheet1!{0}", "Sheet1", "My Data"),
            "'My Data'!{0}"
        );
    }

    // -------------------------------------------------------------------
    // Test 14: replace_sheet_name_in_template — multiple occurrences
    // -------------------------------------------------------------------

    #[test]
    fn test_replace_template_multiple() {
        assert_eq!(
            replace_sheet_name_in_template("Sheet1!{0}+Sheet1!{1}", "Sheet1", "Data"),
            "Data!{0}+Data!{1}"
        );
    }

    // -------------------------------------------------------------------
    // Test 15: replace_sheet_name_in_template — no match returns unchanged
    // -------------------------------------------------------------------

    #[test]
    fn test_replace_template_no_match() {
        let template = "SUM({0})+{1}";
        assert_eq!(
            replace_sheet_name_in_template(template, "Sheet1", "Data"),
            template
        );
    }

    // -------------------------------------------------------------------
    // Test 16: replace_sheet_name_in_a1_formula — basic
    // -------------------------------------------------------------------

    #[test]
    fn test_replace_a1_formula_basic() {
        assert_eq!(
            replace_sheet_name_in_a1_formula("Sheet2!A1+Sheet2!B2", "Sheet2", "Revenue"),
            "Revenue!A1+Revenue!B2"
        );
    }

    // -------------------------------------------------------------------
    // Test 17: replace_sheet_name_in_a1_formula — empty inputs
    // -------------------------------------------------------------------

    #[test]
    fn test_replace_a1_formula_empty() {
        assert_eq!(replace_sheet_name_in_a1_formula("", "Sheet1", "Data"), "");
        assert_eq!(
            replace_sheet_name_in_a1_formula("Sheet1!A1", "", "Data"),
            "Sheet1!A1"
        );
    }

    // -------------------------------------------------------------------
    // Test 18: update_formula_templates_on_sheet_rename — end-to-end
    // -------------------------------------------------------------------

    #[test]
    fn test_update_templates_on_rename_end_to_end() {
        let mut storage = YrsStorage::new();
        let mut mirror = crate::mirror::CellMirror::new();
        let s1 = make_sheet_id(1);
        let s2 = make_sheet_id(2);
        storage.add_sheet(&mut mirror, s1, "Sheet1", 10, 5).unwrap();
        storage.add_sheet(&mut mirror, s2, "Sheet2", 10, 5).unwrap();

        let cell_id = make_cell_id(100);
        let idf = IdentityFormula {
            template: "Sheet2!{0}+1".to_string(),
            refs: vec![],
            is_dynamic_array: false,
            is_volatile: false,
            is_aggregate: false,
        };

        // Set a cell in Sheet1 that references Sheet2
        storage.set_cell(
            &mut mirror,
            &s1,
            cell_id,
            0,
            0,
            CellValue::Number(FiniteF64::must(42.0)),
            Some("Sheet2!A1+1".to_string()),
            Some(idf),
        );

        // Rename Sheet2 -> Data
        let count = update_formula_templates_on_sheet_rename(
            storage.doc(),
            storage.workbook_map(),
            storage.sheets(),
            "Sheet2",
            "Data",
        );
        assert_eq!(count, 1);

        // Verify the cell was updated in the Yrs doc
        let (_, formula, identity) = storage
            .read_cell_from_yrs(&s1, &cell_id)
            .expect("cell should exist");
        assert_eq!(formula, Some("=Data!A1+1".to_string()));
        let idf = identity.expect("identity formula should exist");
        assert_eq!(idf.template, "Data!{0}+1");
    }

    // -------------------------------------------------------------------
    // Test 19: update_formula_templates_on_sheet_rename — no formulas to update
    // -------------------------------------------------------------------

    #[test]
    fn test_update_templates_no_formulas() {
        let mut storage = YrsStorage::new();
        let mut mirror = crate::mirror::CellMirror::new();
        let s1 = make_sheet_id(1);
        storage.add_sheet(&mut mirror, s1, "Sheet1", 10, 5).unwrap();

        // Cell with no formula
        let cell_id = make_cell_id(200);
        storage.set_cell(
            &mut mirror,
            &s1,
            cell_id,
            0,
            0,
            CellValue::Number(FiniteF64::must(42.0)),
            None,
            None,
        );

        let count = update_formula_templates_on_sheet_rename(
            storage.doc(),
            storage.workbook_map(),
            storage.sheets(),
            "Sheet2",
            "Data",
        );
        assert_eq!(count, 0);
    }

    // -------------------------------------------------------------------
    // Test 20: update_formula_templates_on_sheet_rename — formula without cross-sheet ref
    // -------------------------------------------------------------------

    #[test]
    fn test_update_templates_no_cross_sheet_ref() {
        let mut storage = YrsStorage::new();
        let mut mirror = crate::mirror::CellMirror::new();
        let s1 = make_sheet_id(1);
        storage.add_sheet(&mut mirror, s1, "Sheet1", 10, 5).unwrap();

        let cell_id = make_cell_id(300);
        let idf = IdentityFormula {
            template: "SUM({0})".to_string(),
            refs: vec![],
            is_dynamic_array: false,
            is_volatile: false,
            is_aggregate: false,
        };

        storage.set_cell(
            &mut mirror,
            &s1,
            cell_id,
            0,
            0,
            CellValue::Number(FiniteF64::must(10.0)),
            Some("SUM(A1:A10)".to_string()),
            Some(idf),
        );

        let count = update_formula_templates_on_sheet_rename(
            storage.doc(),
            storage.workbook_map(),
            storage.sheets(),
            "Sheet2",
            "Data",
        );
        assert_eq!(count, 0);
    }

    // -------------------------------------------------------------------
    // Test 21: update — multiple cells across multiple sheets
    // -------------------------------------------------------------------

    #[test]
    fn test_update_templates_multiple_cells_across_sheets() {
        let mut storage = YrsStorage::new();
        let mut mirror = crate::mirror::CellMirror::new();
        let s1 = make_sheet_id(1);
        let s2 = make_sheet_id(2);
        let s3 = make_sheet_id(3);
        storage.add_sheet(&mut mirror, s1, "Sheet1", 10, 5).unwrap();
        storage.add_sheet(&mut mirror, s2, "Sheet2", 10, 5).unwrap();
        storage.add_sheet(&mut mirror, s3, "Sheet3", 10, 5).unwrap();

        // Cell in Sheet1 referencing Sheet2
        let c1 = make_cell_id(100);
        storage.set_cell(
            &mut mirror,
            &s1,
            c1,
            0,
            0,
            CellValue::Number(FiniteF64::must(1.0)),
            Some("Sheet2!A1".to_string()),
            Some(IdentityFormula {
                template: "Sheet2!{0}".to_string(),
                refs: vec![],
                is_dynamic_array: false,
                is_volatile: false,
                is_aggregate: false,
            }),
        );

        // Cell in Sheet3 referencing Sheet2
        let c2 = make_cell_id(200);
        storage.set_cell(
            &mut mirror,
            &s3,
            c2,
            0,
            0,
            CellValue::Number(FiniteF64::must(2.0)),
            Some("Sheet2!B2+Sheet2!C3".to_string()),
            Some(IdentityFormula {
                template: "Sheet2!{0}+Sheet2!{1}".to_string(),
                refs: vec![],
                is_dynamic_array: false,
                is_volatile: false,
                is_aggregate: false,
            }),
        );

        // Cell in Sheet2 NOT referencing Sheet2 (local formula)
        let c3 = make_cell_id(300);
        storage.set_cell(
            &mut mirror,
            &s2,
            c3,
            0,
            0,
            CellValue::Number(FiniteF64::must(3.0)),
            Some("SUM(A1:A5)".to_string()),
            Some(IdentityFormula {
                template: "SUM({0})".to_string(),
                refs: vec![],
                is_dynamic_array: false,
                is_volatile: false,
                is_aggregate: false,
            }),
        );

        let count = update_formula_templates_on_sheet_rename(
            storage.doc(),
            storage.workbook_map(),
            storage.sheets(),
            "Sheet2",
            "Revenue",
        );
        assert_eq!(count, 2);

        // Verify c1 was updated
        let (_, f1, idf1) = storage.read_cell_from_yrs(&s1, &c1).unwrap();
        assert_eq!(f1, Some("=Revenue!A1".to_string()));
        assert_eq!(idf1.unwrap().template, "Revenue!{0}");

        // Verify c2 was updated
        let (_, f2, idf2) = storage.read_cell_from_yrs(&s3, &c2).unwrap();
        assert_eq!(f2, Some("=Revenue!B2+Revenue!C3".to_string()));
        assert_eq!(idf2.unwrap().template, "Revenue!{0}+Revenue!{1}");

        // Verify c3 was NOT updated
        let (_, f3, idf3) = storage.read_cell_from_yrs(&s2, &c3).unwrap();
        assert_eq!(f3, Some("=SUM(A1:A5)".to_string()));
        assert_eq!(idf3.unwrap().template, "SUM({0})");
    }

    // -------------------------------------------------------------------
    // Test 22: update — same name is no-op
    // -------------------------------------------------------------------

    #[test]
    fn test_update_templates_same_name() {
        let mut storage = YrsStorage::new();
        let mut mirror = crate::mirror::CellMirror::new();
        let s1 = make_sheet_id(1);
        storage.add_sheet(&mut mirror, s1, "Sheet1", 10, 5).unwrap();

        let count = update_formula_templates_on_sheet_rename(
            storage.doc(),
            storage.workbook_map(),
            storage.sheets(),
            "Sheet1",
            "Sheet1",
        );
        assert_eq!(count, 0);
    }

    // -------------------------------------------------------------------
    // Test 23: update — empty names
    // -------------------------------------------------------------------

    #[test]
    fn test_update_templates_empty_names() {
        let storage = YrsStorage::new();
        assert_eq!(
            update_formula_templates_on_sheet_rename(
                storage.doc(),
                storage.workbook_map(),
                storage.sheets(),
                "",
                "Data"
            ),
            0
        );
        assert_eq!(
            update_formula_templates_on_sheet_rename(
                storage.doc(),
                storage.workbook_map(),
                storage.sheets(),
                "Sheet1",
                ""
            ),
            0
        );
    }

    // -------------------------------------------------------------------
    // Test 24: update — quoted sheet name to unquoted
    // -------------------------------------------------------------------

    #[test]
    fn test_update_templates_quoted_to_unquoted() {
        let mut storage = YrsStorage::new();
        let mut mirror = crate::mirror::CellMirror::new();
        let s1 = make_sheet_id(1);
        let s2 = make_sheet_id(2);
        storage.add_sheet(&mut mirror, s1, "Sheet1", 10, 5).unwrap();
        storage
            .add_sheet(&mut mirror, s2, "My Sheet", 10, 5)
            .unwrap();

        let cell_id = make_cell_id(400);
        storage.set_cell(
            &mut mirror,
            &s1,
            cell_id,
            0,
            0,
            CellValue::Number(FiniteF64::must(5.0)),
            Some("'My Sheet'!A1".to_string()),
            Some(IdentityFormula {
                template: "'My Sheet'!{0}".to_string(),
                refs: vec![],
                is_dynamic_array: false,
                is_volatile: false,
                is_aggregate: false,
            }),
        );

        let count = update_formula_templates_on_sheet_rename(
            storage.doc(),
            storage.workbook_map(),
            storage.sheets(),
            "My Sheet",
            "Data",
        );
        assert_eq!(count, 1);

        let (_, formula, idf) = storage.read_cell_from_yrs(&s1, &cell_id).unwrap();
        assert_eq!(formula, Some("=Data!A1".to_string()));
        assert_eq!(idf.unwrap().template, "Data!{0}");
    }

    // -------------------------------------------------------------------
    // Test 25: update — unquoted to quoted sheet name
    // -------------------------------------------------------------------

    #[test]
    fn test_update_templates_unquoted_to_quoted() {
        let mut storage = YrsStorage::new();
        let mut mirror = crate::mirror::CellMirror::new();
        let s1 = make_sheet_id(1);
        let s2 = make_sheet_id(2);
        storage.add_sheet(&mut mirror, s1, "Sheet1", 10, 5).unwrap();
        storage.add_sheet(&mut mirror, s2, "Data", 10, 5).unwrap();

        let cell_id = make_cell_id(500);
        storage.set_cell(
            &mut mirror,
            &s1,
            cell_id,
            0,
            0,
            CellValue::Number(FiniteF64::must(7.0)),
            Some("Data!A1".to_string()),
            Some(IdentityFormula {
                template: "Data!{0}".to_string(),
                refs: vec![],
                is_dynamic_array: false,
                is_volatile: false,
                is_aggregate: false,
            }),
        );

        let count = update_formula_templates_on_sheet_rename(
            storage.doc(),
            storage.workbook_map(),
            storage.sheets(),
            "Data",
            "My Revenue",
        );
        assert_eq!(count, 1);

        let (_, formula, idf) = storage.read_cell_from_yrs(&s1, &cell_id).unwrap();
        assert_eq!(formula, Some("='My Revenue'!A1".to_string()));
        assert_eq!(idf.unwrap().template, "'My Revenue'!{0}");
    }

    // -------------------------------------------------------------------
    // Test 26: update — no sheets in workbook
    // -------------------------------------------------------------------

    #[test]
    fn test_update_templates_empty_workbook() {
        let storage = YrsStorage::new();
        let count = update_formula_templates_on_sheet_rename(
            storage.doc(),
            storage.workbook_map(),
            storage.sheets(),
            "Sheet1",
            "Data",
        );
        assert_eq!(count, 0);
    }

    // -------------------------------------------------------------------
    // Test 27: replace template with sheet name containing special regex chars
    // -------------------------------------------------------------------

    #[test]
    fn test_replace_template_special_regex_chars() {
        // Sheet name with parentheses and plus sign
        assert_eq!(
            replace_sheet_name_in_template("'Sheet (1)'!{0}", "Sheet (1)", "Data"),
            "Data!{0}"
        );
    }

    // -------------------------------------------------------------------
    // Named-range rename — pure helpers
    // -------------------------------------------------------------------

    #[test]
    fn test_formula_contains_name_ref_simple() {
        assert!(formula_contains_name_ref("MyName+1", "MyName"));
        assert!(formula_contains_name_ref("=MyName", "MyName"));
        assert!(formula_contains_name_ref("SUM(MyName)", "MyName"));
        assert!(formula_contains_name_ref("MyName*2+SalesData", "MyName"));
    }

    #[test]
    fn test_formula_contains_name_ref_word_boundary() {
        // Substring matches must NOT count.
        assert!(!formula_contains_name_ref("SalesData+1", "Data"));
        assert!(!formula_contains_name_ref("MyData_2+1", "Data"));
        assert!(!formula_contains_name_ref("DataPoint", "Data"));
        // But standalone occurrences do.
        assert!(formula_contains_name_ref("Data+1", "Data"));
        assert!(formula_contains_name_ref("=Data", "Data"));
    }

    #[test]
    fn test_formula_contains_name_ref_case_insensitive() {
        // Excel name lookup is case-insensitive.
        assert!(formula_contains_name_ref("MYNAME+1", "MyName"));
        assert!(formula_contains_name_ref("myname+1", "MyName"));
    }

    #[test]
    fn test_replace_name_in_formula_basic() {
        assert_eq!(
            replace_name_in_formula("=MyName+1", "MyName", "NewName"),
            "=NewName+1"
        );
        assert_eq!(
            replace_name_in_formula("SUM(MyName)", "MyName", "Revenue"),
            "SUM(Revenue)"
        );
    }

    #[test]
    fn test_replace_name_in_formula_word_boundary() {
        // Must not corrupt substrings.
        assert_eq!(
            replace_name_in_formula("=SalesData+Data", "Data", "Info"),
            "=SalesData+Info"
        );
        assert_eq!(
            replace_name_in_formula("=MyData_2+Data", "Data", "X"),
            "=MyData_2+X"
        );
    }

    #[test]
    fn test_replace_name_in_formula_multiple_occurrences() {
        // Adjacent occurrences (`Foo+Foo`) must both match — the right
        // boundary char of the first match is the left boundary of the
        // second.
        assert_eq!(
            replace_name_in_formula("=Foo+Foo+Foo", "Foo", "Bar"),
            "=Bar+Bar+Bar"
        );
    }

    #[test]
    fn test_replace_name_in_formula_no_change_on_substring() {
        // No occurrence of the bare name → formula stays untouched.
        assert_eq!(
            replace_name_in_formula("=SalesData+1", "Data", "X"),
            "=SalesData+1"
        );
    }

    #[test]
    fn test_replace_name_in_formula_case_insensitive() {
        assert_eq!(
            replace_name_in_formula("=myname+1", "MyName", "NewName"),
            "=NewName+1"
        );
    }

    // -------------------------------------------------------------------
    // T2 table dependency work — name-rename must NOT touch string literals or sheet
    // prefixes. legacy string-rewrite used a flat regex that corrupted both.
    // -------------------------------------------------------------------

    #[test]
    fn t2_replace_name_skips_string_literal() {
        // `=IF(A1="Region", 1, Region)` must rewrite only the bare
        // `Region` identifier, never the `"Region"` literal.
        assert_eq!(
            replace_name_in_formula("=IF(A1=\"Region\", 1, Region)", "Region", "Sales"),
            "=IF(A1=\"Region\", 1, Sales)"
        );
    }

    #[test]
    fn t2_replace_name_skips_sheet_prefix() {
        // `=Region!A1+Region` — sheet `Region` and named range `Region`
        // collide. The sheet prefix `Region!` must not be rewritten;
        // only the bare `Region` identifier at the end.
        assert_eq!(
            replace_name_in_formula("=Region!A1+Region", "Region", "Sales"),
            "=Region!A1+Sales"
        );
    }

    #[test]
    fn t2_replace_name_skips_quoted_sheet_prefix() {
        // `='Region'!A1+Region` — quoted sheet name `'Region'` followed
        // by `!`. The quoted token must not be rewritten.
        assert_eq!(
            replace_name_in_formula("='Region'!A1+Region", "Region", "Sales"),
            "='Region'!A1+Sales"
        );
    }

    #[test]
    fn t2_replace_name_skips_function_call() {
        // Function names followed by `(` must not be rewritten — even
        // if the function name happens to collide with a defined name.
        // `=Region(A1)` is illegal Excel but represents the family of
        // function-name-collision avoidance.
        //
        // More realistic: `=SUM(Region)` must not rewrite SUM.
        assert_eq!(
            replace_name_in_formula("=SUM(Region)", "SUM", "Total"),
            "=SUM(Region)"
        );
        assert_eq!(
            replace_name_in_formula("=SUM(Region)", "Region", "Sales"),
            "=SUM(Sales)"
        );
    }

    #[test]
    fn t2_replace_name_skips_table_ref() {
        // `Table1[Col]` — `Table1` is a structured table ref, not a
        // named range. Don't rewrite the table identifier.
        assert_eq!(
            replace_name_in_formula("=Region+Table1[Col]", "Table1", "X"),
            "=Region+Table1[Col]"
        );
        // But the named range part still gets rewritten.
        assert_eq!(
            replace_name_in_formula("=Region+Table1[Col]", "Region", "Sales"),
            "=Sales+Table1[Col]"
        );
    }

    #[test]
    fn t2_replace_name_handles_combined_corruption_cases() {
        // The legacy string-rewrite audit's worst case: literal + sheet prefix +
        // bare name in the same formula.
        let src = "=IF(Region!A1=\"Region\", Region, 0)";
        // - `Region!` → sheet prefix, must NOT be rewritten.
        // - `"Region"` → string literal, must NOT be rewritten.
        // - `Region` → bare name, MUST be rewritten.
        let out = replace_name_in_formula(src, "Region", "Sales");
        assert_eq!(out, "=IF(Region!A1=\"Region\", Sales, 0)");
    }

    #[test]
    fn t2_contains_name_ref_skips_string_literal() {
        // `=IF(A1="Region", 1, 2)` does NOT reference the named range
        // `Region` even though the literal contains that text.
        assert!(!formula_contains_name_ref(
            "=IF(A1=\"Region\", 1, 2)",
            "Region"
        ));
    }

    #[test]
    fn t2_contains_name_ref_skips_sheet_prefix() {
        // `=Region!A1` does NOT reference the named range `Region`.
        assert!(!formula_contains_name_ref("=Region!A1", "Region"));
    }

    #[test]
    fn t2_replace_name_no_change_when_only_in_disqualified_positions() {
        // When the name appears ONLY inside disqualified contexts,
        // the formula stays untouched.
        assert_eq!(
            replace_name_in_formula("=\"Region\"+Sheet1!A1", "Region", "Sales"),
            "=\"Region\"+Sheet1!A1"
        );
        assert_eq!(
            replace_name_in_formula("=Region!A1+Region!B2", "Region", "Sales"),
            "=Region!A1+Region!B2"
        );
    }

    #[test]
    fn t2_replace_name_inside_string_with_doubled_quote() {
        // Excel string literals escape internal `"` as `""`. Make sure
        // the scanner doesn't terminate the string at the first `"`.
        assert_eq!(
            replace_name_in_formula("=\"a\"\"Region\"\"b\"+Region", "Region", "Sales"),
            "=\"a\"\"Region\"\"b\"+Sales"
        );
    }
}
