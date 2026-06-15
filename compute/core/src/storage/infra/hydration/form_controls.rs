use yrs::MapRef;

use super::IdAllocator;
use super::helpers::{PositionMap, get_or_create_cell_id_for_pos};
use crate::import::phantom::{parse_cell_ref, parse_range_ref};

pub(super) fn normalize_form_control_references_for_hydration(
    obj: &mut domain_types::domain::floating_object::FloatingObject,
    cells_map: &MapRef,
    pos_map: &mut PositionMap,
    txn: &mut yrs::TransactionMut,
    allocator: &mut impl IdAllocator,
) {
    let domain_types::domain::floating_object::FloatingObjectData::FormControl(control) =
        &mut obj.data
    else {
        return;
    };

    let linked_cell = control.cell_link.clone().or_else(|| {
        control
            .ooxml
            .as_ref()
            .and_then(|props| props.control_pr.as_ref())
            .and_then(|control_pr| control_pr.linked_cell.clone())
    });
    if let Some(cell_id) = linked_cell.as_deref().and_then(|reference| {
        resolve_form_control_cell_ref_to_id(reference, cells_map, pos_map, txn, allocator)
    }) {
        control.cell_link = Some(cell_id.clone());
        if let Some(control_pr) = control
            .ooxml
            .as_mut()
            .and_then(|props| props.control_pr.as_mut())
        {
            control_pr.linked_cell = Some(cell_id);
        }
    }

    let input_range = control.input_range.clone().or_else(|| {
        control
            .ooxml
            .as_ref()
            .and_then(|props| props.control_pr.as_ref())
            .and_then(|control_pr| control_pr.list_fill_range.clone())
    });
    if let Some(range_ref) = input_range.as_deref().and_then(|reference| {
        resolve_form_control_range_ref_to_identity_json(
            reference, cells_map, pos_map, txn, allocator,
        )
    }) {
        control.input_range = Some(range_ref.clone());
        if let Some(control_pr) = control
            .ooxml
            .as_mut()
            .and_then(|props| props.control_pr.as_mut())
        {
            control_pr.list_fill_range = Some(range_ref);
        }
    }
}

fn resolve_form_control_cell_ref_to_id(
    reference: &str,
    cells_map: &MapRef,
    pos_map: &mut PositionMap,
    txn: &mut yrs::TransactionMut,
    allocator: &mut impl IdAllocator,
) -> Option<String> {
    let normalized = normalize_form_control_reference(reference)?;
    let (row, col) = parse_cell_ref(&normalized)?;
    Some(get_or_create_cell_id_for_pos(
        cells_map, pos_map, txn, row, col, allocator,
    ))
}

fn resolve_form_control_range_ref_to_identity_json(
    reference: &str,
    cells_map: &MapRef,
    pos_map: &mut PositionMap,
    txn: &mut yrs::TransactionMut,
    allocator: &mut impl IdAllocator,
) -> Option<String> {
    let normalized = normalize_form_control_reference(reference)?;
    let (start_row, start_col, end_row, end_col) = parse_range_ref(&normalized)?;
    let start_id =
        get_or_create_cell_id_for_pos(cells_map, pos_map, txn, start_row, start_col, allocator);
    let end_id =
        get_or_create_cell_id_for_pos(cells_map, pos_map, txn, end_row, end_col, allocator);

    Some(
        serde_json::json!({
            "type": "range",
            "startId": start_id,
            "endId": end_id,
            "startRowAbsolute": true,
            "startColAbsolute": true,
            "endRowAbsolute": true,
            "endColAbsolute": true,
        })
        .to_string(),
    )
}

fn normalize_form_control_reference(reference: &str) -> Option<String> {
    let mut normalized = reference.trim();
    if normalized.is_empty() || normalized.starts_with('{') {
        return None;
    }
    if (normalized.starts_with('"') && normalized.ends_with('"'))
        || (normalized.starts_with('\'') && normalized.ends_with('\''))
    {
        let quote = if normalized.starts_with('"') {
            '"'
        } else {
            '\''
        };
        normalized = normalized
            .strip_prefix(quote)
            .and_then(|value| value.strip_suffix(quote))
            .unwrap_or(normalized);
    }
    if let Some(rest) = normalized.strip_prefix('=') {
        normalized = rest.trim();
    }
    if let Some((_, local_ref)) = normalized.rsplit_once('!') {
        normalized = local_ref.trim();
    }
    (!normalized.is_empty()).then(|| normalized.to_string())
}
