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
use yrs::{Map, MapPrelim, Origin, Transact};

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
    if update.selected_values.is_some() {
        fields.push("selectedValues".to_string());
    }
    fields
}

pub(in crate::storage::engine) fn create_slicer(
    stores: &EngineStores,
    sheet_id: &SheetId,
    config: StoredSlicer,
) -> Result<MutationResult, ComputeError> {
    let mut slicer = config;

    if slicer.id.is_empty() {
        slicer.id = uuid::Uuid::from_u128(stores.grid_id_alloc.next_u128()).to_string();
    }

    slicer.sheet_id = format!("{:032x}", sheet_id.as_u128());

    let slicer_id = slicer.id.clone();

    {
        let workbook = stores.storage.workbook_map().clone();
        let mut txn = stores
            .storage
            .doc()
            .transact_mut_with(Origin::from(ORIGIN_USER_EDIT));
        let slicers_map =
            crate::storage::ensure_workbook_child_map(&workbook, &mut txn, KEY_SLICERS);
        slicers_map.remove(&mut txn, &slicer_id);
        let entries = slicer_yrs::to_yrs_prelim(&slicer);
        let nested: MapPrelim = entries.into_iter().collect();
        slicers_map.insert(&mut txn, &*slicer_id, nested);
    }

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
    slicer_id: &str,
) -> Result<MutationResult, ComputeError> {
    let existing = get_slicer_state(stores, slicer_id);
    let workbook = stores.storage.workbook_map().clone();
    let mut txn = stores
        .storage
        .doc()
        .transact_mut_with(Origin::from(ORIGIN_USER_EDIT));
    let slicers_map = crate::storage::ensure_workbook_child_map(&workbook, &mut txn, KEY_SLICERS);
    slicers_map.remove(&mut txn, slicer_id);
    let mut result = MutationResult::empty();
    if let Some(slicer) = existing {
        result.slicer_changes.push(slicer_change(
            &slicer,
            SlicerChangeKind::Deleted,
            Vec::new(),
            None,
            None,
        ));
    }
    Ok(result)
}

pub(in crate::storage::engine) fn update_slicer_config(
    stores: &EngineStores,
    slicer_id: &str,
    update: &StoredSlicerUpdate,
) -> Result<MutationResult, ComputeError> {
    let updated_fields = changed_slicer_update_fields(update);
    let workbook = stores.storage.workbook_map().clone();
    let mut txn = stores
        .storage
        .doc()
        .transact_mut_with(Origin::from(ORIGIN_USER_EDIT));
    let slicers_map = crate::storage::ensure_workbook_child_map(&workbook, &mut txn, KEY_SLICERS);
    let slicer_opt = match slicers_map.get(&txn, slicer_id) {
        Some(yrs::Out::YMap(nested)) => slicer_yrs::from_yrs_map(&nested, &txn),
        _ => None,
    };
    let mut result = MutationResult::empty();
    if let Some(mut slicer) = slicer_opt {
        slicer.apply_update(update);
        slicers_map.remove(&mut txn, slicer_id);
        let entries = slicer_yrs::to_yrs_prelim(&slicer);
        let nested: MapPrelim = entries.into_iter().collect();
        slicers_map.insert(&mut txn, slicer_id, nested);
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
        } else if !updated_fields.is_empty() {
            result.slicer_changes.push(slicer_change(
                &slicer,
                SlicerChangeKind::Updated,
                updated_fields,
                None,
                None,
            ));
        }
    }
    Ok(result)
}

pub(in crate::storage::engine) fn get_all_slicers(
    stores: &EngineStores,
    sheet_id: &SheetId,
) -> Vec<StoredSlicer> {
    let sheet_hex = format!("{:032x}", sheet_id.as_u128());
    let workbook = stores.storage.workbook_map();
    let txn = stores.storage.doc().transact();
    let mut results = Vec::new();
    if let Some(yrs::Out::YMap(slicers_map)) = workbook.get(&txn, KEY_SLICERS) {
        for (_key, value) in slicers_map.iter(&txn) {
            let slicer_opt = match value {
                yrs::Out::YMap(nested) => slicer_yrs::from_yrs_map(&nested, &txn),
                _ => None,
            };
            if let Some(slicer) = slicer_opt
                && slicer.sheet_id == sheet_hex
            {
                results.push(slicer);
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
            let slicer_opt = match value {
                yrs::Out::YMap(nested) => slicer_yrs::from_yrs_map(&nested, &txn),
                _ => None,
            };
            if let Some(slicer) = slicer_opt {
                results.push(slicer);
            }
        }
    }
    results
}

pub(in crate::storage::engine) fn get_slicer_state(
    stores: &EngineStores,
    slicer_id: &str,
) -> Option<StoredSlicer> {
    let workbook = stores.storage.workbook_map();
    let txn = stores.storage.doc().transact();
    if let Some(yrs::Out::YMap(slicers_map)) = workbook.get(&txn, KEY_SLICERS) {
        let slicer_opt = match slicers_map.get(&txn, slicer_id) {
            Some(yrs::Out::YMap(nested)) => slicer_yrs::from_yrs_map(&nested, &txn),
            _ => None,
        };
        return slicer_opt;
    }
    None
}

pub(in crate::storage::engine) fn toggle_slicer_item(
    stores: &EngineStores,
    slicer_id: &str,
    value: &CellValue,
) -> Result<MutationResult, ComputeError> {
    let workbook = stores.storage.workbook_map().clone();
    let mut txn = stores
        .storage
        .doc()
        .transact_mut_with(Origin::from(ORIGIN_USER_EDIT));
    let slicers_map = crate::storage::ensure_workbook_child_map(&workbook, &mut txn, KEY_SLICERS);
    let slicer_opt = match slicers_map.get(&txn, slicer_id) {
        Some(yrs::Out::YMap(nested)) => slicer_yrs::from_yrs_map(&nested, &txn),
        _ => None,
    };
    let mut result = MutationResult::empty();
    if let Some(mut slicer) = slicer_opt {
        if let Some(pos) = slicer.selected_values.iter().position(|v| v == value) {
            slicer.selected_values.remove(pos);
        } else {
            slicer.selected_values.push(value.clone());
        }
        slicers_map.remove(&mut txn, slicer_id);
        let entries = slicer_yrs::to_yrs_prelim(&slicer);
        let nested: MapPrelim = entries.into_iter().collect();
        slicers_map.insert(&mut txn, slicer_id, nested);
        result.slicer_changes.push(slicer_change(
            &slicer,
            SlicerChangeKind::SelectionChanged,
            Vec::new(),
            Some(slicer.selected_values.clone()),
            Some(SlicerSelectionChangeType::Toggle),
        ));
    }
    Ok(result)
}

pub(in crate::storage::engine) fn clear_slicer_selection(
    stores: &EngineStores,
    slicer_id: &str,
) -> Result<MutationResult, ComputeError> {
    let workbook = stores.storage.workbook_map().clone();
    let mut txn = stores
        .storage
        .doc()
        .transact_mut_with(Origin::from(ORIGIN_USER_EDIT));
    let slicers_map = crate::storage::ensure_workbook_child_map(&workbook, &mut txn, KEY_SLICERS);
    let slicer_opt = match slicers_map.get(&txn, slicer_id) {
        Some(yrs::Out::YMap(nested)) => slicer_yrs::from_yrs_map(&nested, &txn),
        _ => None,
    };
    let mut result = MutationResult::empty();
    if let Some(mut slicer) = slicer_opt {
        slicer.selected_values.clear();
        slicers_map.remove(&mut txn, slicer_id);
        let entries = slicer_yrs::to_yrs_prelim(&slicer);
        let nested: MapPrelim = entries.into_iter().collect();
        slicers_map.insert(&mut txn, slicer_id, nested);
        result.slicer_changes.push(slicer_change(
            &slicer,
            SlicerChangeKind::SelectionChanged,
            Vec::new(),
            Some(Vec::new()),
            Some(SlicerSelectionChangeType::Clear),
        ));
    }
    Ok(result)
}
