//! Drawing identity ownership across native edits, copy, and export.
use super::helpers::engine_from_parse_output_normal;
use cell_types::{CellId, SheetPos};
use domain_types::domain::floating_object::FloatingObjectData;
use domain_types::{ParseOutput, SheetData};
use formula_types::StructureChange;

fn reference_id(text: &str) -> CellId {
    compute_document::hex::hex_to_id(text)
        .map(CellId::from_raw)
        .unwrap_or_else(|| CellId::from_uuid_str(text).unwrap())
}

#[test]
fn copied_native_drawings_remap_groups_connectors_and_control_cells() {
    let mut engine = engine_from_parse_output_normal(&ParseOutput {
        sheets: vec![SheetData {
            name: "Drawings".into(),
            rows: 5,
            cols: 5,
            ..Default::default()
        }],
        ..Default::default()
    });
    let source = engine.storage().sheet_order()[0];
    engine
        .set_floating_object(
            &source,
            "shape",
            serde_json::json!({
                "type":"shape", "shapeType":"rect", "anchorRow":1,"anchorCol":2,
                "width":50,"height":60,"groupId":"group", "name":"Original",
                "fill":{"type":"solid","color":"#123456"}
            }),
        )
        .unwrap();
    let anchor = engine
        .get_floating_object(&source, "shape")
        .unwrap()
        .unwrap()["anchorCellId"]
        .as_str()
        .unwrap()
        .to_owned();
    engine.set_floating_object(&source, "connector", serde_json::json!({
        "type":"connector","shapeType":"line","startConnection":{"shapeId":"shape","siteIndex":3},
        "anchorRow":1,"anchorCol":2,"groupId":"group"
    })).unwrap();
    engine.set_floating_object(&source, "control", serde_json::json!({
        "type":"formControl","controlType":"checkbox","cellLink":anchor,"anchorRow":2,"anchorCol":2
    })).unwrap();
    engine.set_floating_object_group(&source, "group", serde_json::json!({"id":"group","sheetId":source.to_uuid_string(),"children":["shape","connector"],"name":"Pair"})).unwrap();
    engine.copy_sheet(&source, "Copied").unwrap();
    let copy = engine.cell_store().sheet_by_name("Copied").unwrap();
    let objects = engine.get_all_floating_objects_typed(&copy);
    assert_eq!(objects.len(), 3);
    let shape = objects
        .iter()
        .find(|object| object.common.name == "Original")
        .unwrap();
    assert_ne!(shape.common.id, "shape");
    assert_eq!(shape.common.sheet_id, copy.to_uuid_string());
    let source_anchor = reference_id(&anchor);
    let copied_anchor = reference_id(shape.common.anchor_cell_id.as_deref().unwrap());
    assert_ne!(source_anchor, copied_anchor);
    assert_eq!(
        engine.cell_store().sheet_for_cell(&copied_anchor),
        Some(copy)
    );
    assert_eq!(
        engine
            .cell_store()
            .get_sheet(&copy)
            .unwrap()
            .position_of(&copied_anchor),
        Some(SheetPos::new(1, 2))
    );
    let connector = objects
        .iter()
        .find_map(|object| {
            if let FloatingObjectData::Connector(data) = &object.data {
                Some(data)
            } else {
                None
            }
        })
        .unwrap();
    assert_eq!(
        connector.start_connection.as_ref().unwrap().shape_id,
        shape.common.id
    );
    let control = objects
        .iter()
        .find_map(|object| {
            if let FloatingObjectData::FormControl(data) = &object.data {
                Some(data)
            } else {
                None
            }
        })
        .unwrap();
    assert_eq!(
        reference_id(control.cell_link.as_deref().unwrap()),
        copied_anchor
    );
    let groups = engine.get_all_floating_object_groups_typed(&copy);
    assert_eq!(groups.len(), 1);
    assert_ne!(groups[0].id, "group");
    assert_eq!(
        shape.common.group_id.as_deref(),
        Some(groups[0].id.as_str())
    );
    assert!(groups[0].children.contains(&shape.common.id));
    engine
        .update_floating_object(&copy, &shape.common.id, &serde_json::json!({"width":200}))
        .unwrap();
    assert_eq!(
        engine
            .get_floating_object(&source, "shape")
            .unwrap()
            .unwrap()["width"],
        50.0
    );
}

#[test]
fn drawing_anchor_growth_is_sparse_and_structural_export_projects_current_position() {
    let mut engine = engine_from_parse_output_normal(&ParseOutput {
        sheets: vec![SheetData {
            name: "Drawings".into(),
            rows: 5,
            cols: 5,
            ..Default::default()
        }],
        ..Default::default()
    });
    let sheet = engine.storage().sheet_order()[0];
    engine.set_floating_object(&sheet, "far", serde_json::json!({"type":"shape","shapeType":"rect","anchorRow":100_000,"anchorCol":2,"width":20,"height":30})).unwrap();
    let sheet_store = engine.cell_store().get_sheet(&sheet).unwrap();
    assert_eq!(engine.cell_store().iter_sheet_cells(&sheet).count(), 0);
    assert_eq!(sheet_store.cells().count(), 1);
    assert!(std::sync::Arc::ptr_eq(
        &sheet_store.row_axis,
        &engine.stores.grid_indexes[&sheet].row_axis()
    ));
    engine
        .structure_change(
            &sheet,
            &StructureChange::InsertRows {
                at: 0,
                count: 2,
                new_row_ids: Vec::new(),
            },
        )
        .unwrap();
    let exported = engine.export_to_parse_output().unwrap().parse_output;
    assert_eq!(
        exported.sheets[0].floating_objects[0]
            .common
            .anchor
            .anchor_row,
        100_002
    );
    engine
        .structure_change(
            &sheet,
            &StructureChange::DeleteRows {
                at: 100_002,
                count: 1,
                deleted_cell_ids: Vec::new(),
            },
        )
        .unwrap();
    let object =
        &engine.export_to_parse_output().unwrap().parse_output.sheets[0].floating_objects[0];
    assert_eq!(object.common.anchor.anchor_row, 100_001);
    assert_eq!(
        engine
            .cell_store()
            .iter_sheet_cells(&sheet)
            .count(),
        0
    );
}

#[test]
fn imported_blank_drawing_anchor_has_one_identity_and_no_value_overlay() {
    let output = ParseOutput {
        sheets: vec![SheetData {
            name: "Anchor".into(), rows:3, cols:3,
            cells: vec![domain_types::CellData { row:1,col:2,..Default::default() }],
            floating_objects: vec![serde_json::from_value(serde_json::json!({
                "id":"fobj-1","type":"shape","shapeType":"rect","anchor":{"anchorRow":1,"anchorCol":2},"width":10,"height":10
            })).unwrap()],
            ..Default::default()
        }], ..Default::default()
    };
    let engine = engine_from_parse_output_normal(&output);
    let sheet_id = engine.storage().sheet_order()[0];
    let object = &engine.get_all_floating_objects_typed(&sheet_id)[0];
    let anchor = reference_id(object.common.anchor_cell_id.as_deref().unwrap());
    let sheet = engine.cell_store().get_sheet(&sheet_id).unwrap();
    assert_eq!(sheet.position_of(&anchor), Some(SheetPos::new(1, 2)));
    assert_eq!(sheet.cells().count(), 1);
    assert_eq!(engine.cell_store().iter_sheet_cells(&sheet_id).count(), 0);
}
