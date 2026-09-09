//! Rich error identity and legacy fallback survive the production import path.
use super::super::YrsComputeEngine;
use super::helpers::cell_value_at;
use domain_types::{
    CellData, CellMetadataRecord, FutureMetadataBlock, FutureMetadataGroup, MetadataType,
    ParseOutput, RichDataPart, SheetData, ValueMetadataBlock, WorkbookMetadata, WorkbookRichData,
};
use value_types::{CellError, CellValue};

fn rich_error_workbook(include_spill_details: bool) -> Vec<u8> {
    let rich_ns = "http://schemas.microsoft.com/office/spreadsheetml/2017/richdata";
    let mut metadata = WorkbookMetadata {
        metadata_types: vec![MetadataType { name: "UNRELATED".into(), ..Default::default() }, MetadataType { name: "XLRICHVALUE".into(), ..Default::default() }],
        future_metadata: vec![FutureMetadataGroup {
            name: "XLRICHVALUE".into(),
            blocks: [2, 0, 1, 3].into_iter().map(|index| FutureMetadataBlock {
                raw_xml: format!("<extLst><ext uri=\"{{3e2802c4-a4d2-4d8b-9148-e3be6c30e623}}\"><r:rvb xmlns:r=\"{rich_ns}\" i=\"{index}\"/></ext></extLst>"),
            }).collect(),
        }],
        value_metadata: (0..4).map(|index| ValueMetadataBlock { records: vec![CellMetadataRecord { t: 2, v: index }] }).collect(),
        rich_data: Some(WorkbookRichData { parts: vec![
            RichDataPart { path: "xl/richData/rdrichvalue.xml".into(), content_type: "application/vnd.ms-excel.rdrichvalue+xml".into(), data: format!("<rvData xmlns=\"{rich_ns}\" count=\"4\">{}</rvData>", [4,13,8,19].into_iter().map(|code|format!("<rv s=\"1\"><v>0</v><v>{code}</v><v>7</v></rv>")).collect::<String>()).into_bytes(), ..Default::default() },
            RichDataPart { path: "xl/richData/rdrichvaluestructure.xml".into(), content_type: "application/vnd.ms-excel.rdrichvaluestructure+xml".into(), data: format!("<rvStructures xmlns=\"{rich_ns}\" count=\"2\"><s t=\"unrelated\"/><s t=\"_error\"><k n=\"colOffset\" t=\"i\"/><k n=\"ERRORtype\" t=\"i\"/><k n=\"rwOffset\" t=\"i\"/></s></rvStructures>").into_bytes(), ..Default::default() },
        ], ..Default::default() }),
        ..Default::default()
    };
    if !include_spill_details {
        let parts = &mut metadata.rich_data.as_mut().unwrap().parts;
        parts[0].data = format!(
            "<rvData xmlns=\"{rich_ns}\" count=\"4\">{}</rvData>",
            [4, 13, 8, 19]
                .into_iter()
                .map(|code| format!("<rv s=\"1\"><v>{code}</v><v>0</v></rv>"))
                .collect::<String>()
        )
        .into_bytes();
        parts[1].data = format!("<rvStructures xmlns=\"{rich_ns}\" count=\"2\"><s t=\"unrelated\"/><s t=\"_error\"><k n=\"errorType\" t=\"i\"/><k n=\"subType\" t=\"i\"/></s></rvStructures>").into_bytes();
    }
    let mut cells: Vec<_> = (0..4)
        .map(|row| CellData {
            row,
            col: 0,
            value: CellValue::Error(CellError::Value, None),
            vm: Some(row + 1),
            ..Default::default()
        })
        .collect();
    cells.push(CellData {
        row: 0,
        col: 1,
        value: CellValue::Error(CellError::Value, None),
        vm: Some(1),
        formula: Some("1/0".into()),
        ..Default::default()
    });
    let input = ParseOutput {
        metadata: Some(metadata),
        sheets: vec![SheetData {
            name: "RichErrors".into(),
            rows: 4,
            cols: 2,
            cells,
            ..Default::default()
        }],
        ..Default::default()
    };
    xlsx_parser::write::write_xlsx_from_parse_output(&input).unwrap()
}

fn assert_error(value: CellValue, expected: CellError) {
    assert!(
        matches!(value, CellValue::Error(error, _) if error == expected),
        "{value:?}, expected {expected:?}"
    );
}

#[test]
fn rich_error_values_preserve_cached_identity_fallback_and_recalculation() {
    let bytes = rich_error_workbook(true);
    let (parsed, _) = xlsx_parser::parse_xlsx_to_output(&bytes).unwrap();
    for (row, expected) in [
        CellError::Spill,
        CellError::Name,
        CellError::Calc,
        CellError::Value,
    ]
    .into_iter()
    .enumerate()
    {
        let cell = parsed.sheets[0]
            .cells
            .iter()
            .find(|cell| cell.row == row as u32 && cell.col == 0)
            .unwrap();
        assert_error(cell.value.clone(), expected);
        assert_eq!(cell.imported_rich_error.is_some(), row < 3);
    }
    let (mut engine, _) = YrsComputeEngine::from_xlsx_bytes(&bytes).unwrap();
    let sheet = engine.stores.storage.sheet_order()[0];
    assert_error(cell_value_at(&engine, &sheet, 0, 0), CellError::Spill);
    assert_error(cell_value_at(&engine, &sheet, 0, 1), CellError::Spill);
    let state = compute_collab::encode_full_state(engine.storage().doc());
    let (peer, _) = YrsComputeEngine::from_yrs_state(&state).unwrap();
    assert_error(cell_value_at(&peer, &sheet, 0, 0), CellError::Spill);

    let exported = engine.export_to_xlsx_bytes().unwrap();
    let (reloaded, _) = xlsx_parser::parse_xlsx_to_output(&exported).unwrap();
    let cell = reloaded.sheets[0]
        .cells
        .iter()
        .find(|cell| cell.row == 0 && cell.col == 0)
        .unwrap();
    assert_error(cell.value.clone(), CellError::Spill);
    assert_eq!(cell.imported_rich_error.unwrap().fallback, CellError::Value);
    assert!(reloaded.metadata.unwrap().rich_data.is_some());

    engine.recalculate().unwrap();
    assert_error(cell_value_at(&engine, &sheet, 0, 1), CellError::Div0);
    let exported = engine.export_to_xlsx_bytes().unwrap();
    let (reloaded, _) = xlsx_parser::parse_xlsx_to_output(&exported).unwrap();
    let formula = reloaded.sheets[0]
        .cells
        .iter()
        .find(|cell| cell.row == 0 && cell.col == 1)
        .unwrap();
    assert_error(formula.value.clone(), CellError::Div0);
    assert_eq!(formula.vm, None);
    assert_eq!(formula.imported_rich_error, None);

    // Explicit replacement with the same error must discard its old provenance.
    engine
        .set_cell_value_parsed(&sheet, 0, 0, "#SPILL!")
        .unwrap();
    let (reloaded, _) =
        xlsx_parser::parse_xlsx_to_output(&engine.export_to_xlsx_bytes().unwrap()).unwrap();
    let edited = reloaded.sheets[0]
        .cells
        .iter()
        .find(|cell| cell.row == 0 && cell.col == 0)
        .unwrap();
    assert_error(edited.value.clone(), CellError::Spill);
    assert_eq!(edited.vm, None);
    assert_eq!(edited.imported_rich_error, None);
}

#[test]
fn rich_error_values_missing_spill_offsets_preserve_identity_and_raw_details() {
    let bytes = rich_error_workbook(false);
    let (original, _) = xlsx_parser::parse_xlsx_to_output(&bytes).unwrap();
    let original_rich = original.metadata.unwrap().rich_data.unwrap();
    let (mut engine, _) = YrsComputeEngine::from_xlsx_bytes(&bytes).unwrap();
    let sheet = engine.stores.storage.sheet_order()[0];
    assert_error(cell_value_at(&engine, &sheet, 0, 0), CellError::Spill);
    engine.recalculate().unwrap();
    assert_error(cell_value_at(&engine, &sheet, 0, 0), CellError::Spill);
    let (reloaded, _) =
        xlsx_parser::parse_xlsx_to_output(&engine.export_to_xlsx_bytes().unwrap()).unwrap();
    let cell = reloaded.sheets[0]
        .cells
        .iter()
        .find(|cell| cell.row == 0 && cell.col == 0)
        .unwrap();
    assert_error(cell.value.clone(), CellError::Spill);
    assert_eq!(cell.imported_rich_error.unwrap().fallback, CellError::Value);
    assert_eq!(reloaded.metadata.unwrap().rich_data.unwrap(), original_rich);
}
