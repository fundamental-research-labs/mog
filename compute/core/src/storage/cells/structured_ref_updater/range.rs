use cell_types::col_to_letter;

/// Table range information for structured reference to A1 conversion.
///
/// Mirrors `TableRangeInfo` from the TypeScript source.
#[derive(Debug, Clone, PartialEq)]
pub struct TableRangeInfo {
    /// Table name.
    pub name: String,
    /// Start row (0-based).
    pub start_row: u32,
    /// Start column (0-based).
    pub start_col: u32,
    /// End row (0-based, inclusive).
    pub end_row: u32,
    /// End column (0-based, inclusive).
    pub end_col: u32,
    /// Column definitions: (name, 0-based index within table).
    pub columns: Vec<(String, u32)>,
    /// Whether the table has a header row.
    pub has_header_row: bool,
    /// Whether the table has a totals row.
    pub has_total_row: bool,
}

pub(super) fn table_data_a1_range(table_info: &TableRangeInfo) -> String {
    let data_start_row = if table_info.has_header_row {
        table_info.start_row + 1
    } else {
        table_info.start_row
    };
    let data_end_row = if table_info.has_total_row {
        table_info.end_row - 1
    } else {
        table_info.end_row
    };

    format!(
        "${}${}:${}${}",
        col_to_letter(table_info.start_col),
        data_start_row + 1,
        col_to_letter(table_info.end_col),
        data_end_row + 1
    )
}

#[cfg(test)]
mod tests {
    use super::*;

    fn sales_table(has_header_row: bool, has_total_row: bool) -> TableRangeInfo {
        TableRangeInfo {
            name: "Sales".to_string(),
            start_row: 0,
            start_col: 0,
            end_row: 10,
            end_col: 2,
            columns: vec![
                ("Date".to_string(), 0),
                ("Amount".to_string(), 1),
                ("Tax".to_string(), 2),
            ],
            has_header_row,
            has_total_row,
        }
    }

    #[test]
    fn table_data_a1_range_excludes_header_row() {
        assert_eq!(table_data_a1_range(&sales_table(true, false)), "$A$2:$C$11");
    }

    #[test]
    fn table_data_a1_range_excludes_totals_row() {
        assert_eq!(table_data_a1_range(&sales_table(true, true)), "$A$2:$C$10");
    }

    #[test]
    fn table_data_a1_range_includes_first_row_without_header() {
        assert_eq!(
            table_data_a1_range(&sales_table(false, false)),
            "$A$1:$C$11"
        );
    }

    #[test]
    fn table_data_a1_range_preserves_column_offset() {
        let table_info = TableRangeInfo {
            name: "Sales".to_string(),
            start_row: 5,
            start_col: 3,
            end_row: 15,
            end_col: 6,
            columns: vec![("Date".to_string(), 0), ("Amount".to_string(), 1)],
            has_header_row: true,
            has_total_row: false,
        };

        assert_eq!(table_data_a1_range(&table_info), "$D$7:$G$16");
    }
}
