use cell_types::{SheetId, SheetPos};
use domain_types::domain::table::{TableCatalogEntry, TableSpec};
use value_types::CellValue;

use crate::mirror::CellMirror;
use crate::storage::engine::formula_read;
use crate::storage::engine::stores::EngineStores;

pub(super) fn apply_runtime_table_totals_to_spec(
    stores: &EngineStores,
    mirror: &CellMirror,
    sheet_id: &SheetId,
    table: &TableCatalogEntry,
    spec: &mut TableSpec,
) {
    if !table.has_totals_row {
        return;
    }

    if spec.totals_row_shown.is_none() {
        spec.totals_row_shown = Some(true);
    }

    let totals_row = table.range.end_row();
    let start_col = table.range.start_col();

    for (column_index, column) in spec.columns.iter_mut().enumerate() {
        let Ok(offset) = u32::try_from(column_index) else {
            continue;
        };
        let col = start_col.saturating_add(offset);
        if col > table.range.end_col() {
            continue;
        }

        let pos = SheetPos::new(totals_row, col);
        let cell_id = mirror.resolve_cell_id(sheet_id, pos);

        if column.totals_row_formula.is_none()
            && column.totals_function.is_none()
            && let Some(formula) = formula_read::formula_text_at(
                stores,
                mirror,
                sheet_id,
                totals_row,
                col,
                cell_id.as_ref(),
            )
        {
            column.totals_row_formula = Some(formula);
        }

        if column.totals_label.is_none()
            && column.totals_row_formula.is_none()
            && column.totals_function.is_none()
            && let Some(CellValue::Text(text)) = mirror.get_cell_value_at(sheet_id, pos)
        {
            let label = text.trim();
            if !label.is_empty() {
                column.totals_label = Some(label.to_string());
            }
        }
    }
}
