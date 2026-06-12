use super::{Table, TableBinding, TableColumn, TableColumnBinding, TableStyleInfo};

impl TableBinding {
    /// Create a `TableBinding` from a canonical `Table`.
    ///
    /// Includes the full table extent (id, sheet_id, row/col bounds) so the
    /// binding is self-contained in `rangeBindings`.
    pub fn from_table(table: &Table) -> Self {
        TableBinding {
            name: table.name.clone(),
            display_name: if table.display_name != table.name {
                Some(table.display_name.clone())
            } else {
                None
            },
            id: Some(table.id.clone()),
            sheet_id: Some(table.sheet_id.clone()),
            start_row: Some(table.range.start_row()),
            start_col: Some(table.range.start_col()),
            end_row: Some(table.range.end_row()),
            end_col: Some(table.range.end_col()),
            columns: table
                .columns
                .iter()
                .map(|col| TableColumnBinding {
                    name: col.name.clone(),
                    index: col.index,
                    totals_function: col.totals_function,
                    totals_label: col.totals_label.clone(),
                    calculated_formula: col.calculated_formula.clone(),
                })
                .collect(),
            has_header_row: table.has_header_row,
            has_totals_row: table.has_totals_row,
            auto_expand: table.auto_expand,
            auto_calculated_columns: table.auto_calculated_columns,
            style: Some(TableStyleInfo {
                name: table.style.clone(),
                banded_rows: table.banded_rows,
                banded_columns: table.banded_columns,
                emphasize_first_column: table.emphasize_first_column,
                emphasize_last_column: table.emphasize_last_column,
                show_filter_buttons: table.show_filter_buttons,
            }),
        }
    }

    /// Reconstruct a canonical `Table` from a `TableBinding` + Range extent.
    ///
    /// The caller provides `table_id`, `sheet_id`, and the `SheetRange` from
    /// the Range system. The binding provides column schema and style info.
    pub fn to_table(&self, table_id: &str, sheet_id: &str, range: cell_types::SheetRange) -> Table {
        let style_info = self.style.as_ref();
        Table {
            id: table_id.to_string(),
            name: self.name.clone(),
            display_name: self
                .display_name
                .clone()
                .unwrap_or_else(|| self.name.clone()),
            sheet_id: sheet_id.to_string(),
            range,
            columns: self
                .columns
                .iter()
                .enumerate()
                .map(|(i, col)| TableColumn {
                    id: format!("legacy-binding-col-{}", i + 1),
                    name: col.name.clone(),
                    index: col.index,
                    totals_function: col.totals_function,
                    totals_label: col.totals_label.clone(),
                    calculated_formula: col.calculated_formula.clone(),
                    ..TableColumn::default()
                })
                .collect(),
            has_header_row: self.has_header_row,
            has_totals_row: self.has_totals_row,
            auto_expand: self.auto_expand,
            auto_calculated_columns: self.auto_calculated_columns,
            style: style_info
                .map(|s| s.name.clone())
                .unwrap_or_else(|| "TableStyleMedium2".to_string()),
            banded_rows: style_info.map(|s| s.banded_rows).unwrap_or(true),
            banded_columns: style_info.map(|s| s.banded_columns).unwrap_or(false),
            emphasize_first_column: style_info
                .map(|s| s.emphasize_first_column)
                .unwrap_or(false),
            emphasize_last_column: style_info.map(|s| s.emphasize_last_column).unwrap_or(false),
            show_filter_buttons: style_info.map(|s| s.show_filter_buttons).unwrap_or(true),
            ..Table::default()
        }
    }

    /// Reconstruct a canonical `Table` from a self-contained `TableBinding`.
    ///
    /// Uses the embedded `id`, `sheet_id`, and range coordinates. Returns
    /// `None` if any of the required extent fields are missing.
    pub fn to_table_standalone(&self) -> Option<Table> {
        let table_id = self.id.as_deref().unwrap_or(&self.name);
        let sheet_id = self.sheet_id.as_deref()?;
        let range = cell_types::SheetRange::new(
            self.start_row?,
            self.start_col?,
            self.end_row?,
            self.end_col?,
        );
        Some(self.to_table(table_id, sheet_id, range))
    }
}
