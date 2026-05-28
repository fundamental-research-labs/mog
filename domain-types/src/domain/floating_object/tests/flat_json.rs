use std::collections::HashSet;

use crate::domain::floating_object::{FloatingObject, FloatingObjectData, ShapeData};

use super::helpers::{make_common, maximal_common, minimal_data_variants};

#[test]
fn test_flat_json_structure() {
    let obj = FloatingObject {
        common: make_common("shape-flat", "sheet-1"),
        data: FloatingObjectData::Shape(ShapeData {
            shape_type: "rect".to_string(),
            fill: None,
            outline: None,
            text: None,
            shadow: None,
            adjustments: None,
            scene_3d: None,
            sp_3d: None,
            ooxml: None,
        }),
    };
    let json = serde_json::to_value(&obj).unwrap();
    let map = json.as_object().unwrap();

    // Common fields at top level
    assert!(map.contains_key("id"));
    assert!(map.contains_key("sheetId"));
    assert!(map.contains_key("anchor"));
    assert!(map.contains_key("width"));
    assert!(map.contains_key("height"));
    assert!(map.contains_key("zIndex"));

    // Type tag at top level
    assert_eq!(map.get("type").unwrap(), "shape");

    // Data fields at top level
    assert!(map.contains_key("shapeType"));

    // No "common" or "data" wrapper keys
    assert!(!map.contains_key("common"));
    assert!(!map.contains_key("data"));
}

#[test]
fn test_field_name_uniqueness() {
    let common = maximal_common("test", "sheet");
    let common_val = serde_json::to_value(&common).unwrap();
    let common_keys: HashSet<String> = common_val.as_object().unwrap().keys().cloned().collect();

    for (variant_name, data) in minimal_data_variants() {
        let data_val = serde_json::to_value(&data).unwrap();
        let data_keys: HashSet<String> = data_val
            .as_object()
            .unwrap()
            .keys()
            .filter(|k| *k != "type")
            .cloned()
            .collect();
        let overlap: Vec<_> = common_keys.intersection(&data_keys).collect();
        assert!(
            overlap.is_empty(),
            "Overlapping keys between common and {variant_name}: {overlap:?}",
        );
    }
}
