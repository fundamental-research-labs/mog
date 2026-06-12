use super::{TableCatalogColumn, TableCatalogEntry, TableColumnSpec, TableSpec};

/// Convert a TableSpec (OOXML adapter DTO) to the canonical catalog entry using
/// caller-allocated stable Mog IDs.
pub fn xlsx_table_spec_to_catalog_entry_with_ids<I>(
    spec: &TableSpec,
    sheet_id: &str,
    table_id: String,
    column_ids: I,
) -> TableCatalogEntry
where
    I: IntoIterator<Item = String>,
{
    let (start_row, start_col, end_row, end_col) =
        parse_table_range_ref(&spec.range_ref).unwrap_or((0, 0, 0, 0));
    let mut column_ids = column_ids.into_iter();

    TableCatalogEntry {
        id: table_id,
        ooxml_table_id: Some(spec.id),
        name: spec.name.clone(),
        display_name: spec.display_name.clone(),
        sheet_id: sheet_id.to_string(),
        range: cell_types::SheetRange::new(start_row, start_col, end_row, end_col),
        columns: spec
            .columns
            .iter()
            .enumerate()
            .map(|(i, col)| TableCatalogColumn {
                id: column_ids
                    .next()
                    .expect("caller must provide stable Mog column ids for every table column"),
                ooxml_column_id: Some(col.id),
                name: col.name.clone(),
                index: i as u32,
                totals_function: col.totals_function,
                totals_label: col.totals_label.clone(),
                calculated_formula: col.calculated_formula.clone(),
                calculated_formula_array: col.calculated_formula_array,
                totals_row_formula: col.totals_row_formula.clone(),
                totals_row_formula_array: col.totals_row_formula_array,
                header_row_dxf_id: col.header_row_dxf_id,
                data_dxf_id: col.data_dxf_id,
                totals_row_dxf_id: col.totals_row_dxf_id,
                header_row_cell_style: col.header_row_cell_style.clone(),
                data_cell_style: col.data_cell_style.clone(),
                totals_row_cell_style: col.totals_row_cell_style.clone(),
                unique_name: col.unique_name.clone(),
                query_table_field_id: col.query_table_field_id,
                xml_column_pr: col.xml_column_pr.clone(),
                xr3_uid: col.xr3_uid.clone(),
            })
            .collect(),
        has_header_row: spec.has_headers,
        has_totals_row: spec.has_totals,
        style: spec
            .style_name
            .clone()
            .unwrap_or_else(|| "TableStyleMedium2".to_string()),
        banded_rows: spec.row_stripes,
        banded_columns: spec.col_stripes,
        emphasize_first_column: spec.first_col_highlight,
        emphasize_last_column: spec.last_col_highlight,
        show_filter_buttons: spec.auto_filter_ref.is_some(),
        auto_expand: true,
        auto_calculated_columns: true,
        auto_filter_ref: spec.auto_filter_ref.clone(),
        auto_filter_xr_uid: spec.auto_filter_xr_uid.clone(),
        auto_filter_ext_lst_raw: spec.auto_filter_ext_lst_raw.clone(),
        header_row_dxf_id: spec.header_row_dxf_id,
        data_dxf_id: spec.data_dxf_id,
        totals_row_dxf_id: spec.totals_row_dxf_id,
        header_row_border_dxf_id: spec.header_row_border_dxf_id,
        table_border_dxf_id: spec.table_border_dxf_id,
        totals_row_border_dxf_id: spec.totals_row_border_dxf_id,
        header_row_cell_style: spec.header_row_cell_style.clone(),
        data_cell_style: spec.data_cell_style.clone(),
        totals_row_cell_style: spec.totals_row_cell_style.clone(),
        table_type: spec.table_type.clone(),
        totals_row_shown: spec.totals_row_shown,
        connection_id: spec.connection_id,
        comment: spec.comment.clone(),
        insert_row: spec.insert_row,
        insert_row_shift: spec.insert_row_shift,
        published: spec.published,
        xr_uid: spec.xr_uid.clone(),
        sort_state: spec.sort_state.clone(),
        filter_columns: spec.filter_columns.clone(),
        query_table: spec.query_table.clone(),
        worksheet_relationship_id_hint: spec.worksheet_relationship_id_hint.clone(),
        table_part_path_hint: spec.table_part_path_hint.clone(),
        worksheet_relationship_target_hint: spec.worksheet_relationship_target_hint.clone(),
    }
}

/// Convert a canonical catalog entry back to a TableSpec for XLSX export.
///
/// OOXML numeric IDs come from preserved package metadata or the export
/// projection. Stable Mog IDs are never parsed as OOXML IDs.
pub fn catalog_entry_to_xlsx_table_spec(
    table: &TableCatalogEntry,
    ooxml_columns: Option<&[TableColumnSpec]>,
) -> TableSpec {
    let range_ref = format!(
        "{}{}:{}{}",
        col_index_to_letter(table.range.start_col()),
        table.range.start_row() + 1,
        col_index_to_letter(table.range.end_col()),
        table.range.end_row() + 1,
    );

    let auto_filter_ref = if table.show_filter_buttons {
        Some(range_ref.clone())
    } else {
        None
    };

    let columns = match ooxml_columns {
        Some(ooxml_cols) => ooxml_cols.to_vec(),
        None => table
            .columns
            .iter()
            .map(|col| TableColumnSpec {
                id: col.ooxml_column_id.unwrap_or(col.index + 1),
                name: col.name.clone(),
                totals_function: col.totals_function,
                totals_label: col.totals_label.clone(),
                calculated_formula: col.calculated_formula.clone(),
                calculated_formula_array: col.calculated_formula_array,
                totals_row_formula: col.totals_row_formula.clone(),
                totals_row_formula_array: col.totals_row_formula_array,
                header_row_dxf_id: col.header_row_dxf_id,
                data_dxf_id: col.data_dxf_id,
                totals_row_dxf_id: col.totals_row_dxf_id,
                header_row_cell_style: col.header_row_cell_style.clone(),
                data_cell_style: col.data_cell_style.clone(),
                totals_row_cell_style: col.totals_row_cell_style.clone(),
                unique_name: col.unique_name.clone(),
                query_table_field_id: col.query_table_field_id,
                xml_column_pr: col.xml_column_pr.clone(),
                xr3_uid: col.xr3_uid.clone(),
            })
            .collect(),
    };

    TableSpec {
        id: table.ooxml_table_id.unwrap_or(0),
        name: table.name.clone(),
        display_name: table.display_name.clone(),
        range_ref,
        has_headers: table.has_header_row,
        has_totals: table.has_totals_row,
        style_name: Some(table.style.clone()),
        row_stripes: table.banded_rows,
        col_stripes: table.banded_columns,
        first_col_highlight: table.emphasize_first_column,
        last_col_highlight: table.emphasize_last_column,
        auto_filter_ref: table.auto_filter_ref.clone().or(auto_filter_ref),
        auto_filter_xr_uid: table.auto_filter_xr_uid.clone(),
        auto_filter_ext_lst_raw: table.auto_filter_ext_lst_raw.clone(),
        columns,
        header_row_dxf_id: table.header_row_dxf_id,
        data_dxf_id: table.data_dxf_id,
        totals_row_dxf_id: table.totals_row_dxf_id,
        header_row_border_dxf_id: table.header_row_border_dxf_id,
        table_border_dxf_id: table.table_border_dxf_id,
        totals_row_border_dxf_id: table.totals_row_border_dxf_id,
        header_row_cell_style: table.header_row_cell_style.clone(),
        data_cell_style: table.data_cell_style.clone(),
        totals_row_cell_style: table.totals_row_cell_style.clone(),
        table_type: table.table_type.clone(),
        totals_row_shown: table.totals_row_shown,
        connection_id: table.connection_id,
        comment: table.comment.clone(),
        insert_row: table.insert_row,
        insert_row_shift: table.insert_row_shift,
        published: table.published,
        xr_uid: table.xr_uid.clone(),
        sort_state: table.sort_state.clone(),
        filter_columns: table.filter_columns.clone(),
        query_table: table.query_table.clone(),
        worksheet_relationship_id_hint: table.worksheet_relationship_id_hint.clone(),
        table_part_path_hint: table.table_part_path_hint.clone(),
        worksheet_relationship_target_hint: table.worksheet_relationship_target_hint.clone(),
    }
}

/// Parse an A1-style range reference like "A1:D20" into zero-based bounds.
pub fn parse_table_range_ref(range_ref: &str) -> Option<(u32, u32, u32, u32)> {
    let parts: Vec<&str> = range_ref.split(':').collect();
    if parts.len() != 2 {
        return None;
    }
    let (r1, c1) = parse_table_cell_ref(parts[0])?;
    let (r2, c2) = parse_table_cell_ref(parts[1])?;
    Some((r1, c1, r2, c2))
}

fn parse_table_cell_ref(cell_ref: &str) -> Option<(u32, u32)> {
    let cell_ref = cell_ref.replace('$', "");
    let mut col_str = String::new();
    let mut row_str = String::new();
    for ch in cell_ref.chars() {
        if ch.is_ascii_alphabetic() {
            col_str.push(ch);
        } else if ch.is_ascii_digit() {
            row_str.push(ch);
        }
    }
    if col_str.is_empty() || row_str.is_empty() {
        return None;
    }
    let col = col_letter_to_index(&col_str);
    let row = row_str.parse::<u32>().ok()?.checked_sub(1)?;
    Some((row, col))
}

fn col_letter_to_index(letters: &str) -> u32 {
    let mut result: u32 = 0;
    for ch in letters.to_ascii_uppercase().chars() {
        result = result * 26 + (ch as u32 - 'A' as u32 + 1);
    }
    result.saturating_sub(1)
}

pub(crate) fn col_index_to_letter(col: u32) -> String {
    let mut result = String::new();
    let mut n = col + 1;
    while n > 0 {
        n -= 1;
        result.insert(0, (b'A' + (n % 26) as u8) as char);
        n /= 26;
    }
    result
}
