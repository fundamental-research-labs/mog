//! Table cell format → CellFormat conversion for viewport resolution.

use compute_table::types::{Table, TableCellFormat};
use domain_types::CellFormat;

/// Project a canonical Table to a formula-engine TableDef.
pub fn table_to_table_def(table: &Table) -> formula_types::TableDef {
    formula_types::TableDef {
        name: table.name.clone(),
        sheet: cell_types::SheetId::from_uuid_str(&table.sheet_id)
            .unwrap_or(cell_types::SheetId::from_raw(0)),
        start_row: table.range.start_row(),
        start_col: table.range.start_col(),
        end_row: table.range.end_row(),
        end_col: table.range.end_col(),
        columns: table.columns.iter().map(|c| c.name.clone()).collect(),
        has_headers: table.has_header_row,
        has_totals: table.has_totals_row,
    }
}

/// Build a `compute_table::Table` from a canonical `domain_types::domain::table::Table`.
///
/// Used for viewport style resolution — the returned `Table` can be passed to
/// `compute_table::styles::resolve_table_cell_format()`.
pub fn build_table_for_style_resolution(table: &Table) -> Table {
    // Since compute_table::types::Table is now a re-export of domain_types::Table,
    // this is just a clone.
    table.clone()
}

/// Convert a resolved table cell format into a `CellFormat` for merging
/// into the effective format chain.
///
/// Maps: fill → background_color, font_color → font_color, font_bold → bold.
/// Border fields are ignored (out of scope — CellFormat has no border fields).
pub fn table_cell_format_to_cell_format(tcf: &TableCellFormat) -> CellFormat {
    CellFormat {
        background_color: tcf.fill.as_ref().map(|c| c.to_hex_rgb()),
        font_color: tcf.font_color.as_ref().map(|c| c.to_hex_rgb()),
        bold: tcf.font_bold,
        ..CellFormat::default()
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use cell_types::SheetRange;
    use domain_types::domain::table::{TableColumn, TotalsFunction};
    use value_types::Color;

    /// Helper to build a canonical Table for tests.
    fn make_canonical_table(
        name: &str,
        sheet_id: &str,
        range: SheetRange,
        columns: Vec<TableColumn>,
        style: &str,
        has_header_row: bool,
        has_totals_row: bool,
    ) -> Table {
        Table {
            id: name.to_string(),
            name: name.to_string(),
            display_name: name.to_string(),
            sheet_id: sheet_id.to_string(),
            range,
            columns,
            has_header_row,
            has_totals_row,
            style: style.to_string(),
            banded_rows: true,
            banded_columns: false,
            emphasize_first_column: false,
            emphasize_last_column: false,
            show_filter_buttons: false,
            auto_expand: true,
            auto_calculated_columns: true,
            ..Default::default()
        }
    }

    fn make_col(name: &str, index: u32) -> TableColumn {
        TableColumn {
            id: format!("{}", index + 1),
            name: name.to_string(),
            index,
            totals_function: None,
            totals_label: None,
            calculated_formula: None,
            ..Default::default()
        }
    }

    #[test]
    fn test_full_conversion() {
        let tcf = TableCellFormat {
            fill: Some(Color::from_hex("#4472C4").unwrap()),
            font_color: Some(Color::from_hex("#FFFFFF").unwrap()),
            font_bold: Some(true),
            border_top: None,
            border_bottom: None,
            border_left: None,
            border_right: None,
        };
        let cf = table_cell_format_to_cell_format(&tcf);
        assert_eq!(cf.background_color, Some("#4472c4".to_string()));
        assert_eq!(cf.font_color, Some("#ffffff".to_string()));
        assert_eq!(cf.bold, Some(true));
    }

    #[test]
    fn test_none_fields() {
        let tcf = TableCellFormat {
            fill: None,
            font_color: None,
            font_bold: None,
            border_top: None,
            border_bottom: None,
            border_left: None,
            border_right: None,
        };
        let cf = table_cell_format_to_cell_format(&tcf);
        assert_eq!(cf.background_color, None);
        assert_eq!(cf.font_color, None);
        assert_eq!(cf.bold, None);
    }

    #[test]
    fn test_partial_fields() {
        let tcf = TableCellFormat {
            fill: Some(Color::from_hex("#ED7D31").unwrap()),
            font_color: None,
            font_bold: Some(false),
            border_top: None,
            border_bottom: None,
            border_left: None,
            border_right: None,
        };
        let cf = table_cell_format_to_cell_format(&tcf);
        assert_eq!(cf.background_color, Some("#ed7d31".to_string()));
        assert_eq!(cf.font_color, None);
        assert_eq!(cf.bold, Some(false));
    }

    #[test]
    fn test_table_to_table_def() {
        let table = make_canonical_table(
            "Sales",
            "00000000-0000-0000-0000-000000000001",
            SheetRange::new(0, 0, 10, 3),
            vec![
                make_col("Name", 0),
                make_col("Amount", 1),
                make_col("Date", 2),
                make_col("Status", 3),
            ],
            "TableStyleMedium9",
            true,
            false,
        );
        let def = table_to_table_def(&table);
        assert_eq!(def.name, "Sales");
        assert_eq!(def.start_row, 0);
        assert_eq!(def.end_col, 3);
        assert_eq!(def.columns.len(), 4);
        assert_eq!(def.columns[0], "Name");
        assert!(def.has_headers);
        assert!(!def.has_totals);
    }

    #[test]
    fn test_build_table_for_style_resolution() {
        let mut table = make_canonical_table(
            "Sales",
            "00000000-0000-0000-0000-000000000001",
            SheetRange::new(0, 0, 10, 3),
            vec![
                make_col("Name", 0),
                make_col("Amount", 1),
                make_col("Date", 2),
                make_col("Status", 3),
            ],
            "TableStyleMedium9",
            true,
            false,
        );
        table.emphasize_last_column = true;
        let ct = build_table_for_style_resolution(&table);
        assert_eq!(ct.name, "Sales");
        assert_eq!(ct.style, "TableStyleMedium9");
        assert!(ct.banded_rows);
        assert!(!ct.banded_columns);
        assert!(!ct.emphasize_first_column);
        assert!(ct.emphasize_last_column);
        assert!(ct.has_header_row);
        assert!(!ct.has_totals_row);
        assert_eq!(ct.columns.len(), 4);
        assert_eq!(ct.columns[0].name, "Name");
        assert_eq!(ct.columns[0].index, 0);
        assert_eq!(ct.columns[3].name, "Status");
        assert_eq!(ct.columns[3].index, 3);
        assert_eq!(ct.range.start_row(), 0);
        assert_eq!(ct.range.end_col(), 3);
    }

    #[test]
    fn test_build_table_default_style() {
        let table = make_canonical_table(
            "T1",
            "00000000-0000-0000-0000-000000000001",
            SheetRange::new(5, 2, 20, 5),
            vec![
                make_col("A", 0),
                make_col("B", 1),
                make_col("C", 2),
                make_col("D", 3),
            ],
            "TableStyleMedium2",
            true,
            true,
        );
        let ct = build_table_for_style_resolution(&table);
        assert_eq!(ct.style, "TableStyleMedium2");
        assert!(ct.banded_rows);
        assert!(!ct.banded_columns);
        assert!(ct.has_totals_row);
    }

    #[test]
    fn test_build_table_with_totals_functions() {
        let mut cols = vec![make_col("Revenue", 0)];
        cols[0].totals_function = Some(TotalsFunction::Sum);
        cols[0].totals_label = Some("Total".to_string());
        let table = make_canonical_table(
            "T2",
            "00000000-0000-0000-0000-000000000001",
            SheetRange::new(0, 0, 5, 0),
            cols,
            "TableStyleMedium2",
            true,
            true,
        );
        let ct = build_table_for_style_resolution(&table);
        assert_eq!(
            ct.columns[0].totals_function,
            Some(compute_table::types::TotalsFunction::Sum)
        );
        assert_eq!(ct.columns[0].totals_label, Some("Total".to_string()));
    }
}
