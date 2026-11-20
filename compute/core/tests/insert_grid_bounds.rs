//! Insertion preflight covers values, formulas, formatting, and dimensions at grid limits.

use cell_types::{MAX_COLS, MAX_ROWS, SheetId};
use compute_core::storage::engine::ComputeEngine;
use domain_types::CellFormat;
use formula_types::StructureChange;
use regex::Regex;
use snapshot_types::WorkbookSnapshot;
use value_types::{CellValue, ComputeError};

#[derive(Clone, Copy, Debug)]
enum Tail {
    Value,
    Formula,
    Format,
}

fn position(horizontal: bool, offset: u32) -> (u32, u32) {
    if horizontal { (0, offset) } else { (offset, 0) }
}

fn fixture(horizontal: bool, tail: Tail, offset: u32) -> (ComputeEngine, SheetId) {
    let (mut engine, _) = ComputeEngine::from_snapshot(WorkbookSnapshot::default()).unwrap();
    engine.create_sheet("Sheet1").unwrap();
    let sheet = engine.cell_store().sheet_by_name("Sheet1").unwrap();
    for i in 0..3 {
        let (row, col) = position(horizontal, i);
        engine
            .set_cell_value_parsed(&sheet, row, col, &(i + 1).to_string())
            .unwrap();
    }
    engine.set_cell_value_parsed(&sheet, 1, 1, "=A1+1").unwrap();
    let (row, col) = position(horizontal, offset);
    match tail {
        Tail::Value => {
            engine.set_cell_value_parsed(&sheet, row, col, "7").unwrap();
        }
        Tail::Formula => {
            engine
                .set_cell_value_parsed(&sheet, row, col, "=A1+1")
                .unwrap();
        }
        Tail::Format => {
            engine
                .set_format_for_ranges(
                    &sheet,
                    &[(row, col, row, col)],
                    &CellFormat {
                        background_color: Some("#FFFF00".into()),
                        ..Default::default()
                    },
                )
                .unwrap();
        }
    }
    (engine, sheet)
}

fn reopen(engine: &ComputeEngine) -> (ComputeEngine, SheetId) {
    let bytes = engine.export_to_xlsx_bytes().unwrap();
    let (engine, _) = ComputeEngine::from_xlsx_bytes(&bytes).unwrap();
    let sheet = engine.cell_store().sheet_by_name("Sheet1").unwrap();
    (engine, sheet)
}

fn sheet_xml(engine: &ComputeEngine) -> String {
    let bytes = engine.export_to_xlsx_bytes().unwrap();
    String::from_utf8(
        xlsx_parser::zip::XlsxArchive::new(&bytes)
            .unwrap()
            .read_file("xl/worksheets/sheet1.xml")
            .unwrap(),
    )
    .unwrap()
}

fn assert_export_within_grid(xml: &str) {
    for capture in Regex::new(r#"<row\b[^>]*\br="(\d+)""#)
        .unwrap()
        .captures_iter(xml)
    {
        assert!((1..=MAX_ROWS).contains(&capture[1].parse::<u32>().unwrap()));
    }
    let column_bounds = Regex::new(r#"\b(?:min|max)="(\d+)""#).unwrap();
    for column in Regex::new(r"<col\b[^>]*>").unwrap().find_iter(xml) {
        for capture in column_bounds.captures_iter(column.as_str()) {
            assert!((1..=MAX_COLS).contains(&capture[1].parse::<u32>().unwrap()));
        }
    }
    for capture in Regex::new(r#"<(?:c|dimension)\b[^>]*\b(?:r|ref)="([^"]+)""#)
        .unwrap()
        .captures_iter(xml)
    {
        for reference in capture[1].split(':') {
            let split = reference.find(|c: char| c.is_ascii_digit()).unwrap();
            let (letters, digits) = reference.split_at(split);
            let col = letters
                .bytes()
                .fold(0u32, |n, c| n * 26 + u32::from(c - b'A' + 1));
            assert!((1..=MAX_COLS).contains(&col), "{reference}");
            assert!(
                (1..=MAX_ROWS).contains(&digits.parse::<u32>().unwrap()),
                "{reference}"
            );
        }
    }
}

fn dimension_fixture(horizontal: bool, offset: u32) -> (ComputeEngine, SheetId) {
    let (mut engine, sheet) = fixture(horizontal, Tail::Value, 5);
    // The tail has only a dimension override: no value, formula, or cell style.
    if horizontal {
        engine.set_col_width_chars(&sheet, offset, 20.0).unwrap();
    } else {
        engine.set_row_height(&sheet, offset, 40.0).unwrap();
    }
    (engine, sheet)
}

fn assert_dimension(engine: &ComputeEngine, sheet: &SheetId, horizontal: bool, offset: u32) {
    if horizontal {
        assert_eq!(engine.get_col_width_chars_query(sheet, offset), 20.0);
    } else {
        assert_eq!(engine.get_row_height_query(sheet, offset), 40.0);
    }
}

fn rejects_dimension_tail(horizontal: bool) {
    let limit = if horizontal { MAX_COLS } else { MAX_ROWS };
    for count in [1, 2] {
        for imported in [false, true] {
            let offset = limit - count;
            let (mut engine, mut sheet) = dimension_fixture(horizontal, offset);
            if imported {
                (engine, sheet) = reopen(&engine);
            }
            assert_dimension(&engine, &sheet, horizontal, offset);
            let before = sheet_xml(&engine);
            assert_export_within_grid(&before);
            let undo_depth = engine.get_undo_state().undo_depth;
            let error = insert(&mut engine, &sheet, horizontal, false, 1, count)
                .expect_err("dimension-only tail must reject insertion");
            assert!(matches!(error, ComputeError::InvalidInput { .. }));
            assert_eq!(engine.get_undo_state().undo_depth, undo_depth);
            assert_eq!(sheet_xml(&engine), before);
            assert_dimension(&engine, &sheet, horizontal, offset);
            let (engine, sheet) = reopen(&engine);
            assert_dimension(&engine, &sheet, horizontal, offset);
            assert_export_within_grid(&sheet_xml(&engine));
        }
    }
}

#[test]
fn whole_rows_reject_dimension_only_tail() {
    rejects_dimension_tail(false);
}

#[test]
fn whole_columns_reject_dimension_only_tail() {
    rejects_dimension_tail(true);
}

#[test]
fn whole_axis_dimension_can_move_to_final_position() {
    for horizontal in [false, true] {
        let limit = if horizontal { MAX_COLS } else { MAX_ROWS };
        for count in [1, 2] {
            let (engine, _) = dimension_fixture(horizontal, limit - count - 1);
            let (mut engine, sheet) = reopen(&engine);
            insert(&mut engine, &sheet, horizontal, false, 1, count).unwrap();
            assert_dimension(&engine, &sheet, horizontal, limit - 1);
            assert_export_within_grid(&sheet_xml(&engine));
            let (engine, sheet) = reopen(&engine);
            assert_dimension(&engine, &sheet, horizontal, limit - 1);
        }
    }
}

#[test]
fn dimension_tail_allows_insertions_that_do_not_move_it() {
    for horizontal in [false, true] {
        let limit = if horizontal { MAX_COLS } else { MAX_ROWS };
        let (mut engine, sheet) = dimension_fixture(horizontal, limit - 1);
        insert(&mut engine, &sheet, horizontal, true, 1, 1).unwrap();
        insert(&mut engine, &sheet, !horizontal, false, 1, 1).unwrap();
        assert_dimension(&engine, &sheet, horizontal, limit - 1);
        assert_export_within_grid(&sheet_xml(&engine));
        let (engine, sheet) = reopen(&engine);
        assert_dimension(&engine, &sheet, horizontal, limit - 1);
    }
}

fn insert(
    engine: &mut ComputeEngine,
    sheet: &SheetId,
    horizontal: bool,
    partial: bool,
    at: u32,
    count: u32,
) -> Result<(), ComputeError> {
    if partial {
        let (row, col) = position(horizontal, at);
        let (rows, cols) = if horizontal { (1, count) } else { (count, 1) };
        engine.insert_cells_with_shift(sheet, row, col, rows, cols, horizontal)?;
    } else {
        let change = if horizontal {
            StructureChange::InsertCols {
                at,
                count,
                new_col_ids: vec![],
            }
        } else {
            StructureChange::InsertRows {
                at,
                count,
                new_row_ids: vec![],
            }
        };
        engine.structure_change(sheet, &change)?;
    }
    Ok(())
}

fn assert_tail(engine: &ComputeEngine, sheet: &SheetId, horizontal: bool, tail: Tail, offset: u32) {
    let (row, col) = position(horizontal, offset);
    match tail {
        Tail::Value | Tail::Formula => {
            let range = engine.query_range(sheet, row, col, row, col);
            let cell = range
                .cells
                .first()
                .unwrap_or_else(|| panic!("tail cell retained: {tail:?}, row={row}, col={col}"));
            assert_eq!(
                cell.value,
                CellValue::number(if matches!(tail, Tail::Value) {
                    7.0
                } else {
                    2.0
                })
            );
            assert_eq!(
                cell.formula.as_deref(),
                if matches!(tail, Tail::Formula) {
                    Some("=A1+1")
                } else {
                    None
                }
            );
        }
        Tail::Format => assert_eq!(
            engine
                .get_resolved_format(sheet, row, col)
                .background_color
                .as_deref(),
            Some("#FFFF00")
        ),
    }
}

fn rejects_occupied_tail(horizontal: bool, partial: bool) {
    let limit = if horizontal { MAX_COLS } else { MAX_ROWS };
    for tail in [Tail::Value, Tail::Formula, Tail::Format] {
        for count in [1, 2] {
            for imported in [false, true] {
                // With count=2, test a cell one position before the edge too.
                let offset = limit - count;
                let (mut engine, mut sheet) = fixture(horizontal, tail, offset);
                if imported {
                    (engine, sheet) = reopen(&engine);
                }
                let before = sheet_xml(&engine);
                let before_dims = {
                    let cells = engine.cell_store().get_sheet(&sheet).unwrap();
                    (cells.rows, cells.cols)
                };
                let error = insert(&mut engine, &sheet, horizontal, partial, 1, count)
                    .expect_err("occupied tail must reject insertion");
                assert!(
                    matches!(error, ComputeError::InvalidInput { .. }),
                    "{error:?}"
                );
                assert_eq!(
                    sheet_xml(&engine),
                    before,
                    "rejection changed exported cells or formulas: {tail:?}"
                );
                let cells = engine.cell_store().get_sheet(&sheet).unwrap();
                assert_eq!((cells.rows, cells.cols), before_dims);
                assert_tail(&engine, &sheet, horizontal, tail, offset);
                let (engine, sheet) = reopen(&engine);
                assert_tail(&engine, &sheet, horizontal, tail, offset);
            }
        }
    }
}

fn accepts_empty_tail(horizontal: bool, partial: bool) {
    let limit = if horizontal { MAX_COLS } else { MAX_ROWS };
    for tail in [Tail::Value, Tail::Formula, Tail::Format] {
        for count in [1, 2] {
            let (engine, _) = fixture(horizontal, tail, limit - count - 1);
            let (mut engine, sheet) = reopen(&engine);
            insert(&mut engine, &sheet, horizontal, partial, 1, count).unwrap();
            assert_tail(&engine, &sheet, horizontal, tail, limit - 1);
            let cells = engine.cell_store().get_sheet(&sheet).unwrap();
            assert!(
                cells
                    .cells()
                    .all(|(_, row, col)| row < MAX_ROWS && col < MAX_COLS)
            );
            let (engine, sheet) = reopen(&engine);
            assert_tail(&engine, &sheet, horizontal, tail, limit - 1);
        }
    }
}

#[test]
fn whole_rows_reject_occupied_tail() {
    rejects_occupied_tail(false, false);
}
#[test]
fn whole_columns_reject_occupied_tail() {
    rejects_occupied_tail(true, false);
}
#[test]
fn partial_down_rejects_occupied_tail() {
    rejects_occupied_tail(false, true);
}
#[test]
fn partial_right_rejects_occupied_tail() {
    rejects_occupied_tail(true, true);
}
#[test]
fn whole_rows_accept_empty_tail() {
    accepts_empty_tail(false, false);
}
#[test]
fn whole_columns_accept_empty_tail() {
    accepts_empty_tail(true, false);
}
#[test]
fn partial_down_accepts_empty_tail() {
    accepts_empty_tail(false, true);
}
#[test]
fn partial_right_accepts_empty_tail() {
    accepts_empty_tail(true, true);
}

#[test]
fn partial_insert_ignores_occupied_tail_outside_shifted_band() {
    for horizontal in [false, true] {
        let limit = if horizontal { MAX_COLS } else { MAX_ROWS };
        let (mut engine, sheet) = fixture(horizontal, Tail::Format, limit - 1);
        // Insert in the next row/column; the formatted tail is outside the band.
        engine
            .insert_cells_with_shift(&sheet, 1, 1, 1, 1, horizontal)
            .unwrap();
        assert_tail(&engine, &sheet, horizontal, Tail::Format, limit - 1);
    }
}

#[test]
fn inserting_at_final_position_preserves_cells_before_insertion() {
    for horizontal in [false, true] {
        for partial in [false, true] {
            let limit = if horizontal { MAX_COLS } else { MAX_ROWS };
            let (mut engine, sheet) = fixture(horizontal, Tail::Value, limit - 2);
            insert(&mut engine, &sheet, horizontal, partial, limit - 1, 1).unwrap();
            let (engine, sheet) = reopen(&engine);
            assert_tail(&engine, &sheet, horizontal, Tail::Value, limit - 2);
        }
    }
}

#[test]
fn invalid_insert_spans_reject_without_mutation() {
    for horizontal in [false, true] {
        for partial in [false, true] {
            let limit = if horizontal { MAX_COLS } else { MAX_ROWS };
            for (at, count) in [(limit, 1), (limit - 1, 2), (1, u32::MAX)] {
                let (mut engine, sheet) = fixture(horizontal, Tail::Value, 5);
                let before = sheet_xml(&engine);
                assert!(insert(&mut engine, &sheet, horizontal, partial, at, count).is_err());
                assert_eq!(sheet_xml(&engine), before);
            }
        }
    }
}

#[test]
fn sparse_format_rectangles_reject_overflow_without_allocating_cells() {
    let (mut engine, _) = ComputeEngine::from_snapshot(WorkbookSnapshot::default()).unwrap();
    engine.create_sheet("Sheet1").unwrap();
    let sheet = engine.cell_store().sheet_by_name("Sheet1").unwrap();
    engine
        .set_format_for_ranges(
            &sheet,
            &[(MAX_ROWS - 100, MAX_COLS - 1000, MAX_ROWS - 1, MAX_COLS - 1)],
            &CellFormat {
                background_color: Some("#FFFF00".into()),
                ..Default::default()
            },
        )
        .unwrap();
    let before = engine.get_undo_state();
    for horizontal in [false, true] {
        assert!(insert(&mut engine, &sheet, horizontal, false, 1, 1).is_err());
        assert!(
            engine
                .insert_cells_with_shift(&sheet, MAX_ROWS - 2, MAX_COLS - 2, 1, 1, horizontal)
                .is_err()
        );
    }
    assert_eq!(engine.get_undo_state().undo_depth, before.undo_depth);
    assert_eq!(
        engine
            .cell_store()
            .get_sheet(&sheet)
            .unwrap()
            .cells()
            .count(),
        0
    );
    assert_eq!(
        engine
            .get_resolved_format(&sheet, MAX_ROWS - 1, MAX_COLS - 1)
            .background_color
            .as_deref(),
        Some("#FFFF00")
    );
}

#[test]
fn whole_axis_format_defaults_block_only_the_axis_that_moves_them() {
    for horizontal in [false, true] {
        let (mut engine, _) = ComputeEngine::from_snapshot(WorkbookSnapshot::default()).unwrap();
        engine.create_sheet("Sheet1").unwrap();
        let sheet = engine.cell_store().sheet_by_name("Sheet1").unwrap();
        let format = CellFormat {
            background_color: Some("#FFFF00".into()),
            ..Default::default()
        };
        let (row, col) = position(
            horizontal,
            if horizontal {
                MAX_COLS - 1
            } else {
                MAX_ROWS - 1
            },
        );
        engine.ensure_cell_id_at(&sheet, row, col).unwrap();
        if horizontal {
            engine.set_col_format(&sheet, MAX_COLS - 1, format).unwrap();
        } else {
            engine.set_row_format(&sheet, MAX_ROWS - 1, format).unwrap();
        }
        assert!(insert(&mut engine, &sheet, horizontal, false, 1, 1).is_err());
        insert(&mut engine, &sheet, !horizontal, false, 1, 1).unwrap();
        assert_eq!(
            engine
                .get_resolved_format(&sheet, MAX_ROWS - 1, MAX_COLS - 1)
                .background_color
                .as_deref(),
            Some("#FFFF00")
        );
    }
}

#[test]
fn partial_boundary_insert_splits_imported_styles_and_supports_undo() {
    for horizontal in [false, true] {
        let (mut engine, _) = ComputeEngine::from_snapshot(WorkbookSnapshot::default()).unwrap();
        engine.create_sheet("Sheet1").unwrap();
        let sheet = engine.cell_store().sheet_by_name("Sheet1").unwrap();
        let limit = if horizontal { MAX_COLS } else { MAX_ROWS };
        let (row, col) = position(horizontal, limit - 2);
        let bounds = if horizontal {
            (row, col, row + 1, col)
        } else {
            (row, col, row, col + 1)
        };
        engine
            .set_format_for_ranges(
                &sheet,
                &[bounds],
                &CellFormat {
                    background_color: Some("#FFFF00".into()),
                    ..Default::default()
                },
            )
            .unwrap();
        let (mut engine, sheet) = reopen(&engine);
        let before = sheet_xml(&engine);
        insert(&mut engine, &sheet, horizontal, true, 1, 1).unwrap();
        assert_tail(&engine, &sheet, horizontal, Tail::Format, limit - 1);
        assert_eq!(
            engine
                .get_resolved_format(&sheet, row, col)
                .background_color,
            None
        );
        let (outside_row, outside_col) = if horizontal {
            (row + 1, col)
        } else {
            (row, col + 1)
        };
        assert_eq!(
            engine
                .get_resolved_format(&sheet, outside_row, outside_col)
                .background_color
                .as_deref(),
            Some("#FFFF00")
        );
        let after = sheet_xml(&engine);
        engine.undo().unwrap();
        assert_eq!(sheet_xml(&engine), before);
        engine.redo().unwrap();
        assert_eq!(sheet_xml(&engine), after);
        let (engine, sheet) = reopen(&engine);
        assert_tail(&engine, &sheet, horizontal, Tail::Format, limit - 1);
    }
}
