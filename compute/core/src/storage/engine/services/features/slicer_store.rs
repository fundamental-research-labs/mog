use crate::snapshot::{MutationResult, SlicerChange, SlicerChangeKind, SlicerSourceType};
use crate::storage::engine::history::metadata::capture_workbook_entry;
use crate::storage::engine::stores::EngineStores;
use cell_types::SheetId;
use domain_types::domain::slicer::{
    SlicerSelectionChangeType, SlicerSource, StoredSlicer, StoredSlicerUpdate,
};
use value_types::{CellValue, ComputeError};

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
fn resolve_owned_slicer(
    stores: &EngineStores,
    sheet_id: &SheetId,
    slicer_id: &str,
) -> Option<StoredSlicer> {
    let mut slicer = stores.storage.metadata.slicers.get(slicer_id)?.clone();
    if SheetId::from_uuid_str(&slicer.sheet_id).ok()? != *sheet_id {
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
    stores: &mut EngineStores,
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

    if slicer.id.is_empty() {
        loop {
            let candidate = uuid::Uuid::from_u128(stores.id_alloc.next_u128()).to_string();
            if !stores.storage.metadata.slicers.contains_key(&candidate) {
                slicer.id = candidate;
                break;
            }
        }
    } else if stores.storage.metadata.slicers.contains_key(&slicer.id) {
        return Err(ComputeError::SlicerIdConflict {
            slicer_id: slicer.id,
        });
    }

    capture_workbook_entry!(stores.storage, slicers, slicer.id);
    stores
        .storage
        .metadata
        .slicers
        .insert(slicer.id.clone(), slicer.clone());

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
    stores: &mut EngineStores,
    sheet_id: &SheetId,
    slicer_id: &str,
) -> Result<MutationResult, ComputeError> {
    let existing = resolve_owned_slicer(stores, sheet_id, slicer_id)
        .ok_or_else(|| slicer_not_found(sheet_id, slicer_id))?;
    capture_workbook_entry!(stores.storage, slicers, slicer_id);
    stores.storage.metadata.slicers.remove(slicer_id);
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

pub(in crate::storage::engine) fn delete_slicers(
    stores: &mut EngineStores,
    sheet_id: &SheetId,
    slicer_ids: &[String],
) -> Result<MutationResult, ComputeError> {
    if slicer_ids.is_empty() {
        return Ok(MutationResult::empty());
    }

    // Treat repeated IDs as one requested entity while preserving the caller's
    // order for deterministic mutation evidence.
    let mut unique_ids = Vec::with_capacity(slicer_ids.len());
    for slicer_id in slicer_ids {
        if !unique_ids.iter().any(|existing| *existing == slicer_id) {
            unique_ids.push(slicer_id);
        }
    }

    // Resolve the complete request before the first write so a stale or
    // wrong-sheet ID cannot turn a bulk delete into a partial delete.
    let mut existing = Vec::with_capacity(unique_ids.len());
    for slicer_id in &unique_ids {
        let slicer = resolve_owned_slicer(stores, sheet_id, slicer_id)
            .ok_or_else(|| slicer_not_found(sheet_id, slicer_id))?;
        existing.push(slicer);
    }

    for slicer_id in unique_ids {
        capture_workbook_entry!(stores.storage, slicers, slicer_id);
        stores.storage.metadata.slicers.remove(slicer_id);
    }

    let mut result = MutationResult::empty();
    for slicer in existing {
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
    stores: &mut EngineStores,
    sheet_id: &SheetId,
    slicer_id: &str,
    update: &StoredSlicerUpdate,
) -> Result<MutationResult, ComputeError> {
    let updated_fields = changed_slicer_update_fields(update);
    let mut slicer = resolve_owned_slicer(stores, sheet_id, slicer_id)
        .ok_or_else(|| slicer_not_found(sheet_id, slicer_id))?;
    slicer.apply_update(update);

    if updated_fields.is_empty() && update.selected_values.is_none() {
        return Ok(MutationResult::empty().with_data(&slicer)?);
    }

    capture_workbook_entry!(stores.storage, slicers, slicer.id);
    stores
        .storage
        .metadata
        .slicers
        .insert(slicer.id.clone(), slicer.clone());
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
    stores
        .storage
        .metadata
        .slicers
        .values()
        .filter_map(|slicer| {
            (SheetId::from_uuid_str(&slicer.sheet_id).ok() == Some(*sheet_id)).then(|| {
                StoredSlicer {
                    sheet_id: canonical_sheet_id(sheet_id),
                    ..slicer.clone()
                }
            })
        })
        .collect()
}

pub(in crate::storage::engine) fn get_all_slicers_workbook(
    stores: &EngineStores,
) -> Vec<StoredSlicer> {
    stores.storage.metadata.slicers.values().cloned().collect()
}

pub(in crate::storage::engine) fn get_slicer_state(
    stores: &EngineStores,
    sheet_id: &SheetId,
    slicer_id: &str,
) -> Option<StoredSlicer> {
    resolve_owned_slicer(stores, sheet_id, slicer_id)
}

pub(in crate::storage::engine) fn toggle_slicer_item(
    stores: &mut EngineStores,
    sheet_id: &SheetId,
    slicer_id: &str,
    value: &CellValue,
) -> Result<MutationResult, ComputeError> {
    let mut slicer = resolve_owned_slicer(stores, sheet_id, slicer_id)
        .ok_or_else(|| slicer_not_found(sheet_id, slicer_id))?;
    if let Some(pos) = slicer.selected_values.iter().position(|v| v == value) {
        slicer.selected_values.remove(pos);
    } else {
        slicer.selected_values.push(value.clone());
    }
    capture_workbook_entry!(stores.storage, slicers, slicer.id);
    stores
        .storage
        .metadata
        .slicers
        .insert(slicer.id.clone(), slicer.clone());
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
    stores: &mut EngineStores,
    sheet_id: &SheetId,
    slicer_id: &str,
    values: &[CellValue],
) -> Result<MutationResult, ComputeError> {
    let mut slicer = resolve_owned_slicer(stores, sheet_id, slicer_id)
        .ok_or_else(|| slicer_not_found(sheet_id, slicer_id))?;
    let mut normalized_values = Vec::with_capacity(values.len());
    for value in values {
        if !normalized_values.iter().any(|existing| existing == value) {
            normalized_values.push(value.clone());
        }
    }
    slicer.selected_values = normalized_values;
    capture_workbook_entry!(stores.storage, slicers, slicer.id);
    stores
        .storage
        .metadata
        .slicers
        .insert(slicer.id.clone(), slicer.clone());

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
    stores: &mut EngineStores,
    sheet_id: &SheetId,
    slicer_id: &str,
) -> Result<MutationResult, ComputeError> {
    set_slicer_selection(stores, sheet_id, slicer_id, &[])
}
