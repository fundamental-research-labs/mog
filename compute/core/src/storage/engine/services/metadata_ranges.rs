//! Range-scoped metadata edits preserve unaffected coverage and formula anchors.
use crate::cells::CellStore;
use crate::snapshot::{CfChange, ChangeKind, MutationResult};
use crate::storage::engine::stores::EngineStores;
use crate::storage::sheet::cf_store;
use cell_types::{SheetId, SheetRange};
use compute_parser::{ASTNode, AstFold, CellRefNode, RangeRef};
use formula_types::CellRef;

fn parse_range(text: &str) -> Option<SheetRange> {
    text.parse().ok().or_else(|| {
        text.parse::<cell_types::SheetPos>()
            .ok()
            .map(|p| SheetRange::single(p.row(), p.col()))
    })
}

struct Offset {
    row: i64,
    col: i64,
}
impl Offset {
    fn reference(&self, r: CellRef, abs_row: bool, abs_col: bool) -> Option<CellRef> {
        match r {
            CellRef::Positional { sheet, row, col } => {
                let row = i64::from(row) + if abs_row { 0 } else { self.row };
                let col = i64::from(col) + if abs_col { 0 } else { self.col };
                if !(0..i64::from(cell_types::MAX_ROWS)).contains(&row)
                    || !(0..i64::from(cell_types::MAX_COLS)).contains(&col)
                {
                    return None;
                }
                Some(CellRef::Positional {
                    sheet,
                    row: row as u32,
                    col: col as u32,
                })
            }
            other => Some(other),
        }
    }
}
impl AstFold for Offset {
    fn fold_cell_ref(&mut self, mut r: CellRefNode) -> ASTNode {
        match self.reference(r.reference, r.abs_row, r.abs_col) {
            Some(reference) => {
                r.reference = reference;
                ASTNode::CellReference(r)
            }
            None => ASTNode::Error(value_types::CellError::Ref),
        }
    }
    fn fold_range(&mut self, mut r: RangeRef) -> ASTNode {
        match (
            self.reference(
                r.start,
                r.abs_start.row || r.range_type == formula_types::RangeType::ColumnRange,
                r.abs_start.col || r.range_type == formula_types::RangeType::RowRange,
            ),
            self.reference(
                r.end,
                r.abs_end.row || r.range_type == formula_types::RangeType::ColumnRange,
                r.abs_end.col || r.range_type == formula_types::RangeType::RowRange,
            ),
        ) {
            (Some(start), Some(end)) => {
                r.start = start;
                r.end = end;
                ASTNode::Range(r)
            }
            _ => ASTNode::Error(value_types::CellError::Ref),
        }
    }
}
fn rebase_formula(text: &str, row: i64, col: i64) -> String {
    compute_parser::rewrite_reference_tokens(text, |class, token| {
        use compute_parser::ReferenceTokenClass::*;
        if !matches!(class, CellOrRange | SheetRef | ThreeDRef | ExternalRef) {
            return None;
        }
        let parsed = compute_parser::parse_formula(&format!("={token}"), None).ok()?;
        Some(Offset { row, col }.fold(parsed.into_inner()).to_string())
    })
}
fn rebase_fields(value: &mut serde_json::Value, row: i64, col: i64) {
    match value {
        serde_json::Value::Object(fields) => {
            let formula_threshold = fields.get("type").and_then(|v| v.as_str()) == Some("formula");
            for (key, field) in fields {
                if matches!(
                    key.as_str(),
                    "formula" | "formula1" | "formula2" | "value1" | "value2"
                ) || (formula_threshold && key == "value")
                {
                    if let Some(text) = field.as_str() {
                        *field = serde_json::Value::String(rebase_formula(text, row, col));
                    }
                } else {
                    rebase_fields(field, row, col);
                }
            }
        }
        serde_json::Value::Array(items) => {
            for item in items {
                rebase_fields(item, row, col);
            }
        }
        _ => {}
    }
}

pub(in crate::storage::engine) fn clear_range_metadata(
    stores: &mut EngineStores,
    cell_store: &CellStore,
    sheet: &SheetId,
    cleared: SheetRange,
) -> Result<MutationResult, value_types::ComputeError> {
    let mut result = MutationResult::empty();
    let comments = super::objects::get_all_comments(stores, sheet);
    for comment in comments {
        let pos = compute_document::hex::hex_to_id(&comment.cell_ref)
            .map(cell_types::CellId::from_raw)
            .and_then(|id| {
                cell_store
                    .get_sheet(sheet)
                    .and_then(|s| s.cell_position(&id))
            });
        if pos.is_some_and(|(row, col)| cleared.contains(row, col)) {
            let change = super::objects::delete_comment(stores, cell_store, sheet, &comment.id)?;
            result.comment_changes.extend(change.comment_changes);
        }
    }
    let formats = cf_store::get_formats_for_sheet(&stores.storage, sheet);
    for format in formats {
        if !format.ranges.iter().any(|r| r.intersects(&cleared)) {
            continue;
        }
        let origin = format.ranges[0];
        let fragments: Vec<_> = format
            .ranges
            .iter()
            .flat_map(|range| cf_store::cf_subtract_range(range, &cleared))
            .collect();
        if fragments.is_empty() {
            cf_store::delete_conditional_format(&mut stores.storage, &format.id, sheet);
            result.cf_changes.push(CfChange {
                sheet_id: sheet.to_uuid_string(),
                kind: ChangeKind::Removed,
                rule_id: Some(format.id),
            });
        } else {
            // Keep one group so statistical rules still see the surviving union.
            let mut updated = format;
            let first = fragments[0];
            updated.ranges = fragments;
            let mut rules = serde_json::to_value(&updated.rules).expect("CF rule serialization");
            rebase_fields(
                &mut rules,
                i64::from(first.start_row()) - i64::from(origin.start_row()),
                i64::from(first.start_col()) - i64::from(origin.start_col()),
            );
            updated.rules = serde_json::from_value(rules).expect("CF rule shape unchanged");
            cf_store::add_conditional_format(&mut stores.storage, &updated);
            result.cf_changes.push(CfChange {
                sheet_id: sheet.to_uuid_string(),
                kind: ChangeKind::Set,
                rule_id: Some(updated.id),
            });
        }
    }
    let original = stores
        .storage
        .sheet_metadata
        .get(sheet)
        .map(|m| m.validations.rules.clone())
        .unwrap_or_default();
    let mut replacement = Vec::new();
    for entry in &original {
        if !entry
            .spec
            .ranges
            .iter()
            .filter_map(|text| parse_range(text))
            .any(|r| r.intersects(&cleared))
        {
            replacement.push(entry.clone());
            continue;
        }
        for text in &entry.spec.ranges {
            let Some(range) = parse_range(text) else {
                let mut keep = entry.clone();
                keep.spec.ranges = vec![text.clone()];
                replacement.push(keep);
                continue;
            };
            for fragment in cf_store::cf_subtract_range(&range, &cleared) {
                let mut keep = entry.clone();
                keep.id = stores.next_id_uuid_string();
                if keep.spec.uid.is_some() {
                    keep.spec.uid = Some(keep.id.clone());
                }
                keep.spec.ranges = vec![fragment.to_string()];
                let mut rule =
                    serde_json::to_value(&keep.spec.rule).expect("validation serialization");
                rebase_fields(
                    &mut rule,
                    i64::from(fragment.start_row()) - i64::from(range.start_row()),
                    i64::from(fragment.start_col()) - i64::from(range.start_col()),
                );
                keep.spec.rule =
                    serde_json::from_value(rule).expect("validation rule shape unchanged");
                replacement.push(keep);
            }
        }
    }
    if original != replacement {
        crate::storage::engine::history::metadata::capture_validation_replacement(
            &stores.storage,
            *sheet,
            &replacement,
        );
        if let Some(metadata) = stores.storage.sheet_metadata.get_mut(sheet) {
            metadata.validations.rules = replacement;
            metadata.validations.declared_count = None;
        }
    }
    Ok(result)
}

#[cfg(test)]
mod metadata_range_tests {
    #[test]
    fn whole_axis_reference_rebase_preserves_unbounded_dimension() {
        assert_eq!(
            super::rebase_formula("SUM(A:A,$B:$B,1:1,$2:$2)", 1, 1),
            "SUM(B:B,$B:$B,2:2,$2:$2)"
        );
        assert_eq!(
            super::rebase_formula("AND(A1>0,$C$3=10,\"A1\"=\"A1\")", 1, 1),
            "AND(B2>0,$C$3=10,\"A1\"=\"A1\")"
        );
    }
}
