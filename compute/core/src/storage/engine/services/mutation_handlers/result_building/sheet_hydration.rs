use cell_types::{CellId, SheetId};

use crate::mirror::CellMirror;
use crate::snapshot::{
    Axis, CellPosition, CfChange, ChangeKind, CommentChange, FilterChange, FloatingObjectChange,
    FloatingObjectChangeKind, GroupingChange, MergeChange, MutationResult, PageBreakChange,
    PivotTableChange, PrintAreaChange, PrintSettingsChange, PrintTitlesChange,
    ScrollPositionChange, SheetChange, SheetChangeField, SheetSettingsChange, SparklineChange,
    SplitConfigChange, TableChange,
};
use crate::storage::engine::stores::EngineStores;
use crate::storage::sheet::{
    comments, filters, grouping, pivots, print, properties, settings, sparklines, split_view, view,
    visibility,
};
use compute_document::hex::{hex_to_id, id_to_hex};

// ---------------------------------------------------------------------------
// build_sheet_hydration_changes
// ---------------------------------------------------------------------------

/// Append the full per-sheet hydration shape for a single sheet onto an
/// existing [`MutationResult`].
///
/// This is the canonical "introduce a sheet to observable state" emit. It
/// owns the `SheetChange { field: Sheet, kind: Set }` creation event itself
/// (threading `source_sheet_id` provenance for copies) and enumerates every
/// per-sheet mirror dimension: floating objects, tables, filters, comments,
/// sparklines, conditional formats, grouping, pivots, sheet identity (Sheet
/// / Name / Order / Visibility / TabColor / Frozen), per-sheet settings,
/// page breaks, print area / titles / settings, split config, scroll
/// position.
///
/// Three call sites flow through this helper:
///   1. `build_mutation_result_for_hydration` — once per sheet on cold load
///      (XLSX/CSV import, IndexedDB-replay settle, blank-workbook
///      bootstrap). Passes `source_sheet_id = None`.
///   2. `mutation_create_sheet` — once for the freshly-created sheet on the
///      user-edit add path. Passes `source_sheet_id = None`.
///   3. `mutation_copy_sheet` — once for the freshly-created copy on the
///      user-edit copy path. Passes `source_sheet_id = Some(source)` so the
///      creation event carries copy provenance.
///
/// Workbook-scoped emits (named ranges, workbook settings) are NOT
/// included — they belong to `build_mutation_result_for_hydration` only,
/// which calls this helper once per sheet and then appends them.
pub(in crate::storage::engine) fn build_sheet_hydration_changes(
    stores: &EngineStores,
    mirror: &CellMirror,
    sheet_id: &SheetId,
    source_sheet_id: Option<&SheetId>,
    result: &mut MutationResult,
) {
    let sid = sheet_id;
    let doc = stores.storage.doc();
    let sheets = stores.storage.sheets();
    let sheet_id_str = sid.to_uuid_string();
    let grid = stores.grid_indexes.get(sid);
    let layout = stores.layout_indexes.get(sid);

    // ----- Floating objects (drawings, charts, shapes, pictures, ...) -----
    //
    // Use the JSON-shape API to enumerate object_ids + raw JSON, then
    // compute pixel bounds from the raw JSON in a single pass. We
    // separately invoke the typed reader for the structured payload,
    // matching the live mutation handler's `data` field.
    let all_objects_json =
        crate::storage::sheet::floating_objects::get_all_floating_objects(doc, sheets, sid);
    if !all_objects_json.is_empty() {
        let mut bounds_map = std::collections::HashMap::with_capacity(all_objects_json.len());
        for (object_id, obj_json) in &all_objects_json {
            if let Some(b) = crate::storage::sheet::floating_objects::compute_object_pixel_bounds(
                grid, layout, obj_json,
            ) {
                bounds_map.insert(object_id.clone(), b);
            }
        }

        // Read the typed view with the SAME txn-scope semantics as the
        // JSON-shape read above (each call opens and drops its own txn).
        // Yrs allows concurrent read txns within a thread, so this is
        // safe; the panic that would occur is on `transact_mut()` while
        // a read is held — neither read here triggers that.
        let typed_objects = crate::storage::sheet::floating_objects::get_all_floating_objects_typed(
            doc, sheets, sid,
        );
        for obj in typed_objects {
            let object_id = obj.common.id.clone();
            let object_type = Some(obj.kind());
            let bounds = bounds_map.get(&object_id).cloned();
            result.floating_object_changes.push(FloatingObjectChange {
                sheet_id: sheet_id_str.clone(),
                object_id,
                kind: FloatingObjectChangeKind::Created,
                object_type,
                data: Some(obj),
                bounds,
            });
        }
    }

    // ----- Tables (mirror-backed, no Yrs txn) -----
    let tables = crate::storage::engine::services::tables::get_all_tables_in_sheet(mirror, sid);
    for table in tables {
        result.table_changes.push(TableChange {
            name: table.name,
            sheet_id: sheet_id_str.clone(),
            kind: ChangeKind::Set,
        });
    }

    // ----- Filters -----
    let sheet_filters = filters::get_filters_in_sheet(doc, sheets, sid);
    for filter in sheet_filters {
        result.filter_changes.push(FilterChange {
            sheet_id: sheet_id_str.clone(),
            filter_id: filter.id,
            filter_kind: Some(
                match filter.filter_kind {
                    filters::FilterKind::AutoFilter => "autoFilter",
                    filters::FilterKind::TableFilter => "tableFilter",
                    filters::FilterKind::AdvancedFilter => "advancedFilter",
                }
                .to_string(),
            ),
            action: Some("created".to_string()),
            hidden_row_count: None,
            visible_row_count: None,
            kind: ChangeKind::Set,
        });
    }

    // ----- Comments -----
    let sheet_comments = comments::get_all_comments(doc, sheets, sid);
    for comment in sheet_comments {
        // `comment.cell_ref` is the cell_id hex (Yrs storage key); resolve to a
        // (row, col) position via grid_indexes when possible. Mirrors the live
        // mutation handler's CommentChange shape.
        let cell_id_hex = comment.cell_ref.clone();
        let position = hex_to_id(&cell_id_hex)
            .map(CellId::from_raw)
            .and_then(|cid| grid.and_then(|g| g.cell_position(&cid)))
            .map(|(row, col)| CellPosition { row, col });
        result.comment_changes.push(CommentChange {
            sheet_id: sheet_id_str.clone(),
            cell_id: cell_id_hex,
            position,
            kind: ChangeKind::Set,
        });
    }

    // ----- Sparklines -----
    let sheet_sparklines = sparklines::get_sparklines_in_sheet(doc, sheets, sid);
    for sparkline in sheet_sparklines {
        // Resolve the (row, col) position to a CellId hex when the grid index
        // has a cell at that position; otherwise emit empty cell_id (the
        // SparklineChange handler currently only consumes sheet/position).
        let row = sparkline.cell.row;
        let col = sparkline.cell.col;
        let cell_id_hex = grid
            .and_then(|g| g.cell_id_at(row, col))
            .map(|cid| String::from(id_to_hex(cid.as_u128())))
            .unwrap_or_default();
        result.sparkline_changes.push(SparklineChange {
            sheet_id: sheet_id_str.clone(),
            cell_id: cell_id_hex,
            position: Some(CellPosition { row, col }),
            kind: ChangeKind::Set,
        });
    }

    // ----- Conditional formats -----
    let cf_rules = crate::storage::engine::services::formatting::get_all_cf_rules(stores, sid);
    for cf in cf_rules {
        result.cf_changes.push(CfChange {
            sheet_id: sheet_id_str.clone(),
            kind: ChangeKind::Set,
            rule_id: Some(cf.id),
        });
    }

    // ----- Grouping (row + col) -----
    let row_groups = grouping::get_groups(doc, sheets, sid, grouping::GroupAxis::Row);
    if !row_groups.is_empty() {
        result.grouping_changes.push(GroupingChange {
            sheet_id: sheet_id_str.clone(),
            axis: Axis::Row,
            kind: ChangeKind::Set,
        });
    }
    let col_groups = grouping::get_groups(doc, sheets, sid, grouping::GroupAxis::Column);
    if !col_groups.is_empty() {
        result.grouping_changes.push(GroupingChange {
            sheet_id: sheet_id_str.clone(),
            axis: Axis::Col,
            kind: ChangeKind::Set,
        });
    }

    // ----- Pivot tables -----
    let pivots_in_sheet = pivots::get_all_pivots(doc, sheets, sid);
    for pivot in pivots_in_sheet {
        result.pivot_changes.push(PivotTableChange {
            sheet_id: sheet_id_str.clone(),
            pivot_id: pivot.id,
            kind: ChangeKind::Set,
        });
    }

    // ----- Ranges -----
    if let Some(sheet_mirror) = mirror.get_sheet(sid) {
        for (range_id, rv) in sheet_mirror.iter_ranges() {
            let metadata = compute_document::range::RangeMetadata {
                range_id: *range_id,
                kind: rv.kind,
                anchor: rv.anchor.clone(),
                encoding: rv.encoding,
                row_axis: None,
                col_axis: None,
                row_ids: {
                    let mut pairs: Vec<_> = rv
                        .row_offset_by_id
                        .iter()
                        .map(|(&id, &off)| (off, id))
                        .collect();
                    pairs.sort_by_key(|(off, _)| *off);
                    pairs.into_iter().map(|(_, id)| id).collect()
                },
                col_ids: {
                    let mut pairs: Vec<_> = rv
                        .col_offset_by_id
                        .iter()
                        .map(|(&id, &off)| (off, id))
                        .collect();
                    pairs.sort_by_key(|(off, _)| *off);
                    pairs.into_iter().map(|(_, id)| id).collect()
                },
            };
            let data = serde_json::to_vec(&metadata).unwrap_or_default();
            result.range_changes.push(crate::snapshot::RangeChange {
                sheet_id: sheet_id_str.clone(),
                range_id: *range_id,
                kind: crate::snapshot::RangeChangeKind::Created,
                data,
            });
        }
    }

    // ----- Sheet identity (name / order / visibility / tab-color / frozen) -----
    //
    // One SheetChange per direct-state field. The mirror needs the
    // post-state payload populated (no observer involved on hydration,
    // so there is no `old_*` to thread). Defaults (no tab color, no
    // freeze) are skipped to keep the payload small — the kernel
    // mirror initializes those fields from `DEFAULT_SHEET_META`.
    let sheet_index = stores
        .storage
        .sheet_order()
        .iter()
        .position(|id| id == sid)
        .map(|i| i as i32);
    let sheet_name = properties::get_sheet_name(doc, sheets, sid);
    let source_sheet_id_str = source_sheet_id.map(|s| s.to_uuid_string());

    // Canonical creation event: `field:Sheet, kind:Set` is what the
    // kernel mirror's `applySheetChange` consumes to insert into
    // `sheetOrder` (per-field `Name`/`Order` arms only update the meta
    // map and `Order` requires an `oldIndex` to move — neither
    // populates `sheetOrder` on cold load). Emitted before the
    // per-field deltas so consumers see the creation first.
    if let (Some(name), Some(idx)) = (sheet_name.as_deref(), sheet_index) {
        result.sheet_changes.push(SheetChange {
            sheet_id: sheet_id_str.clone(),
            kind: ChangeKind::Set,
            field: SheetChangeField::Sheet,
            name: Some(name.to_string()),
            old_name: None,
            index: Some(idx),
            old_index: None,
            hidden: None,
            source_sheet_id: source_sheet_id_str.clone(),
            frozen_rows: None,
            old_frozen_rows: None,
            frozen_cols: None,
            old_frozen_cols: None,
            color: None,
            old_color: None,
        });
    }

    if let Some(name) = sheet_name {
        result.sheet_changes.push(SheetChange {
            sheet_id: sheet_id_str.clone(),
            kind: ChangeKind::Set,
            field: SheetChangeField::Name,
            name: Some(name),
            old_name: None,
            index: None,
            old_index: None,
            hidden: None,
            source_sheet_id: None,
            frozen_rows: None,
            old_frozen_rows: None,
            frozen_cols: None,
            old_frozen_cols: None,
            color: None,
            old_color: None,
        });
    }

    if let Some(idx) = sheet_index {
        result.sheet_changes.push(SheetChange {
            sheet_id: sheet_id_str.clone(),
            kind: ChangeKind::Set,
            field: SheetChangeField::Order,
            name: None,
            old_name: None,
            index: Some(idx),
            old_index: None,
            hidden: None,
            source_sheet_id: None,
            frozen_rows: None,
            old_frozen_rows: None,
            frozen_cols: None,
            old_frozen_cols: None,
            color: None,
            old_color: None,
        });
    }

    let is_hidden = visibility::is_sheet_hidden(doc, sheets, sid);
    let visibility_state = visibility::get_sheet_visibility(doc, sheets, sid);
    if is_hidden || visibility_state == "veryHidden" {
        // Only emit when non-default (visible). The kernel mirror's
        // sheet-meta default is `visibility: "visible"`, so emitting
        // every sheet would just confirm the default.
        result.sheet_changes.push(SheetChange {
            sheet_id: sheet_id_str.clone(),
            kind: ChangeKind::Set,
            field: SheetChangeField::Visibility,
            name: None,
            old_name: None,
            index: None,
            old_index: None,
            hidden: Some(is_hidden),
            source_sheet_id: None,
            frozen_rows: None,
            old_frozen_rows: None,
            frozen_cols: None,
            old_frozen_cols: None,
            color: None,
            old_color: None,
        });
    }

    if let Some(meta) = properties::get_sheet_meta(doc, sheets, sid)
        && let Some(color) = meta.tab_color
    {
        result.sheet_changes.push(SheetChange {
            sheet_id: sheet_id_str.clone(),
            kind: ChangeKind::Set,
            field: SheetChangeField::TabColor,
            name: None,
            old_name: None,
            index: None,
            old_index: None,
            hidden: None,
            source_sheet_id: None,
            frozen_rows: None,
            old_frozen_rows: None,
            frozen_cols: None,
            old_frozen_cols: None,
            color: Some(color),
            old_color: None,
        });
    }

    let frozen = view::get_frozen_panes(doc, sheets, sid);
    if frozen.rows != 0 || frozen.cols != 0 {
        result.sheet_changes.push(SheetChange {
            sheet_id: sheet_id_str.clone(),
            kind: ChangeKind::Set,
            field: SheetChangeField::Frozen,
            name: None,
            old_name: None,
            index: None,
            old_index: None,
            hidden: None,
            source_sheet_id: None,
            frozen_rows: Some(frozen.rows),
            old_frozen_rows: None,
            frozen_cols: Some(frozen.cols),
            old_frozen_cols: None,
            color: None,
            old_color: None,
        });
    }

    // ----- Sheet settings (full snapshot per sheet) -----
    //
    // Sentinel `changed_key = "*hydration*"` signals to the kernel
    // mirror that this is an initial-hydration "everything" emit, not
    // a single-key update. The mirror replaces its full settings
    // payload from `settings` rather than diffing against the prior
    // state (which is empty on hydration).
    let sheet_settings = settings::get_sheet_settings(doc, sheets, sid);
    let settings_value =
        serde_json::to_value(&sheet_settings).expect("SheetSettings must serialize to JSON");
    result.settings_changes.push(SheetSettingsChange {
        sheet_id: sheet_id_str.clone(),
        kind: ChangeKind::Set,
        changed_key: "*hydration*".to_string(),
        settings: settings_value,
    });

    // ----- Page breaks (skip if empty — kernel mirror has empty default) -----
    let page_breaks = print::get_page_breaks(doc, sheets, sid);
    if !page_breaks.row_breaks.is_empty() || !page_breaks.col_breaks.is_empty() {
        result.page_break_changes.push(PageBreakChange {
            sheet_id: sheet_id_str.clone(),
            breaks: page_breaks,
        });
    }

    // ----- Print area (only when set) -----
    if let Some(area) = print::get_print_area(doc, sheets, sid) {
        result.print_area_changes.push(PrintAreaChange {
            sheet_id: sheet_id_str.clone(),
            kind: ChangeKind::Set,
            area: Some(area),
        });
    }

    // ----- Print titles (only when set) -----
    let print_titles = print::get_print_titles(doc, sheets, sid);
    let has_print_titles = print_titles.repeat_rows.is_some() || print_titles.repeat_cols.is_some();
    if has_print_titles {
        result.print_titles_changes.push(PrintTitlesChange {
            sheet_id: sheet_id_str.clone(),
            titles: print_titles,
        });
    }

    // ----- Print settings (always emit — defaults populate the mirror) -----
    let print_settings = print::get_print_settings(doc, sheets, sid);
    result.print_settings_changes.push(PrintSettingsChange {
        sheet_id: sheet_id_str.clone(),
        settings: print_settings,
    });

    // ----- Split config (only when set) -----
    if let Some(config) = split_view::get_split_config(doc, sheets, sid) {
        result.split_config_changes.push(SplitConfigChange {
            sheet_id: sheet_id_str.clone(),
            kind: ChangeKind::Set,
            config: Some(config),
        });
    }

    // ----- Scroll position (always emit — defaults populate the mirror) -----
    let scroll = view::get_scroll_position(doc, sheets, sid);
    result.scroll_position_changes.push(ScrollPositionChange {
        sheet_id: sheet_id_str,
        top_row: scroll.top_row,
        left_col: scroll.left_col,
    });
}

// ---------------------------------------------------------------------------
