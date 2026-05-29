//! Per-sheet metadata export functions.
//!
//! Extracted from the monolithic `export.rs` — covers hyperlinks, data
//! validations, sheet protection, sparklines, page breaks, auto filter,
//! outline groups, floating objects, and conditional formats.

use cell_types::SheetId;
use compute_document::hex::id_to_hex;
use compute_document::schema::*;
use domain_types::{
    domain::conditional_format::ConditionalFormat as DomainConditionalFormat,
    domain::filter::{AutoFilter, SortState},
    domain::floating_object::FloatingObject,
    domain::grouping::SheetGroupingConfig,
    domain::hyperlink::{Hyperlink, HyperlinkTargetKind},
    domain::outline::OutlineGroup,
    domain::print::PageBreaks,
    domain::protection::SheetProtection,
    domain::sparkline::{Sparkline as DomainSparkline, SparklineGroup},
    domain::validation::ValidationSpec,
    yrs_schema,
};
use yrs::{Any, Array, Map, Out, Transact};

use crate::storage::sheet::{cf_store, hyperlinks, print};

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

pub(in crate::storage::engine) fn export_x14_dv_disable_prompts(
    stores: &EngineStores,
    sheet_id: &SheetId,
) -> bool {
    export_meta_bool(stores, sheet_id, "x14DvDisablePrompts")
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

pub(in crate::storage::engine) fn export_x14_dv_declared_count(
    stores: &EngineStores,
    sheet_id: &SheetId,
) -> Option<u32> {
    export_meta_u32(stores, sheet_id, "x14DvDeclaredCount")
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

/// Export data validations from `properties/dataValidations` (the single
/// canonical source of truth). Falls back to legacy JSON string.
pub(in crate::storage::engine) fn export_data_validations_for_sheet(
    stores: &EngineStores,
    sheet_id: &SheetId,
) -> Vec<ValidationSpec> {
    export_validation_array(stores, sheet_id, "dataValidations")
}

pub(in crate::storage::engine) fn export_x14_data_validations_for_sheet(
    stores: &EngineStores,
    sheet_id: &SheetId,
) -> Vec<ValidationSpec> {
    export_validation_array(stores, sheet_id, "x14DataValidations")
}

fn export_validation_array(
    stores: &EngineStores,
    sheet_id: &SheetId,
    key: &str,
) -> Vec<ValidationSpec> {
    let sheet_hex = id_to_hex(sheet_id.as_u128());
    let doc = stores.storage.doc();
    let txn = doc.transact();
    let sheets_root = stores.storage.sheets();

    let sheet_map = match sheets_root.get(&txn, &sheet_hex) {
        Some(Out::YMap(m)) => m,
        _ => return vec![],
    };
    let meta_map = match sheet_map.get(&txn, KEY_PROPERTIES) {
        Some(Out::YMap(m)) => m,
        _ => return vec![],
    };

    match meta_map.get(&txn, key) {
        Some(Out::YArray(arr)) => {
            let mut specs = Vec::new();
            for item in arr.iter(&txn) {
                if let Out::YMap(sub_map) = item
                    && let Some(spec) = yrs_schema::validation::from_yrs_map(&sub_map, &txn)
                {
                    specs.push(spec);
                }
            }
            specs
        }
        Some(Out::Any(Any::String(s))) => {
            serde_json::from_str::<Vec<ValidationSpec>>(&s).unwrap_or_default()
        }
        _ => Vec::new(),
    }
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

    // Preferred path: typed AutoFilter at properties/autoFilter.
    let sheet_hex = id_to_hex(sheet_id.as_u128());
    let doc = stores.storage.doc();
    let txn = doc.transact();
    let sheets = stores.storage.sheets();
    if let Some(Out::YMap(sheet_map)) = sheets.get(&txn, &sheet_hex)
        && let Some(Out::YMap(meta_map)) = sheet_map.get(&txn, KEY_PROPERTIES)
        && let Some(Out::YMap(af_map)) = meta_map.get(&txn, "autoFilter")
        && let Some(af) = yrs_schema::auto_filter::from_yrs_map(&af_map, &txn)
    {
        return Some(af);
    }
    drop(txn);

    // Fallback: reconstruct from runtime FilterState (lossy for round-trip-only
    // fields — see function doc). Only fires for filters created via runtime
    // API without going through XLSX import.
    let all_filters = filters::get_filters_in_sheet(doc, sheets, sheet_id);
    let auto_filter_state = all_filters
        .into_iter()
        .find(|f| f.filter_kind == FilterKind::AutoFilter)?;

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
    let mut floating_objects = Vec::new();
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
                    floating_objects.push(obj);
                }
            }
        }
    }

    let workbook = stores.storage.workbook_map();

    // New format: read StoredSlicer entries from workbook slicers map,
    // filtered to this sheet.
    if slicers.is_empty() {
        if let Some(Out::YMap(slicers_map)) = workbook.get(&txn, KEY_SLICERS) {
            let mut stored_slicers = Vec::new();
            for (_, value) in slicers_map.iter(&txn) {
                if let Out::Any(Any::String(json_str)) = value
                    && let Ok(stored) = serde_json::from_str::<
                        domain_types::domain::slicer::StoredSlicer,
                    >(&json_str)
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

    (
        floating_objects,
        slicers,
        slicer_anchors,
        timelines,
        timeline_anchors,
    )
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
