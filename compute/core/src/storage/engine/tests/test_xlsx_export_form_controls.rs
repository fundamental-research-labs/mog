use cell_types::{SheetId, SheetPos};
use domain_types::{
    ParseOutput, SheetData,
    domain::floating_object::{
        AnchorMode, FloatingObject, FloatingObjectAnchor, FloatingObjectCommon, FloatingObjectData,
        FormControlData, FormControlOoxmlProps, FormControlWorksheetControlPr,
    },
};
use value_types::CellValue;

use super::helpers::{archive_text, engine_from_parse_output_normal};

#[test]
fn imported_form_control_refs_hydrate_to_identity_and_export_as_a1() {
    let output = ParseOutput {
        sheets: vec![SheetData {
            name: "Controls".to_string(),
            rows: 4,
            cols: 4,
            cells: vec![
                domain_types::CellData {
                    row: 0,
                    col: 0,
                    value: CellValue::Boolean(true),
                    ..Default::default()
                },
                domain_types::CellData {
                    row: 0,
                    col: 3,
                    value: CellValue::from("Alpha"),
                    ..Default::default()
                },
                domain_types::CellData {
                    row: 1,
                    col: 3,
                    value: CellValue::from("Beta"),
                    ..Default::default()
                },
                domain_types::CellData {
                    row: 2,
                    col: 3,
                    value: CellValue::from("Gamma"),
                    ..Default::default()
                },
            ],
            floating_objects: vec![FloatingObject {
                common: FloatingObjectCommon {
                    id: "fobj-fc-1".to_string(),
                    sheet_id: "sheet-before-hydration".to_string(),
                    anchor: FloatingObjectAnchor {
                        anchor_mode: AnchorMode::OneCell,
                        anchor_row: 1,
                        anchor_col: 1,
                        ..Default::default()
                    },
                    width: 100.0,
                    height: 30.0,
                    name: "Imported check".to_string(),
                    ..Default::default()
                },
                data: FloatingObjectData::FormControl(FormControlData {
                    control_type: "CheckBox".to_string(),
                    cell_link: Some("$A$1".to_string()),
                    input_range: Some("$D$1:$D$3".to_string()),
                    ooxml: Some(FormControlOoxmlProps {
                        control_pr: Some(FormControlWorksheetControlPr {
                            linked_cell: Some("$A$1".to_string()),
                            list_fill_range: Some("$D$1:$D$3".to_string()),
                            ..Default::default()
                        }),
                        ..Default::default()
                    }),
                }),
            }],
            ..Default::default()
        }],
        ..Default::default()
    };

    let engine = engine_from_parse_output_normal(&output);
    let sheet_id_after_hydration =
        SheetId::from_uuid_str(&engine.get_all_sheet_ids()[0]).expect("valid hydrated sheet id");
    let stored_objects = engine.get_all_floating_objects_typed(&sheet_id_after_hydration);
    let stored_control = match &stored_objects[0].data {
        FloatingObjectData::FormControl(control) => control,
        other => panic!("expected form control, got {other:?}"),
    };
    let stored_link = stored_control.cell_link.as_deref().unwrap();
    assert_ne!(stored_link, "$A$1");
    assert!(compute_document::hex::hex_to_id(stored_link).is_some());
    let stored_range: serde_json::Value =
        serde_json::from_str(stored_control.input_range.as_deref().unwrap())
            .expect("stored input range should be identity JSON");
    assert_eq!(stored_range["type"], "range");
    assert!(compute_document::hex::hex_to_id(stored_range["startId"].as_str().unwrap()).is_some());
    assert!(compute_document::hex::hex_to_id(stored_range["endId"].as_str().unwrap()).is_some());

    let exported = engine.export_to_parse_output().unwrap().parse_output;
    let exported_control = match &exported.sheets[0].floating_objects[0].data {
        FloatingObjectData::FormControl(control) => control,
        other => panic!("expected form control, got {other:?}"),
    };
    assert_eq!(exported_control.cell_link.as_deref(), Some("$A$1"));
    assert_eq!(exported_control.input_range.as_deref(), Some("$D$1:$D$3"));
    let control_pr = exported_control
        .ooxml
        .as_ref()
        .and_then(|props| props.control_pr.as_ref())
        .expect("controlPr should be preserved");
    assert_eq!(control_pr.linked_cell.as_deref(), Some("$A$1"));
    assert_eq!(control_pr.list_fill_range.as_deref(), Some("$D$1:$D$3"));
}

#[test]
fn sdk_authored_form_controls_export_identity_refs_as_xlsx_refs() {
    let input = ParseOutput {
        sheets: vec![SheetData {
            name: "Controls".to_string(),
            rows: 4,
            cols: 4,
            cells: vec![
                domain_types::CellData {
                    row: 0,
                    col: 0,
                    value: CellValue::Boolean(true),
                    ..Default::default()
                },
                domain_types::CellData {
                    row: 0,
                    col: 1,
                    value: CellValue::from("Beta"),
                    ..Default::default()
                },
                domain_types::CellData {
                    row: 0,
                    col: 3,
                    value: CellValue::from("Alpha"),
                    ..Default::default()
                },
                domain_types::CellData {
                    row: 1,
                    col: 3,
                    value: CellValue::from("Beta"),
                    ..Default::default()
                },
                domain_types::CellData {
                    row: 2,
                    col: 3,
                    value: CellValue::from("Gamma"),
                    ..Default::default()
                },
            ],
            ..Default::default()
        }],
        ..Default::default()
    };
    let mut engine = engine_from_parse_output_normal(&input);
    let sheet_id_after_hydration =
        SheetId::from_uuid_str(&engine.get_all_sheet_ids()[0]).expect("valid hydrated sheet id");
    let cell_id_hex = |row, col| {
        let cell_id = engine
            .mirror()
            .resolve_cell_id(&sheet_id_after_hydration, SheetPos::new(row, col))
            .expect("cell id should exist");
        compute_document::hex::id_to_hex(cell_id.as_u128()).to_string()
    };
    let a1 = cell_id_hex(0, 0);
    let b1 = cell_id_hex(0, 1);
    let d1 = cell_id_hex(0, 3);
    let d3 = cell_id_hex(2, 3);

    engine
        .create_floating_object(
            &sheet_id_after_hydration,
            &serde_json::json!({
                "type": "formControl",
                "controlType": "checkbox",
                "cellLink": a1,
                "anchor": {
                    "anchorRow": 1,
                    "anchorCol": 1,
                    "anchorMode": "oneCell",
                    "extentCxEmu": 152400,
                    "extentCyEmu": 152400
                },
                "width": 16.0,
                "height": 16.0,
                "name": "Enabled"
            }),
        )
        .expect("checkbox create should succeed");
    engine
        .create_floating_object(
            &sheet_id_after_hydration,
            &serde_json::json!({
                "type": "formControl",
                "controlType": "comboBox",
                "cellLink": b1,
                "inputRange": serde_json::json!({
                    "type": "range",
                    "startId": d1,
                    "endId": d3,
                    "startRowAbsolute": true,
                    "startColAbsolute": true,
                    "endRowAbsolute": true,
                    "endColAbsolute": true
                }).to_string(),
                "ooxml": {
                    "items": ["Alpha", "Beta", "Gamma"]
                },
                "anchor": {
                    "anchorRow": 1,
                    "anchorCol": 2,
                    "anchorMode": "oneCell",
                    "extentCxEmu": 914400,
                    "extentCyEmu": 190500
                },
                "width": 96.0,
                "height": 20.0,
                "name": "Choice"
            }),
        )
        .expect("combo box create should succeed");

    let exported_bytes = engine.export_to_xlsx_bytes().expect("export xlsx bytes");
    let reparsed = xlsx_api::parse(&exported_bytes)
        .expect("exported XLSX should parse")
        .output;
    let controls: Vec<_> = reparsed.sheets[0]
        .floating_objects
        .iter()
        .filter_map(|object| match &object.data {
            FloatingObjectData::FormControl(control) => Some(control),
            _ => None,
        })
        .collect();
    assert!(controls.iter().any(|control| {
        control.control_type == "CheckBox"
            && control.cell_link.as_deref() == Some("$A$1")
            && control
                .ooxml
                .as_ref()
                .and_then(|props| props.checked.as_deref())
                == Some("Checked")
    }));
    assert!(controls.iter().any(|control| {
        control.control_type == "ComboBox"
            && control.cell_link.as_deref() == Some("$B$1")
            && control.input_range.as_deref() == Some("$D$1:$D$3")
    }));

    let vml_xml =
        archive_text(&exported_bytes, "xl/drawings/vmlDrawing1.vml").expect("VML should exist");
    assert!(vml_xml.contains("<x:FmlaLink>$A$1</x:FmlaLink>"));
    assert!(vml_xml.contains("<x:Checked>1</x:Checked>"));
    assert!(vml_xml.contains("<x:FmlaLink>$B$1</x:FmlaLink>"));
    assert!(vml_xml.contains("<x:FmlaRange>$D$1:$D$3</x:FmlaRange>"));
}
