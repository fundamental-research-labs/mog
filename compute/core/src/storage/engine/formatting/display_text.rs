use super::*;

impl YrsComputeEngine {
    /// Inner workhorse: format a known CellValue using the effective format at
    /// `(sheet_id, row, col)`.
    pub(crate) fn format_value_at_cell(
        &self,
        value: &CellValue,
        sheet_id: &SheetId,
        row: u32,
        col: u32,
    ) -> String {
        let cell_id_hex = self
            .mirror
            .resolve_cell_id(sheet_id, SheetPos::new(row, col))
            .map(|cid| id_to_hex(cid.as_u128()))
            .unwrap_or_default();

        let table_fmt = self.resolve_table_format_at_cell(sheet_id, row, col);
        let mut effective = properties::get_effective_format(
            &self.stores.storage,
            sheet_id,
            &cell_id_hex,
            row,
            col,
            table_fmt.as_ref(),
            self.stores.grid_indexes.get(sheet_id),
            self.mirror.get_sheet(sheet_id),
        );

        domain_types::theme_color::resolve_theme_refs(&mut effective, &self.settings.theme_palette);

        let format_code = effective.number_format.as_deref().unwrap_or("General");
        compute_formats::format_value(value, format_code, &self.settings.locale).text
    }

    /// Look up the cell's effective value and format it through the canonical
    /// display path.
    pub fn format_cell_display(&self, sheet_id: &SheetId, row: u32, col: u32) -> String {
        let value = match crate::storage::cells::values::get_effective_value(
            &self.mirror,
            sheet_id,
            row,
            col,
        ) {
            Some(v) => v,
            None => return String::new(),
        };
        self.format_value_at_cell(&value, sheet_id, row, col)
    }
}
