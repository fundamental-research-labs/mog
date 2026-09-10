//! Per-sheet metadata export functions.
//!
//! Extracted from the monolithic `export.rs` — covers hyperlinks, data
//! validations, sheet protection, sparklines, page breaks, auto filter,
//! outline groups, floating objects, and conditional formats.

use std::collections::HashSet;

use cell_types::{CellId, SheetId, SheetPos};
use compute_document::hex::{hex_to_id, id_to_hex};
use domain_types::{
    domain::conditional_format::ConditionalFormat as DomainConditionalFormat,
    domain::filter::{AutoFilter, SortState},
    domain::floating_object::{FloatingObject, FloatingObjectData, FormControlOoxmlProps},
    domain::grouping::SheetGroupingConfig,
    domain::hyperlink::Hyperlink,
    domain::outline::OutlineGroup,
    domain::print::PageBreaks,
    domain::protection::SheetProtection,
    domain::sparkline::{Sparkline as DomainSparkline, SparklineGroup},
    domain::validation::ValidationSpec,
};
use value_types::CellValue;

use crate::cells::CellStore;
use crate::import::phantom::{parse_cell_ref, parse_range_ref};
use crate::range_manager::pos_to_a1;
use crate::storage::sheet::{cf_store, hyperlinks, schemas};

use crate::storage::engine::stores::EngineStores;

// -------------------------------------------------------------------
// Hyperlinks export
// -------------------------------------------------------------------

/// Export native hyperlink metadata in authored order at current coordinates.
pub(in crate::storage::engine) fn export_hyperlinks_for_sheet(
    stores: &EngineStores,
    cell_store: &CellStore,
    sheet_id: &SheetId,
) -> Vec<Hyperlink> {
    cell_store
        .get_sheet(sheet_id)
        .map(|sheet| hyperlinks::get_all_hyperlinks(&stores.storage, sheet_id, sheet))
        .unwrap_or_default()
}

// -------------------------------------------------------------------
// Data validation helpers
// -------------------------------------------------------------------

pub(in crate::storage::engine) fn export_dv_disable_prompts(
    stores: &EngineStores,
    sheet_id: &SheetId,
) -> bool {
    stores
        .storage
        .sheet_metadata
        .get(sheet_id)
        .is_some_and(|metadata| metadata.validations.disable_prompts)
}
pub(in crate::storage::engine) fn export_dv_x_window(
    stores: &EngineStores,
    sheet_id: &SheetId,
) -> Option<u32> {
    stores
        .storage
        .sheet_metadata
        .get(sheet_id)?
        .validations
        .x_window
}
pub(in crate::storage::engine) fn export_dv_y_window(
    stores: &EngineStores,
    sheet_id: &SheetId,
) -> Option<u32> {
    stores
        .storage
        .sheet_metadata
        .get(sheet_id)?
        .validations
        .y_window
}
pub(in crate::storage::engine) fn export_dv_declared_count(
    stores: &EngineStores,
    sheet_id: &SheetId,
) -> Option<u32> {
    stores
        .storage
        .sheet_metadata
        .get(sheet_id)?
        .validations
        .declared_count
}

/// Export data validations from the canonical range-backed validation store.
pub(in crate::storage::engine) fn export_data_validations_for_sheet(
    stores: &EngineStores,
    sheet_id: &SheetId,
) -> Vec<ValidationSpec> {
    schemas::get_validation_specs_for_sheet(&stores.storage, sheet_id)
}

// -------------------------------------------------------------------
// Sheet protection
// -------------------------------------------------------------------

/// Export sheet protection from native sheet metadata.
/// Falls back to legacy JSON string.
pub(in crate::storage::engine) fn export_sheet_protection(
    stores: &EngineStores,
    sheet_id: &SheetId,
) -> Option<SheetProtection> {
    stores
        .storage
        .sheet_metadata
        .get(sheet_id)?
        .protection
        .clone()
}

// -------------------------------------------------------------------
// Sparklines
// -------------------------------------------------------------------

/// Export native sparkline definitions.
pub(in crate::storage::engine) fn export_sparklines_for_sheet(
    stores: &EngineStores,
    sheet_id: &SheetId,
) -> Vec<DomainSparkline> {
    crate::storage::sheet::sparklines::get_sparklines_in_sheet(&stores.storage, sheet_id)
}

/// Export native sparkline group definitions.
pub(in crate::storage::engine) fn export_sparkline_groups_for_sheet(
    stores: &EngineStores,
    sheet_id: &SheetId,
) -> Vec<SparklineGroup> {
    crate::storage::sheet::sparklines::get_sparkline_groups_in_sheet(&stores.storage, sheet_id)
}

// -------------------------------------------------------------------
// Page breaks
// -------------------------------------------------------------------

/// Export page breaks from sheet metadata.
pub(in crate::storage::engine) fn export_page_breaks_for_sheet(
    stores: &EngineStores,
    sheet_id: &SheetId,
) -> Option<PageBreaks> {
    stores
        .storage
        .sheet_metadata
        .get(sheet_id)?
        .page_breaks
        .clone()
}

// -------------------------------------------------------------------
// Auto filter
// -------------------------------------------------------------------

/// Export auto filter — prefers the lossless typed `AutoFilter` written to
/// `properties/autoFilter` during hydration (canonical XLSX-round-trip shape).
/// Falls back to reconstructing from the runtime `FilterState` so filters
/// created via the runtime API (which doesn't touch `properties/autoFilter`)
/// still export; that fallback is lossy — it drops CT_AutoFilter extensions
/// (calendarType, filterVal, Dynamic ISO values, Color dxfId, Icon, button
/// attrs) and is acceptable only because the runtime never populates those.
///
/// Takes a `pos_resolver` closure to resolve cell_id hex strings to (row, col)
/// for the fallback path.
pub(in crate::storage::engine) fn export_auto_filter_for_sheet(
    stores: &EngineStores,
    sheet_id: &SheetId,
    pos_resolver: &impl Fn(&str) -> Option<(u32, u32)>,
) -> Option<AutoFilter> {
    use crate::storage::sheet::filters;
    use domain_types::domain::filter::{FilterKind, filter_state_to_auto_filter};

    let all_filters = filters::get_filters_in_sheet(&stores.storage, sheet_id);
    let auto_filter_state = all_filters
        .into_iter()
        .find(|f| f.filter_kind == FilterKind::AutoFilter)?;

    let binding =
        filters::get_filter_metadata_binding(&stores.storage, sheet_id, &auto_filter_state.id);
    let binding_allows_lossless_export = binding.as_ref().is_none_or(|binding| {
        matches!(
            &binding.owner_path,
            filters::FilterMetadataOwnerPath::SheetAutoFilter { sheet_id: owner_sheet_id }
                if owner_sheet_id == &sheet_id.to_uuid_string()
        )
    });

    if binding_allows_lossless_export
        && let Some(auto_filter) = stores
            .storage
            .sheet_metadata
            .get(sheet_id)
            .and_then(|metadata| metadata.auto_filter.clone())
    {
        return Some(auto_filter);
    }

    // Fallback: reconstruct from runtime FilterState (lossy for round-trip-only
    // fields — see function doc). Only fires for filters created via runtime
    // API without going through XLSX import.
    filter_state_to_auto_filter(&auto_filter_state, pos_resolver)
}

// -------------------------------------------------------------------
// Standalone worksheet sort state
// -------------------------------------------------------------------

/// Export standalone worksheet-level sort state from `properties/sortState`.
///
/// This intentionally does not fall back to runtime `FilterSortState`: the
/// worksheet OOXML contract carries attributes that runtime filter sorting does
/// not model.
pub(in crate::storage::engine) fn export_sort_state_for_sheet(
    stores: &EngineStores,
    sheet_id: &SheetId,
) -> Option<SortState> {
    stores
        .storage
        .sheet_metadata
        .get(sheet_id)?
        .sort_state
        .clone()
}

// -------------------------------------------------------------------
// Outline groups
// -------------------------------------------------------------------

/// Project native outline groups into the XLSX domain.
pub(in crate::storage::engine) fn export_outline_groups_for_sheet(
    stores: &EngineStores,
    sheet_id: &SheetId,
) -> (
    Vec<OutlineGroup>,
    Option<ooxml_types::worksheet::OutlineProperties>,
) {
    let config =
        crate::storage::sheet::grouping::get_sheet_grouping_config(&stores.storage, sheet_id);
    if config == SheetGroupingConfig::default() {
        return (vec![], None);
    }
    let (groups, derived_outline) =
        domain_types::domain::grouping::grouping_config_to_outline_groups(&config);
    let outline = stores
        .storage
        .sheet_metadata
        .get(sheet_id)
        .and_then(|meta| meta.properties.as_ref())
        .and_then(|properties| properties.outline_pr.clone())
        .unwrap_or(derived_outline);
    (groups, Some(outline))
}

// -------------------------------------------------------------------
// Floating objects
// -------------------------------------------------------------------

/// Export floating objects from native sheet metadata.
pub(in crate::storage::engine) fn export_floating_objects_for_sheet(
    stores: &EngineStores,
    cell_store: &CellStore,
    sheet_id: &SheetId,
) -> (
    Vec<FloatingObject>,
    Vec<ooxml_types::slicers::SlicerDef>,
    Vec<ooxml_types::slicers::SlicerAnchor>,
    Vec<ooxml_types::timelines::TimelineDef>,
    Vec<ooxml_types::timelines::TimelineAnchor>,
) {
    let mut floating_objects = Vec::new();
    if let Some(metadata) = stores.storage.sheet_metadata.get(sheet_id) {
        let state = &metadata.floating_objects;
        let mut seen = HashSet::new();
        for id in &state.order {
            if seen.insert(id.as_str()) {
                if let Some(object) = state.objects.get(id) {
                    floating_objects.push(object.as_ref().clone());
                }
            }
        }
        let mut remaining: Vec<_> = state
            .objects
            .iter()
            .filter(|(id, _)| !seen.contains(id.as_str()))
            .collect();
        remaining.sort_by(|(left_id, left), (right_id, right)| {
            left.common
                .z_index
                .cmp(&right.common.z_index)
                .then_with(|| left_id.cmp(right_id))
        });
        floating_objects.extend(
            remaining
                .into_iter()
                .map(|(_, object)| object.as_ref().clone()),
        );
    }
    floating_objects.sort_by_key(|object| object.common.z_index);
    let mut slicers = Vec::new();
    let mut slicer_anchors = Vec::new();
    let mut timelines = Vec::new();
    let mut timeline_anchors = Vec::new();
    let mut stored_slicers: Vec<_> = stores
        .storage
        .metadata
        .slicers
        .values()
        .filter(|stored| SheetId::from_uuid_str(&stored.sheet_id).ok().as_ref() == Some(sheet_id))
        .collect();
    stored_slicers.sort_by(|a, b| a.z_index.cmp(&b.z_index).then_with(|| a.id.cmp(&b.id)));
    for stored in stored_slicers {
        slicers.push(domain_types::domain::slicer::stored_slicer_to_slicer_def(
            stored,
        ));
        if let Some(anchor) = domain_types::domain::slicer::stored_slicer_to_anchor(stored) {
            slicer_anchors.push(anchor);
        }
    }
    let mut stored_timelines: Vec<_> = stores
        .storage
        .metadata
        .timelines
        .values()
        .filter(|stored| SheetId::from_uuid_str(&stored.sheet_id).ok().as_ref() == Some(sheet_id))
        .collect();
    stored_timelines.sort_by(|a, b| a.z_index.cmp(&b.z_index).then_with(|| a.id.cmp(&b.id)));
    for stored in stored_timelines {
        timelines.push(domain_types::domain::slicer::stored_timeline_to_timeline_def(stored));
        if let Some(anchor) = domain_types::domain::slicer::stored_timeline_to_anchor(stored) {
            timeline_anchors.push(anchor);
        }
    }

    if let Some(sheet) = cell_store.get_sheet(sheet_id) {
        for object in &mut floating_objects {
            crate::storage::sheet::floating_objects::project_anchor_positions(object, sheet);
        }
    }
    project_form_control_references_for_export(&mut floating_objects, cell_store, sheet_id);

    (
        floating_objects,
        slicers,
        slicer_anchors,
        timelines,
        timeline_anchors,
    )
}

fn project_form_control_references_for_export(
    objects: &mut [FloatingObject],
    cell_store: &CellStore,
    sheet_id: &SheetId,
) {
    for obj in objects {
        let FloatingObjectData::FormControl(control) = &mut obj.data else {
            continue;
        };

        let linked_ref = control.cell_link.clone().or_else(|| {
            control
                .ooxml
                .as_ref()
                .and_then(|props| props.control_pr.as_ref())
                .and_then(|control_pr| control_pr.linked_cell.clone())
        });
        let linked_cell_a1 = linked_ref
            .as_deref()
            .and_then(|reference| form_control_cell_ref_to_abs_a1(cell_store, sheet_id, reference));
        let checked_state = if is_checkbox_control_type(&control.control_type) {
            linked_ref
                .as_deref()
                .and_then(|reference| form_control_cell_ref_to_pos(cell_store, sheet_id, reference))
                .and_then(|(row, col)| {
                    cell_store.get_cell_value_at(sheet_id, SheetPos::new(row, col))
                })
                .and_then(checkbox_state_from_value)
        } else {
            None
        };

        if let Some(a1) = linked_cell_a1 {
            control.cell_link = Some(a1.clone());
            if let Some(control_pr) = control
                .ooxml
                .as_mut()
                .and_then(|props| props.control_pr.as_mut())
            {
                control_pr.linked_cell = Some(a1);
            }
        }

        let input_range = control.input_range.clone().or_else(|| {
            control
                .ooxml
                .as_ref()
                .and_then(|props| props.control_pr.as_ref())
                .and_then(|control_pr| control_pr.list_fill_range.clone())
        });
        if let Some(range_ref) = input_range
            .as_deref()
            .and_then(|reference| form_control_range_ref_to_abs_a1(cell_store, sheet_id, reference))
        {
            control.input_range = Some(range_ref.clone());
            if let Some(control_pr) = control
                .ooxml
                .as_mut()
                .and_then(|props| props.control_pr.as_mut())
            {
                control_pr.list_fill_range = Some(range_ref);
            }
        }

        if let Some(state) = checked_state {
            let props = control
                .ooxml
                .get_or_insert_with(FormControlOoxmlProps::default);
            props.checked = Some(state.to_string());
        }
    }
}

fn form_control_cell_ref_to_abs_a1(
    cell_store: &CellStore,
    sheet_id: &SheetId,
    reference: &str,
) -> Option<String> {
    let (row, col) = form_control_cell_ref_to_pos(cell_store, sheet_id, reference)?;
    Some(absolute_a1(row, col))
}

fn form_control_cell_ref_to_pos(
    cell_store: &CellStore,
    sheet_id: &SheetId,
    reference: &str,
) -> Option<(u32, u32)> {
    if let Some(cell_hex) = form_control_cell_id_hex(reference)
        && let Some(pos) = super::resolve_cell_position(cell_store, sheet_id, &cell_hex)
    {
        return Some(pos);
    }
    let normalized = normalize_form_control_reference(reference)?;
    parse_cell_ref(&normalized)
}

fn form_control_range_ref_to_abs_a1(
    cell_store: &CellStore,
    sheet_id: &SheetId,
    reference: &str,
) -> Option<String> {
    let (start_row, start_col, end_row, end_col) =
        form_control_range_ref_to_positions(cell_store, sheet_id, reference)?;
    Some(format!(
        "{}:{}",
        absolute_a1(start_row, start_col),
        absolute_a1(end_row, end_col)
    ))
}

fn form_control_range_ref_to_positions(
    cell_store: &CellStore,
    sheet_id: &SheetId,
    reference: &str,
) -> Option<(u32, u32, u32, u32)> {
    let trimmed = reference.trim();
    if trimmed.starts_with('{') {
        let value: serde_json::Value = serde_json::from_str(trimmed).ok()?;
        if value.get("type").and_then(|v| v.as_str()) != Some("range") {
            return None;
        }
        let start_id = value.get("startId").and_then(|v| v.as_str())?;
        let end_id = value.get("endId").and_then(|v| v.as_str())?;
        let (start_row, start_col) = form_control_cell_ref_to_pos(cell_store, sheet_id, start_id)?;
        let (end_row, end_col) = form_control_cell_ref_to_pos(cell_store, sheet_id, end_id)?;
        return Some((start_row, start_col, end_row, end_col));
    }

    let normalized = normalize_form_control_reference(reference)?;
    parse_range_ref(&normalized)
}

fn form_control_cell_id_hex(reference: &str) -> Option<String> {
    let trimmed = reference.trim();
    if hex_to_id(trimmed).is_some() {
        return Some(trimmed.to_ascii_lowercase());
    }
    CellId::from_uuid_str(trimmed)
        .ok()
        .map(|id| id_to_hex(id.as_u128()).to_string())
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

fn absolute_a1(row: u32, col: u32) -> String {
    let reference = pos_to_a1(row, col);
    let split_at = reference
        .find(|ch: char| ch.is_ascii_digit())
        .unwrap_or(reference.len());
    let (col_ref, row_ref) = reference.split_at(split_at);
    format!("${}${}", col_ref, row_ref)
}

fn is_checkbox_control_type(control_type: &str) -> bool {
    matches!(
        control_type.to_ascii_lowercase().as_str(),
        "checkbox" | "check_box" | "check box"
    )
}

fn checkbox_state_from_value(value: &CellValue) -> Option<&'static str> {
    match value {
        CellValue::Boolean(checked) => Some(if *checked { "Checked" } else { "Unchecked" }),
        CellValue::Number(number) => Some(if number.get() != 0.0 {
            "Checked"
        } else {
            "Unchecked"
        }),
        CellValue::Text(text) => match text.trim().to_ascii_lowercase().as_str() {
            "true" | "checked" | "1" => Some("Checked"),
            "false" | "unchecked" | "0" | "" => Some("Unchecked"),
            _ => None,
        },
        CellValue::Null => Some("Unchecked"),
        CellValue::Control(control) => Some(if control.checked {
            "Checked"
        } else {
            "Unchecked"
        }),
        CellValue::Error(..) | CellValue::Array(_) | CellValue::Image(_) => None,
    }
}

// -------------------------------------------------------------------
// Conditional formats
// -------------------------------------------------------------------

/// Export conditional formats for a sheet.
pub(in crate::storage::engine) fn export_conditional_formats_for_sheet(
    stores: &EngineStores,
    sheet_id: &SheetId,
) -> Vec<DomainConditionalFormat> {
    cf_store::get_formats_for_sheet(&stores.storage, sheet_id)
}
