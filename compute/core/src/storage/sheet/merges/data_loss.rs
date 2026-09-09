use crate::mirror::CellMirror;
use cell_types::SheetId;

/// Count nonempty native values and formulas that a merge would clear.
pub fn check_merge_data_loss(
    mirror: &CellMirror,
    sheet_id: SheetId,
    sr: u32,
    sc: u32,
    er: u32,
    ec: u32,
) -> (bool, u32) {
    let Some(sheet) = mirror.get_sheet(&sheet_id) else {
        return (false, 0);
    };
    let mut occupied = std::collections::HashSet::new();
    for (id, entry) in sheet.cells_iter() {
        if entry.is_ghost() {
            continue;
        }
        let Some(pos) = sheet.position_of(id) else {
            continue;
        };
        if pos.row() < sr
            || pos.row() > er
            || pos.col() < sc
            || pos.col() > ec
            || (pos.row() == sr && pos.col() == sc)
        {
            continue;
        }
        if mirror
            .get_cell_value_at(&sheet_id, pos)
            .is_some_and(|value| {
                !value.is_null()
                    && !matches!(value, value_types::CellValue::Text(text) if text.is_empty())
            })
            || mirror.get_formula(id).is_some()
        {
            occupied.insert((pos.row(), pos.col()));
        }
    }
    let max_col = ec.min(sheet.cols.saturating_sub(1));
    if sc <= max_col {
        for col in sc..=max_col {
            if let Some(values) = sheet.get_column_view(col) {
                for (row, value) in values
                    .iter()
                    .enumerate()
                    .skip(sr as usize)
                    .take(er.saturating_sub(sr) as usize + 1)
                {
                    let row = row as u32;
                    if row == sr && col == sc {
                        continue;
                    }
                    if !value.is_null()
                        && !matches!(value, value_types::CellValue::Text(text) if text.is_empty())
                    {
                        occupied.insert((row, col));
                    }
                }
            }
        }
    }
    let count = occupied.len().min(u32::MAX as usize) as u32;
    (count != 0, count)
}
