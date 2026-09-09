mod cells;
mod chart_sources;
mod comment_package_metadata;
mod dimensions;
mod dynamic_metadata;
mod named_ranges;
#[cfg(feature = "native")]
mod native_parallel;
mod palette;
mod pivot_cache_reconciliation;
mod print_defined_names;
mod sheet_metadata;
mod slicers;
mod table_filter_preservation;
mod table_totals;
mod workbook;
mod workbook_views;
pub(in crate::storage::engine) use cells::{
    export_authored_style_runs_for_sheet, export_cells_for_sheet,
    export_col_style_ranges_for_sheet, export_row_col_styles_for_sheet,
};
pub(in crate::storage::engine) use comment_package_metadata::export_comment_package_metadata;
pub(in crate::storage::engine) use dimensions::{
    ExportedTableProjectionInput, TableExportProjection, export_dimensions_for_sheet,
    export_tables_for_sheet, finalize_table_export_projection, table_catalog_for_snapshot,
};
pub(crate) use palette::{LocalPalette, PaletteOps};
pub(in crate::storage::engine) use sheet_metadata::{
    export_auto_filter_for_sheet, export_conditional_formats_for_sheet,
    export_data_validations_for_sheet, export_dv_declared_count, export_dv_disable_prompts,
    export_dv_x_window, export_dv_y_window, export_floating_objects_for_sheet,
    export_hyperlinks_for_sheet, export_outline_groups_for_sheet, export_page_breaks_for_sheet,
    export_sheet_protection, export_sort_state_for_sheet, export_sparkline_groups_for_sheet,
    export_sparklines_for_sheet,
};
pub(in crate::storage::engine) use slicers::export_workbook_slicer_caches;
pub(in crate::storage::engine) use workbook::{
    export_workbook_parsed_pivot_tables, export_workbook_protection, export_workbook_theme,
    export_workbook_threaded_comment_persons,
};

use super::super::export::pos_to_a1;
use super::objects::get_all_comments;
use super::queries;
use crate::mirror::CellMirror;
use crate::storage::engine::stores::EngineStores;
use crate::storage::sheet::{dimensions as dims_mod, merges, print};
use cell_types::SheetId;
use domain_types::{
    DataTableRegion, FrozenPane, MergeRegion, ParseOutput, SheetData,
    domain::comment::{Comment, CommentType},
    domain::conditional_format::ConditionalFormat as DomainConditionalFormat,
    domain::table::TableSpec,
};
use value_types::ComputeError;

use named_ranges::export_workbook_named_ranges;
#[cfg(feature = "native")]
use palette::SharedPalette;
use sheet_metadata::resolve_hydrated_comment_position;
use workbook::{
    export_calculation_properties, export_custom_workbook_views_xml, export_document_properties,
    export_external_links, export_file_sharing, export_file_version, export_shared_string_hints,
    export_workbook_properties, export_workbook_style_palette, export_workbook_stylesheet,
    export_workbook_table_styles,
};
use workbook_views::export_workbook_views_for_sheets;

struct ExportedSheetData {
    sheet: SheetData,
    table_projection_inputs: Vec<ExportedTableProjectionInput>,
}

fn export_single_sheet(
    stores: &EngineStores,
    mirror: &CellMirror,
    sheet_id: &SheetId,
    sheet_idx: usize,
    palette: &impl PaletteOps,
) -> Option<ExportedSheetData> {
    let mut profile = crate::xlsx_profile::PhaseTimer::new("export", "export_single_sheet");
    profile.counter("sheet_index", sheet_idx as u64);

    let name = queries::get_sheet_name(stores, sheet_id)?;

    let cells = export_cells_for_sheet(stores, mirror, sheet_id, palette);
    let authored_style_runs =
        export_authored_style_runs_for_sheet(stores, mirror, sheet_id, palette);

    let merges_raw = match stores.grid_indexes.get(sheet_id) {
        Some(grid) => merges::get_all_merges(&stores.storage, *sheet_id, grid),
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

    let metadata = stores.storage.sheet_metadata.get(sheet_id)?;
    let view = metadata.view.to_domain();
    let frozen_pane = view
        .pane
        .as_ref()
        .filter(|pane| pane.state.is_frozen())
        .map(|pane| FrozenPane {
            rows: pane.y_split as u32,
            cols: pane.x_split as u32,
            top_left_cell: pane.top_left_cell.clone(),
        });
    let extra_sheet_views = metadata.extra_views.clone();

    let stored_max_col = dims_mod::get_max_materialized_col(stores.grid_indexes.get(sheet_id));
    let sheet_dimensions = export_dimensions_for_sheet(stores, mirror, sheet_id, stored_max_col);

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

    let hyperlinks_out = export_hyperlinks_for_sheet(stores, sheet_id);

    let conditional_formats: Vec<DomainConditionalFormat> =
        export_conditional_formats_for_sheet(stores, sheet_id);

    let data_validations = export_data_validations_for_sheet(stores, sheet_id);
    let x14_data_validations = Vec::new();

    let print_settings = metadata.print_settings.clone();

    let hf_images = print::get_hf_images(&stores.storage, sheet_id);

    let protection = export_sheet_protection(stores, sheet_id);

    let data_bounds = queries::get_data_bounds(stores, mirror, sheet_id);
    let max_row = data_bounds.as_ref().map(|b| b.max_row + 1).unwrap_or(0);
    let data_max_col = data_bounds.as_ref().map(|b| b.max_col + 1).unwrap_or(0);
    let max_col = stored_max_col
        .map(|c| data_max_col.max(c + 1))
        .unwrap_or(data_max_col);
    let _sheet_max_col = max_col;
    let (stored_rows, stored_cols) = mirror
        .get_sheet(sheet_id)
        .map(|sheet| (Some(sheet.grid_rows), Some(sheet.grid_cols)))
        .unwrap_or((None, None));
    let (legacy_comment_authors, comment_package, drawing_package) =
        export_comment_package_metadata(stores, sheet_id);
    let dims_max_row = sheet_dimensions
        .row_heights
        .last()
        .map(|rh| rh.row + 1)
        .unwrap_or(0);
    let dims_max_col = sheet_dimensions
        .col_widths
        .last()
        .map(|cw| cw.col + 1)
        .unwrap_or(0);
    let rows = stored_rows.unwrap_or(100).max(max_row).max(dims_max_row);
    let cols = stored_cols
        .unwrap_or(26)
        .max(data_max_col)
        .max(dims_max_col);

    let max_materialized_row_for_styles = stores
        .grid_indexes
        .get(sheet_id)
        .map(|gi| gi.row_count())
        .unwrap_or(0);
    let style_max_row = max_row
        .max(dims_max_row)
        .max(max_materialized_row_for_styles);

    let (row_styles, col_styles) =
        export_row_col_styles_for_sheet(stores, sheet_id, style_max_row, max_col, palette);
    let col_style_ranges = export_col_style_ranges_for_sheet(mirror, sheet_id, palette);

    let sparklines = export_sparklines_for_sheet(stores, sheet_id);
    let sparkline_groups = export_sparkline_groups_for_sheet(stores, sheet_id);

    let page_breaks = export_page_breaks_for_sheet(stores, sheet_id);

    let pos_resolver =
        |cell_id: &str| -> Option<(u32, u32)> { resolve_cell_position(mirror, sheet_id, cell_id) };
    let auto_filter = export_auto_filter_for_sheet(stores, sheet_id, &pos_resolver);
    let sort_state = export_sort_state_for_sheet(stores, sheet_id);

    let (outline_groups, outline_properties) = export_outline_groups_for_sheet(stores, sheet_id);

    let exported_tables = export_tables_for_sheet(stores, mirror, sheet_id);
    let table_projection_inputs = exported_tables
        .iter()
        .map(|table| table.projection_input.clone())
        .collect();
    let tables: Vec<TableSpec> = exported_tables
        .into_iter()
        .map(|table| table.spec)
        .collect();

    let (all_fobjs, slicers, slicer_anchors, timelines, timeline_anchors) =
        export_floating_objects_for_sheet(stores, mirror, sheet_id);

    let (charts, floating_objects) = chart_sources::split_charts_for_sheet_export(all_fobjs);

    let original_sheet_id = metadata.original_sheet_id;
    let visibility = metadata.visibility.clone();
    let sheet_uid = metadata.uid.clone();
    let mut sheet_properties = metadata.properties.clone();
    let worksheet_semantic_containers = metadata.semantic_containers.clone();
    let worksheet_root_namespaces = metadata.root_namespaces.clone();
    let worksheet_ext_lst_xml = metadata.ext_lst_xml.clone();
    let worksheet_dimension_ref = metadata.dimension_ref.clone();
    let sheet_calc_pr = metadata.calc_properties.clone();
    let sheet_views_ext_lst_xml = metadata.views_ext_lst_xml.clone();
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
        data_validations_x_window: export_dv_x_window(stores, sheet_id),
        data_validations_y_window: export_dv_y_window(stores, sheet_id),
        x14_data_validations,
        x14_data_validations_declared_count: None,
        x14_data_validations_disable_prompts: false,
        x14_data_validations_x_window: None,
        x14_data_validations_y_window: None,
        print_settings,
        hf_images,
        protection,
        worksheet_semantic_containers,
        sheet_calc_pr,
        row_styles,
        col_styles,
        col_style_ranges,
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
    Some(ExportedSheetData {
        sheet,
        table_projection_inputs,
    })
}

fn export_data_table_regions(mirror: &CellMirror, sheet_ids: &[SheetId]) -> Vec<DataTableRegion> {
    let mut regions: Vec<DataTableRegion> = mirror
        .all_data_table_regions()
        .iter()
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
                ooxml_flags: region.ooxml_flags.as_ref().map(|flags| {
                    domain_types::DataTableOoxmlFlags {
                        r1: flags.r1.clone(),
                        r2: flags.r2.clone(),
                        aca: flags.aca,
                        ca: flags.ca,
                        bx: flags.bx,
                        dt2d: flags.dt2d,
                        dtr: flags.dtr,
                        del1: flags.del1,
                        del2: flags.del2,
                    }
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

/// Build a complete `ParseOutput` from the current native storage state.
/// This produces the same type that the XLSX parser emits, enabling
/// the unified XLSX writer to consume it.
///
/// On native targets (with rayon), sheets are exported in parallel using a
/// shared thread-safe style palette. On WASM, sheets are processed sequentially.
pub(in crate::storage::engine) fn build_parse_output(
    stores: &EngineStores,
    mirror: &CellMirror,
) -> Result<ParseOutput, ComputeError> {
    let sheet_ids = stores.storage.sheet_order();
    let mut workbook_stylesheet = export_workbook_stylesheet(stores);
    let mut seeded_style_palette = export_workbook_style_palette(stores);
    let imported_style_prefix_len =
        palette::rebind_imported_xf_prefix(&mut seeded_style_palette, workbook_stylesheet.as_ref());

    #[cfg(feature = "native")]
    let (mut output_sheets, table_projection_inputs, style_palette) = {
        use rayon::prelude::*;
        let palette = SharedPalette::from_vec_with_imported_prefix(
            seeded_style_palette,
            imported_style_prefix_len,
        );
        let exported_sheets: Vec<ExportedSheetData> = native_parallel::install(|| {
            sheet_ids
                .par_iter()
                .enumerate()
                .filter_map(|(sheet_idx, sheet_id)| {
                    export_single_sheet(stores, mirror, sheet_id, sheet_idx, &palette)
                })
                .collect()
        })?;
        let table_projection_inputs: Vec<Vec<ExportedTableProjectionInput>> = exported_sheets
            .iter()
            .map(|sheet| sheet.table_projection_inputs.clone())
            .collect();
        let sheets: Vec<SheetData> = exported_sheets
            .into_iter()
            .map(|sheet| sheet.sheet)
            .collect();
        (sheets, table_projection_inputs, palette.into_vec())
    };

    #[cfg(not(feature = "native"))]
    let (mut output_sheets, table_projection_inputs, style_palette) = {
        let palette = LocalPalette::from_vec_with_imported_prefix(
            &mut seeded_style_palette,
            imported_style_prefix_len,
        );
        let exported_sheets: Vec<ExportedSheetData> = sheet_ids
            .iter()
            .enumerate()
            .filter_map(|(sheet_idx, sheet_id)| {
                export_single_sheet(stores, mirror, sheet_id, sheet_idx, &palette)
            })
            .collect();
        let table_projection_inputs: Vec<Vec<ExportedTableProjectionInput>> = exported_sheets
            .iter()
            .map(|sheet| sheet.table_projection_inputs.clone())
            .collect();
        let sheets: Vec<SheetData> = exported_sheets
            .into_iter()
            .map(|sheet| sheet.sheet)
            .collect();
        (sheets, table_projection_inputs, palette.into_vec())
    };

    let table_projection: TableExportProjection =
        finalize_table_export_projection(&mut output_sheets, &table_projection_inputs);

    let (workbook_sheet_inventory, parsed_workbook_sheet_indices, imported_order_to_export_order) =
        crate::storage::workbook::sheet_inventory::export(
            &stores.storage.metadata,
            &sheet_ids,
            &mut output_sheets,
        );
    let named_ranges = export_workbook_named_ranges(
        stores,
        mirror,
        &sheet_ids,
        &workbook_sheet_inventory,
        &imported_order_to_export_order,
    );

    let theme = export_workbook_theme(stores);
    let wb_protection = export_workbook_protection(stores);
    let slicer_caches = export_workbook_slicer_caches(stores, Some(&table_projection));
    let timeline_caches = workbook::export_workbook_timeline_caches(stores);
    let (custom_table_styles, default_table_style, default_pivot_style, generated_table_style_dxfs) =
        export_workbook_table_styles(stores);
    if !generated_table_style_dxfs.is_empty() {
        let stylesheet = workbook_stylesheet.get_or_insert_with(Default::default);
        stylesheet.dxf_registry.extend(generated_table_style_dxfs);
    }
    let data_table_regions = export_data_table_regions(mirror, &sheet_ids);
    let connections = workbook::export_workbook_connections(stores);
    let workbook_views = export_workbook_views_for_sheets(
        stores,
        &sheet_ids,
        &mut output_sheets,
        &workbook_sheet_inventory,
        &imported_order_to_export_order,
    );

    let persons = export_workbook_threaded_comment_persons(stores);
    let has_persons_part = !persons.is_empty()
        || workbook::export_workbook_threaded_comment_persons_part_present(stores);
    let pivot_tables =
        export_workbook_parsed_pivot_tables(stores, mirror, default_pivot_style.as_deref());

    let mut output = ParseOutput {
        sheets: output_sheets,
        workbook_sheet_inventory,
        parsed_workbook_sheet_indices,
        workbook_root_namespaces: workbook::export_workbook_root_namespaces(stores),
        workbook_conformance: None,
        style_palette,
        workbook_stylesheet,
        package_fidelity: workbook::export_package_fidelity_metadata(stores),
        shared_string_hints: export_shared_string_hints(stores),
        named_ranges,
        pivot_tables: pivot_tables.clone(),
        pivot_cache_sources: pivot_cache_reconciliation::export_pivot_cache_sources(
            stores,
            &pivot_tables,
        ),
        pivot_cache_records: pivot_cache_reconciliation::export_pivot_cache_records(
            stores,
            &pivot_tables,
        ),
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
        workbook_views,
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
    slicers::reconcile_pivot_bindings(&mut output);
    dynamic_metadata::reconcile(&mut output);
    let _data_features = output.workbook_data_features();
    Ok(output)
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
