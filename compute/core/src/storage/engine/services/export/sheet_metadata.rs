//! Per-sheet metadata export functions.
//!
//! Extracted from the monolithic `export.rs` — covers hyperlinks, data
//! validations, sheet protection, sparklines, page breaks, auto filter,
//! outline groups, floating objects, and conditional formats.

use std::collections::{HashMap, HashSet};

use cell_types::{CellId, SheetId, SheetPos};
use compute_document::hex::{hex_to_id, id_to_hex};
use compute_document::schema::*;
use domain_types::{
    domain::conditional_format::ConditionalFormat as DomainConditionalFormat,
    domain::filter::{AutoFilter, SortState},
    domain::floating_object::{FloatingObject, FloatingObjectData, FormControlOoxmlProps},
    domain::grouping::SheetGroupingConfig,
    domain::hyperlink::{Hyperlink, HyperlinkTargetKind},
    domain::outline::OutlineGroup,
    domain::print::PageBreaks,
    domain::protection::SheetProtection,
    domain::sparkline::{Sparkline as DomainSparkline, SparklineGroup},
    domain::validation::ValidationSpec,
    yrs_schema,
};
use value_types::CellValue;
use yrs::{Any, Array, Map, Out, Transact};

use crate::import::phantom::{parse_cell_ref, parse_range_ref};
use crate::mirror::CellMirror;
use crate::range_manager::pos_to_a1;
use crate::storage::sheet::{cf_store, hyperlinks, print, schemas};

use super::super::super::export::sorted_map_entries;
use crate::storage::engine::stores::EngineStores;

// -------------------------------------------------------------------
// Resolve cell position
// -------------------------------------------------------------------

/// Resolve a cell_id hex to (row, col) via the in-memory GridIndex —
/// the authoritative runtime store for cell position.
///
/// Catches cells that are registered in GridIndex but not materialised
/// in CellMirror (e.g., style-only cells, comment-only cells).
pub(super) fn resolve_cell_position_from_grid_index(
    stores: &EngineStores,
    sheet_id: &SheetId,
    cell_id_hex: &str,
) -> Option<(u32, u32)> {
    let grid = stores.grid_indexes.get(sheet_id)?;
    let raw_id = compute_document::hex::hex_to_id(cell_id_hex)?;
    let cell_id = cell_types::CellId::from_raw(raw_id);
    grid.cell_position(&cell_id)
}

/// Resolve a hydrated comment/note target through the runtime GridIndex.
///
/// Imported comments store `cell_ref` as a CellId hex string. The authoritative
/// path for turning that identity back into A1 is the GridIndex hydrated from
/// Yrs `gridIndex/{posToId,idToPos}`.
pub(super) fn resolve_hydrated_comment_position(
    stores: &EngineStores,
    sheet_id: &SheetId,
    cell_id_hex: &str,
) -> Option<(u32, u32)> {
    resolve_cell_position_from_grid_index(stores, sheet_id, cell_id_hex)
}

// -------------------------------------------------------------------
// Hyperlinks export
// -------------------------------------------------------------------

/// Export all hyperlinks for a sheet, reading both cell-level hyperlinks
/// and any range hyperlinks stored in the sheet meta.
///
/// Position resolution is handled by `GridIndex` (the sole identity authority);
/// no external resolver is needed.
pub(in crate::storage::engine) fn export_hyperlinks_for_sheet(
    stores: &EngineStores,
    sheet_id: &SheetId,
) -> Vec<Hyperlink> {
    let mut result = match stores.grid_indexes.get(sheet_id) {
        Some(grid) => hyperlinks::get_all_hyperlinks(
            stores.storage.doc(),
            stores.storage.sheets(),
            sheet_id,
            grid,
        ),
        None => Vec::new(),
    };

    let sheet_hex = id_to_hex(sheet_id.as_u128());
    let txn = stores.storage.doc().transact();
    if let Some(Out::YMap(sheet_map)) = stores.storage.sheets().get(&txn, &sheet_hex)
        && let Some(Out::YMap(meta)) = sheet_map.get(&txn, compute_document::schema::KEY_PROPERTIES)
        && let Some(Out::Any(yrs::Any::String(json))) = meta.get(&txn, "rangeHyperlinks")
        && let Ok(entries) = serde_json::from_str::<Vec<serde_json::Value>>(&json)
    {
        for entry in entries {
            let cell_ref = entry
                .get("ref")
                .and_then(|v| v.as_str())
                .unwrap_or_default()
                .to_string();
            let target = entry
                .get("target")
                .and_then(|v| v.as_str())
                .map(|s| s.to_string());
            let location = entry
                .get("location")
                .and_then(|v| v.as_str())
                .map(|s| s.to_string());
            let display = entry
                .get("display")
                .and_then(|v| v.as_str())
                .map(|s| s.to_string());
            let tooltip = entry
                .get("tooltip")
                .and_then(|v| v.as_str())
                .map(|s| s.to_string());
            let uid = entry
                .get("uid")
                .and_then(|v| v.as_str())
                .map(|s| s.to_string());
            let target_kind = entry
                .get("targetKind")
                .and_then(|v| v.as_str())
                .and_then(target_kind_from_str);
            let target_mode = entry
                .get("targetMode")
                .and_then(|v| v.as_str())
                .map(|s| s.to_string());
            result.push(Hyperlink {
                cell_ref,
                target,
                location,
                display,
                tooltip,
                uid,
                target_kind,
                target_mode,
            });
        }
    }

    result
}

fn target_kind_from_str(value: &str) -> Option<HyperlinkTargetKind> {
    match value {
        "inlineLocation" => Some(HyperlinkTargetKind::InlineLocation),
        "relationship" => Some(HyperlinkTargetKind::Relationship),
        _ => None,
    }
}

// -------------------------------------------------------------------
// Data validation helpers
// -------------------------------------------------------------------

/// Export the container-level `disablePrompts` flag for data validations.
pub(in crate::storage::engine) fn export_dv_disable_prompts(
    stores: &EngineStores,
    sheet_id: &SheetId,
) -> bool {
    export_meta_bool(stores, sheet_id, "dvDisablePrompts")
}

fn export_meta_bool(stores: &EngineStores, sheet_id: &SheetId, key: &str) -> bool {
    let sheet_hex = id_to_hex(sheet_id.as_u128());
    let doc = stores.storage.doc();
    let txn = doc.transact();
    let sheets = stores.storage.sheets();

    let sheet_map = match sheets.get(&txn, &sheet_hex) {
        Some(Out::YMap(m)) => m,
        _ => return false,
    };
    let meta_map = match sheet_map.get(&txn, KEY_PROPERTIES) {
        Some(Out::YMap(m)) => m,
        _ => return false,
    };

    match meta_map.get(&txn, key) {
        Some(Out::Any(Any::Bool(b))) => b,
        _ => false,
    }
}

/// Export a container-level u32 attribute from sheet meta (e.g. dvXWindow, dvYWindow).
pub(in crate::storage::engine) fn export_dv_window_attr(
    stores: &EngineStores,
    sheet_id: &SheetId,
    key: &str,
) -> Option<u32> {
    let sheet_hex = id_to_hex(sheet_id.as_u128());
    let doc = stores.storage.doc();
    let txn = doc.transact();
    let sheets = stores.storage.sheets();

    let sheet_map = match sheets.get(&txn, &sheet_hex) {
        Some(Out::YMap(m)) => m,
        _ => return None,
    };
    let meta_map = match sheet_map.get(&txn, KEY_PROPERTIES) {
        Some(Out::YMap(m)) => m,
        _ => return None,
    };

    match meta_map.get(&txn, key) {
        Some(Out::Any(Any::BigInt(v))) if v >= 0 => Some(v as u32),
        Some(Out::Any(Any::Number(v))) if v.is_finite() && v >= 0.0 => Some(v as u32),
        _ => None,
    }
}

/// Export the source-declared data validations container count, when preserved.
pub(in crate::storage::engine) fn export_dv_declared_count(
    stores: &EngineStores,
    sheet_id: &SheetId,
) -> Option<u32> {
    export_meta_u32(stores, sheet_id, "dvDeclaredCount")
}

fn export_meta_u32(stores: &EngineStores, sheet_id: &SheetId, key: &str) -> Option<u32> {
    let sheet_hex = id_to_hex(sheet_id.as_u128());
    let doc = stores.storage.doc();
    let txn = doc.transact();
    let sheets = stores.storage.sheets();

    let sheet_map = match sheets.get(&txn, &sheet_hex) {
        Some(Out::YMap(m)) => m,
        _ => return None,
    };
    let meta_map = match sheet_map.get(&txn, KEY_PROPERTIES) {
        Some(Out::YMap(m)) => m,
        _ => return None,
    };

    match meta_map.get(&txn, key) {
        Some(Out::Any(Any::BigInt(v))) if v >= 0 => Some(v as u32),
        Some(Out::Any(Any::Number(v))) if v.is_finite() && v >= 0.0 => Some(v as u32),
        _ => None,
    }
}

/// Export data validations from the canonical range-backed validation store.
pub(in crate::storage::engine) fn export_data_validations_for_sheet(
    stores: &EngineStores,
    sheet_id: &SheetId,
) -> Vec<ValidationSpec> {
    schemas::get_validation_specs_for_sheet(stores.storage.doc(), stores.storage.sheets(), sheet_id)
}

// -------------------------------------------------------------------
// Sheet protection
// -------------------------------------------------------------------

/// Export sheet protection from the structured Y.Map in sheet meta.
/// Falls back to legacy JSON string.
pub(in crate::storage::engine) fn export_sheet_protection(
    stores: &EngineStores,
    sheet_id: &SheetId,
) -> Option<SheetProtection> {
    let sheet_hex = id_to_hex(sheet_id.as_u128());
    let doc = stores.storage.doc();
    let txn = doc.transact();
    let sheets = stores.storage.sheets();

    let sheet_map = match sheets.get(&txn, &sheet_hex) {
        Some(Out::YMap(m)) => m,
        _ => return None,
    };
    let meta_map = match sheet_map.get(&txn, KEY_PROPERTIES) {
        Some(Out::YMap(m)) => m,
        _ => return None,
    };

    match meta_map.get(&txn, "protectionDetails") {
        Some(Out::YMap(sub_map)) => yrs_schema::protection::sheet_from_yrs_map(&sub_map, &txn),
        Some(Out::Any(Any::String(s))) => serde_json::from_str::<SheetProtection>(&s).ok(),
        _ => None,
    }
}

// -------------------------------------------------------------------
// Sparklines
// -------------------------------------------------------------------

/// Export sparklines from the structured sparklines Y.Map using yrs_schema.
pub(in crate::storage::engine) fn export_sparklines_for_sheet(
    stores: &EngineStores,
    sheet_id: &SheetId,
) -> Vec<DomainSparkline> {
    let sheet_hex = id_to_hex(sheet_id.as_u128());
    let doc = stores.storage.doc();
    let txn = doc.transact();
    let sheets = stores.storage.sheets();

    let sheet_map = match sheets.get(&txn, &sheet_hex) {
        Some(Out::YMap(m)) => m,
        _ => return vec![],
    };
    let sparklines_map = match sheet_map.get(&txn, KEY_SPARKLINES) {
        Some(Out::YMap(m)) => m,
        _ => return vec![],
    };

    let mut result = Vec::new();
    for (key, value) in sorted_map_entries(&sparklines_map, &txn) {
        if key.starts_with("group:") || key.starts_with("idx:") {
            continue;
        }
        if let Out::YMap(map) = value
            && let Some(sparkline) = yrs_schema::sparkline::from_yrs_map(&map, &txn)
        {
            result.push(sparkline);
        }
    }
    result
}

/// Export sparkline groups from the structured sparklines Y.Map using yrs_schema.
pub(in crate::storage::engine) fn export_sparkline_groups_for_sheet(
    stores: &EngineStores,
    sheet_id: &SheetId,
) -> Vec<SparklineGroup> {
    let sheet_hex = id_to_hex(sheet_id.as_u128());
    let doc = stores.storage.doc();
    let txn = doc.transact();
    let sheets = stores.storage.sheets();

    let sheet_map = match sheets.get(&txn, &sheet_hex) {
        Some(Out::YMap(m)) => m,
        _ => return vec![],
    };
    let sparklines_map = match sheet_map.get(&txn, KEY_SPARKLINES) {
        Some(Out::YMap(m)) => m,
        _ => return vec![],
    };

    let mut result = Vec::new();
    for (key, value) in sorted_map_entries(&sparklines_map, &txn) {
        if !key.starts_with("group:") {
            continue;
        }
        if let Out::YMap(map) = value
            && let Some(group) = yrs_schema::sparkline::group_from_yrs_map(&map, &txn)
        {
            result.push(group);
        }
    }
    result
}

// -------------------------------------------------------------------
// Page breaks
// -------------------------------------------------------------------

/// Export page breaks from sheet metadata.
pub(in crate::storage::engine) fn export_page_breaks_for_sheet(
    stores: &EngineStores,
    sheet_id: &SheetId,
) -> Option<PageBreaks> {
    let pb = print::get_page_breaks(stores.storage.doc(), stores.storage.sheets(), sheet_id);
    if pb.row_breaks.is_empty() && pb.col_breaks.is_empty() {
        None
    } else {
        Some(pb)
    }
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

    let doc = stores.storage.doc();
    let sheets = stores.storage.sheets();
    let all_filters = filters::get_filters_in_sheet(doc, sheets, sheet_id);
    let auto_filter_state = all_filters
        .into_iter()
        .find(|f| f.filter_kind == FilterKind::AutoFilter)?;

    let binding =
        filters::get_filter_metadata_binding(doc, sheets, sheet_id, &auto_filter_state.id);
    let binding_allows_lossless_export = binding.as_ref().is_none_or(|binding| {
        matches!(
            &binding.owner_path,
            filters::FilterMetadataOwnerPath::SheetAutoFilter { sheet_id: owner_sheet_id }
                if owner_sheet_id == &sheet_id.to_uuid_string()
        )
    });

    if binding_allows_lossless_export {
        // Preferred path: typed AutoFilter at properties/autoFilter, but only
        // while a live runtime sheet AutoFilter still owns it. This prevents
        // stale lossless metadata from resurrecting a deleted filter on export.
        let sheet_hex = id_to_hex(sheet_id.as_u128());
        let txn = doc.transact();
        if let Some(Out::YMap(sheet_map)) = sheets.get(&txn, &sheet_hex)
            && let Some(Out::YMap(meta_map)) = sheet_map.get(&txn, KEY_PROPERTIES)
            && let Some(Out::YMap(af_map)) = meta_map.get(&txn, "autoFilter")
            && let Some(af) = yrs_schema::auto_filter::from_yrs_map(&af_map, &txn)
        {
            return Some(af);
        }
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
    let sheet_hex = id_to_hex(sheet_id.as_u128());
    let doc = stores.storage.doc();
    let txn = doc.transact();
    let sheets = stores.storage.sheets();

    if let Some(Out::YMap(sheet_map)) = sheets.get(&txn, &sheet_hex)
        && let Some(Out::YMap(meta_map)) = sheet_map.get(&txn, KEY_PROPERTIES)
        && let Some(Out::YMap(sort_map)) = meta_map.get(&txn, yrs_schema::sort_state::PROPERTY_KEY)
    {
        yrs_schema::sort_state::from_yrs_map(&sort_map, &txn)
    } else {
        None
    }
}

// -------------------------------------------------------------------
// Outline groups
// -------------------------------------------------------------------

/// Export outline groups from the grouping Y.Map using yrs_schema.
pub(in crate::storage::engine) fn export_outline_groups_for_sheet(
    stores: &EngineStores,
    sheet_id: &SheetId,
) -> (
    Vec<OutlineGroup>,
    Option<ooxml_types::worksheet::OutlineProperties>,
) {
    let config = crate::storage::sheet::grouping::get_sheet_grouping_config(
        stores.storage.doc(),
        stores.storage.sheets(),
        sheet_id,
    );
    if config == SheetGroupingConfig::default() {
        return (vec![], None);
    }
    let (groups, outline_pr) =
        domain_types::domain::grouping::grouping_config_to_outline_groups(&config);
    (groups, Some(outline_pr))
}

// -------------------------------------------------------------------
// Floating objects
// -------------------------------------------------------------------

/// Export floating objects from the floating objects Y.Map.
pub(in crate::storage::engine) fn export_floating_objects_for_sheet(
    stores: &EngineStores,
    mirror: &CellMirror,
    sheet_id: &SheetId,
) -> (
    Vec<FloatingObject>,
    Vec<ooxml_types::slicers::SlicerDef>,
    Vec<ooxml_types::slicers::SlicerAnchor>,
    Vec<ooxml_types::timelines::TimelineDef>,
    Vec<ooxml_types::timelines::TimelineAnchor>,
) {
    let sheet_hex = id_to_hex(sheet_id.as_u128());
    let doc = stores.storage.doc();
    let txn = doc.transact();
    let sheets = stores.storage.sheets();

    let sheet_map = match sheets.get(&txn, &sheet_hex) {
        Some(Out::YMap(m)) => m,
        _ => return (vec![], vec![], vec![], vec![], vec![]),
    };
    let mut floating_objects_by_key: HashMap<String, FloatingObject> = HashMap::new();
    let mut floating_object_keys_by_id: HashMap<String, String> = HashMap::new();
    let mut slicers = Vec::new();
    let mut slicer_anchors = Vec::new();
    let mut timelines = Vec::new();
    let mut timeline_anchors = Vec::new();

    if let Some(Out::YMap(fobj_map)) = sheet_map.get(&txn, KEY_FLOATING_OBJECTS) {
        for (key, value) in sorted_map_entries(&fobj_map, &txn) {
            if key.starts_with("slicer-anchor-") {
                if let Out::Any(Any::String(json)) = value
                    && let Ok(sa) =
                        serde_json::from_str::<ooxml_types::slicers::SlicerAnchor>(&json)
                {
                    slicer_anchors.push(sa);
                }
            } else if key.starts_with("slicer-") {
                if let Out::Any(Any::String(json)) = value
                    && let Ok(sl) = serde_json::from_str::<ooxml_types::slicers::SlicerDef>(&json)
                {
                    slicers.push(sl);
                }
            } else if let Out::YMap(map) = value {
                // Any non-slicer YMap entry is a floating object. Keys may be
                // `fobj-{ts}-{random}` (API-created) or the object's own ID
                // such as `chart-import-{index}` (XLSX-imported).
                if let Some(obj) = yrs_schema::floating_object::from_yrs_map(&map, &txn) {
                    floating_object_keys_by_id.insert(obj.common.id.clone(), key.clone());
                    floating_objects_by_key.insert(key, obj);
                }
            }
        }
    }

    let mut floating_objects = Vec::with_capacity(floating_objects_by_key.len());
    let mut seen_order_ids = HashSet::new();
    if let Some(Out::YArray(order)) = sheet_map.get(&txn, KEY_FLOATING_OBJECT_ORDER) {
        for value in order.iter(&txn) {
            let Out::Any(Any::String(object_id)) = value else {
                continue;
            };
            if !seen_order_ids.insert(object_id.to_string()) {
                continue;
            }
            if let Some(obj) = take_floating_object_by_order_id(
                &mut floating_objects_by_key,
                &floating_object_keys_by_id,
                &object_id,
            ) {
                floating_objects.push(obj);
            }
        }
    }
    let mut remaining_objects: Vec<(String, FloatingObject)> =
        floating_objects_by_key.into_iter().collect();
    remaining_objects.sort_by(|(a_key, a), (b_key, b)| {
        a.common
            .z_index
            .cmp(&b.common.z_index)
            .then_with(|| a.common.id.cmp(&b.common.id))
            .then_with(|| a_key.cmp(b_key))
    });
    floating_objects.extend(remaining_objects.into_iter().map(|(_, obj)| obj));

    let workbook = stores.storage.workbook_map();

    // New format: read StoredSlicer entries from workbook slicers map,
    // filtered to this sheet.
    if slicers.is_empty() {
        if let Some(Out::YMap(slicers_map)) = workbook.get(&txn, KEY_SLICERS) {
            let mut stored_slicers = Vec::new();
            for (_, value) in slicers_map.iter(&txn) {
                if let Some(stored) = yrs_schema::slicer::from_yrs_out(value, &txn)
                    && sheet_hex == stored.sheet_id
                {
                    stored_slicers.push(stored);
                }
            }
            stored_slicers.sort_by(|a, b| a.z_index.cmp(&b.z_index).then_with(|| a.id.cmp(&b.id)));
            for stored in stored_slicers {
                slicers.push(domain_types::domain::slicer::stored_slicer_to_slicer_def(
                    &stored,
                ));
                if let Some(anchor) = domain_types::domain::slicer::stored_slicer_to_anchor(&stored)
                {
                    slicer_anchors.push(anchor);
                }
            }
        }
    }

    if let Some(Out::YMap(timelines_map)) = workbook.get(&txn, KEY_TIMELINES) {
        let mut stored_timelines = Vec::new();
        for (_, value) in timelines_map.iter(&txn) {
            if let Out::Any(Any::String(json_str)) = value
                && let Ok(stored) =
                    serde_json::from_str::<domain_types::domain::slicer::StoredTimeline>(&json_str)
                && sheet_hex == stored.sheet_id
            {
                stored_timelines.push(stored);
            }
        }
        stored_timelines.sort_by(|a, b| a.z_index.cmp(&b.z_index).then_with(|| a.id.cmp(&b.id)));
        for stored in stored_timelines {
            timelines.push(domain_types::domain::slicer::stored_timeline_to_timeline_def(&stored));
            if let Some(anchor) = domain_types::domain::slicer::stored_timeline_to_anchor(&stored) {
                timeline_anchors.push(anchor);
            }
        }
    }

    project_form_control_references_for_export(&mut floating_objects, stores, mirror, sheet_id);

    (
        floating_objects,
        slicers,
        slicer_anchors,
        timelines,
        timeline_anchors,
    )
}

fn take_floating_object_by_order_id(
    objects_by_key: &mut HashMap<String, FloatingObject>,
    keys_by_object_id: &HashMap<String, String>,
    object_id: &str,
) -> Option<FloatingObject> {
    objects_by_key.remove(object_id).or_else(|| {
        keys_by_object_id
            .get(object_id)
            .and_then(|key| objects_by_key.remove(key))
    })
}

fn project_form_control_references_for_export(
    objects: &mut [FloatingObject],
    stores: &EngineStores,
    mirror: &CellMirror,
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
            .and_then(|reference| form_control_cell_ref_to_abs_a1(stores, sheet_id, reference));
        let checked_state = if is_checkbox_control_type(&control.control_type) {
            linked_ref
                .as_deref()
                .and_then(|reference| form_control_cell_ref_to_pos(stores, sheet_id, reference))
                .and_then(|(row, col)| mirror.get_cell_value_at(sheet_id, SheetPos::new(row, col)))
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
            .and_then(|reference| form_control_range_ref_to_abs_a1(stores, sheet_id, reference))
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
    stores: &EngineStores,
    sheet_id: &SheetId,
    reference: &str,
) -> Option<String> {
    let (row, col) = form_control_cell_ref_to_pos(stores, sheet_id, reference)?;
    Some(absolute_a1(row, col))
}

fn form_control_cell_ref_to_pos(
    stores: &EngineStores,
    sheet_id: &SheetId,
    reference: &str,
) -> Option<(u32, u32)> {
    if let Some(cell_hex) = form_control_cell_id_hex(reference)
        && let Some(pos) = resolve_cell_position_from_grid_index(stores, sheet_id, &cell_hex)
    {
        return Some(pos);
    }
    let normalized = normalize_form_control_reference(reference)?;
    parse_cell_ref(&normalized)
}

fn form_control_range_ref_to_abs_a1(
    stores: &EngineStores,
    sheet_id: &SheetId,
    reference: &str,
) -> Option<String> {
    let (start_row, start_col, end_row, end_col) =
        form_control_range_ref_to_positions(stores, sheet_id, reference)?;
    Some(format!(
        "{}:{}",
        absolute_a1(start_row, start_col),
        absolute_a1(end_row, end_col)
    ))
}

fn form_control_range_ref_to_positions(
    stores: &EngineStores,
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
        let (start_row, start_col) = form_control_cell_ref_to_pos(stores, sheet_id, start_id)?;
        let (end_row, end_col) = form_control_cell_ref_to_pos(stores, sheet_id, end_id)?;
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
    cf_store::get_formats_for_sheet(stores.storage.doc(), &stores.storage.sheets_ref(), sheet_id)
}
