//! Extracted export (read-only) functions.
//!
//! Each function takes explicit references to the engine sub-structs it needs
//! (e.g. `&EngineStores`, `&CellMirror`) instead of `&self`.  The original
//! methods in `export.rs` delegate to these with one-line calls.
//!
//! ## Module structure
//!
//! - `cells` — cell-level export (batch Yrs reads, cell data, row/col styles)
//! - `sheet_metadata` — per-sheet metadata (hyperlinks, validations, sparklines, etc.)
//! - `dimensions` — row heights, column widths, tables
//! - `workbook` — workbook-level exports (theme, protection, properties, etc.)

mod cells;
mod dimensions;
mod sheet_metadata;
mod workbook;

// Re-export everything that's pub(in crate::storage::engine) from submodules
pub(in crate::storage::engine) use cells::{
    export_authored_style_runs_for_sheet, export_cells_for_sheet, export_row_col_styles_for_sheet,
};
pub(in crate::storage::engine) use dimensions::{
    export_dimensions_for_sheet, export_tables_for_sheet,
};
pub(in crate::storage::engine) use sheet_metadata::{
    export_auto_filter_for_sheet, export_conditional_formats_for_sheet,
    export_data_validations_for_sheet, export_dv_declared_count, export_dv_disable_prompts,
    export_dv_window_attr, export_floating_objects_for_sheet, export_hyperlinks_for_sheet,
    export_outline_groups_for_sheet, export_page_breaks_for_sheet, export_sheet_protection,
    export_sort_state_for_sheet, export_sparkline_groups_for_sheet, export_sparklines_for_sheet,
    export_x14_data_validations_for_sheet, export_x14_dv_declared_count,
    export_x14_dv_disable_prompts,
};
pub(in crate::storage::engine) use workbook::{
    export_workbook_parsed_pivot_tables, export_workbook_protection, export_workbook_slicer_caches,
    export_workbook_theme, export_workbook_threaded_comment_persons,
};

use cell_types::SheetId;
use compute_document::schema::{KEY_COLS, KEY_ROWS};
use domain_types::{
    DataTableRegion, DocumentFormat, FrozenPane, MergeRegion, ParseOutput, SheetData, SheetView,
    domain::chart::ChartSpec,
    domain::comment::{Comment, CommentType},
    domain::conditional_format::ConditionalFormat as DomainConditionalFormat,
    domain::floating_object::{FloatingObject, FloatingObjectData},
    domain::print::PrintSettings,
    domain::table::TableSpec,
};
use yrs::{Any, Map, Out, Transact};

use crate::mirror::CellMirror;
use crate::storage::sheet::get_meta_for_export;
use crate::storage::sheet::{dimensions as dims_mod, merges, print};

use super::super::export::pos_to_a1;
use super::objects::get_all_comments;
use super::queries;
use crate::storage::engine::stores::EngineStores;

// Private imports for submodule functions used in export_single_sheet
use sheet_metadata::resolve_hydrated_comment_position;
use workbook::{
    export_calculation_properties, export_custom_workbook_views_xml, export_document_properties,
    export_external_links, export_file_sharing, export_file_version, export_shared_string_hints,
    export_workbook_named_ranges, export_workbook_properties, export_workbook_style_palette,
    export_workbook_stylesheet, export_workbook_table_styles, export_workbook_views,
};

// -------------------------------------------------------------------
// Style palette dedup — O(1) lookup via HashMap
// -------------------------------------------------------------------

/// Trait for O(1) style palette deduplication.
///
/// Two implementations:
/// - `LocalPalette` — single-threaded (WASM / sequential fallback)
/// - `SharedPalette` — thread-safe via `parking_lot::Mutex` (native parallel export)
pub(crate) trait PaletteOps {
    fn get_or_insert(&self, fmt: DocumentFormat) -> u32;
}

/// Single-threaded palette using `RefCell` for interior mutability.
pub(crate) struct LocalPalette {
    palette: std::cell::RefCell<Vec<DocumentFormat>>,
    index: std::cell::RefCell<rustc_hash::FxHashMap<DocumentFormat, u32>>,
}

impl LocalPalette {
    #[cfg(not(feature = "native"))]
    fn new() -> Self {
        Self {
            palette: std::cell::RefCell::new(Vec::new()),
            index: std::cell::RefCell::new(rustc_hash::FxHashMap::default()),
        }
    }

    /// Create from an existing palette Vec (for backward-compat wrapper callsites).
    pub(crate) fn from_vec(existing: &mut Vec<DocumentFormat>) -> Self {
        let index = existing
            .iter()
            .enumerate()
            .map(|(i, fmt)| (fmt.clone(), i as u32))
            .collect();
        Self {
            palette: std::cell::RefCell::new(std::mem::take(existing)),
            index: std::cell::RefCell::new(index),
        }
    }

    pub(crate) fn into_vec(self) -> Vec<DocumentFormat> {
        self.palette.into_inner()
    }
}

impl PaletteOps for LocalPalette {
    fn get_or_insert(&self, fmt: DocumentFormat) -> u32 {
        let mut index = self.index.borrow_mut();
        if let Some(&idx) = index.get(&fmt) {
            return idx;
        }
        let mut palette = self.palette.borrow_mut();
        let idx = palette.len() as u32;
        index.insert(fmt.clone(), idx);
        palette.push(fmt);
        idx
    }
}

/// Thread-safe palette using `parking_lot::Mutex` for concurrent access.
/// Lock contention is minimal: unique formats are few (<1000 per workbook),
/// so most calls are fast HashMap lookups within a short critical section.
#[cfg(feature = "native")]
struct SharedPalette {
    inner: parking_lot::Mutex<(
        Vec<DocumentFormat>,
        rustc_hash::FxHashMap<DocumentFormat, u32>,
    )>,
}

#[cfg(feature = "native")]
impl SharedPalette {
    fn from_vec(existing: Vec<DocumentFormat>) -> Self {
        let index = existing
            .iter()
            .enumerate()
            .map(|(i, fmt)| (fmt.clone(), i as u32))
            .collect();
        Self {
            inner: parking_lot::Mutex::new((existing, index)),
        }
    }

    fn into_vec(self) -> Vec<DocumentFormat> {
        self.inner.into_inner().0
    }
}

#[cfg(feature = "native")]
impl PaletteOps for SharedPalette {
    fn get_or_insert(&self, fmt: DocumentFormat) -> u32 {
        let mut guard = self.inner.lock();
        let (palette, index) = &mut *guard;
        if let Some(&idx) = index.get(&fmt) {
            return idx;
        }
        let idx = palette.len() as u32;
        index.insert(fmt.clone(), idx);
        palette.push(fmt);
        idx
    }
}

// -------------------------------------------------------------------
// Per-sheet export orchestrator
// -------------------------------------------------------------------

/// Export all data for a single sheet.
///
/// Extracted from the per-sheet loop body of `build_parse_output_from_yrs`
/// to enable parallel execution via rayon. This function is pure read-only
/// (no mutations to engine state) and thread-safe when `palette` is a
/// `SharedPalette`.
fn export_single_sheet(
    stores: &EngineStores,
    mirror: &CellMirror,
    sheet_id: &SheetId,
    sheet_idx: usize,
    palette: &impl PaletteOps,
) -> Option<SheetData> {
    let mut profile = crate::xlsx_profile::PhaseTimer::new("export", "export_single_sheet");
    profile.counter("sheet_index", sheet_idx as u64);

    let name = queries::get_sheet_name(stores, sheet_id)?;

    // --- Cells ---
    let cells = export_cells_for_sheet(stores, mirror, sheet_id, palette);
    let authored_style_runs =
        export_authored_style_runs_for_sheet(stores, mirror, sheet_id, palette);

    // --- Merges ---
    let merges_raw = match stores.grid_indexes.get(sheet_id) {
        Some(grid) => merges::get_all_merges(
            stores.storage.doc(),
            stores.storage.sheets(),
            *sheet_id,
            grid,
        ),
        None => Vec::new(),
    };
    let merge_regions: Vec<MergeRegion> = merges_raw
        .into_iter()
        .map(|m| MergeRegion {
            start_row: m.start_row,
            start_col: m.start_col,
            end_row: m.end_row,
            end_col: m.end_col,
        })
        .collect();

    // --- View settings ---
    let view_opts = queries::get_view_options_query(stores, sheet_id);
    let scroll = queries::get_scroll_position_query(stores, sheet_id);
    #[allow(clippy::type_complexity)]
    let (
        zoom_scale_normal,
        zoom_scale_page_layout_view,
        zoom_scale_sheet_layout_view,
        tab_selected,
        active_cell,
        sqref,
        has_explicit_top_left_cell,
        frozen_pane_tlc,
        pane_config,
        selections,
        extra_sheet_views,
        rt_view_type,
        rt_show_outline_symbols,
        rt_show_ruler,
        rt_show_white_space,
        rt_default_grid_color,
        rt_window_protection,
        rt_color_id,
        workbook_view_id,
        sheet_view_ext_lst_xml,
    ) = {
        let txn = stores.storage.doc().transact();
        let meta = get_meta_for_export(&txn, stores.storage.sheets(), sheet_id);
        match meta {
            Some(m) => {
                let zsn = m.get(&txn, "zoomScaleNormal").and_then(|v| match v {
                    Out::Any(Any::Number(n)) => Some(n as u32),
                    _ => None,
                });
                let zsplv = m
                    .get(&txn, "zoomScalePageLayoutView")
                    .and_then(|v| match v {
                        Out::Any(Any::Number(n)) => Some(n as u32),
                        _ => None,
                    });
                let zsslv = m
                    .get(&txn, "zoomScaleSheetLayoutView")
                    .and_then(|v| match v {
                        Out::Any(Any::Number(n)) => Some(n as u32),
                        _ => None,
                    });
                let ts = m
                    .get(&txn, "tabSelected")
                    .and_then(|v| match v {
                        Out::Any(Any::Bool(b)) => Some(b),
                        _ => None,
                    })
                    .unwrap_or(false);
                let ac = m.get(&txn, "activeCell").and_then(|v| match v {
                    Out::Any(Any::String(s)) => Some(s.to_string()),
                    _ => None,
                });
                let sq = m.get(&txn, "sqref").and_then(|v| match v {
                    Out::Any(Any::String(s)) => Some(s.to_string()),
                    _ => None,
                });
                let etlc = m
                    .get(&txn, "hasExplicitTopLeftCell")
                    .and_then(|v| match v {
                        Out::Any(Any::Bool(b)) => Some(b),
                        _ => None,
                    })
                    .unwrap_or(false);
                let fp_tlc = m.get(&txn, "frozenPaneTopLeftCell").and_then(|v| match v {
                    Out::Any(Any::String(s)) => Some(s.to_string()),
                    _ => None,
                });
                let pane = m.get(&txn, "sheetPaneConfig").and_then(|v| match v {
                    Out::Any(Any::String(s)) => {
                        serde_json::from_str::<domain_types::SheetPaneConfig>(&s).ok()
                    }
                    _ => None,
                });
                let sels = m
                    .get(&txn, "selections")
                    .and_then(|v| match v {
                        Out::Any(Any::String(s)) => serde_json::from_str(&s).ok(),
                        _ => None,
                    })
                    .unwrap_or_default();
                let esv = m
                    .get(&txn, "extraSheetViews")
                    .and_then(|v| match v {
                        Out::Any(Any::String(s)) => serde_json::from_str(&s).ok(),
                        _ => None,
                    })
                    .unwrap_or_default();
                let vt = m.get(&txn, "viewType").and_then(|v| match v {
                    Out::Any(Any::String(s)) => Some(s.to_string()),
                    _ => None,
                });
                let sos = m
                    .get(&txn, "showOutlineSymbols")
                    .and_then(|v| match v {
                        Out::Any(Any::Bool(b)) => Some(b),
                        _ => None,
                    })
                    .unwrap_or(true);
                let sr = m
                    .get(&txn, "showRuler")
                    .and_then(|v| match v {
                        Out::Any(Any::Bool(b)) => Some(b),
                        _ => None,
                    })
                    .unwrap_or(true);
                let sws = m
                    .get(&txn, "showWhiteSpace")
                    .and_then(|v| match v {
                        Out::Any(Any::Bool(b)) => Some(b),
                        _ => None,
                    })
                    .unwrap_or(true);
                let dgc = m
                    .get(&txn, "defaultGridColor")
                    .and_then(|v| match v {
                        Out::Any(Any::Bool(b)) => Some(b),
                        _ => None,
                    })
                    .unwrap_or(true);
                let wp = m
                    .get(&txn, "windowProtection")
                    .and_then(|v| match v {
                        Out::Any(Any::Bool(b)) => Some(b),
                        _ => None,
                    })
                    .unwrap_or(false);
                let cid = m.get(&txn, "colorId").and_then(|v| match v {
                    Out::Any(Any::Number(n)) => Some(n as u32),
                    _ => None,
                });
                let wvid = m
                    .get(&txn, "workbookViewId")
                    .and_then(|v| match v {
                        Out::Any(Any::Number(n)) => Some(n as u32),
                        _ => None,
                    })
                    .unwrap_or(0);
                let view_ext = m.get(&txn, "sheetViewExtLstXml").and_then(|v| match v {
                    Out::Any(Any::String(s)) => Some(s.to_string()),
                    _ => None,
                });
                (
                    zsn, zsplv, zsslv, ts, ac, sq, etlc, fp_tlc, pane, sels, esv, vt, sos, sr, sws,
                    dgc, wp, cid, wvid, view_ext,
                )
            }
            None => (
                None,
                None,
                None,
                false,
                None,
                None,
                false,
                None,
                None,
                Vec::new(),
                Vec::new(),
                None,
                true,
                true,
                true,
                true,
                false,
                None,
                0,
                None,
            ),
        }
    };
    let frozen_pane = if pane_config
        .as_ref()
        .is_some_and(|pane| pane.state.is_frozen())
    {
        Some(FrozenPane {
            rows: pane_config.as_ref().unwrap().y_split as u32,
            cols: pane_config.as_ref().unwrap().x_split as u32,
            top_left_cell: pane_config
                .as_ref()
                .unwrap()
                .top_left_cell
                .clone()
                .or(frozen_pane_tlc),
        })
    } else {
        None
    };
    let view = SheetView {
        show_gridlines: view_opts.show_gridlines,
        show_row_col_headers: view_opts.show_row_headers && view_opts.show_column_headers,
        show_zeros: view_opts.show_zeros,
        show_outline_symbols: rt_show_outline_symbols,
        show_formulas: view_opts.show_formulas,
        right_to_left: view_opts.right_to_left,
        show_ruler: rt_show_ruler,
        show_white_space: rt_show_white_space,
        default_grid_color: rt_default_grid_color,
        window_protection: rt_window_protection,
        color_id: rt_color_id,
        zoom_scale: view_opts.zoom_scale,
        zoom_scale_normal,
        view: rt_view_type,
        zoom_scale_page_layout_view,
        zoom_scale_sheet_layout_view,
        workbook_view_id,
        scroll_row: scroll.top_row,
        scroll_col: scroll.left_col,
        has_explicit_top_left_cell,
        tab_selected,
        active_cell,
        sqref,
        pane: pane_config,
        selections,
        pivot_selection: Vec::new(),
        ext_lst_xml: sheet_view_ext_lst_xml,
    };

    // --- Dimensions (custom row heights, col widths) ---
    let stored_max_col = dims_mod::get_max_materialized_col(
        stores.storage.doc(),
        stores.storage.sheets(),
        sheet_id,
        stores.grid_indexes.get(sheet_id),
    );
    let sheet_dimensions = export_dimensions_for_sheet(stores, mirror, sheet_id, stored_max_col);

    // --- Comments ---
    let raw_comments = get_all_comments(stores, sheet_id);
    let comments_out: Vec<Comment> = raw_comments
        .into_iter()
        .filter_map(|mut cc| {
            let a1_ref = if let Some(pos) =
                resolve_hydrated_comment_position(stores, sheet_id, &cc.cell_ref)
                    .or_else(|| resolve_cell_position(mirror, sheet_id, &cc.cell_ref))
            {
                pos_to_a1(pos.0, pos.1)
            } else {
                tracing::warn!(
                    sheet_id = %sheet_id.to_uuid_string(),
                    comment_id = %cc.id,
                    stored_ref = %cc.cell_ref,
                    "skipping comment with unresolved hydrated CellId"
                );
                return None;
            };
            let has_thread = cc.comment_type == CommentType::ThreadedComment;
            let content_text = if has_thread {
                cc.content.clone().unwrap_or_else(|| {
                    cc.runs
                        .iter()
                        .map(|r| r.text.as_str())
                        .collect::<Vec<_>>()
                        .join("")
                })
            } else {
                cc.runs
                    .iter()
                    .map(|r| r.text.as_str())
                    .collect::<Vec<_>>()
                    .join("")
            };
            cc.cell_ref = a1_ref;
            cc.content = Some(content_text);
            Some(cc)
        })
        .collect();

    // --- Hyperlinks ---
    let hyperlinks_out = export_hyperlinks_for_sheet(stores, sheet_id);

    // --- Conditional formats ---
    let conditional_formats: Vec<DomainConditionalFormat> =
        export_conditional_formats_for_sheet(stores, sheet_id);

    // --- Data validations ---
    let data_validations = export_data_validations_for_sheet(stores, sheet_id);
    let x14_data_validations = export_x14_data_validations_for_sheet(stores, sheet_id);

    // --- Print settings ---
    let ps = print::get_print_settings(stores.storage.doc(), stores.storage.sheets(), sheet_id);
    let print_settings = if ps == PrintSettings::default() {
        None
    } else {
        Some(ps)
    };

    // --- Header/footer images ---
    let hf_images = print::get_hf_images(stores.storage.doc(), stores.storage.sheets(), sheet_id);

    // --- Protection ---
    let protection = export_sheet_protection(stores, sheet_id);

    // --- Sheet metadata (rows/cols count) ---
    let data_bounds = queries::get_data_bounds(stores, mirror, sheet_id);
    let max_row = data_bounds.as_ref().map(|b| b.max_row + 1).unwrap_or(0);
    let data_max_col = data_bounds.as_ref().map(|b| b.max_col + 1).unwrap_or(0);
    let max_col = stored_max_col
        .map(|c| data_max_col.max(c + 1))
        .unwrap_or(data_max_col);
    let _sheet_max_col = max_col;
    let (stored_rows, stored_cols, legacy_comment_authors, comment_package, drawing_package) = {
        let txn = stores.storage.doc().transact();
        if let Some(meta) = get_meta_for_export(&txn, stores.storage.sheets(), sheet_id) {
            let rows = match meta.get(&txn, KEY_ROWS) {
                Some(Out::Any(Any::Number(n))) => Some(n.max(0.0) as u32),
                _ => None,
            };
            let cols = match meta.get(&txn, KEY_COLS) {
                Some(Out::Any(Any::Number(n))) => Some(n.max(0.0) as u32),
                _ => None,
            };
            let legacy_comment_authors = match meta.get(&txn, "legacyCommentAuthors") {
                Some(Out::Any(Any::String(s))) => serde_json::from_str(&s).unwrap_or_default(),
                _ => Vec::new(),
            };
            let comment_package = match meta.get(&txn, "commentPackage") {
                Some(Out::Any(Any::String(s))) => serde_json::from_str(&s).ok(),
                _ => None,
            };
            let drawing_package = match meta.get(&txn, "drawingPackage") {
                Some(Out::Any(Any::String(s))) => serde_json::from_str(&s).ok(),
                _ => None,
            };
            (
                rows,
                cols,
                legacy_comment_authors,
                comment_package,
                drawing_package,
            )
        } else {
            (None, None, Vec::new(), None, None)
        }
    };
    let rows = stored_rows.unwrap_or(100).max(max_row);
    let cols = stored_cols.unwrap_or(26).max(data_max_col);

    let dims_max_row = sheet_dimensions
        .row_heights
        .last()
        .map(|rh| rh.row + 1)
        .unwrap_or(0);
    let max_materialized_row_for_styles = stores
        .grid_indexes
        .get(sheet_id)
        .map(|gi| gi.row_count())
        .unwrap_or(0);
    let style_max_row = max_row
        .max(dims_max_row)
        .max(max_materialized_row_for_styles);

    // --- Row/Col styles ---
    let (row_styles, col_styles) =
        export_row_col_styles_for_sheet(stores, sheet_id, style_max_row, max_col, palette);

    // --- Sparklines ---
    let sparklines = export_sparklines_for_sheet(stores, sheet_id);
    let sparkline_groups = export_sparkline_groups_for_sheet(stores, sheet_id);

    // --- Page breaks ---
    let page_breaks = export_page_breaks_for_sheet(stores, sheet_id);

    // --- Auto filter ---
    let pos_resolver =
        |cell_id: &str| -> Option<(u32, u32)> { resolve_cell_position(mirror, sheet_id, cell_id) };
    let auto_filter = export_auto_filter_for_sheet(stores, sheet_id, &pos_resolver);
    let sort_state = export_sort_state_for_sheet(stores, sheet_id);

    // --- Outline groups ---
    let (outline_groups, outline_properties) = export_outline_groups_for_sheet(stores, sheet_id);

    // --- Tables ---
    let tables: Vec<TableSpec> = export_tables_for_sheet(stores, mirror, sheet_id);

    // --- Floating objects (unified), slicers ---
    let (all_fobjs, slicers, slicer_anchors, timelines, timeline_anchors) =
        export_floating_objects_for_sheet(stores, sheet_id);

    let mut charts: Vec<ChartSpec> = Vec::new();
    let mut floating_objects: Vec<FloatingObject> = Vec::new();
    for fobj in all_fobjs {
        if matches!(&fobj.data, FloatingObjectData::Chart(_)) {
            if let Some(spec) = ChartSpec::from_floating_object(&fobj) {
                charts.push(spec);
            }
        } else {
            floating_objects.push(fobj);
        }
    }
    charts.sort_by_key(|c| c.z_index);

    // --- Sheet metadata from Yrs meta map ---
    let (
        original_sheet_id,
        visibility,
        sheet_uid,
        mut sheet_properties,
        worksheet_semantic_containers,
        worksheet_root_namespaces,
        worksheet_ext_lst_xml,
        worksheet_dimension_ref,
        sheet_calc_pr,
        sheet_views_ext_lst_xml,
    ) = {
        let txn = stores.storage.doc().transact();
        let meta = get_meta_for_export(&txn, stores.storage.sheets(), sheet_id);
        match meta {
            Some(m) => {
                let osi = m.get(&txn, "originalSheetId").and_then(|v| match v {
                    Out::Any(Any::Number(n)) => Some(n as u32),
                    _ => None,
                });
                let is_hidden = m
                    .get(&txn, "hidden")
                    .and_then(|v| match v {
                        Out::Any(Any::Bool(b)) => Some(b),
                        _ => None,
                    })
                    .unwrap_or(false);
                let is_very_hidden = m
                    .get(&txn, "veryHidden")
                    .and_then(|v| match v {
                        Out::Any(Any::Bool(b)) => Some(b),
                        _ => None,
                    })
                    .unwrap_or(false);
                let vis = if is_very_hidden {
                    domain_types::SheetState::VeryHidden
                } else if is_hidden {
                    domain_types::SheetState::Hidden
                } else {
                    domain_types::SheetState::Visible
                };
                let uid = m.get(&txn, "sheetUid").and_then(|v| match v {
                    Out::Any(Any::String(s)) => Some(s.to_string()),
                    _ => None,
                });
                let mut sheet_properties = m
                    .get(
                        &txn,
                        domain_types::yrs_schema::sheet_properties::PROPERTY_KEY,
                    )
                    .and_then(|v| match v {
                        Out::YMap(map) => {
                            domain_types::yrs_schema::sheet_properties::from_yrs_map(&map, &txn)
                        }
                        _ => None,
                    });
                let tab_color = m.get(&txn, "tabColor").and_then(|v| match v {
                    Out::Any(Any::String(s)) => Some(s.to_string()),
                    _ => None,
                });
                if let Some(tab_color) = tab_color {
                    let properties = sheet_properties.get_or_insert_with(Default::default);
                    if properties.tab_color.is_none() {
                        properties.tab_color = Some(tab_color_to_ooxml_color(&tab_color));
                    }
                }
                let worksheet_semantic_containers = m
                    .get(&txn, "worksheetSemanticContainers")
                    .and_then(|v| match v {
                        Out::Any(Any::String(s)) => {
                            serde_json::from_str::<domain_types::WorksheetSemanticContainers>(&s)
                                .ok()
                        }
                        _ => None,
                    })
                    .unwrap_or_default();
                let worksheet_root_namespaces = m
                    .get(&txn, "worksheetRootNamespaces")
                    .and_then(|v| match v {
                        Out::Any(Any::String(s)) => {
                            serde_json::from_str::<domain_types::XmlNamespaceDeclarations>(&s).ok()
                        }
                        _ => None,
                    })
                    .unwrap_or_default();
                let worksheet_ext_lst_xml =
                    m.get(&txn, "worksheetExtLstXml").and_then(|v| match v {
                        Out::Any(Any::String(s)) => Some(s.to_string()),
                        _ => None,
                    });
                let worksheet_dimension_ref =
                    m.get(&txn, "worksheetDimensionRef").and_then(|v| match v {
                        Out::Any(Any::String(s)) => Some(s.to_string()),
                        _ => None,
                    });
                let sheet_calc_pr = m.get(&txn, "sheetCalcPr").and_then(|v| match v {
                    Out::Any(Any::String(s)) => {
                        serde_json::from_str::<ooxml_types::worksheet::SheetCalcPr>(&s).ok()
                    }
                    _ => None,
                });
                let sheet_views_ext_lst_xml =
                    m.get(&txn, "sheetViewsExtLstXml").and_then(|v| match v {
                        Out::Any(Any::String(s)) => Some(s.to_string()),
                        _ => None,
                    });
                (
                    osi,
                    vis,
                    uid,
                    sheet_properties,
                    worksheet_semantic_containers,
                    worksheet_root_namespaces,
                    worksheet_ext_lst_xml,
                    worksheet_dimension_ref,
                    sheet_calc_pr,
                    sheet_views_ext_lst_xml,
                )
            }
            None => (
                None,
                domain_types::SheetState::Visible,
                None,
                None,
                Default::default(),
                Default::default(),
                None,
                None,
                None,
                None,
            ),
        }
    };
    if let Some(outline) = outline_properties.clone() {
        sheet_properties
            .get_or_insert_with(Default::default)
            .outline_pr = Some(outline);
    }

    let mut sheet_properties = sheet_properties;
    if let Some(print_settings) = &print_settings
        && let Some(page_setup_properties) = &print_settings.page_setup_properties
    {
        let properties = sheet_properties.get_or_insert_with(Default::default);
        properties.page_set_up_pr = Some(ooxml_types::worksheet::PageSetupProperties {
            auto_page_breaks: page_setup_properties.auto_page_breaks,
            fit_to_page: page_setup_properties.fit_to_page,
        });
    }

    let sheet = SheetData {
        name,
        rows,
        cols,
        worksheet_root_namespaces,
        worksheet_ext_lst_xml,
        worksheet_dimension_ref,
        sheet_id: original_sheet_id,
        visibility,
        uid: sheet_uid,
        cells,
        authored_style_runs,
        dimensions: sheet_dimensions,
        merges: merge_regions,
        frozen_pane,
        view,
        sheet_views_ext_lst_xml,
        comments: comments_out,
        legacy_comment_authors,
        comment_package,
        drawing_package,
        conditional_formats,
        hyperlinks: hyperlinks_out,
        data_validations,
        data_validations_declared_count: export_dv_declared_count(stores, sheet_id),
        data_validations_disable_prompts: export_dv_disable_prompts(stores, sheet_id),
        data_validations_x_window: export_dv_window_attr(stores, sheet_id, "dvXWindow"),
        data_validations_y_window: export_dv_window_attr(stores, sheet_id, "dvYWindow"),
        x14_data_validations,
        x14_data_validations_declared_count: export_x14_dv_declared_count(stores, sheet_id),
        x14_data_validations_disable_prompts: export_x14_dv_disable_prompts(stores, sheet_id),
        x14_data_validations_x_window: export_dv_window_attr(stores, sheet_id, "x14DvXWindow"),
        x14_data_validations_y_window: export_dv_window_attr(stores, sheet_id, "x14DvYWindow"),
        print_settings,
        hf_images,
        protection,
        worksheet_semantic_containers,
        sheet_calc_pr,
        row_styles,
        col_styles,
        charts,
        sparklines,
        sparkline_groups,
        tables,
        slicers,
        slicer_anchors,
        timelines,
        timeline_anchors,
        floating_objects,
        page_breaks,
        auto_filter,
        sort_state,
        outline_groups,
        sheet_properties,
        outline_properties,
        extra_sheet_views,
    };
    profile.counter("cells", sheet.cells.len() as u64);
    profile.counter("ranges", sheet.authored_style_runs.len() as u64);
    profile.counter("merges", sheet.merges.len() as u64);
    Some(sheet)
}

fn export_data_table_regions(stores: &EngineStores, sheet_ids: &[SheetId]) -> Vec<DataTableRegion> {
    let mut regions: Vec<DataTableRegion> =
        crate::storage::workbook::data_tables::get_all_data_table_regions(
            stores.storage.doc(),
            stores.storage.workbook_map(),
        )
        .into_iter()
        .filter_map(|region| {
            let sheet_id = SheetId::from_uuid_str(&region.sheet).ok()?;
            let sheet_index = sheet_ids.iter().position(|sid| *sid == sheet_id)? as u32;
            Some(DataTableRegion {
                sheet_index,
                start_row: region.start_row,
                start_col: region.start_col,
                end_row: region.end_row,
                end_col: region.end_col,
                row_input_ref: region.row_input_ref,
                col_input_ref: region.col_input_ref,
                ooxml_flags: region
                    .ooxml_flags
                    .map(|flags| domain_types::DataTableOoxmlFlags {
                        r1: flags.r1,
                        r2: flags.r2,
                        aca: flags.aca,
                        ca: flags.ca,
                        bx: flags.bx,
                        dt2d: flags.dt2d,
                        dtr: flags.dtr,
                        del1: flags.del1,
                        del2: flags.del2,
                    }),
            })
        })
        .collect();
    regions.sort_by_key(|region| {
        (
            region.sheet_index,
            region.start_row,
            region.start_col,
            region.end_row,
            region.end_col,
        )
    });
    regions
}

fn tab_color_to_ooxml_color(color: &str) -> ooxml_types::styles::ColorDef {
    let hex = color.strip_prefix('#').unwrap_or(color);
    let argb = if hex.len() == 6 {
        format!("FF{hex}")
    } else {
        hex.to_string()
    };
    ooxml_types::styles::ColorDef::Rgb {
        val: argb,
        tint: None,
    }
}

// -------------------------------------------------------------------
// Full ParseOutput build (main orchestrator)
// -------------------------------------------------------------------

/// Build a complete `ParseOutput` from the current Yrs storage state.
/// This produces the same type that the XLSX parser emits, enabling
/// the unified XLSX writer to consume it.
///
/// On native targets (with rayon), sheets are exported in parallel using a
/// shared thread-safe style palette. On WASM, sheets are processed sequentially.
pub(in crate::storage::engine) fn build_parse_output_from_yrs(
    stores: &EngineStores,
    mirror: &CellMirror,
) -> ParseOutput {
    let sheet_ids = stores.storage.sheet_order();

    // --- Parallel per-sheet export (native) or sequential (WASM) ---
    #[cfg(feature = "native")]
    let (output_sheets, style_palette) = {
        use rayon::prelude::*;
        let palette = SharedPalette::from_vec(export_workbook_style_palette(stores));
        let sheets: Vec<SheetData> = sheet_ids
            .par_iter()
            .enumerate()
            .filter_map(|(sheet_idx, sheet_id)| {
                export_single_sheet(stores, mirror, sheet_id, sheet_idx, &palette)
            })
            .collect();
        (sheets, palette.into_vec())
    };

    #[cfg(not(feature = "native"))]
    let (output_sheets, style_palette) = {
        let mut seeded_palette = export_workbook_style_palette(stores);
        let palette = LocalPalette::from_vec(&mut seeded_palette);
        let sheets: Vec<SheetData> = sheet_ids
            .iter()
            .enumerate()
            .filter_map(|(sheet_idx, sheet_id)| {
                export_single_sheet(stores, mirror, sheet_id, sheet_idx, &palette)
            })
            .collect();
        (sheets, palette.into_vec())
    };

    // --- Named ranges ---
    let named_ranges = export_workbook_named_ranges(stores, mirror, &sheet_ids);

    // --- Workbook-level ---
    let theme = export_workbook_theme(stores);
    let wb_protection = export_workbook_protection(stores);
    let slicer_caches = export_workbook_slicer_caches(stores);
    let timeline_caches = workbook::export_workbook_timeline_caches(stores);
    let (custom_table_styles, default_table_style, default_pivot_style) =
        export_workbook_table_styles(stores);
    let data_table_regions = export_data_table_regions(stores, &sheet_ids);
    let connections = workbook::export_workbook_connections(stores);

    let persons = export_workbook_threaded_comment_persons(stores);
    let has_persons_part = !persons.is_empty()
        || workbook::export_workbook_threaded_comment_persons_part_present(stores);

    let output = ParseOutput {
        sheets: output_sheets,
        workbook_sheet_inventory: Vec::new(),
        workbook_root_namespaces: workbook::export_workbook_root_namespaces(stores),
        workbook_conformance: None,
        style_palette,
        workbook_stylesheet: export_workbook_stylesheet(stores),
        package_fidelity: workbook::export_package_fidelity_metadata(stores),
        shared_string_hints: export_shared_string_hints(stores),
        named_ranges,
        pivot_tables: export_workbook_parsed_pivot_tables(stores),
        pivot_cache_sources: workbook::export_pivot_cache_sources(stores),
        pivot_cache_records: workbook::export_pivot_cache_records(stores),
        data_table_regions,
        slicer_caches,
        timeline_caches,
        custom_table_styles,
        default_table_style,
        default_pivot_style,
        theme,
        properties: export_document_properties(stores),
        extended_properties: workbook::export_extended_document_properties(stores),
        protection: wb_protection,
        calculation: export_calculation_properties(stores),
        calc_id_provenance: Default::default(),
        metadata: workbook::export_xlsx_metadata(stores),
        workbook_views: export_workbook_views(stores),
        custom_workbook_views_xml: export_custom_workbook_views_xml(stores),
        workbook_properties: export_workbook_properties(stores),
        file_version: export_file_version(stores),
        file_sharing: export_file_sharing(stores),
        web_publishing: workbook::export_workbook_web_publishing(stores),
        external_links: export_external_links(stores),
        connections,
        persons,
        has_persons_part,
        volatile_dependency_part: workbook::export_volatile_dependency_part(stores),
    };
    let _data_features = output.workbook_data_features();
    output
}

/// Helper: resolve a cell_id hex string to (row, col) via the compute mirror.
fn resolve_cell_position(
    mirror: &CellMirror,
    sheet_id: &SheetId,
    cell_id_hex: &str,
) -> Option<(u32, u32)> {
    let result = queries::get_cell_position(mirror, sheet_id, cell_id_hex)?;
    Some((result.row, result.col))
}
