//! Calculated Columns

use super::table::get_data_range;
use super::types::Table;

pub fn get_calculated_formula_for_cell(table: &Table, row: u32, col: u32) -> Option<&str> {
    let data_range = get_data_range(table)?;
    if row < data_range.start_row() || row > data_range.end_row() {
        return None;
    }
    if col < data_range.start_col() || col > data_range.end_col() {
        return None;
    }
    let idx = (col - table.range.start_col()) as usize;
    if idx >= table.columns.len() {
        return None;
    }
    table.columns[idx].calculated_formula.as_deref()
}

pub fn get_column_data_cells(table: &Table, ci: usize) -> Vec<(u32, u32)> {
    if ci >= table.columns.len() {
        return Vec::new();
    }
    let dr = match get_data_range(table) {
        Some(r) => r,
        None => return Vec::new(),
    };
    let col = table.range.start_col() + ci as u32;
    (dr.start_row()..=dr.end_row()).map(|r| (r, col)).collect()
}

pub fn get_table_column_index(table: &Table, absolute_col: u32) -> Option<usize> {
    if absolute_col < table.range.start_col() || absolute_col > table.range.end_col() {
        return None;
    }
    let index = (absolute_col - table.range.start_col()) as usize;
    if index >= table.columns.len() {
        return None;
    }
    Some(index)
}

pub fn set_calculated_formula(table: &Table, ci: usize, formula: &str) -> Option<Table> {
    if ci >= table.columns.len() {
        return None;
    }
    let mut result = table.clone();
    result.columns[ci].calculated_formula = Some(formula.to_string());
    Some(result)
}

pub fn clear_calculated_formula(table: &Table, ci: usize) -> Option<Table> {
    if ci >= table.columns.len() {
        return None;
    }
    let mut result = table.clone();
    result.columns[ci].calculated_formula = None;
    Some(result)
}

#[cfg(test)]
mod tests {
    use super::super::table::{CreateTableOptions, create_table};
    use super::super::types::TableRange;
    use super::*;

    fn make_table(name: &str, sr: u32, sc: u32, er: u32, ec: u32) -> Table {
        create_table(
            name,
            "sheet1",
            TableRange::new(sr, sc, er, ec),
            &["A", "B", "C"],
            None,
        )
        .unwrap()
    }

    fn make_table_with_totals(name: &str, sr: u32, sc: u32, er: u32, ec: u32) -> Table {
        create_table(
            name,
            "sheet1",
            TableRange::new(sr, sc, er, ec),
            &["A", "B", "C"],
            Some(CreateTableOptions {
                has_totals_row: Some(true),
                ..Default::default()
            }),
        )
        .unwrap()
    }

    #[test]
    fn data_cells_basic() {
        let t = make_table("T1", 0, 0, 10, 2);
        let cells = get_column_data_cells(&t, 0);
        assert_eq!(cells.len(), 10);
        assert_eq!(cells[0], (1, 0));
        assert_eq!(cells[9], (10, 0));
    }

    #[test]
    fn data_cells_with_totals() {
        let t = make_table_with_totals("T1", 0, 0, 11, 2);
        let cells = get_column_data_cells(&t, 1);
        assert_eq!(cells.len(), 10);
        assert_eq!(cells[0], (1, 1));
        assert_eq!(cells[9], (10, 1));
    }

    #[test]
    fn data_cells_out_of_bounds() {
        let t = make_table("T1", 0, 0, 10, 2);
        assert!(get_column_data_cells(&t, 99).is_empty());
    }

    #[test]
    fn data_cells_nonzero_start() {
        let t = make_table("T1", 5, 3, 15, 5);
        let cells = get_column_data_cells(&t, 2);
        assert_eq!(cells.len(), 10);
        assert_eq!(cells[0], (6, 5));
        assert_eq!(cells[9], (15, 5));
    }

    #[test]
    fn formula_for_data_cell() {
        let mut t = make_table("T1", 0, 0, 10, 2);
        t.columns[1].calculated_formula = Some("=[@A]*2".to_string());
        assert_eq!(get_calculated_formula_for_cell(&t, 5, 1), Some("=[@A]*2"));
    }

    #[test]
    fn formula_for_header_row_returns_none() {
        let mut t = make_table("T1", 0, 0, 10, 2);
        t.columns[0].calculated_formula = Some("=1+1".to_string());
        assert!(get_calculated_formula_for_cell(&t, 0, 0).is_none());
    }

    #[test]
    fn formula_for_totals_row_returns_none() {
        let mut t = make_table_with_totals("T1", 0, 0, 11, 2);
        t.columns[0].calculated_formula = Some("=1+1".to_string());
        assert!(get_calculated_formula_for_cell(&t, 11, 0).is_none());
    }

    #[test]
    fn formula_for_non_calculated_column() {
        let t = make_table("T1", 0, 0, 10, 2);
        assert!(get_calculated_formula_for_cell(&t, 5, 0).is_none());
    }

    #[test]
    fn formula_outside_table_returns_none() {
        let t = make_table("T1", 0, 0, 10, 2);
        assert!(get_calculated_formula_for_cell(&t, 5, 99).is_none());
    }

    #[test]
    fn column_index_in_range() {
        let t = make_table("T1", 0, 0, 10, 2);
        assert_eq!(get_table_column_index(&t, 0), Some(0));
        assert_eq!(get_table_column_index(&t, 1), Some(1));
        assert_eq!(get_table_column_index(&t, 2), Some(2));
    }

    #[test]
    fn column_index_out_of_range() {
        let t = make_table("T1", 0, 0, 10, 2);
        assert!(get_table_column_index(&t, 3).is_none());
    }

    #[test]
    fn column_index_nonzero_start() {
        let t = make_table("T1", 5, 3, 15, 5);
        assert_eq!(get_table_column_index(&t, 3), Some(0));
        assert_eq!(get_table_column_index(&t, 5), Some(2));
        assert!(get_table_column_index(&t, 2).is_none());
        assert!(get_table_column_index(&t, 6).is_none());
    }

    #[test]
    fn set_and_clear_formula() {
        let t = make_table("T1", 0, 0, 10, 2);
        assert!(t.columns[0].calculated_formula.is_none());
        let t2 = set_calculated_formula(&t, 0, "=[@B]+1").unwrap();
        assert_eq!(t2.columns[0].calculated_formula.as_deref(), Some("=[@B]+1"));
        assert!(t.columns[0].calculated_formula.is_none());
        let t3 = clear_calculated_formula(&t2, 0).unwrap();
        assert!(t3.columns[0].calculated_formula.is_none());
    }

    #[test]
    fn set_formula_out_of_bounds() {
        let t = make_table("T1", 0, 0, 10, 2);
        assert!(set_calculated_formula(&t, 99, "=1").is_none());
        assert!(clear_calculated_formula(&t, 99).is_none());
    }
}
