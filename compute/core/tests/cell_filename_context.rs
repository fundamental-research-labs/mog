use compute_core::storage::engine::ComputeEngine;
use domain_types::{CellData, ParseOutput, SheetData};
use value_types::CellValue;

fn workbook() -> Vec<u8> {
    xlsx_parser::write::write_xlsx_from_parse_output(&ParseOutput {
        sheets: vec![
            SheetData {
                name: "Sheet1".into(),
                cells: vec![
                    CellData {
                        row: 0,
                        col: 0,
                        formula: Some("CELL(\"filename\",A2)".into()),
                        ..Default::default()
                    },
                    CellData {
                        row: 1,
                        col: 0,
                        formula: Some("CELL(\"filename\",'Other sheet'!A1)".into()),
                        ..Default::default()
                    },
                ],
                ..Default::default()
            },
            SheetData {
                name: "Other sheet".into(),
                ..Default::default()
            },
        ],
        ..Default::default()
    })
    .unwrap()
}

fn check(engine: &mut ComputeEngine, prefix: &str) {
    engine.recalculate().unwrap();
    let sheet = engine.cell_store().sheet_by_name("Sheet1").unwrap();
    for (row, name) in [(0, "Sheet1"), (1, "Other sheet")] {
        let expected = if prefix.is_empty() {
            String::new()
        } else {
            format!("{prefix}{name}")
        };
        assert_eq!(
            engine.get_cell_value(&sheet, row, 0),
            CellValue::Text(expected.into())
        );
    }
}

#[test]
fn filename_uses_actual_input_path_and_referenced_sheet_through_export_and_rebuild() {
    let dir = std::env::temp_dir().join(format!(
        "mog-file-context-{}-{}",
        std::process::id(),
        std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .unwrap()
            .as_nanos()
    ));
    std::fs::create_dir_all(&dir).unwrap();
    let input = dir.join("input ü.xlsx");
    std::fs::write(&input, workbook()).unwrap();
    let prefix = format!(
        "{}{}[input ü.xlsx]",
        dir.display(),
        std::path::MAIN_SEPARATOR
    );
    let (mut engine, _) = ComputeEngine::from_xlsx_path(input.to_str().unwrap()).unwrap();
    check(&mut engine, &prefix);
    engine.rebuild_compute_core().unwrap();
    check(&mut engine, &prefix);
    let output = dir.join("saved-as.xlsx");
    engine.export_to_xlsx_path(&output).unwrap();
    check(&mut engine, &prefix);
    let (mut reopened, _) = ComputeEngine::from_xlsx_path(output.to_str().unwrap()).unwrap();
    check(
        &mut reopened,
        &format!(
            "{}{}[saved-as.xlsx]",
            dir.display(),
            std::path::MAIN_SEPARATOR
        ),
    );
    let exported = engine.export_to_xlsx_bytes().unwrap();
    let (mut bytes_only, _) = ComputeEngine::from_xlsx_bytes(&exported).unwrap();
    check(&mut bytes_only, "");
    engine.import_from_xlsx_bytes(&workbook(), true).unwrap();
    check(&mut engine, "");
    std::fs::remove_dir_all(dir).unwrap();
}

#[test]
fn filename_has_no_guessed_identity_for_unsaved_byte_workbooks() {
    let (mut engine, _) = ComputeEngine::from_xlsx_bytes(&workbook()).unwrap();
    check(&mut engine, "");
    engine.rebuild_compute_core().unwrap();
    check(&mut engine, "");
}
