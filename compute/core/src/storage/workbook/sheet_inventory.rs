//! Workbook tab membership, including inert chartsheets and dialogsheets.
//!
//! Bind imported editable indices to durable sheet IDs at hydration. Export
//! reconciles those bindings with live sheet order so deletion, insertion,
//! renaming, and reordering cannot revive or misidentify imported worksheets.
use std::collections::{BTreeSet, HashMap, HashSet};
use std::sync::Arc;

use cell_types::SheetId;
use domain_types::{ParseOutput, SheetData, WorkbookSheetKind, WorkbookSheetPackageInfo};
use serde::{Deserialize, Serialize};
use yrs::{Any, Doc, Map, MapRef, Out, Transact, TransactionMut};

const KEY_SHEET_INVENTORY: &str = "workbookSheetInventory";

#[derive(Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct StoredInventory {
    entries: Vec<WorkbookSheetPackageInfo>,
    editable_sheet_ids: Vec<String>,
    parsed_workbook_sheet_indices: BTreeSet<u32>,
}

pub(crate) fn hydrate(
    workbook: &MapRef,
    output: &ParseOutput,
    sheet_ids: &[SheetId],
    txn: &mut TransactionMut,
) {
    if output.workbook_sheet_inventory.is_empty() {
        return;
    }
    let inventory = StoredInventory {
        entries: output.workbook_sheet_inventory.clone(),
        editable_sheet_ids: sheet_ids.iter().map(SheetId::to_uuid_string).collect(),
        parsed_workbook_sheet_indices: output.parsed_workbook_sheet_indices.clone(),
    };
    let json = serde_json::to_string(&inventory).expect("sheet inventory is serializable");
    workbook.insert(txn, KEY_SHEET_INVENTORY, Any::String(Arc::from(json)));
}

pub(crate) fn export(
    doc: &Doc,
    workbook: &MapRef,
    sheet_ids: &[SheetId],
    sheets: &mut [SheetData],
) -> (
    Vec<WorkbookSheetPackageInfo>,
    BTreeSet<u32>,
    HashMap<u32, u32>,
) {
    let txn = doc.transact();
    let Some(Out::Any(Any::String(json))) = workbook.get(&txn, KEY_SHEET_INVENTORY) else {
        return Default::default();
    };
    let Ok(stored) = serde_json::from_str::<StoredInventory>(&json) else {
        return Default::default();
    };
    reconcile(stored, sheet_ids, sheets)
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
    // Reserve inert and surviving worksheet identities before allocating IDs
    // for newly created sheets. Numeric Excel IDs are independent of tab order.
    let mut used_ids: BTreeSet<_> = stored
        .entries
        .iter()
        .filter(|entry| {
            entry.editable_sheet_index.is_none()
                || entry
                    .editable_sheet_index
                    .and_then(|index| stored.editable_sheet_ids.get(index))
                    .is_some_and(|id| current_id_set.contains(id))
        })
        .filter_map(|entry| entry.sheet_id)
        .collect();
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
        // Copy-sheet can inherit the imported numeric ID in its properties;
        // only the bound original owns that ID. New tabs require a free ID.
        let preferred_id = if original.is_some() {
            entry.sheet_id.or(sheet.sheet_id)
        } else {
            sheet
                .sheet_id
                .filter(|id| *id > 0 && !used_ids.contains(id))
        };
        let sheet_id = preferred_id.unwrap_or_else(|| {
            let mut candidate = 1;
            while used_ids.contains(&candidate) {
                candidate += 1;
            }
            used_ids.insert(candidate);
            candidate
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
