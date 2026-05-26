//! Adjustment functions for structured references.

use super::super::types::{StructuredRef, StructuredRefSpecifier, TableStructureChange};

/// Adjust a structured reference in response to a table structure change.
///
/// Returns a new `StructuredRef` (or a clone of the same one if no change needed).
///
/// **IMPROVEMENT over TS**: When removing a column that is one end of a column range,
/// shrink the range instead of removing the entire range specifier.
pub fn adjust_structured_ref(ref_: &StructuredRef, change: &TableStructureChange) -> StructuredRef {
    match change {
        TableStructureChange::TableRenamed { old_name, new_name } => {
            adjust_table_renamed(ref_, old_name, new_name)
        }
        TableStructureChange::ColumnRenamed { old_name, new_name } => {
            adjust_column_renamed(ref_, old_name, new_name)
        }
        TableStructureChange::ColumnRemoved { name } => adjust_column_removed(ref_, name),
        TableStructureChange::ColumnAdded { .. } => {
            // Column addition does not invalidate existing structured references.
            ref_.clone()
        }
        TableStructureChange::TableResized { .. } => {
            // Table resize does not affect the structured reference text itself.
            ref_.clone()
        }
    }
}

fn adjust_table_renamed(ref_: &StructuredRef, old_name: &str, new_name: &str) -> StructuredRef {
    if !ref_.table_name.eq_ignore_ascii_case(old_name) {
        return ref_.clone();
    }
    StructuredRef {
        table_name: new_name.to_string(),
        specifiers: ref_.specifiers.clone(),
    }
}

fn adjust_column_renamed(ref_: &StructuredRef, old_name: &str, new_name: &str) -> StructuredRef {
    let mut changed = false;
    let new_specifiers: Vec<StructuredRefSpecifier> = ref_
        .specifiers
        .iter()
        .map(|spec| match spec {
            StructuredRefSpecifier::Column { name } => {
                if name.eq_ignore_ascii_case(old_name) {
                    changed = true;
                    StructuredRefSpecifier::Column {
                        name: new_name.to_string(),
                    }
                } else {
                    spec.clone()
                }
            }
            StructuredRefSpecifier::ColumnRange { start, end } => {
                let mut new_start = start.clone();
                let mut new_end = end.clone();
                if start.eq_ignore_ascii_case(old_name) {
                    new_start = new_name.to_string();
                    changed = true;
                }
                if end.eq_ignore_ascii_case(old_name) {
                    new_end = new_name.to_string();
                    changed = true;
                }
                if new_start != *start || new_end != *end {
                    StructuredRefSpecifier::ColumnRange {
                        start: new_start,
                        end: new_end,
                    }
                } else {
                    spec.clone()
                }
            }
            _ => spec.clone(),
        })
        .collect();

    if changed {
        StructuredRef {
            table_name: ref_.table_name.clone(),
            specifiers: new_specifiers,
        }
    } else {
        ref_.clone()
    }
}

fn adjust_column_removed(ref_: &StructuredRef, removed_name: &str) -> StructuredRef {
    let new_specifiers: Vec<StructuredRefSpecifier> = ref_
        .specifiers
        .iter()
        .filter_map(|spec| match spec {
            StructuredRefSpecifier::Column { name } => {
                if name.eq_ignore_ascii_case(removed_name) {
                    None
                } else {
                    Some(spec.clone())
                }
            }
            StructuredRefSpecifier::ColumnRange { start, end } => {
                let start_removed = start.eq_ignore_ascii_case(removed_name);
                let end_removed = end.eq_ignore_ascii_case(removed_name);
                if start_removed && end_removed {
                    // Both ends removed — remove the entire range
                    None
                } else if start_removed {
                    // IMPROVEMENT: shrink range — start removed, keep end as single column
                    Some(StructuredRefSpecifier::Column { name: end.clone() })
                } else if end_removed {
                    // IMPROVEMENT: shrink range — end removed, keep start as single column
                    Some(StructuredRefSpecifier::Column {
                        name: start.clone(),
                    })
                } else {
                    Some(spec.clone())
                }
            }
            _ => Some(spec.clone()), // Keep special items and thisRow
        })
        .collect();

    // If all specifiers were removed, keep original ref (avoid producing invalid empty ref)
    if new_specifiers.is_empty() {
        return ref_.clone();
    }

    StructuredRef {
        table_name: ref_.table_name.clone(),
        specifiers: new_specifiers,
    }
}
