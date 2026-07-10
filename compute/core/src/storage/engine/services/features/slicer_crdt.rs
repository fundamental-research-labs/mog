use crate::snapshot::{MutationResult, SlicerChange, SlicerChangeKind, SlicerSourceType};
use crate::storage::engine::stores::EngineStores;
use cell_types::SheetId;
use compute_document::schema::KEY_SLICERS;
use compute_document::undo::ORIGIN_USER_EDIT;
use domain_types::domain::slicer::{
    SlicerSelectionChangeType, SlicerSource, StoredSlicer, StoredSlicerUpdate,
};
use domain_types::yrs_schema::slicer as slicer_yrs;
use value_types::{CellValue, ComputeError};
use yrs::{Map, MapPrelim, MapRef, Origin, ReadTxn, Transact, TransactionMut};

fn slicer_source_metadata(source: &SlicerSource) -> (SlicerSourceType, String) {
    match source {
        SlicerSource::Table { table_id, .. } => (SlicerSourceType::Table, table_id.clone()),
        SlicerSource::Pivot { pivot_id, .. } => (SlicerSourceType::Pivot, pivot_id.clone()),
    }
}

fn slicer_change(
    slicer: &StoredSlicer,
    kind: SlicerChangeKind,
    updated_fields: Vec<String>,
    selected_values: Option<Vec<CellValue>>,
    selection_change_type: Option<SlicerSelectionChangeType>,
) -> SlicerChange {
    let (source_type, source_id) = slicer_source_metadata(&slicer.source);
    SlicerChange {
        sheet_id: slicer.sheet_id.clone(),
        slicer_id: slicer.id.clone(),
        kind,
        source_type: Some(source_type),
        source_id: Some(source_id),
        updated_fields,
        selected_values,
        selection_change_type,
        data: Some(slicer.clone()),
    }
}

fn canonical_sheet_id(sheet_id: &SheetId) -> String {
    sheet_id.to_uuid_string()
}

/// Resolve a workbook-level slicer key only when it belongs to the receiver
/// worksheet. Stored ownership is compared as a parsed identity so imported
/// dashed/uppercase UUID spellings cannot bypass or fail worksheet scoping.
fn resolve_owned_slicer<T: ReadTxn>(
    slicers_map: &MapRef,
    txn: &T,
    sheet_id: &SheetId,
    slicer_id: &str,
) -> Option<StoredSlicer> {
    let mut slicer = slicers_map
        .get(txn, slicer_id)
        .and_then(|value| slicer_yrs::from_yrs_out(value, txn))?;
    let stored_sheet_id = SheetId::from_uuid_str(&slicer.sheet_id).ok()?;
    if stored_sheet_id != *sheet_id {
        return None;
    }
    slicer.sheet_id = canonical_sheet_id(sheet_id);
    Some(slicer)
}

fn slicer_not_found(sheet_id: &SheetId, slicer_id: &str) -> ComputeError {
    ComputeError::SlicerNotFound {
        sheet_id: canonical_sheet_id(sheet_id),
        slicer_id: slicer_id.to_string(),
    }
}

fn replace_slicer(slicers_map: &MapRef, txn: &mut TransactionMut<'_>, slicer: &StoredSlicer) {
    slicers_map.remove(txn, &slicer.id);
    let entries = slicer_yrs::to_yrs_prelim(slicer);
    let nested: MapPrelim = entries.into_iter().collect();
    slicers_map.insert(txn, &*slicer.id, nested);
}

fn changed_slicer_update_fields(update: &StoredSlicerUpdate) -> Vec<String> {
    let mut fields = Vec::new();
    if update.caption.is_some() {
        fields.push("caption".to_string());
    }
    if update.name.is_some() {
        fields.push("name".to_string());
    }
    if update.style.is_some() {
        fields.push("style".to_string());
    }
    if update.position.is_some() {
        fields.push("position".to_string());
    }
    if update.z_index.is_some() {
        fields.push("zIndex".to_string());
    }
    if update.locked.is_some() {
        fields.push("locked".to_string());
    }
    if update.show_header.is_some() {
        fields.push("showHeader".to_string());
    }
    if update.start_item.is_some() {
        fields.push("startItem".to_string());
    }
    if update.multi_select.is_some() {
        fields.push("multiSelect".to_string());
    }
    fields
}

pub(in crate::storage::engine) fn create_slicer(
    stores: &EngineStores,
    sheet_id: &SheetId,
    config: StoredSlicer,
) -> Result<MutationResult, ComputeError> {
    let mut slicer = config;

    let receiver_sheet_id = canonical_sheet_id(sheet_id);
    let requested_owner = SheetId::from_uuid_str(&slicer.sheet_id).ok();
    if slicer.sheet_id.is_empty() || requested_owner != Some(*sheet_id) {
        return Err(ComputeError::SlicerSheetMismatch {
            receiver_sheet_id,
            requested_sheet_id: slicer.sheet_id,
        });
    }
    slicer.sheet_id = canonical_sheet_id(sheet_id);

    let workbook = stores.storage.workbook_map().clone();
    let mut txn = stores
        .storage
        .doc()
        .transact_mut_with(Origin::from(ORIGIN_USER_EDIT));
    let slicers_map = crate::storage::ensure_workbook_child_map(&workbook, &mut txn, KEY_SLICERS);

    if slicer.id.is_empty() {
        loop {
            let candidate = uuid::Uuid::from_u128(stores.id_alloc.next_u128()).to_string();
            if slicers_map.get(&txn, &candidate).is_none() {
                slicer.id = candidate;
                break;
            }
        }
    } else if slicers_map.get(&txn, &slicer.id).is_some() {
        return Err(ComputeError::SlicerIdConflict {
            slicer_id: slicer.id,
        });
    }

    let entries = slicer_yrs::to_yrs_prelim(&slicer);
    let nested: MapPrelim = entries.into_iter().collect();
    slicers_map.insert(&mut txn, &*slicer.id, nested);
    drop(txn);

    let mut result = MutationResult::empty().with_data(&slicer)?;
    result.slicer_changes.push(slicer_change(
        &slicer,
        SlicerChangeKind::Created,
        Vec::new(),
        None,
        None,
    ));
    Ok(result)
}

pub(in crate::storage::engine) fn delete_slicer(
    stores: &EngineStores,
    sheet_id: &SheetId,
    slicer_id: &str,
) -> Result<MutationResult, ComputeError> {
    let workbook = stores.storage.workbook_map().clone();
    let mut txn = stores
        .storage
        .doc()
        .transact_mut_with(Origin::from(ORIGIN_USER_EDIT));
    let slicers_map = match workbook.get(&txn, KEY_SLICERS) {
        Some(yrs::Out::YMap(map)) => map,
        _ => return Err(slicer_not_found(sheet_id, slicer_id)),
    };
    let existing = resolve_owned_slicer(&slicers_map, &txn, sheet_id, slicer_id)
        .ok_or_else(|| slicer_not_found(sheet_id, slicer_id))?;
    slicers_map.remove(&mut txn, slicer_id);
    drop(txn);
    let mut result = MutationResult::empty().with_data(&existing)?;
    result.slicer_changes.push(slicer_change(
        &existing,
        SlicerChangeKind::Deleted,
        Vec::new(),
        None,
        None,
    ));
    Ok(result)
}

pub(in crate::storage::engine) fn update_slicer_config(
    stores: &EngineStores,
    sheet_id: &SheetId,
    slicer_id: &str,
    update: &StoredSlicerUpdate,
) -> Result<MutationResult, ComputeError> {
    let updated_fields = changed_slicer_update_fields(update);
    let workbook = stores.storage.workbook_map().clone();
    let mut txn = stores
        .storage
        .doc()
        .transact_mut_with(Origin::from(ORIGIN_USER_EDIT));
    let slicers_map = match workbook.get(&txn, KEY_SLICERS) {
        Some(yrs::Out::YMap(map)) => map,
        _ => return Err(slicer_not_found(sheet_id, slicer_id)),
    };
    let mut slicer = resolve_owned_slicer(&slicers_map, &txn, sheet_id, slicer_id)
        .ok_or_else(|| slicer_not_found(sheet_id, slicer_id))?;
    slicer.apply_update(update);

    if updated_fields.is_empty() && update.selected_values.is_none() {
        return Ok(MutationResult::empty().with_data(&slicer)?);
    }

    replace_slicer(&slicers_map, &mut txn, &slicer);
    drop(txn);
    let mut result = MutationResult::empty().with_data(&slicer)?;
    if !updated_fields.is_empty() {
        result.slicer_changes.push(slicer_change(
            &slicer,
            SlicerChangeKind::Updated,
            updated_fields,
            None,
            None,
        ));
    }
    if update.selected_values.is_some() {
        let selection_change_type = if slicer.selected_values.is_empty() {
            SlicerSelectionChangeType::Clear
        } else {
            SlicerSelectionChangeType::Select
        };
        result.slicer_changes.push(slicer_change(
            &slicer,
            SlicerChangeKind::SelectionChanged,
            Vec::new(),
            Some(slicer.selected_values.clone()),
            Some(selection_change_type),
        ));
    }
    Ok(result)
}

pub(in crate::storage::engine) fn get_all_slicers(
    stores: &EngineStores,
    sheet_id: &SheetId,
) -> Vec<StoredSlicer> {
    let sheet_hex = canonical_sheet_id(sheet_id);
    let workbook = stores.storage.workbook_map();
    let txn = stores.storage.doc().transact();
    let mut results = Vec::new();
    if let Some(yrs::Out::YMap(slicers_map)) = workbook.get(&txn, KEY_SLICERS) {
        for (_key, value) in slicers_map.iter(&txn) {
            let slicer_opt = slicer_yrs::from_yrs_out(value, &txn);
            if let Some(slicer) = slicer_opt
                && SheetId::from_uuid_str(&slicer.sheet_id).ok() == Some(*sheet_id)
            {
                results.push(StoredSlicer {
                    sheet_id: sheet_hex.clone(),
                    ..slicer
                });
            }
        }
    }
    results
}

/// Get all slicers across all sheets in the workbook (no sheet filter).
pub(in crate::storage::engine) fn get_all_slicers_workbook(
    stores: &EngineStores,
) -> Vec<StoredSlicer> {
    let workbook = stores.storage.workbook_map();
    let txn = stores.storage.doc().transact();
    let mut results = Vec::new();
    if let Some(yrs::Out::YMap(slicers_map)) = workbook.get(&txn, KEY_SLICERS) {
        for (_key, value) in slicers_map.iter(&txn) {
            let slicer_opt = slicer_yrs::from_yrs_out(value, &txn);
            if let Some(slicer) = slicer_opt {
                results.push(slicer);
            }
        }
    }
    results
}

pub(in crate::storage::engine) fn get_slicer_state(
    stores: &EngineStores,
    sheet_id: &SheetId,
    slicer_id: &str,
) -> Option<StoredSlicer> {
    let workbook = stores.storage.workbook_map();
    let txn = stores.storage.doc().transact();
    if let Some(yrs::Out::YMap(slicers_map)) = workbook.get(&txn, KEY_SLICERS) {
        return resolve_owned_slicer(&slicers_map, &txn, sheet_id, slicer_id);
    }
    None
}

pub(in crate::storage::engine) fn toggle_slicer_item(
    stores: &EngineStores,
    sheet_id: &SheetId,
    slicer_id: &str,
    value: &CellValue,
) -> Result<MutationResult, ComputeError> {
    let workbook = stores.storage.workbook_map().clone();
    let mut txn = stores
        .storage
        .doc()
        .transact_mut_with(Origin::from(ORIGIN_USER_EDIT));
    let slicers_map = match workbook.get(&txn, KEY_SLICERS) {
        Some(yrs::Out::YMap(map)) => map,
        _ => return Err(slicer_not_found(sheet_id, slicer_id)),
    };
    let mut slicer = resolve_owned_slicer(&slicers_map, &txn, sheet_id, slicer_id)
        .ok_or_else(|| slicer_not_found(sheet_id, slicer_id))?;
    if let Some(pos) = slicer.selected_values.iter().position(|v| v == value) {
        slicer.selected_values.remove(pos);
    } else {
        slicer.selected_values.push(value.clone());
    }
    replace_slicer(&slicers_map, &mut txn, &slicer);
    drop(txn);
    let mut result = MutationResult::empty().with_data(&slicer)?;
    result.slicer_changes.push(slicer_change(
        &slicer,
        SlicerChangeKind::SelectionChanged,
        Vec::new(),
        Some(slicer.selected_values.clone()),
        Some(SlicerSelectionChangeType::Toggle),
    ));
    Ok(result)
}

pub(in crate::storage::engine) fn set_slicer_selection(
    stores: &EngineStores,
    sheet_id: &SheetId,
    slicer_id: &str,
    values: &[CellValue],
) -> Result<MutationResult, ComputeError> {
    let workbook = stores.storage.workbook_map().clone();
    let mut txn = stores
        .storage
        .doc()
        .transact_mut_with(Origin::from(ORIGIN_USER_EDIT));
    let slicers_map = match workbook.get(&txn, KEY_SLICERS) {
        Some(yrs::Out::YMap(map)) => map,
        _ => return Err(slicer_not_found(sheet_id, slicer_id)),
    };
    let mut slicer = resolve_owned_slicer(&slicers_map, &txn, sheet_id, slicer_id)
        .ok_or_else(|| slicer_not_found(sheet_id, slicer_id))?;
    slicer.selected_values = values.to_vec();
    replace_slicer(&slicers_map, &mut txn, &slicer);
    drop(txn);

    let selection_change_type = if slicer.selected_values.is_empty() {
        SlicerSelectionChangeType::Clear
    } else {
        SlicerSelectionChangeType::Select
    };
    let mut result = MutationResult::empty().with_data(&slicer)?;
    result.slicer_changes.push(slicer_change(
        &slicer,
        SlicerChangeKind::SelectionChanged,
        Vec::new(),
        Some(slicer.selected_values.clone()),
        Some(selection_change_type),
    ));
    Ok(result)
}

pub(in crate::storage::engine) fn clear_slicer_selection(
    stores: &EngineStores,
    sheet_id: &SheetId,
    slicer_id: &str,
) -> Result<MutationResult, ComputeError> {
    set_slicer_selection(stores, sheet_id, slicer_id, &[])
}
