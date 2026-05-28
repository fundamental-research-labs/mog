use super::*;
use yrs::ReadTxn;

pub(super) fn make_sheet_id(n: u128) -> SheetId {
    SheetId::from_raw(n)
}

pub(super) fn storage_with_sheet() -> (YrsStorage, SheetId, GridIndex) {
    let (storage, sid, gi, _mirror) = storage_with_sheet_and_mirror();
    (storage, sid, gi)
}

pub(super) fn storage_with_sheet_and_mirror()
-> (YrsStorage, SheetId, GridIndex, crate::mirror::CellMirror) {
    let mut storage = YrsStorage::new();
    let mut mirror = crate::mirror::CellMirror::new();
    let sid = make_sheet_id(1);
    storage
        .add_sheet(&mut mirror, sid, "Sheet1", 100, 26)
        .unwrap();
    let id_alloc = Arc::new(cell_types::IdAllocator::new());
    let gi = GridIndex::new(sid, 100, 26, id_alloc);
    (storage, sid, gi, mirror)
}

pub(super) fn empty_mirror() -> crate::mirror::CellMirror {
    crate::mirror::CellMirror::new()
}

pub(super) fn validation_rule_count(storage: &YrsStorage, sid: &SheetId) -> usize {
    get_range_schemas_for_sheet(storage.doc(), storage.sheets(), sid).len()
}

pub(super) fn make_range_schema(id: &str) -> RangeSchema {
    RangeSchema {
        id: id.to_string(),
        created_at: 1700000000,
        ranges: vec![IdentityRangeSchemaRef {
            start_id: "0:0".to_string(),
            end_id: "10:5".to_string(),
            sheet_id: None,
        }],
        schema: RangeSchemaDefinition {
            schema_type: Some(SchemaType::Number),
            constraints: Some(SchemaConstraints {
                min: Some(0.0),
                max: Some(100.0),
                ..Default::default()
            }),
        },
        enforcement: Some(EnforcementLevel::Strict),
        ui: Some(RangeSchemaUi {
            show_dropdown: None,
            error_message: Some(ErrorMessage {
                title: Some("Invalid".to_string()),
                message: Some("Must be 0-100".to_string()),
            }),
            input_message: Some(InputMessage {
                title: Some("Enter value".to_string()),
                message: Some("0 to 100".to_string()),
            }),
        }),
    }
}

pub(super) fn range_schema_at(id: &str, start: &str, end: &str) -> RangeSchema {
    RangeSchema {
        id: id.to_string(),
        created_at: 1700000000,
        ranges: vec![IdentityRangeSchemaRef {
            start_id: start.to_string(),
            end_id: end.to_string(),
            sheet_id: None,
        }],
        schema: RangeSchemaDefinition {
            schema_type: Some(SchemaType::Number),
            constraints: Some(SchemaConstraints {
                min: Some(0.0),
                max: Some(100.0),
                ..Default::default()
            }),
        },
        enforcement: Some(EnforcementLevel::Strict),
        ui: None,
    }
}

pub(super) fn sync_storage(src: &YrsStorage, dst: &YrsStorage) {
    use yrs::updates::decoder::Decode;
    let sv = dst.doc().transact().state_vector();
    let update = src.doc().transact().encode_diff_v1(&sv);
    let decoded = yrs::Update::decode_v1(&update).expect("decode update");
    dst.doc()
        .transact_mut()
        .apply_update(decoded)
        .expect("apply update");
}

pub(super) fn clone_storage(src: &YrsStorage) -> YrsStorage {
    use yrs::updates::decoder::Decode;
    let update = src
        .doc()
        .transact()
        .encode_diff_v1(&yrs::StateVector::default());
    let decoded = yrs::Update::decode_v1(&update).expect("decode update");
    let storage2 = YrsStorage::new();
    storage2
        .doc()
        .transact_mut()
        .apply_update(decoded)
        .expect("apply update");
    storage2
}

pub(super) fn view_ids(storage: &YrsStorage, sid: &SheetId) -> Vec<String> {
    get_range_schemas_for_sheet(storage.doc(), storage.sheets(), sid)
        .into_iter()
        .map(|r| r.id)
        .collect()
}

pub(super) fn make_custom_formula_range_schema(
    id: &str,
    formula: &str,
    ranges: Vec<IdentityRangeSchemaRef>,
) -> RangeSchema {
    RangeSchema {
        id: id.to_string(),
        created_at: 1700000000,
        ranges,
        schema: RangeSchemaDefinition {
            schema_type: Some(SchemaType::Any),
            constraints: Some(SchemaConstraints {
                formula: Some(formula.to_string()),
                ..Default::default()
            }),
        },
        enforcement: Some(EnforcementLevel::Strict),
        ui: None,
    }
}
