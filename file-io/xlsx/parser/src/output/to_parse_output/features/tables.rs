use super::*;

// =============================================================================
// Domain conversions: Tables
// =============================================================================

/// Convert parser `ParsedTable` items (per-sheet) into domain `TableSpec` items.
pub(crate) fn convert_tables(tables: &[ParsedTable]) -> Vec<TableSpec> {
    tables
        .iter()
        .map(|t| TableSpec {
            id: t.id,
            name: t.name.clone(),
            display_name: t.display_name.clone(),
            range_ref: t.ref_range.clone(),
            has_headers: t.has_headers,
            has_totals: t.has_totals,
            style_name: t.style_name.clone(),
            row_stripes: t.show_row_stripes,
            col_stripes: t.show_column_stripes,
            first_col_highlight: t.show_first_column,
            last_col_highlight: t.show_last_column,
            auto_filter_ref: t.auto_filter_ref.clone(),
            auto_filter_xr_uid: t.auto_filter_xr_uid.clone(),
            auto_filter_ext_lst_raw: t.auto_filter_ext_lst_raw.clone(),
            columns: t
                .columns
                .iter()
                .map(|c| TableColumnSpec {
                    id: c.id,
                    name: c.name.clone(),
                    totals_label: c.totals_row_label.clone(),
                    totals_function: c
                        .totals_row_function
                        .as_deref()
                        .and_then(TotalsFunction::from_ooxml_str),
                    calculated_formula: c.calculated_column_formula.clone(),
                    calculated_formula_array: c.calculated_column_formula_array,
                    totals_row_formula: c.totals_row_formula.clone(),
                    totals_row_formula_array: c.totals_row_formula_array,
                    header_row_dxf_id: c.header_row_dxf_id,
                    data_dxf_id: c.data_dxf_id,
                    totals_row_dxf_id: c.totals_row_dxf_id,
                    header_row_cell_style: c.header_row_cell_style.clone(),
                    data_cell_style: c.data_cell_style.clone(),
                    totals_row_cell_style: c.totals_row_cell_style.clone(),
                    unique_name: c.unique_name.clone(),
                    query_table_field_id: c.query_table_field_id,
                    xml_column_pr: c.xml_column_pr.clone(),
                    xr3_uid: c.xr3_uid.clone(),
                })
                .collect(),
            header_row_dxf_id: t.header_row_dxf_id,
            data_dxf_id: t.data_dxf_id,
            totals_row_dxf_id: t.totals_row_dxf_id,
            header_row_border_dxf_id: t.header_row_border_dxf_id,
            table_border_dxf_id: t.table_border_dxf_id,
            totals_row_border_dxf_id: t.totals_row_border_dxf_id,
            header_row_cell_style: t.header_row_cell_style.clone(),
            data_cell_style: t.data_cell_style.clone(),
            totals_row_cell_style: t.totals_row_cell_style.clone(),
            table_type: t.table_type.clone(),
            totals_row_shown: t.totals_row_shown,
            connection_id: t.connection_id,
            comment: t.comment.clone(),
            insert_row: t.insert_row,
            insert_row_shift: t.insert_row_shift,
            published: t.published,
            xr_uid: t.xr_uid.clone(),
            filter_columns: t.filter_columns.clone(),
            query_table: t.query_table.clone(),
            worksheet_relationship_id_hint: t.worksheet_relationship_id_hint.clone(),
            table_part_path_hint: t.table_part_path_hint.clone(),
            worksheet_relationship_target_hint: t.worksheet_relationship_target_hint.clone(),
            sort_state: t.sort_state.as_ref().map(|ss| {
                domain_types::domain::table::TableSortState {
                    ref_range: ss.ref_range.clone(),
                    column_sort: ss.column_sort,
                    case_sensitive: ss.case_sensitive,
                    sort_method: ss.sort_method,
                    conditions: ss
                        .conditions
                        .iter()
                        .map(|sc| domain_types::domain::table::TableSortCondition {
                            ref_range: sc.ref_range.clone(),
                            descending: sc.descending,
                            sort_by: sc.sort_by,
                            custom_list: sc.custom_list.clone(),
                            dxf_id: sc.dxf_id,
                            icon_set: sc.icon_set,
                            icon_id: sc.icon_id,
                        })
                        .collect(),
                    ext_lst_raw: ss.ext_lst_raw.clone(),
                }
            }),
        })
        .collect()
}
