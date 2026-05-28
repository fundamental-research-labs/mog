//! Rewrite external workbook references (`[N]SheetName!Ref`) in formula strings
//! during XLSX import, resolving them to local sheet references when the referenced
//! sheet exists in the same workbook.
//!
//! This module is called once after the full parse is complete (sheets + external_links
//! are both available) and before the `FullParseResult` is assembled.
//!
//! UTF-8 boundary guard: every `&s[n..]` / `&s[..n]` in this file slices
//! formula / external-ref tokens at byte offsets produced by
//! ASCII-only delimiters (`[`, `]`, `!`, digit bytes). Char-boundary
//! by construction. File-scope allow documented here.

#![allow(clippy::string_slice)]

use std::borrow::Cow;
use std::collections::{HashMap, HashSet};
use unicase::UniCase;

use crate::output::results::{DefinedNameOutput, FullParsedSheet};
use domain_types::domain::external_link::ExternalLink;

/// Rewrite all external references across all formula locations in the parse result.
///
/// This is the top-level orchestrator. It builds lookup tables once and applies
/// `rewrite_formula_external_refs()` to every formula string in the parse output.
///
/// Early-exits if `external_links` is empty (no work to do).
pub(crate) fn rewrite_all_external_refs(
    sheets: &mut [FullParsedSheet],
    defined_names: &mut [DefinedNameOutput],
    external_links: &[ExternalLink],
) {
    if external_links.is_empty() {
        return;
    }

    // Build the set of local sheet names (case-insensitive).
    let local_sheet_names: HashSet<UniCase<String>> = sheets
        .iter()
        .map(|s| UniCase::new(s.name.clone()))
        .collect();

    if local_sheet_names.is_empty() {
        return;
    }

    // Build external link index: formula ordinal (1-based string) → metadata for resolution.
    // The `[N]` in formulas is 1-based workbook externalReferences order, not
    // necessarily the externalLink part filename suffix.
    let ext_link_map: HashMap<String, ExtLinkInfo<'_>> = external_links
        .iter()
        .filter_map(|link| {
            let ordinal = link
                .imported_identity
                .as_ref()
                .map(|identity| identity.excel_ordinal)?;
            let is_path_missing = link.file_path_rel_type.as_deref().is_some_and(
                crate::infra::opc::is_missing_external_workbook_path_relationship_type,
            );
            let has_external_path = link.file_path.as_ref().map_or(false, |p| !p.is_empty());
            Some((
                ordinal.to_string(),
                ExtLinkInfo {
                    sheet_names: link.sheet_names.as_slice(),
                    is_path_missing,
                    has_external_path,
                },
            ))
        })
        .collect();

    // --- 1. Cell formulas ---
    for sheet in sheets.iter_mut() {
        for cell in &mut sheet.cells {
            if let Some(ref mut formula) = cell.formula {
                rewrite_in_place(formula, &local_sheet_names, &ext_link_map);
            }
            // Array formulas use the same `formula` field; `array_ref` is just the range string.
        }

        // --- 3. Conditional formatting (full rules) ---
        for cf in &mut sheet.conditional_formatting_full {
            for rule in &mut cf.rules {
                for f in &mut rule.formulas {
                    rewrite_in_place(f, &local_sheet_names, &ext_link_map);
                }
            }
        }

        // --- 4. Data validations ---
        for dv in &mut sheet.data_validations {
            if let Some(ref mut f1) = dv.formula1 {
                rewrite_in_place(f1, &local_sheet_names, &ext_link_map);
            }
            if let Some(ref mut f2) = dv.formula2 {
                rewrite_in_place(f2, &local_sheet_names, &ext_link_map);
            }
        }

        // --- 5 & 6. Table calculated columns and totals row formulas ---
        for table in &mut sheet.tables {
            for col in &mut table.columns {
                if let Some(ref mut f) = col.calculated_column_formula {
                    rewrite_in_place(f, &local_sheet_names, &ext_link_map);
                }
                if let Some(ref mut f) = col.totals_row_formula {
                    rewrite_in_place(f, &local_sheet_names, &ext_link_map);
                }
            }
        }

        // --- 7. Sparkline data ranges ---
        for group in &mut sheet.sparkline_groups {
            for sparkline in &mut group.sparklines {
                rewrite_in_place(&mut sparkline.data_range, &local_sheet_names, &ext_link_map);
            }
        }

        // --- 8. Form controls ---
        for fc in &mut sheet.form_controls {
            if let Some(ref mut f) = fc.fmla_link {
                rewrite_in_place(f, &local_sheet_names, &ext_link_map);
            }
            if let Some(ref mut f) = fc.fmla_range {
                rewrite_in_place(f, &local_sheet_names, &ext_link_map);
            }
            if let Some(ref mut f) = fc.fmla_group {
                rewrite_in_place(f, &local_sheet_names, &ext_link_map);
            }
            if let Some(ref mut f) = fc.fmla_txbx {
                rewrite_in_place(f, &local_sheet_names, &ext_link_map);
            }
        }

        // --- 9. Data table regions ---
        //
        // Typed data-table input refs: `row_input_ref` / `col_input_ref` are now typed
        // `Option<CellRef>`. XLSX `<f t="dataTable">` r1/r2 attributes are
        // always sheet-local single-cell refs (the underlying scheduler
        // assumes the same sheet as the region itself), so external-ref
        // rewriting is a no-op for this slot — there is no `[N]Sheet!Cell`
        // form to rewrite. The rewrite block is dropped, not skipped.

        // --- 10 & 11. ChartEx formulas ---
        rewrite_chart_ex_external_refs(
            &mut sheet.parsed_chart_ex,
            &local_sheet_names,
            &ext_link_map,
        );
    }

    // --- 2. Defined names ---
    for dn in defined_names.iter_mut() {
        rewrite_in_place(&mut dn.refers_to, &local_sheet_names, &ext_link_map);
    }
}

/// Rewrite a formula string in place if it contains external references.
fn rewrite_in_place(
    formula: &mut String,
    local_sheets: &HashSet<UniCase<String>>,
    ext_links: &HashMap<String, ExtLinkInfo<'_>>,
) {
    match rewrite_formula_external_refs(formula, local_sheets, ext_links) {
        Cow::Borrowed(_) => {} // no change
        Cow::Owned(new) => *formula = new,
    }
}

/// Rewrite ChartEx formula references in all parsed ChartEx parts.
fn rewrite_chart_ex_external_refs(
    chart_ex_parts: &mut [crate::output::results::ParsedChartEx],
    local_sheets: &HashSet<UniCase<String>>,
    ext_links: &HashMap<String, ExtLinkInfo<'_>>,
) {
    use ooxml_types::chart_ex::ChartExDimension;

    for part in chart_ex_parts.iter_mut() {
        let mut changed = false;
        // Dimension formulas: chart_space.chart_data.data[*].dimensions[*]
        for data in &mut part.chart_space.chart_data.data {
            for dim in &mut data.dimensions {
                match dim {
                    ChartExDimension::String { formula, .. }
                    | ChartExDimension::Numeric { formula, .. } => {
                        let before = formula.content.clone();
                        rewrite_in_place(&mut formula.content, local_sheets, ext_links);
                        changed |= formula.content != before;
                    }
                }
            }
        }

        // Title formula: chart_space.chart.title.tx.tx_data.formula
        if let Some(ref mut title) = part.chart_space.chart.title {
            if let Some(ref mut tx) = title.tx {
                if let Some(ref mut tx_data) = tx.tx_data {
                    if let Some(ref mut f) = tx_data.formula {
                        let before = f.clone();
                        rewrite_in_place(f, local_sheets, ext_links);
                        changed |= *f != before;
                    }
                }
            }
        }

        if changed {
            part.original_xml.clear();
        }
    }
}

/// Rewrite external workbook references in a single formula string.
///
/// Scans `formula` for `[N]SheetName!` or `[Filename.xlsx]SheetName!` patterns and
/// replaces them with `SheetName!` when the sheet exists in `local_sheets`.
///
/// Returns `Cow::Borrowed` when no `[` is present (zero allocation fast path).
pub(crate) fn rewrite_formula_external_refs<'a>(
    formula: &'a str,
    local_sheets: &HashSet<UniCase<String>>,
    ext_links: &HashMap<String, ExtLinkInfo<'_>>,
) -> Cow<'a, str> {
    // Fast path: no bracket at all.
    if !formula.contains('[') {
        return Cow::Borrowed(formula);
    }

    let bytes = formula.as_bytes();
    let len = bytes.len();
    let mut result = String::with_capacity(formula.len());
    let mut i = 0;

    while i < len {
        let b = bytes[i];

        // Skip string literals.
        if b == b'"' {
            let start = i;
            i += 1;
            while i < len {
                if bytes[i] == b'"' {
                    i += 1;
                    // Excel doubles quotes inside strings.
                    if i < len && bytes[i] == b'"' {
                        i += 1;
                        continue;
                    }
                    break;
                }
                i += 1;
            }
            result.push_str(&formula[start..i]);
            continue;
        }

        // Handle quoted external ref: '[1]Sheet Name'!A1
        // The quote wraps the entire [N]SheetName construct.
        if b == b'\'' {
            // Check if next char is '['
            if i + 1 < len && bytes[i + 1] == b'[' {
                if let Some((replacement, consumed)) =
                    try_rewrite_quoted_external_ref(formula, i, local_sheets, ext_links)
                {
                    result.push_str(&replacement);
                    i += consumed;
                    continue;
                }
            }
            // Not an external ref pattern — just copy the character.
            result.push('\'');
            i += 1;
            continue;
        }

        // Unquoted external ref: [1]Sheet1!A1 or [Book.xlsx]Sheet1!A1
        if b == b'[' {
            // Skip R1C1 relative addressing: R[1]C[2]
            if i > 0
                && (bytes[i - 1] == b'R'
                    || bytes[i - 1] == b'r'
                    || bytes[i - 1] == b'C'
                    || bytes[i - 1] == b'c')
            {
                result.push('[');
                i += 1;
                continue;
            }

            if let Some((replacement, consumed)) =
                try_rewrite_unquoted_external_ref(formula, i, local_sheets, ext_links)
            {
                result.push_str(&replacement);
                i += consumed;
                continue;
            }

            // Not a valid external ref — copy as-is.
            result.push('[');
            i += 1;
            continue;
        }

        // Advance by full UTF-8 character to avoid splitting multi-byte sequences.
        if let Some(ch) = formula[i..].chars().next() {
            result.push(ch);
            i += ch.len_utf8();
        } else {
            i += 1;
        }
    }

    // If result is identical to input, return borrowed (shouldn't happen since we only
    // get here if formula contains '[', but be safe).
    if result == formula {
        Cow::Borrowed(formula)
    } else {
        Cow::Owned(result)
    }
}

/// Try to rewrite an unquoted external ref starting at `pos` (which points to `[`).
///
/// Pattern: `[N]SheetName!` or `[Filename.xlsx]SheetName!`
///
/// Returns `(replacement_text, chars_consumed)` if successfully rewritten or kept intact,
/// or `None` if this isn't a valid external ref pattern.
fn try_rewrite_unquoted_external_ref(
    formula: &str,
    pos: usize,
    local_sheets: &HashSet<UniCase<String>>,
    ext_links: &HashMap<String, ExtLinkInfo<'_>>,
) -> Option<(String, usize)> {
    let bytes = formula.as_bytes();
    let len = bytes.len();

    // Find closing bracket.
    let bracket_start = pos + 1;
    let mut j = bracket_start;
    while j < len && bytes[j] != b']' {
        if bytes[j] == b'[' {
            // Nested brackets — malformed, bail.
            return None;
        }
        j += 1;
    }
    if j >= len {
        return None; // No closing bracket.
    }

    let bracket_content = &formula[bracket_start..j];
    if bracket_content.is_empty() {
        return None; // Empty brackets [].
    }

    let after_bracket = j + 1; // Position after ']'

    // Extract sheet name: everything from after ']' to '!'
    // The sheet name is unquoted here, so it cannot contain special characters.
    let mut k = after_bracket;
    while k < len && bytes[k] != b'!' {
        // If we hit certain delimiters, this isn't a sheet reference.
        if bytes[k] == b','
            || bytes[k] == b')'
            || bytes[k] == b'+'
            || bytes[k] == b'-'
            || bytes[k] == b'*'
            || bytes[k] == b'/'
            || bytes[k] == b'('
            || bytes[k] == b' '
        {
            return None;
        }
        k += 1;
    }
    if k >= len || k == after_bracket {
        return None; // No '!' found or empty sheet name.
    }

    let sheet_name = &formula[after_bracket..k];
    let consumed = k + 1 - pos; // Include the '!'

    // Check if we can resolve this to a local sheet.
    if should_resolve(bracket_content, sheet_name, local_sheets, ext_links) {
        // Resolved: emit SheetName! (without the [N] prefix).
        // If the sheet name needs quoting (contains spaces, etc.), add quotes.
        let ref_after_excl = &formula[k + 1..]; // not consumed, just for the check
        let _ = ref_after_excl;
        let mut out = String::new();
        if needs_quoting(sheet_name) {
            out.push('\'');
            out.push_str(sheet_name);
            out.push('\'');
        } else {
            out.push_str(sheet_name);
        }
        out.push('!');
        Some((out, consumed))
    } else {
        // Not resolved: emit original text verbatim.
        let original = &formula[pos..pos + consumed];
        Some((original.to_string(), consumed))
    }
}

/// Try to rewrite a quoted external ref starting at `pos` (which points to `'`).
///
/// Pattern: `'[N]Sheet Name'!` or `'[Filename.xlsx]Sheet Name'!`
///
/// Returns `(replacement_text, chars_consumed)` if successfully rewritten or kept intact,
/// or `None` if this isn't a valid external ref pattern.
fn try_rewrite_quoted_external_ref(
    formula: &str,
    pos: usize,
    local_sheets: &HashSet<UniCase<String>>,
    ext_links: &HashMap<String, ExtLinkInfo<'_>>,
) -> Option<(String, usize)> {
    let bytes = formula.as_bytes();
    let len = bytes.len();

    // pos is at opening quote, pos+1 should be '['
    debug_assert!(bytes[pos] == b'\'');
    debug_assert!(pos + 1 < len && bytes[pos + 1] == b'[');

    // Find closing bracket.
    let bracket_start = pos + 2;
    let mut j = bracket_start;
    while j < len && bytes[j] != b']' {
        if bytes[j] == b'[' {
            return None; // Nested brackets.
        }
        j += 1;
    }
    if j >= len {
        return None;
    }

    let bracket_content = &formula[bracket_start..j];
    if bracket_content.is_empty() {
        return None;
    }

    let after_bracket = j + 1;

    // Find closing quote. The sheet name is between ']' and "'".
    // Handle escaped quotes ('') within the sheet name.
    let mut k = after_bracket;
    while k < len {
        if bytes[k] == b'\'' {
            // Check for escaped quote ('').
            if k + 1 < len && bytes[k + 1] == b'\'' {
                k += 2;
                continue;
            }
            break;
        }
        k += 1;
    }
    if k >= len {
        return None; // No closing quote.
    }

    let sheet_name = &formula[after_bracket..k];
    if sheet_name.is_empty() {
        return None;
    }

    // After closing quote, we expect '!'.
    let after_quote = k + 1;
    if after_quote >= len || bytes[after_quote] != b'!' {
        return None;
    }

    let consumed = after_quote + 1 - pos; // From opening quote through '!'

    // Unescape the sheet name for matching (replace '' with ').
    let unescaped_name = if sheet_name.contains("''") {
        sheet_name.replace("''", "'")
    } else {
        sheet_name.to_string()
    };

    if should_resolve(bracket_content, &unescaped_name, local_sheets, ext_links) {
        // Resolved: emit 'SheetName'! or SheetName! depending on whether quoting is needed.
        let mut out = String::new();
        if needs_quoting(&unescaped_name) {
            out.push('\'');
            // Re-escape single quotes in the sheet name.
            out.push_str(&unescaped_name.replace('\'', "''"));
            out.push('\'');
        } else {
            out.push_str(&unescaped_name);
        }
        out.push('!');
        Some((out, consumed))
    } else {
        // Not resolved: emit original verbatim.
        let original = &formula[pos..pos + consumed];
        Some((original.to_string(), consumed))
    }
}

/// Metadata about an external link needed for resolution decisions.
#[derive(Debug)]
pub(crate) struct ExtLinkInfo<'a> {
    pub sheet_names: &'a [String],
    /// True when the relationship type is `xlPathMissing` (path to external workbook is broken).
    pub is_path_missing: bool,
    /// True when the external link has a non-empty file path (points to a different workbook).
    pub has_external_path: bool,
}

/// Determine whether an external reference should be resolved to a local sheet.
///
/// `bracket_content` is the text between `[` and `]` (e.g., `"1"` or `"Book1.xlsx"`).
/// `sheet_name` is the sheet name after the bracket (already unescaped).
fn should_resolve(
    bracket_content: &str,
    sheet_name: &str,
    local_sheets: &HashSet<UniCase<String>>,
    ext_links: &HashMap<String, ExtLinkInfo<'_>>,
) -> bool {
    let sheet_key = UniCase::new(sheet_name.to_string());

    // First check: does this sheet exist locally?
    if !local_sheets.contains(&sheet_key) {
        return false;
    }

    // Numeric index: [1], [2], etc. — look up the external link's metadata.
    if bracket_content.chars().all(|c| c.is_ascii_digit()) {
        if let Some(info) = ext_links.get(bracket_content) {
            // Never resolve when the external workbook path is missing — these are
            // genuinely broken external references that should stay as #REF!.
            if info.is_path_missing {
                return false;
            }
            // Don't resolve when the link points to a different workbook, even if
            // it happens to share a sheet name with the local workbook.
            if info.has_external_path {
                return false;
            }
            // Self-reference (no external path): resolve if the sheet name matches.
            if info.sheet_names.is_empty() {
                // No sheet metadata — be conservative and don't resolve.
                return false;
            }
            let matches_external = info
                .sheet_names
                .iter()
                .any(|s| UniCase::new(s.as_str()) == UniCase::new(sheet_name));
            return matches_external;
        }
        // No external link metadata for this index — be conservative and don't resolve,
        // since we can't confirm this is a self-reference.
        return false;
    }

    // Filename syntax: [Book1.xlsx], [Budget.xlsx], etc.
    // These reference a specific external workbook. Even if a sheet with the same
    // name exists locally, we can't be sure it's the same data. Don't resolve.
    false
}

/// Check whether a sheet name requires quoting in A1-style references.
///
/// Sheet names need quoting if they contain spaces, special characters, or
/// could be confused with cell references.
fn needs_quoting(name: &str) -> bool {
    if name.is_empty() {
        return true;
    }
    // If it contains any characters that aren't alphanumeric, underscore, or period,
    // it needs quoting.
    name.bytes()
        .any(|b| !b.is_ascii_alphanumeric() && b != b'_' && b != b'.')
}

// =============================================================================
// Tests
// =============================================================================

#[cfg(test)]
mod tests {
    use super::*;

    fn make_local_sheets(names: &[&str]) -> HashSet<UniCase<String>> {
        names.iter().map(|n| UniCase::new(n.to_string())).collect()
    }

    /// Test helper: stores owned sheet-name data alongside the borrow map.
    struct ExtLinks {
        // (id, sheet_names, is_path_missing, has_external_path)
        _storage: Vec<(String, Vec<String>, bool, bool)>,
    }

    impl ExtLinks {
        /// Create self-reference ext links (no external path).
        fn new(entries: &[(&str, &[&str])]) -> Self {
            let storage = entries
                .iter()
                .map(|(id, sheets)| {
                    (
                        id.to_string(),
                        sheets.iter().map(|s| s.to_string()).collect(),
                        false, // is_path_missing
                        false, // has_external_path (self-reference)
                    )
                })
                .collect();
            ExtLinks { _storage: storage }
        }

        /// Create ext links pointing to different workbooks.
        fn new_external(entries: &[(&str, &[&str])]) -> Self {
            let storage = entries
                .iter()
                .map(|(id, sheets)| {
                    (
                        id.to_string(),
                        sheets.iter().map(|s| s.to_string()).collect(),
                        false, // is_path_missing
                        true,  // has_external_path (different workbook)
                    )
                })
                .collect();
            ExtLinks { _storage: storage }
        }

        fn new_with_missing(entries: &[(&str, &[&str], bool)]) -> Self {
            let storage = entries
                .iter()
                .map(|(id, sheets, missing)| {
                    (
                        id.to_string(),
                        sheets.iter().map(|s| s.to_string()).collect(),
                        *missing,
                        false, // has_external_path
                    )
                })
                .collect();
            ExtLinks { _storage: storage }
        }

        fn as_map(&self) -> HashMap<String, ExtLinkInfo<'_>> {
            self._storage
                .iter()
                .map(|(id, sheets, missing, external)| {
                    (
                        id.clone(),
                        ExtLinkInfo {
                            sheet_names: sheets.as_slice(),
                            is_path_missing: *missing,
                            has_external_path: *external,
                        },
                    )
                })
                .collect()
        }
    }

    // --- Resolution tests ---

    #[test]
    fn simple_numeric_ref() {
        let locals = make_local_sheets(&["Sheet1"]);
        let el = ExtLinks::new(&[("1", &["Sheet1"])]);
        let result = rewrite_formula_external_refs("[1]Sheet1!A1", &locals, &el.as_map());
        assert_eq!(result, "Sheet1!A1");
    }

    #[test]
    fn quoted_sheet_with_space() {
        let locals = make_local_sheets(&["My Sheet"]);
        let el = ExtLinks::new(&[("1", &["My Sheet"])]);
        let result = rewrite_formula_external_refs("'[1]My Sheet'!A1", &locals, &el.as_map());
        assert_eq!(result, "'My Sheet'!A1");
    }

    #[test]
    fn absolute_addressing() {
        let locals = make_local_sheets(&["Data"]);
        let el = ExtLinks::new(&[("1", &["Data"])]);
        let result = rewrite_formula_external_refs("[1]Data!$A$1", &locals, &el.as_map());
        assert_eq!(result, "Data!$A$1");
    }

    #[test]
    fn multiple_refs_both_resolved() {
        let locals = make_local_sheets(&["Data", "Other"]);
        let el = ExtLinks::new(&[("1", &["Data"]), ("2", &["Other"])]);
        let result =
            rewrite_formula_external_refs("=SUM([1]Data!A1,[2]Other!B1)", &locals, &el.as_map());
        assert_eq!(result, "=SUM(Data!A1,Other!B1)");
    }

    #[test]
    fn partial_resolution() {
        let locals = make_local_sheets(&["Data"]);
        let el = ExtLinks::new(&[("1", &["Data"]), ("2", &["Missing"])]);
        let result =
            rewrite_formula_external_refs("=SUM([1]Data!A1,[2]Missing!B1)", &locals, &el.as_map());
        assert_eq!(result, "=SUM(Data!A1,[2]Missing!B1)");
    }

    // --- Non-resolution tests ---

    #[test]
    fn no_local_match() {
        let locals = make_local_sheets(&["Sheet1"]);
        let el = ExtLinks::new(&[("1", &["Other"])]);
        let result = rewrite_formula_external_refs("[1]Other!A1", &locals, &el.as_map());
        assert_eq!(result, "[1]Other!A1");
    }

    #[test]
    fn r1c1_pattern_skipped() {
        let locals = make_local_sheets(&["Sheet1"]);
        let el = ExtLinks::new(&[]);
        let result = rewrite_formula_external_refs("R[1]C[2]", &locals, &el.as_map());
        assert_eq!(result, "R[1]C[2]");
    }

    #[test]
    fn string_literal_untouched() {
        let locals = make_local_sheets(&["Sheet1"]);
        let el = ExtLinks::new(&[("1", &["Sheet1"])]);
        let result = rewrite_formula_external_refs("=\"[1]Sheet1!A1\"", &locals, &el.as_map());
        assert_eq!(result, "=\"[1]Sheet1!A1\"");
    }

    #[test]
    fn no_bracket_zero_alloc() {
        let locals = make_local_sheets(&["Sheet1"]);
        let el = ExtLinks::new(&[]);
        let result = rewrite_formula_external_refs("=SUM(A1:A10)", &locals, &el.as_map());
        assert!(matches!(result, Cow::Borrowed(_)));
        assert_eq!(result, "=SUM(A1:A10)");
    }

    // --- Filename syntax ---

    #[test]
    fn filename_syntax_not_resolved() {
        // Filename syntax references a specific external workbook — don't resolve
        // even if a sheet with the same name exists locally.
        let locals = make_local_sheets(&["Data"]);
        let el = ExtLinks::new(&[]);
        let result = rewrite_formula_external_refs("[Book1.xlsx]Data!A1", &locals, &el.as_map());
        assert_eq!(result, "[Book1.xlsx]Data!A1");
    }

    // --- Case insensitivity ---

    #[test]
    fn case_insensitive_match() {
        let locals = make_local_sheets(&["Data"]);
        let el = ExtLinks::new(&[("1", &["data"])]);
        let result = rewrite_formula_external_refs("[1]data!A1", &locals, &el.as_map());
        assert_eq!(result, "data!A1");
    }

    // --- Edge cases ---

    #[test]
    fn empty_brackets() {
        let locals = make_local_sheets(&["Sheet1"]);
        let el = ExtLinks::new(&[]);
        let result = rewrite_formula_external_refs("[]Sheet1!A1", &locals, &el.as_map());
        // Empty bracket content — not a valid external ref, passes through.
        assert_eq!(result, "[]Sheet1!A1");
    }

    #[test]
    fn quoted_with_escaped_quote_in_name() {
        let locals = make_local_sheets(&["John's Sheet"]);
        let el = ExtLinks::new(&[("1", &["John's Sheet"])]);
        let result = rewrite_formula_external_refs("'[1]John''s Sheet'!A1", &locals, &el.as_map());
        assert_eq!(result, "'John''s Sheet'!A1");
    }

    #[test]
    fn ccm_gaap_real_world() {
        // From the privateco_turn6 benchmark.
        let locals = make_local_sheets(&["CCM-GAAP", "Public Comps"]);
        let el = ExtLinks::new(&[("1", &["CCM-GAAP"]), ("2", &["Public Comps"])]);
        let ext = el.as_map();

        let r1 = rewrite_formula_external_refs("'[1]CCM-GAAP'!$B$3", &locals, &ext);
        assert_eq!(r1, "'CCM-GAAP'!$B$3");

        let r2 = rewrite_formula_external_refs("'[2]Public Comps'!B8", &locals, &ext);
        assert_eq!(r2, "'Public Comps'!B8");
    }

    #[test]
    fn formula_with_mixed_content() {
        let locals = make_local_sheets(&["Data"]);
        let el = ExtLinks::new(&[("1", &["Data"])]);
        let result = rewrite_formula_external_refs(
            "=IF([1]Data!A1>0,[1]Data!B1,\"[1]Data!C1\")",
            &locals,
            &el.as_map(),
        );
        assert_eq!(result, "=IF(Data!A1>0,Data!B1,\"[1]Data!C1\")");
    }

    #[test]
    fn quoted_sheet_with_hyphen() {
        // Sheet names with hyphens are always quoted in real XLSX files.
        let locals = make_local_sheets(&["Sheet-Name"]);
        let el = ExtLinks::new(&[("1", &["Sheet-Name"])]);
        let result = rewrite_formula_external_refs("'[1]Sheet-Name'!A1", &locals, &el.as_map());
        assert_eq!(result, "'Sheet-Name'!A1");
    }

    // --- xlPathMissing tests ---

    #[test]
    fn xl_path_missing_not_resolved() {
        // External links with xlPathMissing are genuinely broken — never resolve,
        // even if a local sheet has the same name.
        let locals = make_local_sheets(&["2-CashFlow"]);
        let el = ExtLinks::new_with_missing(&[("22", &[], true)]);
        let result = rewrite_formula_external_refs("'[22]2-CashFlow'!E24", &locals, &el.as_map());
        assert_eq!(result, "'[22]2-CashFlow'!E24");
    }

    #[test]
    fn xl_path_missing_with_sheet_names_not_resolved() {
        // Even if the external link has sheet_names matching local sheets,
        // xlPathMissing means the path is broken.
        let locals = make_local_sheets(&["Sheet1"]);
        let el = ExtLinks::new_with_missing(&[("1", &["Sheet1"], true)]);
        let result = rewrite_formula_external_refs("[1]Sheet1!A1", &locals, &el.as_map());
        assert_eq!(result, "[1]Sheet1!A1");
    }

    #[test]
    fn no_metadata_not_resolved() {
        // When there's no external link metadata for the index, be conservative.
        let locals = make_local_sheets(&["Sheet1"]);
        let el = ExtLinks::new(&[]);
        let result = rewrite_formula_external_refs("[99]Sheet1!A1", &locals, &el.as_map());
        assert_eq!(result, "[99]Sheet1!A1");
    }

    #[test]
    fn empty_sheet_names_not_resolved() {
        // External link exists but has no sheet_names — can't confirm self-reference.
        let locals = make_local_sheets(&["Sheet1"]);
        let el = ExtLinks::new(&[("1", &[])]);
        let result = rewrite_formula_external_refs("[1]Sheet1!A1", &locals, &el.as_map());
        assert_eq!(result, "[1]Sheet1!A1");
    }

    // --- Bug-reproducing tests: external refs with matching local sheet names ---

    #[test]
    fn bug_external_ref_same_sheet_name_different_workbook() {
        // BUG: External link #1 points to a DIFFERENT workbook ("2025.12.001 Stock Report.xlsx")
        // that happens to have a sheet named "Coversheet". The resolver incorrectly assumes
        // matching sheet names means self-reference and strips the [1] prefix.
        // The external ref should be KEPT because [1] is a different workbook.
        let locals = make_local_sheets(&["Coversheet"]);
        let el = ExtLinks::new_external(&[("1", &["Coversheet"])]);
        let result = rewrite_formula_external_refs("[1]Coversheet!$J$10", &locals, &el.as_map());
        assert_eq!(
            result, "[1]Coversheet!$J$10",
            "External ref to different workbook should NOT be resolved to local sheet"
        );
    }

    #[test]
    fn bug_external_ref_resolves_to_shorter_local_sheet() {
        // BUG: External link #14 points to a different workbook whose RentRoll sheet
        // has ~200 rows. Local RentRoll only has ~71 rows. The resolver strips [14],
        // causing $E$198 to reference a non-existent row locally -> returns 0 -> #DIV/0!.
        // The external ref should be KEPT to use the cached external value.
        let locals = make_local_sheets(&["RentRoll"]);
        let el = ExtLinks::new_external(&[("14", &["RentRoll"])]);
        let result = rewrite_formula_external_refs("[14]RentRoll!$E$198", &locals, &el.as_map());
        assert_eq!(
            result, "[14]RentRoll!$E$198",
            "External ref to different workbook should NOT be resolved to local sheet"
        );
    }

    #[test]
    fn bug_external_ref_quoted_same_sheet_name() {
        // Same bug as above but with quoted syntax (sheet name contains space).
        // External workbook has "General Assumptions" sheet, and so does the local workbook.
        // The external ref should be KEPT because [3] is a different workbook.
        let locals = make_local_sheets(&["General Assumptions"]);
        let el = ExtLinks::new_external(&[("3", &["General Assumptions"])]);
        let result =
            rewrite_formula_external_refs("'[3]General Assumptions'!$F$10", &locals, &el.as_map());
        assert_eq!(
            result, "'[3]General Assumptions'!$F$10",
            "External ref to different workbook should NOT be resolved to local sheet"
        );
    }

    // --- UTF-8 double-encoding bug tests ---
    // BUG (line 283): `result.push(b as char)` casts each UTF-8 byte to a char
    // independently. For multi-byte sequences this produces mojibake because each
    // byte 0x80..0xFF becomes its own U+0080..U+00FF codepoint.

    #[test]
    fn bug_utf8_pound_sign_in_table_ref() {
        // Structured table ref with non-ASCII column name. The formula contains '['
        // (from the table column ref), so the byte-level loop is entered.
        // BUG: £ (U+00A3, bytes C2 A3) gets corrupted because each UTF-8 byte is
        // cast to char independently on line 283: `result.push(b as char)`.
        let locals = make_local_sheets(&["Data"]);
        let el = ExtLinks::new(&[("1", &["Data"])]);
        let result =
            rewrite_formula_external_refs("=[1]Data!A1+Table1[UK RRP in £]", &locals, &el.as_map());
        assert_eq!(
            result, "=Data!A1+Table1[UK RRP in £]",
            "Non-ASCII chars must be preserved through the rewriter"
        );
    }

    #[test]
    fn bug_utf8_euro_sign_after_external_ref() {
        // Euro sign € (U+20AC) is 3 UTF-8 bytes: [0xE2, 0x82, 0xAC].
        // BUG: Each byte becomes its own char via `result.push(b as char)` on line 283.
        let locals = make_local_sheets(&["Sheet1"]);
        let el = ExtLinks::new(&[]);
        // [Book.xlsx] is filename syntax (not resolved), but triggers the byte loop.
        let result = rewrite_formula_external_refs(
            "=[Book.xlsx]Sheet1!A1*\u{20AC}Rate",
            &locals,
            &el.as_map(),
        );
        assert_eq!(
            result, "=[Book.xlsx]Sheet1!A1*\u{20AC}Rate",
            "Non-ASCII chars must be preserved through the rewriter"
        );
    }

    #[test]
    fn bug_utf8_cjk_character_corrupted() {
        // CJK character 中 (U+4E2D) is 3 UTF-8 bytes: [0xE4, 0xB8, 0xAD].
        // BUG: Each byte becomes its own char via `result.push(b as char)` on line 283.
        let locals = make_local_sheets(&["Sheet1"]);
        let el = ExtLinks::new(&[("1", &["Sheet1"])]);
        let result =
            rewrite_formula_external_refs("=[1]Sheet1!A1+\u{4E2D}\u{56FD}", &locals, &el.as_map());
        assert_eq!(
            result, "=Sheet1!A1+\u{4E2D}\u{56FD}",
            "Non-ASCII chars must be preserved through the rewriter"
        );
    }

    // --- Orchestrator tests ---

    #[test]
    fn rewrite_all_skips_when_no_external_links() {
        let mut sheets: Vec<FullParsedSheet> = Vec::new();
        let mut defined_names: Vec<DefinedNameOutput> = Vec::new();
        let external_links: Vec<ExternalLink> = Vec::new();
        // Should return immediately without error.
        rewrite_all_external_refs(&mut sheets, &mut defined_names, &external_links);
    }
}
