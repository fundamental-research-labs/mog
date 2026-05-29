//! Tests for resolved types and their accessor methods.
//!
//! These tests construct `ResolvedPivotConfig` via `validate_and_resolve()`,
//! then exercise every accessor on the resolved types to ensure coverage.

use crate::engine::validate_and_resolve;
use crate::resolved::*;
use crate::types::*;
use value_types::CellValue;

// ============================================================================
// Helpers
// ============================================================================

/// Build a minimal valid config with one row field, one value field.
fn make_basic_config() -> PivotTableConfig {
    PivotTableConfig {
        schema_version: PIVOT_CONFIG_SCHEMA_VERSION,
        id: "pivot1".to_string(),
        name: "Test Pivot".to_string(),
        source_sheet_id: None,
        source_sheet_name: "Sheet1".to_string(),
        source_range: CellRange::new(0, 0, 10, 2),
        output_sheet_name: "PivotSheet".to_string(),
        output_location: OutputLocation { row: 0, col: 0 },
        fields: vec![
            PivotField {
                id: FieldId::from("region"),
                name: "Region".to_string(),
                source_column: 0,
                data_type: DetectedDataType::String,
                ..Default::default()
            },
            PivotField {
                id: FieldId::from("product"),
                name: "Product".to_string(),
                source_column: 1,
                data_type: DetectedDataType::String,
                ..Default::default()
            },
            PivotField {
                id: FieldId::from("sales"),
                name: "Sales".to_string(),
                source_column: 2,
                data_type: DetectedDataType::Number,
                ..Default::default()
            },
        ],
        placements: vec![
            PivotFieldPlacement::Row(AxisPlacement {
                base: PlacementBase {
                    field_id: FieldId::from("region"),
                    placement_id: crate::types::PlacementId::default(),
                    position: 0,
                    display_name: Some("Region Label".to_string()),
                },
                sort_order: Some(SortDirection::Desc),
                custom_sort_list: Some(vec![
                    CellValue::Text("East".into()),
                    CellValue::Text("West".into()),
                ]),
                sort_by_value: None,
                date_grouping: Some(DateGrouping::Month),
                number_grouping: None,
                show_subtotals: Some(true),
            }),
            PivotFieldPlacement::Column(AxisPlacement {
                base: PlacementBase {
                    field_id: FieldId::from("product"),
                    placement_id: crate::types::PlacementId::default(),
                    position: 0,
                    display_name: Some("Prod".to_string()),
                },
                sort_order: Some(SortDirection::Asc),
                custom_sort_list: None,
                sort_by_value: None,
                date_grouping: None,
                number_grouping: Some(NumberGrouping::new(0.0, 100.0, 10.0)),
                show_subtotals: Some(false),
            }),
            PivotFieldPlacement::Value(ValuePlacement {
                base: PlacementBase {
                    field_id: FieldId::from("sales"),
                    placement_id: crate::types::PlacementId::default(),
                    position: 0,
                    display_name: Some("Total Sales".to_string()),
                },
                source: crate::types::PivotValueSource::Field {
                    field_id: crate::types::FieldId::default(),
                },
                aggregate_function: AggregateFunction::Sum,
                number_format: Some("#,##0.00".to_string()),
                show_values_as: Some(ShowValuesAsConfig {
                    calculation_type: ShowValuesAs::PercentOfGrandTotal,
                    base_field: None,
                    base_item: None,
                }),
            }),
            PivotFieldPlacement::Filter(FilterPlacement {
                base: PlacementBase {
                    field_id: FieldId::from("region"),
                    placement_id: crate::types::PlacementId::default(),
                    position: 0,
                    display_name: Some("Filter Region".to_string()),
                },
            }),
        ],
        filters: vec![],
        layout: Some(PivotTableLayout {
            show_row_grand_totals: Some(false),
            show_column_grand_totals: Some(false),
            layout_form: Some(LayoutForm::Tabular),
            subtotal_location: Some(SubtotalLocation::Top),
            repeat_row_labels: Some(true),
            ..Default::default()
        }),
        style: None,
        data_options: None,
        created_at: None,
        updated_at: None,
        calculated_fields: None,
        allow_multiple_filters_per_field: None,
        auto_format: None,
        preserve_formatting: None,
        data_on_rows: None,
        cache_id: None,
        ref_range: None,
        first_data_row: None,
        first_header_row: None,
        first_data_col: None,
        rows_per_page: None,
        cols_per_page: None,
        row_items: Vec::new(),
        col_items: Vec::new(),
    }
}

// ============================================================================
// ResolvedPivotConfig accessor tests
// ============================================================================

#[test]
fn resolved_config_all_accessors() {
    let config = make_basic_config();
    let resolved = validate_and_resolve(&config).expect("valid config");

    // Top-level accessors
    assert_eq!(resolved.id(), "pivot1");
    assert_eq!(resolved.source_sheet_name(), "Sheet1");
    assert_eq!(resolved.source_range().start_row(), 0);
    assert_eq!(resolved.source_range().start_col(), 0);
    assert_eq!(resolved.source_range().end_row(), 10);
    assert_eq!(resolved.source_range().end_col(), 2);
    assert_eq!(resolved.output_sheet_name(), "PivotSheet");
    assert_eq!(resolved.output_location().row, 0);
    assert_eq!(resolved.output_location().col, 0);

    // Fields
    assert_eq!(resolved.fields().len(), 3);
    assert_eq!(resolved.fields()[0].id, FieldId::from("region"));
    assert_eq!(resolved.fields()[1].id, FieldId::from("product"));
    assert_eq!(resolved.fields()[2].id, FieldId::from("sales"));

    // Placements
    assert_eq!(resolved.row_placements().len(), 1);
    assert_eq!(resolved.column_placements().len(), 1);
    assert_eq!(resolved.value_placements().len(), 1);
    assert_eq!(resolved.filter_placements().len(), 1);

    // Filters (empty in basic config)
    assert!(resolved.filters().is_empty());

    // Calculated fields (empty in basic config)
    assert!(resolved.calculated_fields().is_empty());
}

// ============================================================================
// ResolvedAxisPlacement accessor tests
// ============================================================================

#[test]
fn resolved_axis_placement_row_all_accessors() {
    let config = make_basic_config();
    let resolved = validate_and_resolve(&config).expect("valid config");
    let row = &resolved.row_placements()[0];

    assert_eq!(row.field_id(), &FieldId::from("region"));
    assert_eq!(row.column_index(), 0); // source_column 0
    assert_eq!(row.position(), 0);
    assert_eq!(row.display_name(), Some("Region Label"));
    assert_eq!(row.sort_order(), SortDirection::Desc);

    // custom_sort_list
    let csl = row
        .custom_sort_list()
        .expect("should have custom sort list");
    assert_eq!(csl.len(), 2);
    assert_eq!(csl[0], CellValue::Text("East".into()));
    assert_eq!(csl[1], CellValue::Text("West".into()));

    // sort_by_value is None in this config
    assert!(row.sort_by_value().is_none());

    // date_grouping
    assert_eq!(row.date_grouping(), Some(DateGrouping::Month));

    // number_grouping is None for the row
    assert!(row.number_grouping().is_none());

    // show_subtotals
    assert!(row.show_subtotals());
}

#[test]
fn resolved_axis_placement_column_all_accessors() {
    let config = make_basic_config();
    let resolved = validate_and_resolve(&config).expect("valid config");
    let col = &resolved.column_placements()[0];

    assert_eq!(col.field_id(), &FieldId::from("product"));
    assert_eq!(col.column_index(), 1); // source_column 1
    assert_eq!(col.position(), 0);
    assert_eq!(col.display_name(), Some("Prod"));
    assert_eq!(col.sort_order(), SortDirection::Asc);
    assert!(col.custom_sort_list().is_none());
    assert!(col.sort_by_value().is_none());
    assert!(col.date_grouping().is_none());

    // number_grouping
    let ng = col.number_grouping().expect("should have number grouping");
    assert!((ng.start - 0.0).abs() < f64::EPSILON);
    assert!((ng.end - 100.0).abs() < f64::EPSILON);
    assert!((ng.interval - 10.0).abs() < f64::EPSILON);

    // show_subtotals resolved to false
    assert!(!col.show_subtotals());
}

// ============================================================================
// ResolvedValuePlacement accessor tests
// ============================================================================

#[test]
fn resolved_value_placement_all_accessors() {
    let config = make_basic_config();
    let resolved = validate_and_resolve(&config).expect("valid config");
    let val = &resolved.value_placements()[0];

    assert_eq!(val.field_id(), &FieldId::from("sales"));
    assert_eq!(val.column_index(), 2); // source_column 2
    assert_eq!(val.position(), 0);
    assert_eq!(val.display_name(), Some("Total Sales"));
    assert_eq!(val.aggregate_function(), AggregateFunction::Sum);
    assert_eq!(val.number_format(), Some("#,##0.00"));

    let sva = val.show_values_as().expect("should have show_values_as");
    assert_eq!(sva.calculation_type, ShowValuesAs::PercentOfGrandTotal);
}

// ============================================================================
// ResolvedFilterPlacement accessor tests
// ============================================================================

#[test]
fn resolved_filter_placement_all_accessors() {
    let config = make_basic_config();
    let resolved = validate_and_resolve(&config).expect("valid config");
    let fp = &resolved.filter_placements()[0];

    assert_eq!(fp.field_id(), &FieldId::from("region"));
    assert_eq!(fp.column_index(), 0); // source_column 0
    assert_eq!(fp.position(), 0);
    assert_eq!(fp.display_name(), Some("Filter Region"));
}

// ============================================================================
// ResolvedLayout accessor tests
// ============================================================================

#[test]
fn resolved_layout_all_accessors() {
    let config = make_basic_config();
    let resolved = validate_and_resolve(&config).expect("valid config");
    let layout = resolved.layout();

    assert!(!layout.show_row_grand_totals());
    assert!(!layout.show_column_grand_totals());
    assert_eq!(*layout.layout_form(), LayoutForm::Tabular);
    assert!(layout.repeat_all_item_labels());
    assert!(!layout.show_empty_rows());
    assert!(!layout.show_empty_columns());
    assert!(layout.subtotal_at_top());
}

#[test]
fn resolved_layout_default_values() {
    let layout = ResolvedLayout::default();

    assert!(layout.show_row_grand_totals());
    assert!(layout.show_column_grand_totals());
    assert_eq!(*layout.layout_form(), LayoutForm::Compact);
    assert!(!layout.repeat_all_item_labels());
    assert!(!layout.show_empty_rows());
    assert!(!layout.show_empty_columns());
    assert!(!layout.subtotal_at_top());
}

#[test]
fn resolved_layout_default_when_none_in_config() {
    // Config with no layout => defaults
    let mut config = make_basic_config();
    config.layout = None;
    let resolved = validate_and_resolve(&config).expect("valid config");
    let layout = resolved.layout();

    assert!(layout.show_row_grand_totals());
    assert!(layout.show_column_grand_totals());
    assert_eq!(*layout.layout_form(), LayoutForm::Compact);
    assert!(!layout.repeat_all_item_labels());
    assert!(!layout.show_empty_rows());
    assert!(!layout.show_empty_columns());
    assert!(!layout.subtotal_at_top());
}

// ============================================================================
// ResolvedFilter accessor tests (with include/exclude/condition/top_bottom)
// ============================================================================

#[test]
fn resolved_filter_all_accessors() {
    let mut config = make_basic_config();
    config.filters = vec![PivotFilter {
        field_id: FieldId::from("region"),
        include_values: Some(vec![
            CellValue::Text("East".into()),
            CellValue::Text("West".into()),
        ]),
        exclude_values: Some(vec![CellValue::Text("North".into())]),
        condition: Some(PivotFilterConditionFlat {
            operator: FilterOperator::GreaterThan,
            value: Some(CellValue::number(10.0)),
            value2: None,
        }),
        top_bottom: Some(PivotTopBottomFilter {
            filter_type: TopBottomType::Top,
            n: 5.0,
            by: TopBottomBy::Items,
            value_field_id: Some(FieldId::from("sales")),
        }),
        show_items_with_no_data: Some(true),
    }];
    let resolved = validate_and_resolve(&config).expect("valid config");

    assert_eq!(resolved.filters().len(), 1);
    let f = &resolved.filters()[0];

    assert_eq!(f.field_id(), &FieldId::from("region"));
    assert_eq!(f.field_column_index(), 0);

    // include_values
    let inc = f.include_values().expect("should have include_values");
    assert_eq!(inc.len(), 2);
    assert_eq!(inc[0], CellValue::Text("East".into()));

    // exclude_values
    let exc = f.exclude_values().expect("should have exclude_values");
    assert_eq!(exc.len(), 1);
    assert_eq!(exc[0], CellValue::Text("North".into()));

    // condition
    let cond = f.condition().expect("should have condition");
    match cond {
        PivotFilterCondition::Unary { op, value } => {
            assert_eq!(*op, UnaryFilterOp::GreaterThan);
            assert_eq!(*value, CellValue::number(10.0));
        }
        _ => panic!("Expected Unary condition"),
    }

    // show_items_with_no_data
    assert!(f.show_items_with_no_data());
}

#[test]
fn resolved_filter_with_no_condition() {
    let mut config = make_basic_config();
    config.filters = vec![PivotFilter {
        field_id: FieldId::from("region"),
        include_values: None,
        exclude_values: None,
        condition: None,
        top_bottom: None,
        show_items_with_no_data: None,
    }];
    let resolved = validate_and_resolve(&config).expect("valid config");
    let f = &resolved.filters()[0];

    assert!(f.include_values().is_none());
    assert!(f.exclude_values().is_none());
    assert!(f.condition().is_none());
    assert!(f.top_bottom().is_none());
    assert!(f.show_items_with_no_data()); // defaults to true (matching Excel behavior)
}

// ============================================================================
// ResolvedTopBottom accessor tests
// ============================================================================

#[test]
fn resolved_top_bottom_all_accessors() {
    let mut config = make_basic_config();
    config.filters = vec![PivotFilter {
        field_id: FieldId::from("region"),
        include_values: None,
        exclude_values: None,
        condition: None,
        top_bottom: Some(PivotTopBottomFilter {
            filter_type: TopBottomType::Bottom,
            n: 10.0,
            by: TopBottomBy::Percent,
            value_field_id: Some(FieldId::from("sales")),
        }),
        show_items_with_no_data: None,
    }];
    let resolved = validate_and_resolve(&config).expect("valid config");
    let f = &resolved.filters()[0];
    let tb = f.top_bottom().expect("should have top_bottom");

    assert_eq!(tb.filter_type(), TopBottomType::Bottom);
    assert!((tb.n() - 10.0).abs() < f64::EPSILON);
    assert_eq!(tb.by(), TopBottomBy::Percent);
    // value_field_index should resolve to Some(0) since sales is value_placements[0]
    assert_eq!(tb.value_field_index(), Some(0));
}

#[test]
fn resolved_top_bottom_no_value_field_id() {
    let mut config = make_basic_config();
    config.filters = vec![PivotFilter {
        field_id: FieldId::from("region"),
        include_values: None,
        exclude_values: None,
        condition: None,
        top_bottom: Some(PivotTopBottomFilter {
            filter_type: TopBottomType::Top,
            n: 3.0,
            by: TopBottomBy::Items,
            value_field_id: None,
        }),
        show_items_with_no_data: None,
    }];
    let resolved = validate_and_resolve(&config).expect("valid config");
    let tb = resolved.filters()[0]
        .top_bottom()
        .expect("should have top_bottom");

    assert_eq!(tb.filter_type(), TopBottomType::Top);
    assert!((tb.n() - 3.0).abs() < f64::EPSILON);
    assert_eq!(tb.by(), TopBottomBy::Items);
    assert!(tb.value_field_index().is_none());
}

// ============================================================================
// ResolvedSortByValue accessor tests
// ============================================================================

#[test]
fn resolved_sort_by_value_all_accessors() {
    let mut config = make_basic_config();
    // Update the row placement to have sort_by_value
    config.placements[0] = PivotFieldPlacement::Row(AxisPlacement {
        base: PlacementBase {
            field_id: FieldId::from("region"),
            placement_id: crate::types::PlacementId::default(),
            position: 0,
            display_name: None,
        },
        sort_order: Some(SortDirection::Desc),
        custom_sort_list: None,
        sort_by_value: Some(SortByValueConfig {
            value_field_id: FieldId::from("sales"),
            order: SortDirection::Desc,
            column_key: Some("Widget".to_string()),
        }),
        date_grouping: None,
        number_grouping: None,
        show_subtotals: None,
    });
    let resolved = validate_and_resolve(&config).expect("valid config");
    let row = &resolved.row_placements()[0];
    let sbv = row.sort_by_value().expect("should have sort_by_value");

    assert_eq!(sbv.value_field_index(), 0);
    assert_eq!(sbv.order(), SortDirection::Desc);
    assert_eq!(sbv.column_key(), Some("Widget"));
}

#[test]
fn resolved_sort_by_value_no_column_key() {
    let mut config = make_basic_config();
    config.placements[0] = PivotFieldPlacement::Row(AxisPlacement {
        base: PlacementBase {
            field_id: FieldId::from("region"),
            placement_id: crate::types::PlacementId::default(),
            position: 0,
            display_name: None,
        },
        sort_order: Some(SortDirection::Asc),
        custom_sort_list: None,
        sort_by_value: Some(SortByValueConfig {
            value_field_id: FieldId::from("sales"),
            order: SortDirection::Asc,
            column_key: None,
        }),
        date_grouping: None,
        number_grouping: None,
        show_subtotals: None,
    });
    let resolved = validate_and_resolve(&config).expect("valid config");
    let sbv = resolved.row_placements()[0]
        .sort_by_value()
        .expect("should have sort_by_value");

    assert_eq!(sbv.value_field_index(), 0);
    assert_eq!(sbv.order(), SortDirection::Asc);
    assert!(sbv.column_key().is_none());
}

// ============================================================================
// ResolvedCalculatedField accessor tests
// ============================================================================

#[test]
fn resolved_calculated_field_all_accessors() {
    let mut config = make_basic_config();
    config.calculated_fields = Some(vec![CalculatedField {
        field_id: CalculatedFieldId::from("profit"),
        name: "Profit".to_string(),
        formula: "Sales * 0.3".to_string(),
    }]);

    let resolved = validate_and_resolve(&config).expect("valid config");

    assert_eq!(resolved.calculated_fields().len(), 1);
    let cf = &resolved.calculated_fields()[0];

    assert_eq!(cf.field_id(), &FieldId::from("profit"));
    assert_eq!(cf.name(), "Profit");
    assert_eq!(cf.formula(), "Sales * 0.3");
    // parsed_expr should be valid since the formula parses correctly
    let _expr = cf.parsed_expr(); // just ensure accessor works
}

// ============================================================================
// ResolvedValuePlacement with no optional fields
// ============================================================================

#[test]
fn resolved_value_placement_minimal() {
    let mut config = make_basic_config();
    // Replace value placement with minimal one (no display_name, no number_format, no show_values_as)
    config.placements[2] = PivotFieldPlacement::Value(ValuePlacement {
        base: PlacementBase {
            field_id: FieldId::from("sales"),
            placement_id: crate::types::PlacementId::default(),
            position: 0,
            display_name: None,
        },
        source: crate::types::PivotValueSource::Field {
            field_id: crate::types::FieldId::default(),
        },
        aggregate_function: AggregateFunction::Average,
        number_format: None,
        show_values_as: None,
    });
    let resolved = validate_and_resolve(&config).expect("valid config");
    let val = &resolved.value_placements()[0];

    assert!(val.display_name().is_none());
    assert_eq!(val.aggregate_function(), AggregateFunction::Average);
    assert!(val.number_format().is_none());
    assert!(val.show_values_as().is_none());
}

// ============================================================================
// ResolvedAxisPlacement with no optional fields (defaults)
// ============================================================================

#[test]
fn resolved_axis_placement_defaults() {
    let mut config = make_basic_config();
    // Replace row placement with minimal one
    config.placements[0] = PivotFieldPlacement::Row(AxisPlacement {
        base: PlacementBase {
            field_id: FieldId::from("region"),
            placement_id: crate::types::PlacementId::default(),
            position: 0,
            display_name: None,
        },
        sort_order: None,
        custom_sort_list: None,
        sort_by_value: None,
        date_grouping: None,
        number_grouping: None,
        show_subtotals: None,
    });
    let resolved = validate_and_resolve(&config).expect("valid config");
    let row = &resolved.row_placements()[0];

    assert!(row.display_name().is_none());
    assert_eq!(row.sort_order(), SortDirection::Asc); // default
    assert!(row.custom_sort_list().is_none());
    assert!(row.sort_by_value().is_none());
    assert!(row.date_grouping().is_none());
    assert!(row.number_grouping().is_none());
    assert!(!row.show_subtotals()); // default false
}
