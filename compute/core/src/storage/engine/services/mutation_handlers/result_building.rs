use std::collections::HashSet;

use cell_types::{CellId, SheetId, SheetPos};
use value_types::CellValue;

use crate::mirror::CellMirror;
use crate::snapshot::{
    Axis, CellPosition, CfChange, ChangeKind, CommentChange, DimensionChange, FilterChange,
    FloatingObjectChange, FloatingObjectChangeKind, GroupingChange, MergeChange, MutationResult,
    NamedRangeChange, PageBreakChange, PivotTableChange, PrintAreaChange, PrintSettingsChange,
    PrintTitlesChange, PropertyChange, RecalcResult, ScrollPositionChange, SheetChange,
    SheetChangeField, SheetSettingsChange, SortingChange, SparklineChange, SplitConfigChange,
    TableChange, VisibilityChange, WorkbookSettings, WorkbookSettingsChange,
};
use crate::storage::engine::settings::EngineSettings;
use crate::storage::engine::stores::EngineStores;
use crate::storage::sheet::{
    comments, dimensions, filters, grouping, hyperlinks, pivots, print, properties, settings,
    sparklines, split_view, view, visibility,
};
use crate::storage::workbook;
use compute_document::hex::{hex_to_id, id_to_hex};
use compute_document::observe::{CellChangeKind, DocumentChanges};
use compute_wire::flags as render_flags;

use super::{observer_kind_to_change_kind, resolve_col_id_to_index, resolve_row_id_to_index};

// ---------------------------------------------------------------------------
// build_mutation_result_from_changes
// ---------------------------------------------------------------------------

/// Build a complete [`MutationResult`] from a [`RecalcResult`] and
/// [`DocumentChanges`], reading current state from yrs for each change.
///
/// The `resolve_table_format_fn` callback handles table format resolution
/// which requires access to engine state beyond what's passed here.
pub(in crate::storage::engine) fn build_mutation_result_from_changes(
    stores: &EngineStores,
    mirror: &CellMirror,
    _settings: &EngineSettings,
    recalc: RecalcResult,
    changes: &DocumentChanges,
    resolve_table_format_fn: &dyn Fn(&SheetId, u32, u32) -> Option<domain_types::CellFormat>,
) -> MutationResult {
    let mut result = MutationResult::from_recalc(recalc);

    // --- Sheet lifecycle (additions / deletions) ---
    //
    // Observer-driven sheet additions (undo of a delete; remote sync
    // introducing a peer's new sheet) require the same MutationResult
    // shape as bootstrap / user-edit add / copy: a `SheetChange
    // { field: Sheet, kind: Set }` creation event plus the full
    // per-sheet hydration shape. Without this the kernel mirror never
    // re-introduces the restored sheet to `sheetMetaBySheet` /
    // `sheetOrder` / per-sheet projections — same architectural class
    // sync-paint/09 closed for the three live mutation handlers; this
    // is the fourth call site.
    //
    // Deletions emit `SheetChange { kind: Removed, field: Sheet }` so
    // the mirror's `applySheetChange` Removed arm calls `dropSheet(sid)`
    // to clear all per-sheet maps for the dropped sheet.
    for sid in &changes.sheet_additions {
        build_sheet_hydration_changes(stores, mirror, sid, None, &mut result);
    }
    for sid in &changes.sheet_deletions {
        result.sheet_changes.push(SheetChange {
            sheet_id: sid.to_uuid_string(),
            kind: ChangeKind::Removed,
            field: SheetChangeField::Sheet,
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
            color: None,
            old_color: None,
        });
    }

    // --- Property changes ---
    for pch in &changes.properties {
        let sheet_id_str = pch.sheet_id.to_uuid_string();
        let cell_hex = id_to_hex(pch.cell_id.as_u128());
        let kind = observer_kind_to_change_kind(pch.kind);

        // Resolve (row, col) from grid_indexes; `None` if unavailable.
        let position = stores
            .grid_indexes
            .get(&pch.sheet_id)
            .and_then(|g| g.cell_position(&pch.cell_id))
            .or_else(|| {
                mirror
                    .resolve_position(&pch.cell_id)
                    .map(|pos| (pos.row(), pos.col()))
            })
            .map(|(row, col)| CellPosition { row, col });

        let format = if kind == ChangeKind::Set {
            // Format resolution still needs (row, col); skip if unresolved.
            if let Some(pos) = position.as_ref() {
                let table_fmt = resolve_table_format_fn(&pch.sheet_id, pos.row, pos.col);
                let effective = crate::storage::properties::get_effective_format(
                    &stores.storage,
                    &pch.sheet_id,
                    &cell_hex,
                    pos.row,
                    pos.col,
                    table_fmt.as_ref(),
                    stores.grid_indexes.get(&pch.sheet_id),
                    mirror.get_sheet(&pch.sheet_id),
                );
                serde_json::to_value(&effective).ok()
            } else {
                None
            }
        } else {
            None
        };

        result.property_changes.push(PropertyChange {
            sheet_id: sheet_id_str,
            cell_id: cell_hex.into(),
            position,
            kind,
            format,
        });
    }

    // --- Dimension changes (row heights) ---
    // Yrs stores canonical units (points); DimensionChange.size must be pixels for TS.
    for dch in &changes.row_heights {
        let sheet_id_str = dch.sheet_id.to_uuid_string();
        let kind = observer_kind_to_change_kind(dch.kind);
        if let Some(row) = resolve_row_id_to_index(stores, &dch.sheet_id, &dch.key) {
            let size = if kind == ChangeKind::Set {
                let height_pt = dimensions::get_row_height(
                    stores.storage.doc(),
                    stores.storage.sheets(),
                    &dch.sheet_id,
                    row,
                    stores.grid_indexes.get(&dch.sheet_id),
                );
                let pixels = if height_pt.0 == 0.0 {
                    0.0
                } else {
                    domain_types::units::points_to_pixels(height_pt).0
                };
                // Storage units are always finite; use `must` to document the
                // invariant. A non-finite value here would indicate corrupt
                // storage state, which should panic in debug.
                Some(value_types::FiniteF64::must(pixels))
            } else {
                None
            };
            result.dimension_changes.push(DimensionChange {
                sheet_id: sheet_id_str,
                axis: Axis::Row,
                index: row,
                kind,
                size,
            });
        }
    }

    // --- Dimension changes (col widths) ---
    // Yrs stores canonical units (char-width); DimensionChange.size must be pixels for TS.
    let mdw = domain_types::units::platform_mdw();
    for dch in &changes.col_widths {
        let sheet_id_str = dch.sheet_id.to_uuid_string();
        let kind = observer_kind_to_change_kind(dch.kind);
        if let Some(col) = resolve_col_id_to_index(stores, &dch.sheet_id, &dch.key) {
            let size = if kind == ChangeKind::Set {
                let width_cw = dimensions::get_col_width(
                    stores.storage.doc(),
                    stores.storage.sheets(),
                    &dch.sheet_id,
                    col,
                    stores.grid_indexes.get(&dch.sheet_id),
                );
                let pixels = if width_cw.0 == 0.0 {
                    0.0
                } else {
                    domain_types::units::char_width_to_pixels(width_cw, mdw).0
                };
                Some(value_types::FiniteF64::must(pixels))
            } else {
                None
            };
            result.dimension_changes.push(DimensionChange {
                sheet_id: sheet_id_str,
                axis: Axis::Col,
                index: col,
                kind,
                size,
            });
        }
    }

    // --- Merge changes ---
    for mch in &changes.merges {
        let sheet_id_str = mch.sheet_id.to_uuid_string();
        let kind = observer_kind_to_change_kind(mch.kind);
        if kind == ChangeKind::Set {
            if let Some(idx) = stores.merge_indexes.get(&mch.sheet_id) {
                for item in idx.items() {
                    if item.id == mch.key {
                        result.merge_changes.push(MergeChange {
                            sheet_id: sheet_id_str.clone(),
                            kind,
                            start_row: item.start_row,
                            start_col: item.start_col,
                            end_row: item.end_row,
                            end_col: item.end_col,
                        });
                    }
                }
            }
        } else {
            result.merge_changes.push(MergeChange {
                sheet_id: sheet_id_str,
                kind,
                start_row: 0,
                start_col: 0,
                end_row: 0,
                end_col: 0,
            });
        }
    }

    // --- Visibility changes (hidden rows) ---
    for vch in &changes.hidden_rows {
        let sheet_id_str = vch.sheet_id.to_uuid_string();
        if let Some(row) = resolve_row_id_to_index(stores, &vch.sheet_id, &vch.key) {
            let hidden = dimensions::is_row_hidden(
                stores.storage.doc(),
                stores.storage.sheets(),
                &vch.sheet_id,
                row,
            );
            result.visibility_changes.push(VisibilityChange {
                sheet_id: sheet_id_str,
                axis: Axis::Row,
                index: row,
                hidden,
            });
        }
    }

    // --- Visibility changes (hidden cols) ---
    for vch in &changes.hidden_cols {
        let sheet_id_str = vch.sheet_id.to_uuid_string();
        if let Some(col) = resolve_col_id_to_index(stores, &vch.sheet_id, &vch.key) {
            let hidden = dimensions::is_column_hidden(
                stores.storage.doc(),
                stores.storage.sheets(),
                &vch.sheet_id,
                col,
            );
            result.visibility_changes.push(VisibilityChange {
                sheet_id: sheet_id_str,
                axis: Axis::Col,
                index: col,
                hidden,
            });
        }
    }

    // --- Comment changes ---
    for cch in &changes.comments {
        let sheet_id_str = cch.sheet_id.to_uuid_string();
        let kind = observer_kind_to_change_kind(cch.kind);
        let cell_id = hex_to_id(&cch.key)
            .map(CellId::from_raw)
            .unwrap_or_else(|| CellId::from_raw(0));
        let position = stores
            .grid_indexes
            .get(&cch.sheet_id)
            .and_then(|g| g.cell_position(&cell_id))
            .map(|(row, col)| CellPosition { row, col });

        result.comment_changes.push(CommentChange {
            sheet_id: sheet_id_str,
            cell_id: cch.key.clone(),
            position,
            kind,
        });
    }

    // --- Filter changes ---
    for fch in &changes.filters {
        let sheet_id_str = fch.sheet_id.to_uuid_string();
        result.filter_changes.push(FilterChange {
            sheet_id: sheet_id_str,
            filter_id: fch.key.clone().unwrap_or_default(),
            filter_kind: None,
            action: Some(
                match observer_kind_to_change_kind(fch.kind) {
                    ChangeKind::Set => "updated",
                    ChangeKind::Removed => "deleted",
                }
                .to_string(),
            ),
            hidden_row_count: None,
            visible_row_count: None,
            kind: observer_kind_to_change_kind(fch.kind),
        });
    }

    // --- Table changes ---
    for tch in &changes.tables {
        let kind = observer_kind_to_change_kind(tch.kind);
        result.table_changes.push(TableChange {
            name: tch.key.clone(),
            sheet_id: String::new(),
            kind,
        });
    }

    // --- Floating object changes ---
    for foch in &changes.floating_objects {
        let sheet_id_str = foch.sheet_id.to_uuid_string();
        let kind = match foch.kind {
            CellChangeKind::Modified => FloatingObjectChangeKind::Updated {
                changed_fields: vec![],
            },
            CellChangeKind::Removed => FloatingObjectChangeKind::Removed,
        };
        result.floating_object_changes.push(FloatingObjectChange {
            sheet_id: sheet_id_str,
            object_id: foch.object_id.clone(),
            kind,
            object_type: None,
            data: None,
            bounds: None,
        });
    }

    // --- Pivot table changes ---
    //
    // Undo/redo observer replay may include raw child-map churn under
    // `pivotTables/<pivotId>` in addition to the top-level entry change. The
    // public mutation result is semantic, so coalesce each touched pivot to its
    // final state after the transaction.
    let mut seen_pivots = HashSet::new();
    for pch in &changes.pivot_tables {
        if !seen_pivots.insert((pch.sheet_id, pch.pivot_id.clone())) {
            continue;
        }
        let kind = if pivots::get_pivot(
            stores.storage.doc(),
            stores.storage.sheets(),
            &pch.sheet_id,
            &pch.pivot_id,
        )
        .is_some()
        {
            ChangeKind::Set
        } else {
            ChangeKind::Removed
        };
        result.pivot_changes.push(PivotTableChange {
            sheet_id: pch.sheet_id.to_uuid_string(),
            pivot_id: pch.pivot_id.clone(),
            kind,
        });
    }

    // --- Grouping changes ---
    for gch in &changes.grouping {
        result.grouping_changes.push(GroupingChange {
            sheet_id: gch.sheet_id.to_uuid_string(),
            axis: Axis::Row,
            kind: observer_kind_to_change_kind(gch.kind),
        });
    }

    // --- Sparkline changes ---
    let mut seen_sparkline_positions: Vec<(String, u32, u32, ChangeKind)> = Vec::new();
    let mut push_sparkline_position =
        |result: &mut MutationResult, sheet_id: SheetId, row: u32, col: u32, kind: ChangeKind| {
            let sheet_id_str = sheet_id.to_uuid_string();
            if seen_sparkline_positions.contains(&(sheet_id_str.clone(), row, col, kind)) {
                return;
            }
            seen_sparkline_positions.push((sheet_id_str.clone(), row, col, kind));
            let cell_id = stores
                .grid_indexes
                .get(&sheet_id)
                .and_then(|grid| grid.cell_id_at(row, col))
                .map(|cell_id| id_to_hex(cell_id.as_u128()).to_string())
                .unwrap_or_default();
            result.sparkline_changes.push(SparklineChange {
                sheet_id: sheet_id_str,
                cell_id,
                position: Some(CellPosition { row, col }),
                kind,
            });
        };

    for sch in &changes.sparklines {
        let kind = observer_kind_to_change_kind(sch.kind);
        let Some(key) = sch.key.as_deref() else {
            continue;
        };

        if let Some(rest) = key.strip_prefix("idx:") {
            if let Some((row, col)) = parse_sparkline_idx_key(rest) {
                push_sparkline_position(&mut result, sch.sheet_id, row, col, kind);
            }
            continue;
        }

        if let Some(group_id) = key.strip_prefix("group:") {
            if kind == ChangeKind::Set
                && let Some(group) = sparklines::get_sparkline_group(
                    stores.storage.doc(),
                    &stores.storage.sheets_ref(),
                    &sch.sheet_id,
                    group_id,
                )
            {
                for sparkline_id in &group.sparkline_ids {
                    if let Some(sparkline) = sparklines::get_sparkline(
                        stores.storage.doc(),
                        &stores.storage.sheets_ref(),
                        &sch.sheet_id,
                        sparkline_id,
                    ) {
                        push_sparkline_position(
                            &mut result,
                            sch.sheet_id,
                            sparkline.cell.row,
                            sparkline.cell.col,
                            ChangeKind::Set,
                        );
                    }
                }
            }
            continue;
        }

        if kind == ChangeKind::Set
            && let Some(sparkline) = sparklines::get_sparkline(
                stores.storage.doc(),
                &stores.storage.sheets_ref(),
                &sch.sheet_id,
                key,
            )
        {
            push_sparkline_position(
                &mut result,
                sch.sheet_id,
                sparkline.cell.row,
                sparkline.cell.col,
                ChangeKind::Set,
            );
        }
    }

    // --- Conditional format changes ---
    for cfch in &changes.conditional_formats {
        result.cf_changes.push(CfChange {
            sheet_id: cfch.sheet_id.to_uuid_string(),
            kind: observer_kind_to_change_kind(cfch.kind),
            rule_id: cfch.key.clone(),
        });
    }

    // --- Named range changes ---
    for nrch in &changes.named_ranges {
        let kind = observer_kind_to_change_kind(nrch.kind);
        let name = nrch.key.clone().unwrap_or_default();
        result
            .named_range_changes
            .push(NamedRangeChange { name, kind });
    }

    // --- Sorting changes ---
    for sch in &changes.sorting {
        result.sorting_changes.push(SortingChange {
            sheet_id: sch.sheet_id.to_uuid_string(),
            kind: observer_kind_to_change_kind(sch.kind),
            start_row: 0,
            start_col: 0,
            end_row: 0,
            end_col: 0,
            rows_moved: 0,
        });
    }

    // --- Sheet metadata changes ---
    //
    // Observer field names are raw camelCase Yrs meta keys (e.g. "name",
    // "frozenRows", "showGridlines"). Translate per key into either:
    //   - a `SheetSettingsChange` with the full post-state settings snapshot
    //     (when the key participates in `SheetSettings`), or
    //   - a `SheetChange` with the post-state payload populated (rename,
    //     order, hidden, visibility, tabColor, frozenRows/frozenCols).
    //
    // The observer record does not retain pre-mutation scalars, so
    // `old_name` / `old_index` / `old_color` / `old_frozen_*` are emitted
    // as `None`. The TS mirror tolerates missing pre-state; only the
    // post-state must be populated for the kernel mirror to resolve a
    // remote/observer-driven sheet-meta change correctly.
    let sheet_doc = stores.storage.doc();
    let sheet_map = stores.storage.sheets();
    for smch in &changes.sheet_meta {
        let sheet_id_str = smch.sheet_id.to_uuid_string();
        let kind = observer_kind_to_change_kind(smch.kind);
        let field_str = smch.field.as_deref().unwrap_or("");

        // Settings-bucket keys (top-level meta keys that participate in
        // SheetSettings). Source of truth: SHEET_SETTINGS_KEYS in
        // crate::storage::sheet::settings.
        if settings::is_sheet_settings_key(field_str) {
            let post_settings = settings::get_sheet_settings(sheet_doc, sheet_map, &smch.sheet_id);
            let settings_value =
                serde_json::to_value(&post_settings).expect("SheetSettings must serialize to JSON");
            result.settings_changes.push(SheetSettingsChange {
                sheet_id: sheet_id_str,
                kind,
                changed_key: field_str.to_string(),
                settings: settings_value,
            });
            continue;
        }

        // SheetChange-backed keys. Field-specific payloads are hydrated
        // from post-mutation Yrs state via existing query helpers.
        let mut sheet_change = SheetChange {
            sheet_id: sheet_id_str,
            kind,
            field: SheetChangeField::Sheet,
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
            color: None,
            old_color: None,
        };

        match field_str {
            "name" => {
                sheet_change.field = SheetChangeField::Name;
                sheet_change.name =
                    properties::get_sheet_name(sheet_doc, sheet_map, &smch.sheet_id);
                // TODO(observer-old-state): observer does not retain old name.
            }
            "order" => {
                sheet_change.field = SheetChangeField::Order;
                sheet_change.index = stores
                    .storage
                    .sheet_order()
                    .iter()
                    .position(|sid| sid == &smch.sheet_id)
                    .map(|i| i as i32);
                // TODO(observer-old-state): observer does not retain old index.
            }
            "hidden" => {
                sheet_change.field = SheetChangeField::Hidden;
                sheet_change.hidden = Some(visibility::is_sheet_hidden(
                    sheet_doc,
                    sheet_map,
                    &smch.sheet_id,
                ));
            }
            "visibility" | "veryHidden" => {
                sheet_change.field = SheetChangeField::Visibility;
                let state = visibility::get_sheet_visibility(sheet_doc, sheet_map, &smch.sheet_id);
                sheet_change.hidden = Some(state == "hidden" || state == "veryHidden");
            }
            "tabColor" | "tab_color" => {
                sheet_change.field = SheetChangeField::TabColor;
                sheet_change.color =
                    properties::get_sheet_meta(sheet_doc, sheet_map, &smch.sheet_id)
                        .and_then(|m| m.tab_color);
                // TODO(observer-old-state): observer does not retain old color.
            }
            "frozenRows" | "frozenCols" | "frozen" => {
                sheet_change.field = SheetChangeField::Frozen;
                let panes = view::get_frozen_panes(sheet_doc, sheet_map, &smch.sheet_id);
                sheet_change.frozen_rows = Some(panes.rows);
                sheet_change.frozen_cols = Some(panes.cols);
                // TODO(observer-old-state): observer does not retain old frozen rows/cols.
            }
            "enableCalculation" => {
                sheet_change.field = SheetChangeField::EnableCalculation;
            }
            _ => {
                // Unknown sheet-meta keys are not sheet lifecycle events.
                // `SheetChangeField::Sheet` is reserved for canonical sheet
                // introduction/removal from `sheet_additions`,
                // `sheet_deletions`, and hydration. Emitting it here lets an
                // unrelated metadata removal look like a deleted sheet to the
                // TS mirror.
                continue;
            }
        }

        result.sheet_changes.push(sheet_change);
    }

    // --- Sheet order changes ---
    //
    // The `sheetOrder` Y.Array sits in the workbook map. Mutations
    // (move_sheet, reorder_sheets) and their undo/redo emit
    // `Event::Array` events that the observer captures as
    // `sheet_order_changed = true`. Translate into per-sheet
    // `SheetChange{field: Order}` entries so the TS mirror updates
    // tab positions. The observer does not retain pre-state, so
    // `old_index` is `None`.
    if changes.sheet_order_changed {
        let order = stores.storage.sheet_order();
        for (idx, sid) in order.iter().enumerate() {
            result.sheet_changes.push(SheetChange {
                sheet_id: sid.to_uuid_string(),
                kind: ChangeKind::Set,
                field: SheetChangeField::Order,
                name: None,
                old_name: None,
                index: Some(idx as i32),
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
    }

    // --- Observer old values ---
    // Thread old cell values from the observer into the MutationResult so the
    // TS ChangeAccumulator can populate DirtyCell.oldValue.
    for cell_change in &changes.cells {
        if let Some(ref old_val) = cell_change.old_value {
            let key = format!(
                "{}:{}",
                cell_change.sheet_id.to_uuid_string(),
                cell_change.cell_id.to_uuid_string(),
            );
            result.old_values.insert(key, old_val.clone());
        }
    }

    // --- Workbook settings changes ---
    if changes.workbook_settings_changed {
        let doc = stores.storage.doc();
        let workbook_settings =
            workbook::settings::get_settings(doc, stores.storage.workbook_map());
        let workbook_settings_value = serde_json::to_value(&workbook_settings)
            .expect("WorkbookSettings must serialize to JSON");
        let changed_keys = match &workbook_settings_value {
            serde_json::Value::Object(map) => map.keys().cloned().collect::<Vec<_>>(),
            _ => Vec::new(),
        };
        result
            .workbook_settings_changes
            .push(WorkbookSettingsChange {
                kind: ChangeKind::Set,
                changed_keys,
                settings: workbook_settings_value,
            });
    }

    result
}

fn parse_sparkline_idx_key(rest: &str) -> Option<(u32, u32)> {
    let (row, col) = rest.split_once(',')?;
    Some((row.parse().ok()?, col.parse().ok()?))
}

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
// build_mutation_result_for_hydration
// ---------------------------------------------------------------------------

/// Build a [`MutationResult`] that represents a freshly hydrated workbook
/// (XLSX / CSV import). Hydration writes directly to Yrs storage and
/// rebuilds engine indexes, bypassing the live observer. This helper walks
/// the post-hydration engine state and emits per-domain "Set" / "Created"
/// changes so the kernel TS event pipeline (`MutationResultHandler.applyAndNotify`)
/// can populate the TS-side projections (drawings, tables, comments,
/// filters, sparklines, named ranges, conditional formats, pivots, grouping)
/// exactly as it does for live mutations.
///
/// Kernel mirror direct-state bridge: also emits the mirror-backed direct-state
/// families — sheet identity (name/order/visibility/tab-color/frozen panes),
/// per-sheet settings, page breaks, print area/titles/settings, split config,
/// scroll position, and workbook settings — so the first-paint
/// `MutationResult` is sufficient to fully populate the kernel TS mirror
/// without a separate hydration RPC.
///
/// **What is NOT emitted:**
///
/// - `propertyChanges` / `dimensionChanges` / `visibilityChanges` /
///   `mergeChanges` / `structureChanges` — bulk per-cell/row/col changes
///   are too expensive to enumerate and the viewport buffer is the
///   correct mechanism for cell/format reads after hydration.
/// - `sortingChanges` — sorting is an action, not a stored entity.
pub(in crate::storage::engine) fn build_mutation_result_for_hydration(
    stores: &EngineStores,
    mirror: &CellMirror,
    recalc: RecalcResult,
) -> MutationResult {
    let mut result = MutationResult::from_recalc(recalc);

    let sheet_ids = stores.storage.sheet_order();
    for sid in &sheet_ids {
        build_sheet_hydration_changes(stores, mirror, sid, None, &mut result);
    }
    let doc = stores.storage.doc();

    // ----- Named ranges (workbook-scoped enumeration) -----
    let named_ranges =
        crate::storage::engine::services::queries::get_named_ranges_by_scope(stores, None);
    for nr in named_ranges {
        result.named_range_changes.push(NamedRangeChange {
            name: nr.name,
            kind: ChangeKind::Set,
        });
    }

    // ----- Workbook-level settings (full snapshot) -----
    //
    // Single emit; `changed_keys` enumerates every camelCase top-level
    // field on the snapshot so the kernel mirror knows the entire
    // payload was "changed from nothing" on hydration. The mirror
    // replaces its full workbook-settings payload from `settings`.
    let workbook_settings = workbook::settings::get_settings(doc, stores.storage.workbook_map());
    let workbook_settings_value =
        serde_json::to_value(&workbook_settings).expect("WorkbookSettings must serialize to JSON");
    let changed_keys = match &workbook_settings_value {
        serde_json::Value::Object(map) => map.keys().cloned().collect::<Vec<_>>(),
        _ => Vec::new(),
    };
    result
        .workbook_settings_changes
        .push(WorkbookSettingsChange {
            kind: ChangeKind::Set,
            changed_keys,
            settings: workbook_settings_value,
        });

    result
}

/// Build a minimal [`MutationResult`] for deferred-hydration mode.
///
/// In deferred mode, Yrs is empty. We read sheet metadata from the stored
/// `DeferredHydrationData` (which holds the `ParseOutput` and `WorkbookSnapshot`)
/// to populate sheet changes, settings, and dimension data. This is enough for
/// the UI to show sheet tabs, apply dimensions, and render the viewport.
pub(in crate::storage::engine) fn build_mutation_result_for_deferred(
    stores: &EngineStores,
    _mirror: &CellMirror,
    deferred: Option<&crate::storage::engine::construction::DeferredHydrationData>,
) -> MutationResult {
    let mut result = MutationResult::from_recalc(RecalcResult::empty());

    let data = match deferred {
        Some(d) => d,
        None => {
            tracing::info!("[PERF] build_mutation_result_for_deferred: no deferred data");
            return result;
        }
    };
    tracing::info!(
        sheet_count = data.workbook_snap.sheets.len(),
        "[PERF] build_mutation_result_for_deferred: building"
    );

    // Emit SheetChange + settings for each sheet from parse output data.
    // In deferred mode Yrs is empty, so all metadata comes from ParseOutput.
    for (i, sheet_snap) in data.workbook_snap.sheets.iter().enumerate() {
        let sheet_data = &data.parse_output.sheets[i];
        let is_hidden = sheet_data.visibility != ooxml_types::workbook::SheetState::Visible;

        // Creation event (populates sheetOrder in kernel mirror)
        result.sheet_changes.push(SheetChange {
            sheet_id: sheet_snap.id.clone(),
            field: SheetChangeField::Sheet,
            kind: ChangeKind::Set,
            name: Some(sheet_data.name.clone()),
            old_name: None,
            index: Some(i as i32),
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

        // Visibility event (for hidden sheets)
        if is_hidden {
            result.sheet_changes.push(SheetChange {
                sheet_id: sheet_snap.id.clone(),
                field: SheetChangeField::Visibility,
                kind: ChangeKind::Set,
                name: None,
                old_name: None,
                index: None,
                old_index: None,
                hidden: Some(true),
                source_sheet_id: None,
                frozen_rows: None,
                old_frozen_rows: None,
                frozen_cols: None,
                old_frozen_cols: None,
                color: None,
                old_color: None,
            });
        }

        // Frozen panes
        if let Some(ref fp) = sheet_data.frozen_pane
            && (fp.rows > 0 || fp.cols > 0)
        {
            result.sheet_changes.push(SheetChange {
                sheet_id: sheet_snap.id.clone(),
                field: SheetChangeField::Frozen,
                kind: ChangeKind::Set,
                name: None,
                old_name: None,
                index: None,
                old_index: None,
                hidden: None,
                source_sheet_id: None,
                frozen_rows: Some(fp.rows),
                old_frozen_rows: None,
                frozen_cols: Some(fp.cols),
                old_frozen_cols: None,
                color: None,
                old_color: None,
            });
        }

        // Merge changes from parse_output
        for m in &sheet_data.merges {
            result.merge_changes.push(MergeChange {
                sheet_id: sheet_snap.id.clone(),
                kind: ChangeKind::Set,
                start_row: m.start_row,
                start_col: m.start_col,
                end_row: m.end_row,
                end_col: m.end_col,
            });
        }

        // Floating objects are hydrated into the critical Yrs document even in
        // deferred mode. Emit the same Created patches as the full hydration
        // path so TS-side object projections are populated before first paint.
        if let Ok(sid) = SheetId::from_uuid_str(&sheet_snap.id) {
            let doc = stores.storage.doc();
            let sheets = stores.storage.sheets();
            let grid = stores.grid_indexes.get(&sid);
            let layout = stores.layout_indexes.get(&sid);
            let all_objects_json =
                crate::storage::sheet::floating_objects::get_all_floating_objects(
                    doc, sheets, &sid,
                );
            let mut bounds_map = std::collections::HashMap::with_capacity(all_objects_json.len());
            for (object_id, obj_json) in &all_objects_json {
                if let Some(bounds) =
                    crate::storage::sheet::floating_objects::compute_object_pixel_bounds(
                        grid, layout, obj_json,
                    )
                {
                    bounds_map.insert(object_id.clone(), bounds);
                }
            }

            for obj in crate::storage::sheet::floating_objects::get_all_floating_objects_typed(
                doc, sheets, &sid,
            ) {
                let object_id = obj.common.id.clone();
                let object_type = Some(obj.kind());
                let bounds = bounds_map.get(&object_id).cloned();
                result.floating_object_changes.push(FloatingObjectChange {
                    sheet_id: sheet_snap.id.clone(),
                    object_id,
                    kind: FloatingObjectChangeKind::Created,
                    object_type,
                    data: Some(obj),
                    bounds,
                });
            }
        }

        // Sheet settings with real data from parse output view
        let sheet_settings = domain_types::domain::sheet::SheetSettings {
            show_gridlines: sheet_data.view.show_gridlines,
            show_row_headers: sheet_data.view.show_row_col_headers,
            show_column_headers: sheet_data.view.show_row_col_headers,
            is_protected: sheet_data.protection.is_some(),
            protection_password_hash: None,
            show_zero_values: sheet_data.view.show_zeros,
            gridline_color: None,
            right_to_left: sheet_data.view.right_to_left,
            show_formulas: sheet_data.view.show_formulas,
            zoom_scale: sheet_data.view.zoom_scale,
            protection_options: None,
            default_row_height: sheet_data.dimensions.default_row_height.unwrap_or(20.0),
            default_col_width: sheet_data.dimensions.default_col_width.unwrap_or(64.0),
        };
        let settings_value =
            serde_json::to_value(&sheet_settings).expect("SheetSettings must serialize to JSON");
        result.settings_changes.push(SheetSettingsChange {
            sheet_id: sheet_snap.id.clone(),
            kind: ChangeKind::Set,
            changed_key: "*hydration*".to_string(),
            settings: settings_value,
        });
    }

    // Emit workbook settings. Deferred hydration has no populated Yrs
    // workbook settings map yet, so emit Rust's canonical defaults as the
    // full snapshot rather than an empty object.
    let workbook_settings_value = serde_json::to_value(WorkbookSettings::default())
        .expect("WorkbookSettings defaults must serialize to JSON");
    let changed_keys = match &workbook_settings_value {
        serde_json::Value::Object(map) => map.keys().cloned().collect::<Vec<_>>(),
        _ => Vec::new(),
    };
    result
        .workbook_settings_changes
        .push(WorkbookSettingsChange {
            kind: ChangeKind::Set,
            changed_keys,
            settings: workbook_settings_value,
        });

    // Emit named ranges
    for nr in &data.parse_output.named_ranges {
        if !nr.hidden {
            result.named_range_changes.push(NamedRangeChange {
                name: nr.name.clone(),
                kind: ChangeKind::Set,
            });
        }
    }

    result
}

// ---------------------------------------------------------------------------
// enrich_display_text
// ---------------------------------------------------------------------------

/// Populate `display_text` on each `CellChange` using the canonical
/// `format_value_at_cell` method.
pub(in crate::storage::engine) fn enrich_display_text(
    _stores: &EngineStores,
    _mirror: &CellMirror,
    _settings: &EngineSettings,
    result: &mut RecalcResult,
    format_value_fn: &dyn Fn(&CellValue, &SheetId, u32, u32) -> String,
) {
    for change in &mut result.changed_cells {
        let Some(pos) = change.position.clone() else {
            continue;
        };
        let sheet_id = match SheetId::from_uuid_str(&change.sheet_id) {
            Ok(id) => id,
            Err(_) => continue,
        };
        let text = format_value_fn(&change.value, &sheet_id, pos.row, pos.col);
        change.display_text = Some(text);
    }
}

// ---------------------------------------------------------------------------
// enrich_metadata_flags
// ---------------------------------------------------------------------------

/// Populate `extra_flags` on each `CellChange` with metadata flags
/// (HAS_FORMULA, HAS_COMMENT, HAS_SPARKLINE, HAS_HYPERLINK).
pub(in crate::storage::engine) fn enrich_metadata_flags(
    stores: &EngineStores,
    mirror: &CellMirror,
    recalc: &mut RecalcResult,
) {
    let mut comment_cache: std::collections::HashMap<SheetId, std::collections::HashSet<u128>> =
        std::collections::HashMap::new();

    for change in &mut recalc.changed_cells {
        let Some(pos) = change.position.clone() else {
            continue;
        };

        let sheet_id = match SheetId::from_uuid_str(&change.sheet_id) {
            Ok(id) => id,
            Err(_) => continue,
        };
        let cell_id = match CellId::from_uuid_str(&change.cell_id) {
            Ok(id) => id,
            Err(_) => continue,
        };

        // --- HAS_FORMULA ---
        // Check three sources:
        // 1. Compute store has a formula for this cell's CellId (anchor cells).
        // 2. Mirror has a formula for the cell at this position (legacy CellId path).
        // 3. Projection registry: CSE members own the legacy array formula.
        //    Dynamic-array spill members are associated projected values, not
        //    formula owners, and are marked through IS_SPILL_MEMBER patches.
        let has_formula = stores.compute.get_formula(&cell_id).is_some()
            || mirror
                .get_sheet(&sheet_id)
                .and_then(|sheet| {
                    sheet
                        .cell_id_at(SheetPos::new(pos.row, pos.col))
                        .and_then(|cid| sheet.get_cell(&cid))
                })
                .is_some_and(|entry| entry.formula.is_some())
            || mirror
                .projection_registry
                .resolve(&sheet_id, pos.row, pos.col)
                .is_some_and(|(anchor_id, _, _)| mirror.is_cse_anchor(&anchor_id));

        if has_formula {
            change.extra_flags |= render_flags::HAS_FORMULA;
        }

        // --- HAS_COMMENT ---
        let comment_ids = comment_cache.entry(sheet_id).or_insert_with(|| {
            let cell_id_hexes = comments::get_cell_ids_with_comments(
                stores.storage.doc(),
                stores.storage.sheets(),
                &sheet_id,
            );
            cell_id_hexes
                .iter()
                .filter_map(|hex| hex_to_id(hex))
                .collect()
        });
        if comment_ids.contains(&cell_id.as_u128()) {
            change.extra_flags |= render_flags::HAS_COMMENT;
        }

        // --- HAS_SPARKLINE ---
        if sparklines::has_sparkline(
            stores.storage.doc(),
            &stores.storage.sheets_ref(),
            &sheet_id,
            pos.row,
            pos.col,
        ) {
            change.extra_flags |= render_flags::HAS_SPARKLINE;
        }

        // --- HAS_HYPERLINK ---
        if let Some(grid) = stores.grid_indexes.get(&sheet_id)
            && hyperlinks::get_hyperlink(
                stores.storage.doc(),
                stores.storage.sheets(),
                &sheet_id,
                grid,
                pos.row,
                pos.col,
            )
            .is_some()
        {
            change.extra_flags |= render_flags::HAS_HYPERLINK;
        }
    }
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------
//
// These tests pin the contract that *remote* (observer-driven) sheet-meta
// edits and *cold-load* hydration both populate the mirror-backed
// MutationResult families with the same shape the live local-write path
// emits, so the kernel TS mirror can apply either path uniformly.
//
// Two harnesses:
//   - Collab pair: peer A makes a local edit, encodes a yrs delta,
//     peer B applies the delta. The delta drains through B's observer,
//     producing a `DocumentChanges` that `build_mutation_result_from_changes`
//     translates. This exercises the *observer-translation* path
//     (gaps A.1/A.2 in the plan) without needing to mock yrs internals.
//   - Hydration: build an engine from a snapshot, then call
//     `build_mutation_result_for_hydration` directly. This exercises the
//     cold-load path (gap C in the plan).
#[cfg(test)]
mod tests {
    use super::*;
    use crate::snapshot::{ChangeKind as SnapChangeKind, SheetChangeField, WorkbookSettingsChange};
    use crate::storage::engine::YrsComputeEngine;
    use snapshot_types::{SheetSnapshot, WorkbookSnapshot};

    const SHEET_UUID: &str = "550e8400-e29b-41d4-a716-446655440000";

    fn empty_snapshot_with_one_sheet() -> WorkbookSnapshot {
        WorkbookSnapshot {
            sheets: vec![SheetSnapshot {
                id: SHEET_UUID.to_string(),
                name: "Sheet1".to_string(),
                rows: 10,
                cols: 10,
                cells: vec![],
                ranges: vec![],
            }],
            ..Default::default()
        }
    }

    /// Build a (peer_a, peer_b) pair seeded from the same yrs state.
    /// Peer B is born from A's full state; both share CellIds + history,
    /// so subsequent yrs deltas from A apply cleanly to B.
    fn build_collab_pair() -> (YrsComputeEngine, YrsComputeEngine) {
        let (engine_a, _) = YrsComputeEngine::from_snapshot(empty_snapshot_with_one_sheet())
            .expect("A from_snapshot");
        let empty_sv = {
            use yrs::updates::encoder::Encode;
            yrs::StateVector::default().encode_v1()
        };
        let full_state = engine_a
            .encode_diff(&empty_sv)
            .expect("A encode_diff(empty)");
        let (engine_b, _) =
            YrsComputeEngine::from_yrs_state(&full_state).expect("B from_yrs_state");
        (engine_a, engine_b)
    }

    fn ship_delta(a: &mut YrsComputeEngine, b: &mut YrsComputeEngine) -> MutationResult {
        let b_sv = b.encode_state_vector();
        let delta = a.encode_diff(&b_sv).expect("A encode_diff(B.sv)");
        let (_patches, result) = b.apply_sync_update(&delta).expect("B apply_sync_update");
        result
    }

    fn sheet_id() -> SheetId {
        SheetId::from_uuid_str(SHEET_UUID).unwrap()
    }

    // ------------------------------------------------------------------
    // Gap A.2 — Sync rebuild routes settings state through the hydration
    // `SheetSettingsChange` sentinel with the post-mutation full settings blob.
    // ------------------------------------------------------------------
    #[test]
    fn sync_rebuild_emits_settings_hydration_for_remote_show_gridlines_toggle() {
        let (mut engine_a, mut engine_b) = build_collab_pair();
        let sid = sheet_id();

        // Peer A: toggle showGridlines off.
        engine_a
            .set_view_option(&sid, "showGridlines", false)
            .expect("A set_view_option");

        // Peer B applies A's delta. Sync intentionally rebuilds from Yrs state
        // instead of trusting observer events, so the returned settings change
        // is hydration-shaped rather than a per-key observer delta.
        let result = ship_delta(&mut engine_a, &mut engine_b);

        let settings_change = result
            .settings_changes
            .iter()
            .find(|s| s.sheet_id == sid.to_uuid_string())
            .expect("settings_changes must contain the sheet settings entry");
        assert_eq!(settings_change.sheet_id, sid.to_uuid_string());
        assert_eq!(settings_change.kind, SnapChangeKind::Set);
        assert_eq!(settings_change.changed_key, "*hydration*");
        // Full settings snapshot must be populated and must reflect the
        // post-mutation value (showGridlines=false).
        let show = settings_change
            .settings
            .get("showGridlines")
            .and_then(|v| v.as_bool())
            .expect("showGridlines key on settings blob");
        assert!(!show, "post-state showGridlines must be false");

        assert!(
            result.sheet_changes.iter().any(
                |sc| sc.field == SheetChangeField::Sheet && sc.sheet_id == sid.to_uuid_string()
            ),
            "sync rebuild must include the hydration sheet entry"
        );
    }

    // ------------------------------------------------------------------
    // Gap A.1 — Frozen-key normalization for raw "frozenRows"/"frozenCols".
    // ------------------------------------------------------------------
    #[test]
    fn observer_translation_emits_frozen_change_for_remote_freeze_toggle() {
        let (mut engine_a, mut engine_b) = build_collab_pair();
        let sid = sheet_id();

        engine_a
            .set_frozen_panes(&sid, 2, 1)
            .expect("A set_frozen_panes");

        let result = ship_delta(&mut engine_a, &mut engine_b);

        // The observer fires twice (one for `frozenRows`, one for
        // `frozenCols`). Both must normalize to `SheetChangeField::Frozen`
        // with the post-state counts.
        let frozen_changes: Vec<_> = result
            .sheet_changes
            .iter()
            .filter(|s| s.field == SheetChangeField::Frozen)
            .collect();
        assert!(
            !frozen_changes.is_empty(),
            "expected at least one Frozen SheetChange; got sheet_changes = {:?}",
            result.sheet_changes
        );
        for sc in &frozen_changes {
            assert_eq!(sc.sheet_id, sid.to_uuid_string());
            assert_eq!(sc.frozen_rows, Some(2));
            assert_eq!(sc.frozen_cols, Some(1));
        }
    }

    // ------------------------------------------------------------------
    // Gap A — populated payload tests for remote sheet-meta edits.
    // ------------------------------------------------------------------
    #[test]
    fn observer_translation_emits_populated_rename() {
        let (mut engine_a, mut engine_b) = build_collab_pair();
        let sid = sheet_id();

        engine_a
            .rename_compute_sheet(&sid, "Renamed")
            .expect("A rename_sheet");

        let result = ship_delta(&mut engine_a, &mut engine_b);

        let sc = result
            .sheet_changes
            .iter()
            .find(|s| s.field == SheetChangeField::Name)
            .expect("expected Name SheetChange");
        assert_eq!(sc.sheet_id, sid.to_uuid_string());
        assert_eq!(sc.name.as_deref(), Some("Renamed"));
    }

    #[test]
    fn sync_rebuild_emits_populated_visibility_for_hidden() {
        let (mut engine_a, mut engine_b) = build_collab_pair();
        let sid = sheet_id();

        engine_a.set_sheet_hidden(&sid, true).expect("A set_hidden");
        let result = ship_delta(&mut engine_a, &mut engine_b);

        let sc = result
            .sheet_changes
            .iter()
            .find(|s| s.field == SheetChangeField::Visibility)
            .expect("expected Visibility SheetChange");
        assert_eq!(sc.hidden, Some(true));
    }

    #[test]
    fn observer_translation_emits_populated_visibility() {
        let (mut engine_a, mut engine_b) = build_collab_pair();
        let sid = sheet_id();

        engine_a
            .set_sheet_visibility(&sid, "veryHidden")
            .expect("A set_visibility");
        let result = ship_delta(&mut engine_a, &mut engine_b);

        let sc = result
            .sheet_changes
            .iter()
            .find(|s| s.field == SheetChangeField::Visibility)
            .expect("expected Visibility SheetChange");
        assert_eq!(sc.hidden, Some(true));
    }

    #[test]
    fn observer_translation_emits_populated_tab_color() {
        let (mut engine_a, mut engine_b) = build_collab_pair();
        let sid = sheet_id();

        engine_a
            .set_tab_color(&sid, Some("#FF0000".into()))
            .expect("A set_tab_color");
        let result = ship_delta(&mut engine_a, &mut engine_b);

        let sc = result
            .sheet_changes
            .iter()
            .find(|s| s.field == SheetChangeField::TabColor)
            .expect("expected TabColor SheetChange");
        assert_eq!(sc.color.as_deref(), Some("#FF0000"));
    }

    // NOTE on Order coverage:
    //
    // The plan lists `order` in the populated-payload set, but the
    // `SheetChangeField::Order` branch in `build_mutation_result_from_changes`
    // reads from `changes.sheet_meta` with `field == "order"` — and the
    // production observer path never writes a top-level `"order"` key
    // into per-sheet meta. Sheet ordering is stored as a workbook-scoped
    // YArray (KEY_SHEET_ORDER), which the observer surfaces as a
    // `structural_changes` entry, not a `sheet_meta` change. The Order
    // arm is reachable only by a synthetic test that injects a
    // `SheetMetaChange { field: Some("order".into()), ... }` directly,
    // which would test the unit logic of the arm without exercising any
    // realistic pipeline. Hydration coverage already verifies that
    // `SheetChangeField::Order` lands with a populated `index` on the
    // cold-load path (`hydration_emits_mirror_backed_families_with_populated_payloads`).

    // ------------------------------------------------------------------
    // Gap C — Hydration emits mirror-backed direct-state families with
    // populated payloads; uses Set | Removed only.
    // ------------------------------------------------------------------
    #[test]
    fn hydration_emits_mirror_backed_families_with_populated_payloads() {
        // Build engine, mutate state to non-defaults, then call the
        // hydration builder directly to exercise the cold-load path.
        let (mut engine, _) = YrsComputeEngine::from_snapshot(empty_snapshot_with_one_sheet())
            .expect("from_snapshot");
        let sid = sheet_id();

        // Establish non-default values across mirror-backed families.
        engine
            .set_view_option(&sid, "showGridlines", false)
            .expect("set_view_option");
        engine
            .set_frozen_panes(&sid, 3, 2)
            .expect("set_frozen_panes");
        engine
            .set_tab_color(&sid, Some("#00FF00".into()))
            .expect("set_tab_color");

        // Drain pending observer effects so subsequent hydration sees a
        // settled engine state (mirrors the production hydration path).
        let recalc = crate::snapshot::RecalcResult::empty();
        let result = engine.with_internals_for_test(|stores, mirror, _| {
            super::build_mutation_result_for_hydration(stores, mirror, recalc)
        });

        // 1. SheetChange families on hydration must use Set (not Created).
        for sc in &result.sheet_changes {
            assert!(
                matches!(sc.kind, SnapChangeKind::Set | SnapChangeKind::Removed),
                "hydration SheetChange.kind must be Set or Removed (was {:?})",
                sc.kind
            );
        }

        // 2. Frozen change must be populated (not just discriminator).
        let frozen = result
            .sheet_changes
            .iter()
            .find(|s| s.field == SheetChangeField::Frozen)
            .expect("expected Frozen SheetChange on hydration");
        assert_eq!(frozen.frozen_rows, Some(3));
        assert_eq!(frozen.frozen_cols, Some(2));

        // 3. TabColor populated.
        let tab = result
            .sheet_changes
            .iter()
            .find(|s| s.field == SheetChangeField::TabColor)
            .expect("expected TabColor SheetChange on hydration");
        assert_eq!(tab.color.as_deref(), Some("#00FF00"));

        // 4. Name populated.
        let name = result
            .sheet_changes
            .iter()
            .find(|s| s.field == SheetChangeField::Name)
            .expect("expected Name SheetChange on hydration");
        assert_eq!(name.name.as_deref(), Some("Sheet1"));

        // 5. Order populated.
        let order = result
            .sheet_changes
            .iter()
            .find(|s| s.field == SheetChangeField::Order)
            .expect("expected Order SheetChange on hydration");
        assert_eq!(order.index, Some(0));

        // 5b. Canonical creation event: `field:Sheet, kind:Set` must be
        // emitted per registered sheet with both name and index populated.
        // Without it, the kernel mirror's `sheetOrder` stays empty after
        // hydration — the per-field `Name`/`Order` arms only touch the
        // meta map and `Order`'s move arm requires `oldIndex`. See
        // `kernel/src/document/state-mirror.ts:applySheetChange`.
        let sheet_create = result
            .sheet_changes
            .iter()
            .find(|s| s.field == SheetChangeField::Sheet)
            .expect("expected Sheet SheetChange on hydration");
        assert_eq!(sheet_create.kind, SnapChangeKind::Set);
        assert_eq!(sheet_create.sheet_id, sid.to_uuid_string());
        assert_eq!(sheet_create.name.as_deref(), Some("Sheet1"));
        assert_eq!(sheet_create.index, Some(0));

        // 6. Per-sheet settings — full snapshot (sentinel changed_key).
        let settings = result
            .settings_changes
            .iter()
            .find(|s| s.sheet_id == sid.to_uuid_string())
            .expect("expected SheetSettingsChange on hydration");
        assert_eq!(settings.changed_key, "*hydration*");
        assert_eq!(settings.kind, SnapChangeKind::Set);
        let show = settings
            .settings
            .get("showGridlines")
            .and_then(|v| v.as_bool())
            .expect("settings.showGridlines key");
        assert!(!show, "hydration must reflect post-mutation showGridlines");

        // 7. Workbook-level settings emitted exactly once with all keys.
        assert_eq!(
            result.workbook_settings_changes.len(),
            1,
            "hydration must emit one WorkbookSettingsChange, got {:?}",
            result.workbook_settings_changes
        );
        let WorkbookSettingsChange {
            kind,
            changed_keys,
            settings: wb_settings,
        } = &result.workbook_settings_changes[0];
        assert_eq!(*kind, SnapChangeKind::Set);
        assert!(
            !changed_keys.is_empty(),
            "WorkbookSettingsChange.changed_keys must enumerate settings on hydration"
        );
        assert!(
            wb_settings.is_object(),
            "WorkbookSettingsChange.settings must be a serialized object"
        );

        // 8. Print settings always emitted (defaults populate the mirror).
        assert!(
            !result.print_settings_changes.is_empty(),
            "hydration must emit print_settings_changes"
        );
        // 9. Scroll position always emitted.
        assert!(
            !result.scroll_position_changes.is_empty(),
            "hydration must emit scroll_position_changes"
        );
    }
}
