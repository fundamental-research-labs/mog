use crate::domain::validation::{
    ColumnSchema, EnforcementLevel, IdentityRangeSchemaRef, RangeSchema, RangeSchemaDefinition,
    RangeSchemaUi, SchemaType,
};
use crate::yrs_schema::{cell_properties, column_schema};
use crate::{CellFormat, CellProperties, FontSize};

use super::support::roundtrip_map;

#[test]
fn cell_properties_hydrates_format_and_metadata_from_one_flat_map() {
    let original = CellProperties {
        format: Some(CellFormat {
            bold: Some(true),
            italic: Some(false),
            font_size: Some(FontSize::from_points(11.0)),
            font_color: Some("#FF0000".to_string()),
            background_color: Some("#FFFF00".to_string()),
            ..Default::default()
        }),
        provenance: Some("imported".to_string()),
        validation: Some("validation-1".to_string()),
        connection_id: Some("connection-1".to_string()),
        style_id: Some(5),
        cell_metadata_index: Some(1),
        vm: Some(7),
        formula_result_type: Some(2),
        has_empty_cached_value: true,
        original_sst_index: Some(9),
        original_value: Some("cached".to_string()),
        ..Default::default()
    };

    assert_eq!(
        original,
        roundtrip_map(cell_properties::to_yrs_prelim(&original), |map, txn| {
            cell_properties::from_yrs_map(map, txn)
        },)
    );
}

#[test]
fn column_and_range_schema_round_trip_through_real_yrs_maps() {
    let column = ColumnSchema {
        id: "column-1".to_string(),
        name: "Amount".to_string(),
        schema_type: SchemaType::Currency,
        constraints: None,
        distribution: None,
        description: Some("Imported amount column".to_string()),
    };
    assert_eq!(
        column,
        roundtrip_map(column_schema::column_to_yrs_prelim(&column), |map, txn| {
            column_schema::column_from_yrs_map(map, txn)
        },)
    );

    let range = RangeSchema {
        id: "range-1".to_string(),
        created_at: 1700000000,
        ranges: vec![IdentityRangeSchemaRef {
            start_id: "A1".to_string(),
            end_id: "A10".to_string(),
            sheet_id: Some("sheet-1".to_string()),
        }],
        schema: RangeSchemaDefinition {
            schema_type: Some(SchemaType::Number),
            constraints: None,
        },
        enforcement: Some(EnforcementLevel::Strict),
        ui: Some(RangeSchemaUi {
            show_dropdown: Some(false),
            error_message: None,
            input_message: None,
        }),
    };
    assert_eq!(
        range,
        roundtrip_map(column_schema::range_to_yrs_prelim(&range), |map, txn| {
            column_schema::range_from_yrs_map(map, txn)
        },)
    );
}
