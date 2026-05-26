//! Defined-name (named range) lowering — boundary 1.1.
//!
//! Converts `domain_types::NamedRange` → `formula_types::NamedRangeDef`.
//!
//! Since `ParseOutput` is position-keyed with no CellIds, we use
//! `NamedRangeDef::from_expression` which stores the raw A1 `refers_to` string.
//! The scheduler will resolve this to identity refs once the CellMirror is live.
//!
//! The `resolver` maps XLSX sheet indices to actual SheetIds so that
//! sheet-scoped named ranges use the correct scope for variable lookup.

use cell_types::{ColId, RangeKind, RowId};
use compute_parser::ParsedExpr;
use domain_types::NamedRange;
use formula_types::{CellRef, NamedRangeDef, Scope};
use snapshot_types::SheetSnapshot;

use super::SheetResolver;

/// Returns true when `refers_to` is purely a `#REF!` (with or without a sheet
/// qualifier) or empty — i.e. the name has no useful referent and should be
/// skipped by the import path.
///
/// This is the typed replacement for the byte-level `is_ref_error_only` that
/// lived in `import::sanitize` prior to typed formula boundary See the plan for the
/// full rationale: [`ParsedExpr::classify`] is total over UTF-8, so the Greek
/// OFFSET panic class (see UTF-8 boundary) cannot recur.
pub(crate) fn is_orphan_name(refers_to: &str) -> bool {
    matches!(
        ParsedExpr::classify(refers_to),
        ParsedExpr::BrokenRef { .. } | ParsedExpr::Empty
    )
}

pub(crate) fn convert_named_ranges(
    named_ranges: &[NamedRange],
    resolver: &SheetResolver<'_>,
) -> Vec<NamedRangeDef> {
    named_ranges
        .iter()
        .filter(|nr| !nr.hidden) // Skip hidden internal names (e.g. _xlnm._FilterDatabase)
        .filter(|nr| !is_orphan_name(&nr.refers_to)) // Skip orphaned #REF! entries (including _xlnm.Print_Area/Print_Titles)
        .filter_map(|nr| {
            let scope = match nr.local_sheet_id {
                Some(idx) => {
                    // Remap XLSX sheet index to the actual SheetId allocated
                    // for that sheet during snapshot conversion. The resolver
                    // indexes into the same sheets array, so both lookups
                    // should always succeed — if they don't, the XLSX is
                    // malformed and we skip this named range.
                    let sheet_uuid = match resolver.by_index(idx as usize) {
                        Some(uuid) => uuid,
                        None => {
                            tracing::warn!(
                                "named range '{}': localSheetId {} out of range, skipping",
                                nr.name,
                                idx
                            );
                            return None;
                        }
                    };
                    match cell_types::SheetId::from_uuid_str(sheet_uuid) {
                        Ok(sid) => Scope::Sheet(sid),
                        Err(e) => {
                            tracing::warn!(
                                "named range '{}': sheet UUID parse failed: {}, skipping",
                                nr.name,
                                e
                            );
                            return None;
                        }
                    }
                }
                None => Scope::Workbook,
            };
            Some(NamedRangeDef::from_expression(
                nr.name.clone(),
                scope,
                nr.refers_to.clone(),
            ))
        })
        .collect()
}

/// Best-effort linkage: for each named range whose `refers_to` resolves to a
/// cell/range reference, check if a `RangeKind::Data` Range on the same sheet
/// covers that position. If so, populate `linked_range_id`.
///
/// This is a post-classification pass — the sheets must already have their
/// `ranges` populated by the import classifier before calling this.
///
/// `all_row_ids` and `all_col_ids` are the hydration ID maps indexed by
/// `[sheet_index][positional_index]`, enabling position-to-identity lookups.
pub(crate) fn link_named_ranges_to_data_ranges(
    named_ranges: &mut [NamedRangeDef],
    sheets: &[SheetSnapshot],
    all_row_ids: &[Vec<RowId>],
    all_col_ids: &[Vec<ColId>],
) {
    for def in named_ranges.iter_mut() {
        let raw = def.raw_expression.as_deref().unwrap_or("");

        let expr = ParsedExpr::classify(raw);

        // Extract (start_row, start_col, end_row, end_col) from the parsed
        // expression. For a Cell, start == end.
        let region = match &expr {
            ParsedExpr::Cell(cell_node) => {
                extract_position(&cell_node.reference).map(|(r, c)| (r, c, r, c))
            }
            ParsedExpr::Range(range_ref) => {
                let start = extract_position(&range_ref.start);
                let end = extract_position(&range_ref.end);
                match (start, end) {
                    (Some((sr, sc)), Some((er, ec))) => Some((sr, sc, er, ec)),
                    _ => None,
                }
            }
            _ => None,
        };

        let Some((start_row, start_col, end_row, end_col)) = region else {
            continue;
        };

        // Data Ranges from the classifier are single-column, so a match
        // requires start_col == end_col.
        if start_col != end_col {
            continue;
        }

        // Try each sheet to find a covering Data Range. Since
        // ParsedExpr::classify doesn't preserve the sheet qualifier in the
        // CellRef, we check all sheets. For sheet-scoped named ranges we
        // could narrow this, but the cost is negligible at import time.
        for (sheet_idx, sheet) in sheets.iter().enumerate() {
            let row_ids = match all_row_ids.get(sheet_idx) {
                Some(r) => r,
                None => continue,
            };
            let col_ids = match all_col_ids.get(sheet_idx) {
                Some(c) => c,
                None => continue,
            };

            // Look up the ColId at the named range's column position.
            let nr_col_id = match col_ids.get(start_col as usize) {
                Some(c) => *c,
                None => continue,
            };

            // Verify the named range's row span is within the sheet's row ID map.
            if row_ids.get(start_row as usize).is_none() || row_ids.get(end_row as usize).is_none()
            {
                continue;
            }

            for rd in &sheet.ranges {
                if rd.kind != RangeKind::Data || rd.col_ids.len() != 1 {
                    continue;
                }

                // Check if the Data Range covers the same column.
                if rd.col_ids[0] != nr_col_id {
                    continue;
                }

                // Check if the Data Range's row span covers the named range's
                // row span. The Data Range's row_ids are ordered, so the first
                // and last give us the row span boundaries.
                if rd.row_ids.is_empty() {
                    continue;
                }
                let rd_first_row = rd.row_ids[0];
                let rd_last_row = *rd.row_ids.last().unwrap();

                // The named range is covered if its row span is a subset of
                // the Data Range's row span.
                // Use the row_ids array from the hydration map to find the
                // positional index of each Data Range boundary RowId.
                let rd_first_pos = row_ids.iter().position(|r| *r == rd_first_row);
                let rd_last_pos = row_ids.iter().position(|r| *r == rd_last_row);

                if let (Some(rd_fp), Some(rd_lp)) = (rd_first_pos, rd_last_pos)
                    && (start_row as usize) >= rd_fp
                    && (end_row as usize) <= rd_lp
                {
                    def.linked_range_id = Some(rd.range_id);
                    break;
                }
            }

            if def.linked_range_id.is_some() {
                break;
            }
        }
    }
}

/// Extract (row, col) from a positional CellRef.
fn extract_position(cell_ref: &CellRef) -> Option<(u32, u32)> {
    match cell_ref {
        CellRef::Positional { row, col, .. } => Some((*row, *col)),
        CellRef::Resolved(_) => None,
    }
}
