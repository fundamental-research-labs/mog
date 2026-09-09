use cell_types::{CellId, SheetPos};
use compute_core::bridge_types::CellInput;
use compute_core::storage::engine::ComputeEngine;
use domain_types::{CellData, ParseOutput, SheetData};
use snapshot_types::queries::FindInRangeOptions;
use value_types::{CellValue, FiniteF64};

fn number(value: f64) -> CellValue {
    CellValue::Number(FiniteF64::must(value))
}

#[test]
fn compact_values_participate_in_queries_and_replacement_without_replacing_formulas() {
    let mut cells: Vec<_> = (0..512)
        .map(|row| CellData {
            row,
            col: 0,
            value: number(10.0),
            ..Default::default()
        })
        .collect();
    cells.extend([
        CellData {
            row: 0,
            col: 1,
            value: number(5120.0),
            formula: Some("SUM(A1:A512)".into()),
            ..Default::default()
        },
        CellData {
            row: 1,
            col: 1,
            value: number(10.0),
            formula: Some("10".into()),
            ..Default::default()
        },
    ]);
    let bytes = xlsx_parser::write::write_xlsx_from_parse_output(&ParseOutput {
        sheets: vec![SheetData {
            name: "Data".into(),
            rows: 512,
            cols: 2,
            cells,
            ..Default::default()
        }],
        ..Default::default()
    })
    .unwrap();
    let (mut engine, _) = ComputeEngine::from_xlsx_bytes(&bytes).unwrap();
    let sheet_id = *engine.cell_store().sheet_ids().next().unwrap();
    assert!(
        engine
            .cell_store()
            .get_sheet(&sheet_id)
            .unwrap()
            .iter_ranges()
            .next()
            .is_some()
    );
    assert_eq!(engine.get_cell_count(&sheet_id), 514);
    assert_eq!(engine.get_raw_value(&sheet_id, 250, 0), "10");
    assert_eq!(
        engine.get_cell_data(&sheet_id, 250, 0).unwrap()["value"]["value"],
        10.0
    );

    let result = engine
        .replace_all_in_range(
            &sheet_id,
            0,
            0,
            511,
            1,
            "10".into(),
            "20".into(),
            FindInRangeOptions {
                text: "10".into(),
                case_sensitive: Some(true),
                whole_cell: Some(true),
                include_formulas: None,
            },
        )
        .unwrap();
    assert_eq!(result.extract_data::<u32>(), Some(512));
    assert_eq!(engine.get_cell_count(&sheet_id), 514);
    assert_eq!(
        engine
            .cell_store()
            .get_cell_value_at(&sheet_id, SheetPos::new(0, 1)),
        Some(&number(10240.0))
    );
    assert_eq!(engine.get_raw_value(&sheet_id, 1, 1), "=10");
    assert_eq!(
        engine
            .cell_store()
            .get_cell_value_at(&sheet_id, SheetPos::new(1, 1)),
        Some(&number(10.0))
    );

    let literal_id = CellId::from_raw(0x1010);
    engine
        .set_cell(
            &sheet_id,
            literal_id,
            2,
            1,
            CellInput::Literal {
                text: "=1+1".into(),
            },
        )
        .unwrap();
    let info = engine.get_cell_info(&sheet_id, 2, 1).unwrap();
    assert!(info.formula.is_none());
    assert_eq!(engine.get_raw_value(&sheet_id, 2, 1), "=1+1");
    assert_eq!(engine.get_cell_count(&sheet_id), 515);
}

fn blank_engine() -> (ComputeEngine, cell_types::SheetId) {
    let sheet_id = cell_types::SheetId::from_raw(1);
    let (engine, _) = ComputeEngine::from_snapshot(snapshot_types::WorkbookSnapshot {
        sheets: vec![snapshot_types::SheetSnapshot {
            identities: Vec::new(),
            id: sheet_id.to_uuid_string(),
            name: "Data".into(),
            rows: 100,
            cols: 26,
            cells: vec![],
            ranges: vec![],
            row_axis: None,
            col_axis: None,
        }],
        ..Default::default()
    })
    .unwrap();
    (engine, sheet_id)
}

#[test]
fn all_input_paths_share_lossless_native_values_and_formula_dependencies() {
    let (mut engine, sid) = blank_engine();
    let inputs = [
        (
            CellInput::Literal { text: "123".into() },
            CellValue::Text("123".into()),
        ),
        (
            CellInput::Literal {
                text: "=A1+1".into(),
            },
            CellValue::Text("=A1+1".into()),
        ),
        (
            CellInput::Literal { text: "".into() },
            CellValue::Text("".into()),
        ),
        (
            CellInput::Parse { text: "\0".into() },
            CellValue::Text("\0".into()),
        ),
        (
            CellInput::Parse {
                text: "Πλήρης 🦀".into(),
            },
            CellValue::Text("Πλήρης 🦀".into()),
        ),
        (CellInput::Parse { text: "42".into() }, number(42.0)),
    ];
    for (col, (input, expected)) in inputs.into_iter().enumerate() {
        engine
            .set_cell(
                &sid,
                CellId::from_raw(100 + col as u128),
                0,
                col as u32,
                input,
            )
            .unwrap();
        assert_eq!(
            engine
                .cell_store()
                .get_cell_value_at(&sid, SheetPos::new(0, col as u32)),
            Some(&expected)
        );
        assert!(
            engine
                .get_cell_info(&sid, 0, col as u32)
                .unwrap()
                .formula
                .is_none()
        );
    }
    engine
        .set_cell_value_as_text(&sid, 1, 0, "'42".into())
        .unwrap();
    assert_eq!(
        engine
            .cell_store()
            .get_cell_value_at(&sid, SheetPos::new(1, 0)),
        Some(&CellValue::Text("42".into()))
    );
    engine
        .set_cell_values_parsed(&sid, vec![(2, 0, "2".into()), (2, 1, "=A3*3".into())])
        .unwrap();
    let formula_id = engine
        .cell_store()
        .get_sheet(&sid)
        .unwrap()
        .cell_id_at(cell_types::SheetPos::new(2, 1))
        .unwrap();
    assert!(engine.cell_store().get_formula(&formula_id).is_some());
    assert_eq!(
        engine
            .cell_store()
            .get_cell_value_at(&sid, SheetPos::new(2, 1)),
        Some(&number(6.0))
    );
    let result = engine
        .set_cell_value_parsed(&sid, 2, 0, "4".into())
        .unwrap();
    assert_eq!(
        engine
            .cell_store()
            .get_cell_value_at(&sid, SheetPos::new(2, 1)),
        Some(&number(12.0))
    );
    assert!(
        result
            .recalc
            .changed_cells
            .iter()
            .any(|change| change.old_value == Some(number(2.0)) && change.value == number(4.0))
    );
    engine
        .import_values(
            &sid,
            vec![
                (3, 0, CellValue::Text("0042".into()), None),
                (3, 1, CellValue::Null, Some("A3+1".into())),
                (
                    3,
                    2,
                    CellValue::Error(value_types::CellError::Div0, None),
                    None,
                ),
            ],
        )
        .unwrap();
    assert_eq!(
        engine
            .cell_store()
            .get_cell_value_at(&sid, SheetPos::new(3, 0)),
        Some(&CellValue::Text("0042".into()))
    );
    assert_eq!(
        engine
            .cell_store()
            .get_cell_value_at(&sid, SheetPos::new(3, 1)),
        Some(&number(5.0))
    );
    assert_eq!(
        engine
            .cell_store()
            .get_cell_value_at(&sid, SheetPos::new(3, 2)),
        Some(&CellValue::Error(value_types::CellError::Div0, None))
    );
    engine
        .set_cell_value_as_text(&sid, 1, 0, "".into())
        .unwrap();
    assert!(
        engine
            .cell_store()
            .get_cell_value_at(&sid, SheetPos::new(1, 0))
            .is_none_or(CellValue::is_null)
    );
    let registered = engine.cell_store().get_sheet(&sid).unwrap().cells().count();
    engine
        .set_cell_value_parsed(&sid, 90, 20, "   ".into())
        .unwrap();
    assert_eq!(
        engine.cell_store().get_sheet(&sid).unwrap().cells().count(),
        registered
    );
}

#[test]
fn clearing_contents_preserves_identity_for_existing_formula_references() {
    let (mut engine, sid) = blank_engine();
    engine
        .set_cell_values_parsed(&sid, vec![(0, 0, "7".into()), (0, 1, "=A1+1".into())])
        .unwrap();
    let source_id = engine
        .cell_store()
        .get_sheet(&sid)
        .unwrap()
        .cell_id_at(cell_types::SheetPos::new(0, 0))
        .unwrap();
    engine.batch_clear_cells(vec![source_id]).unwrap();
    assert_eq!(
        engine
            .cell_store()
            .get_sheet(&sid)
            .unwrap()
            .cell_id_at(cell_types::SheetPos::new(0, 0)),
        Some(source_id)
    );
    assert_eq!(
        engine
            .cell_store()
            .get_cell_value_at(&sid, SheetPos::new(0, 1)),
        Some(&number(1.0))
    );
    engine.set_cell_value_parsed(&sid, 0, 0, "12").unwrap();
    assert_eq!(
        engine
            .cell_store()
            .get_sheet(&sid)
            .unwrap()
            .cell_id_at(cell_types::SheetPos::new(0, 0)),
        Some(source_id)
    );
    assert_eq!(
        engine
            .cell_store()
            .get_cell_value_at(&sid, SheetPos::new(0, 1)),
        Some(&number(13.0))
    );
}

#[test]
fn merging_and_clearing_compact_values_updates_dependents_and_xlsx() {
    let mut cells: Vec<_> = (0..512)
        .map(|row| CellData {
            row,
            col: 0,
            value: number(10.0),
            ..Default::default()
        })
        .collect();
    cells.push(CellData {
        row: 0,
        col: 1,
        value: number(5120.0),
        formula: Some("SUM(A1:A512)".into()),
        ..Default::default()
    });
    let bytes = xlsx_parser::write::write_xlsx_from_parse_output(&ParseOutput {
        sheets: vec![SheetData {
            name: "Data".into(),
            rows: 512,
            cols: 2,
            cells,
            ..Default::default()
        }],
        ..Default::default()
    })
    .unwrap();
    let (mut engine, _) = ComputeEngine::from_xlsx_bytes(&bytes).unwrap();
    let sid = *engine.cell_store().sheet_ids().next().unwrap();
    assert!(
        !engine
            .cell_store()
            .get_sheet(&sid)
            .unwrap()
            .range_views_is_empty()
    );
    let merged = engine.merge_range(&sid, 0, 0, 2, 0).unwrap();
    assert_eq!(
        engine
            .cell_store()
            .get_cell_value_at(&sid, SheetPos::new(0, 1)),
        Some(&number(5100.0))
    );
    assert!(merged.recalc.changed_cells.iter().any(|change| {
        change
            .position
            .as_ref()
            .is_some_and(|pos| pos.row == 1 && pos.col == 0)
            && change.old_value == Some(number(10.0))
            && change.value == CellValue::Null
    }));
    engine.unmerge_range(&sid, 0, 0, 2, 0).unwrap();
    assert_eq!(
        engine
            .cell_store()
            .get_cell_value_at(&sid, SheetPos::new(1, 0))
            .cloned()
            .unwrap_or_default(),
        CellValue::Null
    );
    engine.clear_range(&sid, 3, 0, 511, 0).unwrap();
    assert_eq!(
        engine
            .cell_store()
            .get_cell_value_at(&sid, SheetPos::new(0, 1)),
        Some(&number(10.0))
    );
    let bytes = engine.export_to_xlsx_bytes().unwrap();
    let (reloaded, _) = ComputeEngine::from_xlsx_bytes(&bytes).unwrap();
    let sid = *reloaded.cell_store().sheet_ids().next().unwrap();
    assert_eq!(
        reloaded
            .cell_store()
            .get_cell_value_at(&sid, SheetPos::new(0, 1)),
        Some(&number(10.0))
    );
    assert_eq!(
        reloaded
            .cell_store()
            .get_cell_value_at(&sid, SheetPos::new(400, 0))
            .cloned()
            .unwrap_or_default(),
        CellValue::Null
    );
}
