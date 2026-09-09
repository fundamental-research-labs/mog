//! Workbook tab membership, including inert chartsheets and dialogsheets.
//!
//! Bind imported editable indices to durable sheet IDs at hydration. Export
//! reconciles those bindings with live sheet order so deletion, insertion,
//! renaming, and reordering cannot revive or misidentify imported worksheets.
use std::collections::{BTreeSet, HashMap, HashSet};

use cell_types::SheetId;
use domain_types::{ParseOutput, SheetData, WorkbookSheetKind, WorkbookSheetPackageInfo};

#[derive(Debug, Clone, Default)]
pub(crate) struct StoredInventory {
    entries: Vec<WorkbookSheetPackageInfo>,
    editable_sheet_ids: Vec<String>,
    parsed_workbook_sheet_indices: BTreeSet<u32>,
}

pub(crate) fn hydrate(
    metadata: &mut super::WorkbookMetadata,
    output: &ParseOutput,
    sheet_ids: &[SheetId],
) {
    if output.workbook_sheet_inventory.is_empty() {
        return;
    }
    let inventory = StoredInventory {
        entries: output.workbook_sheet_inventory.clone(),
        editable_sheet_ids: sheet_ids.iter().map(SheetId::to_uuid_string).collect(),
        parsed_workbook_sheet_indices: output.parsed_workbook_sheet_indices.clone(),
    };
    metadata.sheet_inventory = Some(inventory);
}

pub(crate) fn export(
    metadata: &super::WorkbookMetadata,
    sheet_ids: &[SheetId],
    sheets: &mut [SheetData],
) -> (
    Vec<WorkbookSheetPackageInfo>,
    BTreeSet<u32>,
    HashMap<u32, u32>,
) {
    let Some(stored) = metadata.sheet_inventory.as_ref() else {
        return Default::default();
    };
    reconcile(stored.clone(), sheet_ids, sheets)
}

fn reconcile(
    mut stored: StoredInventory,
    sheet_ids: &[SheetId],
    sheets: &mut [SheetData],
) -> (
    Vec<WorkbookSheetPackageInfo>,
    BTreeSet<u32>,
    HashMap<u32, u32>,
) {
    stored.entries.sort_by_key(|entry| entry.workbook_order);
    let current_ids: Vec<_> = sheet_ids.iter().map(SheetId::to_uuid_string).collect();
    let current_id_set: HashSet<_> = current_ids.iter().collect();
    let imported: HashMap<_, _> = stored
        .entries
        .iter()
        .filter_map(|entry| {
            let id = stored.editable_sheet_ids.get(entry.editable_sheet_index?)?;
            Some((id, entry))
        })
        .collect();
    // Native sheet metadata owns current numeric IDs; imported inventory is a
    // fallback for bound originals. Reserve every preferred ID before assigning
    // missing IDs, so allocation cannot steal a later tab's canonical identity.
    let mut used_ids: BTreeSet<_> = stored
        .entries
        .iter()
        .filter(|entry| entry.editable_sheet_index.is_none())
        .filter_map(|entry| entry.sheet_id)
        .collect();
    let mut preferred_ids = vec![None; sheets.len()];
    for (index, (id, sheet)) in current_ids.iter().zip(sheets.iter()).enumerate() {
        if let Some(original) = imported.get(id) {
            preferred_ids[index] = sheet
                .sheet_id
                .or(original.sheet_id)
                .filter(|id| *id > 0 && used_ids.insert(*id));
        }
    }
    for (index, (id, sheet)) in current_ids.iter().zip(sheets.iter()).enumerate() {
        if !imported.contains_key(id) {
            // A copy may inherit its original's ID; only a free ID is usable.
            preferred_ids[index] = sheet.sheet_id.filter(|id| *id > 0 && used_ids.insert(*id));
        }
    }
    let mut editable = Vec::with_capacity(sheets.len());
    for (index, (id, sheet)) in current_ids.iter().zip(sheets.iter_mut()).enumerate() {
        let original = imported.get(id);
        let mut entry =
            original
                .map(|entry| (*entry).clone())
                .unwrap_or_else(|| {
                    WorkbookSheetPackageInfo {
                kind: WorkbookSheetKind::Worksheet,
                relationship_type: Some(
                    "http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet"
                        .into(),
                ),
                content_type: Some(
                    "application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"
                        .into(),
                ),
                ..Default::default()
            }
                });
        let sheet_id = preferred_ids[index].unwrap_or_else(|| {
            domain_types::domain::workbook::next_worksheet_id(&used_ids)
                .expect("workbook has an available positive sheet ID")
        });
        used_ids.insert(sheet_id);
        sheet.sheet_id = Some(sheet_id);
        entry.sheet_id = Some(sheet_id);
        entry.name = sheet.name.clone();
        entry.visibility = sheet.visibility;
        entry.editable_sheet_index = Some(index);
        if entry.normalized_part_path.is_none() {
            entry.normalized_part_path = Some(format!("xl/worksheets/sheet{}.xml", index + 1));
        }
        let parsed = original.is_none_or(|entry| {
            stored
                .parsed_workbook_sheet_indices
                .contains(&entry.workbook_order)
        });
        editable.push((entry, parsed));
    }
    let mut editable = editable.into_iter();
    let mut result = Vec::new();
    // Inert tabs retain their slots relative to surviving imported editable
    // slots; editable slots follow the current user-controlled sheet order.
    for entry in &stored.entries {
        if let Some(index) = entry.editable_sheet_index {
            if stored
                .editable_sheet_ids
                .get(index)
                .is_some_and(|id| current_id_set.contains(id))
                && let Some(entry) = editable.next()
            {
                result.push(entry);
            }
        } else {
            result.push((
                entry.clone(),
                stored
                    .parsed_workbook_sheet_indices
                    .contains(&entry.workbook_order),
            ));
        }
    }
    result.extend(editable);
    let mut parsed_indices = BTreeSet::new();
    let inventory: Vec<WorkbookSheetPackageInfo> = result
        .into_iter()
        .enumerate()
        .map(|(index, (mut entry, parsed))| {
            entry.workbook_order = index as u32;
            // Empty is the parser's full/legacy parse sentinel. Only compact
            // selected parses carry an explicit set; adding a tab must not
            // accidentally turn a full workbook into a partial-parse marker.
            if parsed && !stored.parsed_workbook_sheet_indices.is_empty() {
                parsed_indices.insert(entry.workbook_order);
            }
            entry
        })
        .collect();
    let imported_order_to_export_order = stored
        .entries
        .iter()
        .filter_map(|original| {
            let exported = if let Some(index) = original.editable_sheet_index {
                let id = stored.editable_sheet_ids.get(index)?;
                let current_index = current_ids.iter().position(|current| current == id)?;
                inventory
                    .iter()
                    .find(|entry| entry.editable_sheet_index == Some(current_index))
            } else {
                inventory.iter().find(|entry| {
                    entry.editable_sheet_index.is_none()
                        && entry.kind == original.kind
                        && entry.normalized_part_path == original.normalized_part_path
                        && entry.workbook_r_id == original.workbook_r_id
                })
            }?;
            Some((original.workbook_order, exported.workbook_order))
        })
        .collect();
    (inventory, parsed_indices, imported_order_to_export_order)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn original_inventory() -> StoredInventory {
        StoredInventory {
            entries: vec![WorkbookSheetPackageInfo {
                sheet_id: Some(1),
                editable_sheet_index: Some(0),
                kind: WorkbookSheetKind::Worksheet,
                ..Default::default()
            }],
            editable_sheet_ids: vec![SheetId::from_raw(1).to_uuid_string()],
            ..Default::default()
        }
    }

    #[test]
    fn native_original_and_copy_ids_match_canonical_writer_allocation() {
        let mut sheets = vec![
            SheetData {
                sheet_id: Some(7),
                ..Default::default()
            },
            SheetData::default(),
        ];
        let expected = ParseOutput {
            sheets: sheets.clone(),
            ..Default::default()
        }
        .resolved_worksheet_ids()
        .unwrap();
        let (inventory, _, _) = reconcile(
            original_inventory(),
            &[SheetId::from_raw(1), SheetId::from_raw(2)],
            &mut sheets,
        );
        assert_eq!(expected, vec![7, 8]);
        assert_eq!(
            sheets
                .iter()
                .map(|sheet| sheet.sheet_id.unwrap())
                .collect::<Vec<_>>(),
            expected
        );
        assert_eq!(
            inventory
                .iter()
                .map(|entry| entry.sheet_id.unwrap())
                .collect::<Vec<_>>(),
            expected
        );
    }

    #[test]
    fn maximum_native_id_allocates_copy_from_first_available_gap() {
        for inert_id in [None, Some(1)] {
            let mut stored = original_inventory();
            if let Some(sheet_id) = inert_id {
                stored.entries.push(WorkbookSheetPackageInfo {
                    workbook_order: 1,
                    sheet_id: Some(sheet_id),
                    kind: WorkbookSheetKind::Chartsheet,
                    ..Default::default()
                });
            }
            let mut sheets = vec![
                SheetData {
                    sheet_id: Some(u32::MAX),
                    ..Default::default()
                },
                SheetData::default(),
            ];
            reconcile(
                stored,
                &[SheetId::from_raw(1), SheetId::from_raw(2)],
                &mut sheets,
            );
            assert_eq!(sheets[0].sheet_id, Some(u32::MAX));
            assert_eq!(sheets[1].sheet_id, Some(inert_id.unwrap_or(0) + 1));
        }
    }

    #[test]
    fn reordered_copy_reserves_later_native_and_inert_ids_before_allocation() {
        let mut stored = original_inventory();
        stored.entries.push(WorkbookSheetPackageInfo {
            workbook_order: 1,
            sheet_id: Some(8),
            kind: WorkbookSheetKind::Chartsheet,
            ..Default::default()
        });
        let mut sheets = vec![
            SheetData {
                sheet_id: Some(7),
                ..Default::default()
            },
            SheetData {
                sheet_id: Some(7),
                ..Default::default()
            },
            SheetData {
                sheet_id: Some(9),
                ..Default::default()
            },
        ];
        let (inventory, _, _) = reconcile(
            stored,
            &[
                SheetId::from_raw(2),
                SheetId::from_raw(1),
                SheetId::from_raw(3),
            ],
            &mut sheets,
        );
        assert_eq!(
            sheets
                .iter()
                .map(|sheet| sheet.sheet_id)
                .collect::<Vec<_>>(),
            vec![Some(10), Some(7), Some(9)]
        );
        assert_eq!(
            inventory
                .iter()
                .map(|entry| entry.sheet_id)
                .collect::<Vec<_>>(),
            vec![Some(10), Some(8), Some(7), Some(9)]
        );
    }
}
