use super::*;

// -------------------------------------------------------------------
// Regex Search
// -------------------------------------------------------------------

pub(in crate::storage::engine) fn regex_search(
    engine: &crate::storage::engine::YrsComputeEngine,
    sheet_id: &SheetId,
    options: RegexSearchOptions,
) -> RegexSearchResult {
    let case_insensitive = !options.case_sensitive.unwrap_or(false);
    let whole_cell = options.whole_cell.unwrap_or(false);
    let include_formulas = options.include_formulas.unwrap_or(false);

    // 1. Compile patterns with regex crate
    let mut compiled = Vec::new();
    let mut errors = Vec::new();
    for pattern in &options.patterns {
        let mut p = pattern.clone();
        if case_insensitive {
            p = format!("(?i){}", p);
        }
        if whole_cell {
            p = format!("^(?:{})$", p);
        }
        match regex::Regex::new(&p) {
            Ok(re) => compiled.push((pattern.clone(), re)),
            Err(e) => errors.push(format!("Pattern '{}': {}", pattern, e)),
        }
    }

    let sheet_name = get_sheet_name(&engine.stores, sheet_id).unwrap_or_default();

    if compiled.is_empty() {
        return RegexSearchResult {
            matches: vec![],
            errors,
        };
    }

    // 2. Get data bounds and clamp to optional range constraint
    let bounds = match get_data_bounds(&engine.stores, &engine.mirror, sheet_id) {
        Some(b) => b,
        None => {
            return RegexSearchResult {
                matches: vec![],
                errors,
            };
        }
    };

    let min_row = options
        .start_row
        .map_or(bounds.min_row, |r| r.max(bounds.min_row));
    let min_col = options
        .start_col
        .map_or(bounds.min_col, |c| c.max(bounds.min_col));
    let max_row = options
        .end_row
        .map_or(bounds.max_row, |r| r.min(bounds.max_row));
    let max_col = options
        .end_col
        .map_or(bounds.max_col, |c| c.min(bounds.max_col));

    // 3. Iterate cells using shared visitor
    let mut matches = Vec::new();

    for_each_cell_in_range(
        engine,
        sheet_id,
        min_row,
        min_col,
        max_row,
        max_col,
        false, // skip format-only cells
        &mut |visit| {
            // Test formatted display string against patterns
            for (original_pattern, re) in &compiled {
                if re.is_match(&visit.formatted) {
                    matches.push(RegexSearchMatch {
                        row: visit.row,
                        col: visit.col,
                        address: crate::range_manager::pos_to_a1(visit.row, visit.col),
                        sheet_name: sheet_name.clone(),
                        value: visit.formatted.clone(),
                        matched_pattern: original_pattern.clone(),
                    });
                    return; // one match per cell (first pattern wins)
                }
            }

            // Optionally test formula text
            if include_formulas && let Some(ref formula) = visit.formula {
                for (original_pattern, re) in &compiled {
                    if re.is_match(formula) {
                        matches.push(RegexSearchMatch {
                            row: visit.row,
                            col: visit.col,
                            address: crate::range_manager::pos_to_a1(visit.row, visit.col),
                            sheet_name: sheet_name.clone(),
                            value: visit.formatted.clone(),
                            matched_pattern: original_pattern.clone(),
                        });
                        return;
                    }
                }
            }
        },
    );

    RegexSearchResult { matches, errors }
}

// -------------------------------------------------------------------
// Sign Check
// -------------------------------------------------------------------

pub(in crate::storage::engine) fn sign_check(
    engine: &crate::storage::engine::YrsComputeEngine,
    sheet_id: &SheetId,
    start_row: u32,
    start_col: u32,
    end_row: u32,
    end_col: u32,
    options: SignCheckOptions,
) -> SignCheckResult {
    use std::collections::BTreeMap;

    let axis = options.axis.as_deref().unwrap_or("column");
    let window = options.window.unwrap_or(3) as usize;

    // Pass 1: Collect all non-zero numeric cell values in the range.
    let mut cells: BTreeMap<(u32, u32), f64> = BTreeMap::new();

    for_each_cell_in_range(
        engine,
        sheet_id,
        start_row,
        start_col,
        end_row,
        end_col,
        false,
        &mut |visit| {
            if let Some(num) = visit.value.as_number()
                && num != 0.0
            {
                cells.insert((visit.row, visit.col), num);
            }
        },
    );

    let cells_checked = cells.len() as u32;

    // Pass 2: For each cell, find neighbors and compute disagreement.
    let mut anomalies = Vec::new();

    for (&(row, col), &value) in &cells {
        let mut neighbors: Vec<(u32, u32, f64)> = Vec::new();

        if axis == "column" || axis == "both" {
            // Collect cells in the same column, sorted by row distance.
            let mut col_cells: Vec<(u32, f64)> = cells
                .iter()
                .filter(|&(&(r, c), _)| c == col && r != row)
                .map(|(&(r, _), &v)| (r, v))
                .collect();
            col_cells.sort_by_key(|&(r, _)| row.abs_diff(r));

            // Take up to `window` before and `window` after.
            let mut before = 0usize;
            let mut after = 0usize;
            for (r, v) in &col_cells {
                if *r < row && before < window {
                    neighbors.push((*r, col, *v));
                    before += 1;
                } else if *r > row && after < window {
                    neighbors.push((*r, col, *v));
                    after += 1;
                }
                if before >= window && after >= window {
                    break;
                }
            }
        }

        if axis == "row" || axis == "both" {
            // Collect cells in the same row, sorted by column distance.
            let mut row_cells: Vec<(u32, f64)> = cells
                .iter()
                .filter(|&(&(r, c), _)| r == row && c != col)
                .map(|(&(_, c), &v)| (c, v))
                .collect();
            row_cells.sort_by_key(|&(c, _)| col.abs_diff(c));

            let mut before = 0usize;
            let mut after = 0usize;
            for (c, v) in &row_cells {
                if *c < col && before < window {
                    neighbors.push((row, *c, *v));
                    before += 1;
                } else if *c > col && after < window {
                    neighbors.push((row, *c, *v));
                    after += 1;
                }
                if before >= window && after >= window {
                    break;
                }
            }
        }

        if neighbors.is_empty() {
            continue;
        }

        let cell_positive = value > 0.0;
        let disagree_count = neighbors
            .iter()
            .filter(|&&(_, _, v)| (v > 0.0) != cell_positive)
            .count();
        let disagreement = disagree_count as f64 / neighbors.len() as f64;

        if disagreement > 0.5 {
            // `value` and neighbor `v` come from `CellValue::Number`'s inner
            // `FiniteF64`, so they are finite by construction — `must` is
            // correct. `disagreement` is `disagree_count / neighbors.len()`
            // with the `if neighbors.is_empty() { continue; }` guard above,
            // so the divisor is positive — also finite.
            anomalies.push(SignAnomaly {
                row,
                col,
                cell: crate::range_manager::pos_to_a1(row, col),
                value: value_types::FiniteF64::must(value),
                disagreement: value_types::FiniteF64::must(disagreement),
                neighbors: neighbors
                    .iter()
                    .map(|&(r, c, v)| SignNeighbor {
                        cell: crate::range_manager::pos_to_a1(r, c),
                        value: value_types::FiniteF64::must(v),
                    })
                    .collect(),
            });
        }
    }

    // Sort by disagreement descending (strongest signals first).
    anomalies.sort_by(|a, b| {
        b.disagreement
            .partial_cmp(&a.disagreement)
            .unwrap_or(std::cmp::Ordering::Equal)
    });

    SignCheckResult {
        cells_checked,
        anomalies,
    }
}

// -------------------------------------------------------------------
// Find in Range (regex pattern search)
// -------------------------------------------------------------------

use crate::engine_types::queries::{FindInRangeOptions, FindInRangeResult};

/// Build a compiled regex from `FindInRangeOptions`.
///
/// The search text is interpreted as a regex pattern. Case-insensitive and
/// whole-cell anchoring are applied based on options.
fn build_find_regex(options: &FindInRangeOptions) -> Option<regex::Regex> {
    if options.text.is_empty() {
        return None;
    }
    let pattern = if options.whole_cell.unwrap_or(false) {
        format!("^(?:{})$", options.text)
    } else {
        options.text.clone()
    };
    let case_insensitive = !options.case_sensitive.unwrap_or(false);
    regex::RegexBuilder::new(&pattern)
        .case_insensitive(case_insensitive)
        .build()
        .ok()
}

/// Find the first cell matching a regex pattern in a range.
pub(in crate::storage::engine) fn find_in_range(
    engine: &crate::storage::engine::YrsComputeEngine,
    sheet_id: &SheetId,
    start_row: u32,
    start_col: u32,
    end_row: u32,
    end_col: u32,
    options: FindInRangeOptions,
) -> Option<FindInRangeResult> {
    let re = build_find_regex(&options)?;
    let include_formulas = options.include_formulas.unwrap_or(false);
    let mut result: Option<FindInRangeResult> = None;

    for_each_cell_in_range(
        engine,
        sheet_id,
        start_row,
        start_col,
        end_row,
        end_col,
        false,
        &mut |visit| {
            if result.is_some() {
                return; // already found first match
            }
            let display = if visit.formatted.is_empty() {
                visit.value.to_string()
            } else {
                visit.formatted.clone()
            };
            if !display.is_empty() && re.is_match(&display) {
                result = Some(FindInRangeResult {
                    row: visit.row,
                    col: visit.col,
                    address: crate::range_manager::pos_to_a1(visit.row, visit.col),
                    value: display,
                });
                return;
            }

            if include_formulas
                && let Some(formula) = &visit.formula
                && re.is_match(formula)
            {
                result = Some(FindInRangeResult {
                    row: visit.row,
                    col: visit.col,
                    address: crate::range_manager::pos_to_a1(visit.row, visit.col),
                    value: display,
                });
            }
        },
    );

    result
}

/// Find all cells matching a regex pattern in a range.
pub(in crate::storage::engine) fn find_all_in_range(
    engine: &crate::storage::engine::YrsComputeEngine,
    sheet_id: &SheetId,
    start_row: u32,
    start_col: u32,
    end_row: u32,
    end_col: u32,
    options: FindInRangeOptions,
) -> Vec<FindInRangeResult> {
    let re = match build_find_regex(&options) {
        Some(r) => r,
        None => return Vec::new(),
    };
    let include_formulas = options.include_formulas.unwrap_or(false);
    let mut results = Vec::new();

    for_each_cell_in_range(
        engine,
        sheet_id,
        start_row,
        start_col,
        end_row,
        end_col,
        false,
        &mut |visit| {
            let display = if visit.formatted.is_empty() {
                visit.value.to_string()
            } else {
                visit.formatted.clone()
            };
            if !display.is_empty() && re.is_match(&display) {
                results.push(FindInRangeResult {
                    row: visit.row,
                    col: visit.col,
                    address: crate::range_manager::pos_to_a1(visit.row, visit.col),
                    value: display,
                });
                return;
            }

            if include_formulas
                && let Some(formula) = &visit.formula
                && re.is_match(formula)
            {
                results.push(FindInRangeResult {
                    row: visit.row,
                    col: visit.col,
                    address: crate::range_manager::pos_to_a1(visit.row, visit.col),
                    value: display,
                });
            }
        },
    );

    results
}

// -------------------------------------------------------------------
// Workbook-wide Regex Search
// -------------------------------------------------------------------

/// Search all sheets for cells matching regex patterns.
///
/// Compiles patterns once, then iterates each sheet's data bounds.
/// Range constraint from `options` is applied per-sheet when present.
pub(in crate::storage::engine) fn regex_search_all_sheets(
    engine: &crate::storage::engine::YrsComputeEngine,
    options: RegexSearchOptions,
) -> WorkbookSearchResult {
    let case_insensitive = !options.case_sensitive.unwrap_or(false);
    let whole_cell = options.whole_cell.unwrap_or(false);
    let include_formulas = options.include_formulas.unwrap_or(false);

    // 1. Compile patterns once
    let mut compiled = Vec::new();
    let mut errors = Vec::new();
    for pattern in &options.patterns {
        let mut p = pattern.clone();
        if case_insensitive {
            p = format!("(?i){}", p);
        }
        if whole_cell {
            p = format!("^(?:{})$", p);
        }
        match regex::Regex::new(&p) {
            Ok(re) => compiled.push((pattern.clone(), re)),
            Err(e) => errors.push(format!("Pattern '{}': {}", pattern, e)),
        }
    }

    if compiled.is_empty() {
        return WorkbookSearchResult {
            matches: vec![],
            errors,
        };
    }

    // 2. Iterate all sheets in tab order
    let sheet_ids = engine.stores.storage.sheet_order();
    let mut matches = Vec::new();

    for sheet_id in &sheet_ids {
        let sheet_name = properties::get_sheet_name(
            engine.stores.storage.doc(),
            engine.stores.storage.sheets(),
            sheet_id,
        )
        .unwrap_or_else(|| id_to_hex(sheet_id.as_u128()).into());

        let bounds = match get_data_bounds(&engine.stores, &engine.mirror, sheet_id) {
            Some(b) => b,
            None => continue,
        };

        // Clamp to optional range constraint (applied per-sheet)
        let min_row = options
            .start_row
            .map_or(bounds.min_row, |r| r.max(bounds.min_row));
        let min_col = options
            .start_col
            .map_or(bounds.min_col, |c| c.max(bounds.min_col));
        let max_row = options
            .end_row
            .map_or(bounds.max_row, |r| r.min(bounds.max_row));
        let max_col = options
            .end_col
            .map_or(bounds.max_col, |c| c.min(bounds.max_col));

        for_each_cell_in_range(
            engine,
            sheet_id,
            min_row,
            min_col,
            max_row,
            max_col,
            false,
            &mut |visit| {
                for (original_pattern, re) in &compiled {
                    if re.is_match(&visit.formatted) {
                        matches.push(WorkbookSearchMatch {
                            sheet_id: id_to_hex(sheet_id.as_u128()).into(),
                            sheet_name: sheet_name.clone(),
                            row: visit.row,
                            col: visit.col,
                            address: crate::range_manager::pos_to_a1(visit.row, visit.col),
                            value: visit.formatted.clone(),
                            matched_pattern: original_pattern.clone(),
                        });
                        return;
                    }
                }

                if include_formulas && let Some(ref formula) = visit.formula {
                    for (original_pattern, re) in &compiled {
                        if re.is_match(formula) {
                            matches.push(WorkbookSearchMatch {
                                sheet_id: id_to_hex(sheet_id.as_u128()).to_string(),
                                sheet_name: sheet_name.clone(),
                                row: visit.row,
                                col: visit.col,
                                address: crate::range_manager::pos_to_a1(visit.row, visit.col),
                                value: visit.formatted.clone(),
                                matched_pattern: original_pattern.clone(),
                            });
                            return;
                        }
                    }
                }
            },
        );
    }

    WorkbookSearchResult { matches, errors }
}
