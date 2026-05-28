use crate::domain::floating_object::{
    FloatingObject, FloatingObjectAnchor, FloatingObjectCommon, FloatingObjectData, ShapeData,
};
use crate::yrs_schema::floating_object;

use super::support::roundtrip_string_map_value;

#[test]
fn shape_envelope_round_trips_through_unified_floating_object_adapter() {
    let original = FloatingObject {
        common: FloatingObjectCommon {
            id: "shape-1".to_string(),
            sheet_id: "sheet-1".to_string(),
            anchor: FloatingObjectAnchor {
                anchor_row: 1,
                anchor_col: 2,
                extent_cx: Some(952500),
                extent_cy: Some(476250),
                ..Default::default()
            },
            width: 100.0,
            height: 50.0,
            z_index: 2,
            name: "Rectangle 1".to_string(),
            created_at: 1700000000,
            updated_at: 1700000001,
            ..Default::default()
        },
        data: FloatingObjectData::Shape(ShapeData {
            shape_type: "rect".to_string(),
            ..Default::default()
        }),
    };

    let restored =
        roundtrip_string_map_value(floating_object::to_yrs_prelim(&original), |map, txn| {
            floating_object::from_yrs_map(map, txn)
        })
        .expect("floating object should hydrate");

    assert_eq!(restored.common, original.common);
    assert_eq!(restored.data, original.data);
}
