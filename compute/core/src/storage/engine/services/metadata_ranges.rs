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

/// Immutable source metadata, captured before an overlapping copy changes cells.
pub(in crate::storage::engine) struct CopyMetadata {
    source: SheetRange,
    comments: Vec<(
        cell_types::SheetPos,
        crate::storage::sheet::comments::StoredComment,
    )>,
    links: Vec<(
        SheetRange,
        crate::storage::sheet::hyperlinks::StoredHyperlink,
    )>,
    validations: Vec<crate::storage::sheet::schemas::StoredValidation>,
    formats: Vec<domain_types::domain::conditional_format::ConditionalFormat>,
    covered: Vec<SheetRange>,
}

pub(in crate::storage::engine) fn capture_copy_metadata(
    stores: &EngineStores,
    cells: &CellStore,
    sheet: &SheetId,
    source: SheetRange,
    skip_blanks: bool,
) -> CopyMetadata {
    let metadata = stores.storage.sheet_metadata.get(sheet);
    let position = |id| {
        cells
            .get_sheet(sheet)
            .and_then(|s| s.cell_position(&id))
            .map(|(row, col)| cell_types::SheetPos::new(row, col))
    };
    let covered = if skip_blanks {
        cells
            .cells_in_range(
                sheet,
                source.start_row(),
                source.start_col(),
                source.end_row(),
                source.end_col(),
            )
            .filter_map(|(id, _, _)| {
                let pos = position(id)?;
                let value = cells.get_cell_value_at(sheet, pos);
                (value.is_some_and(|v| !v.is_null()) || cells.get_formula(&id).is_some())
                    .then(|| SheetRange::single(pos.row(), pos.col()))
            })
            .collect()
    } else {
        vec![source]
    };
    let included =
        |pos: cell_types::SheetPos| covered.iter().any(|r| r.contains(pos.row(), pos.col()));
    let comments = metadata
        .into_iter()
        .flat_map(|m| m.comments.iter())
        .filter_map(|comment| {
            let pos = position(comment.cell_ref.cell()?)?;
            included(pos).then(|| (pos, comment.clone()))
        })
        .collect();
    let links = metadata
        .into_iter()
        .flat_map(|m| m.hyperlinks.iter())
        .filter_map(|link| {
            let start = position(link.start_id)?;
            let end = position(link.end_id.unwrap_or(link.start_id))?;
            let range = SheetRange::new(start.row(), start.col(), end.row(), end.col());
            Some(
                covered
                    .iter()
                    .filter_map(|r| cf_store::cf_intersect_ranges(r, &range))
                    .map(|r| (r, link.clone()))
                    .collect::<Vec<_>>(),
            )
        })
        .flatten()
        .collect();
    CopyMetadata {
        source,
        comments,
        links,
        covered,
        validations: metadata
            .map(|m| m.validations.rules.clone())
            .unwrap_or_default(),
        formats: cf_store::get_formats_for_sheet(&stores.storage, sheet),
    }
}

pub(in crate::storage::engine) fn apply_copy_metadata(
    stores: &mut EngineStores,
    cells: &mut CellStore,
    snapshot: CopyMetadata,
    sheet: &SheetId,
    target_row: u32,
    target_col: u32,
    transpose: bool,
    row_tiles: u32,
    col_tiles: u32,
) -> Result<MutationResult, value_types::ComputeError> {
    let mut result = MutationResult::empty();
    let (height, width) = if transpose {
        (
            (snapshot.source.end_col() - snapshot.source.start_col() + 1),
            (snapshot.source.end_row() - snapshot.source.start_row() + 1),
        )
    } else {
        (
            (snapshot.source.end_row() - snapshot.source.start_row() + 1),
            (snapshot.source.end_col() - snapshot.source.start_col() + 1),
        )
    };
    for tr in 0..row_tiles {
        for tc in 0..col_tiles {
            let row = target_row + tr * height;
            let col = target_col + tc * width;
            let translate = |range: SheetRange| {
                let sr = range.start_row() - snapshot.source.start_row();
                let sc = range.start_col() - snapshot.source.start_col();
                let er = range.end_row() - snapshot.source.start_row();
                let ec = range.end_col() - snapshot.source.start_col();
                if transpose {
                    SheetRange::new(row + sc, col + sr, row + ec, col + er)
                } else {
                    SheetRange::new(row + sr, col + sc, row + er, col + ec)
                }
            };
            for source in &snapshot.covered {
                let target = translate(*source);
                let cleared = clear_range_metadata(stores, cells, sheet, target)?;
                result.comment_changes.extend(cleared.comment_changes);
                result.cf_changes.extend(cleared.cf_changes);
                clear_hyperlink_fragments(stores, cells, sheet, target);
            }
            let ids: std::collections::HashMap<_, _> = snapshot
                .comments
                .iter()
                .map(|(_, c)| (c.id.clone(), stores.next_id_uuid_string()))
                .collect();
            for (pos, comment) in &snapshot.comments {
                let target = translate(SheetRange::single(pos.row(), pos.col()));
                let id = super::cell_editing::ensure_cell_id(
                    stores,
                    cells,
                    sheet,
                    target.start_row(),
                    target.start_col(),
                )
                .expect("target identity");
                let mut copy = comment.clone();
                copy.id = ids[&comment.id].clone();
                copy.cell_ref = crate::storage::sheet::comments::CommentAnchor::Cell(id);
                for link in [&mut copy.thread_id, &mut copy.parent_id]
                    .into_iter()
                    .flatten()
                {
                    if let Some(new) = ids.get(link) {
                        *link = new.clone();
                    }
                }
                crate::storage::engine::history::metadata::capture_sheet_vector_entry!(stores.storage,*sheet,comments,copy.id,entry=>entry.id);
                stores
                    .storage
                    .sheet_metadata
                    .get_mut(sheet)
                    .expect("sheet")
                    .comments
                    .push(copy);
                result.comment_changes.push(crate::snapshot::CommentChange {
                    sheet_id: sheet.to_uuid_string(),
                    cell_id: id.to_uuid_string(),
                    position: Some(crate::snapshot::CellPosition {
                        row: target.start_row(),
                        col: target.start_col(),
                    }),
                    kind: ChangeKind::Set,
                });
            }
            for (range, link) in &snapshot.links {
                let target = translate(*range);
                let mut copy = link.clone();
                if copy.data.uid.is_some() {
                    copy.data.uid = Some(stores.next_id_uuid_string());
                }
                copy.start_id = super::cell_editing::ensure_cell_id(
                    stores,
                    cells,
                    sheet,
                    target.start_row(),
                    target.start_col(),
                )
                .expect("target identity");
                copy.end_id = if target.start_row() != target.end_row()
                    || target.start_col() != target.end_col()
                {
                    super::cell_editing::ensure_cell_id(
                        stores,
                        cells,
                        sheet,
                        target.end_row(),
                        target.end_col(),
                    )
                } else {
                    None
                };
                crate::storage::engine::history::metadata::capture_sheet_field!(
                    stores.storage,
                    *sheet,
                    hyperlinks
                );
                stores
                    .storage
                    .sheet_metadata
                    .get_mut(sheet)
                    .expect("sheet")
                    .hyperlinks
                    .push(copy);
            }
            for original in &snapshot.formats {
                let ranges: Vec<_> = original
                    .ranges
                    .iter()
                    .flat_map(|range| {
                        snapshot
                            .covered
                            .iter()
                            .filter_map(|covered| cf_store::cf_intersect_ranges(range, covered))
                            .map(translate)
                    })
                    .collect();
                if ranges.is_empty() {
                    continue;
                }
                let origin = original.ranges[0];
                let target = ranges[0];
                let mut copy = original.clone();
                copy.id = stores.next_id_uuid_string();
                copy.sheet_id = sheet.to_uuid_string();
                copy.ranges = ranges;
                let mut rules = serde_json::to_value(&copy.rules).expect("CF serialization");
                if let Some(rules) = rules.as_array_mut() {
                    for rule in rules {
                        if let Some(object) = rule.as_object_mut() {
                            object.insert(
                                "id".into(),
                                serde_json::Value::String(stores.next_id_uuid_string()),
                            );
                        }
                    }
                }
                rebase_fields(
                    &mut rules,
                    i64::from(target.start_row()) - i64::from(origin.start_row()),
                    i64::from(target.start_col()) - i64::from(origin.start_col()),
                );
                copy.rules = serde_json::from_value(rules).expect("CF shape");
                cf_store::add_conditional_format(&mut stores.storage, &copy);
                result.cf_changes.push(CfChange {
                    sheet_id: sheet.to_uuid_string(),
                    kind: ChangeKind::Set,
                    rule_id: Some(copy.id),
                });
            }
            for original in &snapshot.validations {
                for text in &original.spec.ranges {
                    let Some(range) = parse_range(text) else {
                        continue;
                    };
                    for covered in &snapshot.covered {
                        let Some(part) = cf_store::cf_intersect_ranges(&range, covered) else {
                            continue;
                        };
                        let target = translate(part);
                        let mut copy = original.clone();
                        copy.id = stores.next_id_uuid_string();
                        if copy.spec.uid.is_some() {
                            copy.spec.uid = Some(copy.id.clone());
                        }
                        copy.spec.ranges = vec![target.to_string()];
                        let mut rule = serde_json::to_value(&copy.spec.rule)
                            .expect("validation serialization");
                        rebase_fields(
                            &mut rule,
                            i64::from(target.start_row()) - i64::from(range.start_row()),
                            i64::from(target.start_col()) - i64::from(range.start_col()),
                        );
                        copy.spec.rule = serde_json::from_value(rule).expect("validation shape");
                        crate::storage::engine::history::metadata::capture_sheet_vector_entry!(stores.storage,*sheet,validations.rules,copy.id,entry=>entry.id);
                        crate::storage::engine::history::metadata::capture_sheet_field!(
                            stores.storage,
                            *sheet,
                            validations.declared_count
                        );
                        let metadata = stores.storage.sheet_metadata.get_mut(sheet).expect("sheet");
                        metadata.validations.rules.push(copy);
                        metadata.validations.declared_count = None;
                    }
                }
            }
        }
    }
    Ok(result)
}

fn clear_hyperlink_fragments(
    stores: &mut EngineStores,
    cells: &mut CellStore,
    sheet: &SheetId,
    cut: SheetRange,
) {
    let original = stores
        .storage
        .sheet_metadata
        .get(sheet)
        .map(|m| m.hyperlinks.clone())
        .unwrap_or_default();
    let mut replacement = Vec::new();
    for link in &original {
        let bounds = cells.get_sheet(sheet).and_then(|s| {
            Some((
                s.cell_position(&link.start_id)?,
                s.cell_position(&link.end_id.unwrap_or(link.start_id))?,
            ))
        });
        let Some(((sr, sc), (er, ec))) = bounds else {
            replacement.push(link.clone());
            continue;
        };
        let range = SheetRange::new(sr, sc, er, ec);
        if !range.intersects(&cut) {
            replacement.push(link.clone());
            continue;
        }
        for part in cf_store::cf_subtract_range(&range, &cut) {
            let mut copy = link.clone();
            copy.start_id = super::cell_editing::ensure_cell_id(
                stores,
                cells,
                sheet,
                part.start_row(),
                part.start_col(),
            )
            .expect("fragment identity");
            copy.end_id =
                if part.start_row() != part.end_row() || part.start_col() != part.end_col() {
                    super::cell_editing::ensure_cell_id(
                        stores,
                        cells,
                        sheet,
                        part.end_row(),
                        part.end_col(),
                    )
                } else {
                    None
                };
            replacement.push(copy);
        }
    }
    if replacement != original {
        crate::storage::engine::history::metadata::capture_sheet_field!(
            stores.storage,
            *sheet,
            hyperlinks
        );
        stores
            .storage
            .sheet_metadata
            .get_mut(sheet)
            .expect("sheet")
            .hyperlinks = replacement;
    }
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
