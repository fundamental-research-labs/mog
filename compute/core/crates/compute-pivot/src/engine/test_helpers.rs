//! Test helpers for pivot engine tests.

use value_types::CellValue;

use crate::types::*;

/// Default expansion state for tests: all items expanded.
///
/// `None` also means "expand all" (matching Excel's default behavior).
/// This helper exists for explicitness in tests.
pub(super) fn expand_all() -> PivotExpansionState {
    PivotExpansionState::default()
}

pub(super) fn cv_text(s: &str) -> CellValue {
    CellValue::Text(s.into())
}

pub(super) fn cv_num(n: f64) -> CellValue {
    CellValue::number(n)
}

pub(super) fn cv_bool(b: bool) -> CellValue {
    CellValue::Boolean(b)
}

pub(super) fn sample_sales_data() -> Vec<Vec<CellValue>> {
    vec![
        vec![
            cv_text("Region"),
            cv_text("Product"),
            cv_text("Quarter"),
            cv_text("Sales"),
            cv_text("Units"),
        ],
        vec![
            cv_text("East"),
            cv_text("Widget"),
            cv_text("Q1"),
            cv_num(1000.0),
            cv_num(10.0),
        ],
        vec![
            cv_text("East"),
            cv_text("Widget"),
            cv_text("Q2"),
            cv_num(1200.0),
            cv_num(12.0),
        ],
        vec![
            cv_text("East"),
            cv_text("Gadget"),
            cv_text("Q1"),
            cv_num(800.0),
            cv_num(8.0),
        ],
        vec![
            cv_text("East"),
            cv_text("Gadget"),
            cv_text("Q2"),
            cv_num(900.0),
            cv_num(9.0),
        ],
        vec![
            cv_text("West"),
            cv_text("Widget"),
            cv_text("Q1"),
            cv_num(1500.0),
            cv_num(15.0),
        ],
        vec![
            cv_text("West"),
            cv_text("Widget"),
            cv_text("Q2"),
            cv_num(1800.0),
            cv_num(18.0),
        ],
        vec![
            cv_text("West"),
            cv_text("Gadget"),
            cv_text("Q1"),
            cv_num(700.0),
            cv_num(7.0),
        ],
        vec![
            cv_text("West"),
            cv_text("Gadget"),
            cv_text("Q2"),
            cv_num(600.0),
            cv_num(6.0),
        ],
    ]
}

pub(super) fn sample_fields() -> Vec<PivotField> {
    vec![
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
            id: FieldId::from("quarter"),
            name: "Quarter".to_string(),
            source_column: 2,
            data_type: DetectedDataType::String,
            ..Default::default()
        },
        PivotField {
            id: FieldId::from("sales"),
            name: "Sales".to_string(),
            source_column: 3,
            data_type: DetectedDataType::Number,
            ..Default::default()
        },
        PivotField {
            id: FieldId::from("units"),
            name: "Units".to_string(),
            source_column: 4,
            data_type: DetectedDataType::Number,
            ..Default::default()
        },
    ]
}

pub(super) fn make_base_config(
    fields: Vec<PivotField>,
    placements: Vec<PivotFieldPlacement>,
    filters: Vec<PivotFilter>,
) -> PivotTableConfig {
    PivotTableConfig {
        schema_version: PIVOT_CONFIG_SCHEMA_VERSION,
        id: "pivot1".to_string(),
        name: "Test Pivot".to_string(),
        source_sheet_id: None,
        source_sheet_name: "sheet1".to_string(),
        source_range: CellRange::new(0, 0, 8, 4),
        output_sheet_name: "sheet1".to_string(),
        output_location: OutputLocation { row: 0, col: 0 },
        fields,
        placements,
        filters,
        layout: None,
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

pub(super) fn make_placement(
    field_id: &str,
    area: PivotFieldArea,
    position: usize,
    aggregate_function: Option<AggregateFunction>,
) -> PivotFieldPlacement {
    let fid = FieldId::from(field_id);
    match area {
        PivotFieldArea::Row => PivotFieldPlacement::Row(AxisPlacement {
            base: PlacementBase {
                field_id: fid,
                placement_id: crate::types::PlacementId::default(),
                position,
                display_name: None,
            },
            sort_order: None,
            custom_sort_list: None,
            sort_by_value: None,
            date_grouping: None,
            number_grouping: None,
            show_subtotals: None,
        }),
        PivotFieldArea::Column => PivotFieldPlacement::Column(AxisPlacement {
            base: PlacementBase {
                field_id: fid,
                placement_id: crate::types::PlacementId::default(),
                position,
                display_name: None,
            },
            sort_order: None,
            custom_sort_list: None,
            sort_by_value: None,
            date_grouping: None,
            number_grouping: None,
            show_subtotals: None,
        }),
        PivotFieldArea::Value => PivotFieldPlacement::Value(ValuePlacement {
            base: PlacementBase {
                field_id: fid,
                placement_id: crate::types::PlacementId::default(),
                position,
                display_name: None,
            },
            source: crate::types::PivotValueSource::Field {
                field_id: crate::types::FieldId::default(),
            },
            aggregate_function: aggregate_function.unwrap_or(AggregateFunction::Sum),
            number_format: None,
            show_values_as: None,
        }),
        PivotFieldArea::Filter => PivotFieldPlacement::Filter(FilterPlacement {
            base: PlacementBase {
                field_id: fid,
                placement_id: crate::types::PlacementId::default(),
                position,
                display_name: None,
            },
        }),
        _ => PivotFieldPlacement::Row(AxisPlacement {
            base: PlacementBase {
                field_id: fid,
                placement_id: crate::types::PlacementId::default(),
                position,
                display_name: None,
            },
            sort_order: None,
            custom_sort_list: None,
            sort_by_value: None,
            date_grouping: None,
            number_grouping: None,
            show_subtotals: None,
        }),
    }
}

pub(super) fn make_row_axis(field_id: &str, position: usize) -> AxisPlacement {
    AxisPlacement {
        base: PlacementBase {
            field_id: FieldId::from(field_id),
            placement_id: crate::types::PlacementId::default(),
            position,
            display_name: None,
        },
        sort_order: None,
        custom_sort_list: None,
        sort_by_value: None,
        date_grouping: None,
        number_grouping: None,
        show_subtotals: None,
    }
}

/// Build a PivotTableConfig from field specs, placement specs, and filters.
///
/// `fields_spec`: slice of (name, source_col, data_type)
/// `row_field_names`: names used for row placements (matched against fields_spec name)
/// `column_field_names`: names used for column placements
/// `value_fields`: slice of (name, AggregateFunction)
/// `filters`: pre-built filters
/// `data`: the source data (for computing source_range)
pub(super) fn build_spreadjs_config(
    id: &str,
    fields_spec: &[(&str, usize, DetectedDataType)],
    row_field_names: &[&str],
    column_field_names: &[&str],
    value_fields: &[(&str, AggregateFunction)],
    filters: Vec<PivotFilter>,
    data: &[Vec<CellValue>],
) -> PivotTableConfig {
    let fields: Vec<PivotField> = fields_spec
        .iter()
        .map(|(name, col, dt)| PivotField {
            id: FieldId::from(name.to_lowercase().replace(' ', "_")),
            name: name.to_string(),
            source_column: *col as u32,
            data_type: dt.clone(),
            ..Default::default()
        })
        .collect();

    let mut placements: Vec<PivotFieldPlacement> = Vec::new();

    for (pos, name) in row_field_names.iter().enumerate() {
        let field_id = name.to_lowercase().replace(' ', "_");
        placements.push(make_placement(&field_id, PivotFieldArea::Row, pos, None));
    }

    for (pos, name) in column_field_names.iter().enumerate() {
        let field_id = name.to_lowercase().replace(' ', "_");
        placements.push(make_placement(&field_id, PivotFieldArea::Column, pos, None));
    }

    for (pos, (name, agg)) in value_fields.iter().enumerate() {
        let field_id = name.to_lowercase().replace(' ', "_");
        placements.push(make_placement(
            &field_id,
            PivotFieldArea::Value,
            pos,
            Some(*agg),
        ));
    }

    let end_row = if data.is_empty() {
        0
    } else {
        (data.len() - 1) as u32
    };
    let end_col = if data.is_empty() || data[0].is_empty() {
        0
    } else {
        (data[0].len() - 1) as u32
    };

    PivotTableConfig {
        schema_version: PIVOT_CONFIG_SCHEMA_VERSION,
        id: id.to_string(),
        name: format!("SpreadJS test: {}", id),
        source_sheet_id: None,
        source_sheet_name: "test".to_string(),
        source_range: CellRange::new(0, 0, end_row, end_col),
        output_sheet_name: "test".to_string(),
        output_location: OutputLocation { row: 0, col: 0 },
        fields,
        placements,
        filters,
        layout: Some(PivotTableLayout {
            show_row_grand_totals: Some(true),
            show_column_grand_totals: Some(true),
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

/// Helper: find a row in the result by matching header values.
/// For single-level: key = "East" matches headers[0].value == "East".
/// For multi-level: key = "East|Widget" matches headers[0]="East", headers[1]="Widget".
/// For blank: key = "(blank)" matches Null or empty string.
pub(super) fn find_row_by_key<'a>(rows: &'a [PivotRow], key: &str) -> Option<&'a PivotRow> {
    if key == "(blank)" {
        return rows.iter().find(|r| {
            if r.is_subtotal || r.is_grand_total {
                return false;
            }
            if r.headers.is_empty() {
                return false;
            }
            match &r.headers[0].value {
                CellValue::Null => true,
                CellValue::Text(s) => s.is_empty() || s.as_ref() == "(blank)",
                _ => false,
            }
        });
    }

    let parts: Vec<&str> = key.split('|').collect();
    rows.iter().find(|r| {
        if r.is_subtotal || r.is_grand_total {
            return false;
        }
        if r.headers.len() < parts.len() {
            return false;
        }
        // Only match rows whose headers length equals the key parts length
        // (skip parent rows that have fewer headers for multi-level)
        let non_subtotal_headers: Vec<&PivotHeader> = r.headers.iter().collect();
        if non_subtotal_headers.len() != parts.len() {
            return false;
        }
        parts.iter().enumerate().all(|(idx, part)| {
            let header_val = match &non_subtotal_headers[idx].value {
                CellValue::Text(s) => s.to_lowercase(),
                CellValue::Number(n) => format!("{}", *n),
                CellValue::Null => String::new(),
                other => format!("{}", other),
            };
            header_val == part.to_lowercase()
        })
    })
}

/// Helper: assert float equality with tolerance
pub(super) fn assert_approx(actual: &CellValue, expected: f64, label: &str) {
    match actual {
        CellValue::Number(n) => {
            assert!(
                (n.get() - expected).abs() < 1e-5,
                "{}: expected {} but got {}",
                label,
                expected,
                *n
            );
        }
        other => {
            panic!(
                "{}: expected Number({}) but got {:?}",
                label, expected, other
            );
        }
    }
}

/// Default sales data fields spec
pub(super) fn spreadjs_sales_fields() -> Vec<(&'static str, usize, DetectedDataType)> {
    vec![
        ("Region", 0, DetectedDataType::String),
        ("Product", 1, DetectedDataType::String),
        ("Quarter", 2, DetectedDataType::String),
        ("Sales", 3, DetectedDataType::Number),
        ("Units", 4, DetectedDataType::Number),
    ]
}

/// Helper: create a config with calculated fields using the sample sales data.
/// The sample data has fields: Region(0), Product(1), Quarter(2), Sales(3), Units(4).
pub(super) fn make_config_with_calc_fields(
    row_fields: Vec<(&str, usize)>,
    col_fields: Vec<(&str, usize)>,
    value_fields: Vec<(&str, usize, AggregateFunction)>,
    calc_fields: Vec<CalculatedField>,
) -> PivotTableConfig {
    let mut placements = Vec::new();
    for (i, (field_id, _pos)) in row_fields.iter().enumerate() {
        placements.push(make_placement(field_id, PivotFieldArea::Row, i, None));
    }
    for (i, (field_id, _pos)) in col_fields.iter().enumerate() {
        placements.push(make_placement(field_id, PivotFieldArea::Column, i, None));
    }
    for (i, (field_id, _pos, agg)) in value_fields.iter().enumerate() {
        placements.push(make_placement(
            field_id,
            PivotFieldArea::Value,
            i,
            Some(*agg),
        ));
    }

    let mut config = make_base_config(sample_fields(), placements, vec![]);
    config.calculated_fields = Some(calc_fields);
    config
}

/// Census-like data: Function (dept), Role, EmployeeID (for counting), FLC (salary).
/// Used by sort-by-value and tabular layout tests.
pub(super) fn census_data() -> Vec<Vec<CellValue>> {
    vec![
        // Header row
        vec![
            cv_text("Function"),
            cv_text("Role"),
            cv_text("EmployeeID"),
            cv_text("FLC"),
        ],
        // COGS function, various roles with different counts
        // IC: 5 employees (most)
        vec![
            cv_text("COGS"),
            cv_text("IC"),
            cv_text("E001"),
            cv_num(50000.0),
        ],
        vec![
            cv_text("COGS"),
            cv_text("IC"),
            cv_text("E002"),
            cv_num(55000.0),
        ],
        vec![
            cv_text("COGS"),
            cv_text("IC"),
            cv_text("E003"),
            cv_num(48000.0),
        ],
        vec![
            cv_text("COGS"),
            cv_text("IC"),
            cv_text("E004"),
            cv_num(52000.0),
        ],
        vec![
            cv_text("COGS"),
            cv_text("IC"),
            cv_text("E005"),
            cv_num(51000.0),
        ],
        // Manager: 3 employees
        vec![
            cv_text("COGS"),
            cv_text("Manager"),
            cv_text("E006"),
            cv_num(80000.0),
        ],
        vec![
            cv_text("COGS"),
            cv_text("Manager"),
            cv_text("E007"),
            cv_num(85000.0),
        ],
        vec![
            cv_text("COGS"),
            cv_text("Manager"),
            cv_text("E008"),
            cv_num(82000.0),
        ],
        // Principal: 2 employees
        vec![
            cv_text("COGS"),
            cv_text("Principal"),
            cv_text("E009"),
            cv_num(120000.0),
        ],
        vec![
            cv_text("COGS"),
            cv_text("Principal"),
            cv_text("E010"),
            cv_num(125000.0),
        ],
        // Director: 1 employee (least)
        vec![
            cv_text("COGS"),
            cv_text("Director"),
            cv_text("E011"),
            cv_num(150000.0),
        ],
    ]
}

pub(super) fn census_fields() -> Vec<PivotField> {
    vec![
        PivotField {
            id: FieldId::from("function"),
            name: "Function".to_string(),
            source_column: 0,
            data_type: DetectedDataType::String,
            ..Default::default()
        },
        PivotField {
            id: FieldId::from("role"),
            name: "Role".to_string(),
            source_column: 1,
            data_type: DetectedDataType::String,
            ..Default::default()
        },
        PivotField {
            id: FieldId::from("employee_id"),
            name: "EmployeeID".to_string(),
            source_column: 2,
            data_type: DetectedDataType::String,
            ..Default::default()
        },
        PivotField {
            id: FieldId::from("flc"),
            name: "FLC".to_string(),
            source_column: 3,
            data_type: DetectedDataType::Number,
            ..Default::default()
        },
    ]
}

/// Mixed-type amount data: Category field as row, Amount field with mixed types as value.
/// - "Groceries" has only numeric amounts
/// - "Banking" has both numeric and text amounts
/// - "Rent" has only text amounts
pub(super) fn mixed_type_amount_data() -> Vec<Vec<CellValue>> {
    vec![
        vec![cv_text("Category"), cv_text("Amount")],
        // Groceries — all numeric
        vec![cv_text("Groceries"), cv_num(-50.0)],
        vec![cv_text("Groceries"), cv_num(-30.0)],
        vec![cv_text("Groceries"), cv_num(-20.0)],
        // Banking — mixed: 2 numeric + 1 text (comma-formatted string)
        vec![cv_text("Banking"), cv_num(-100.0)],
        vec![cv_text("Banking"), cv_num(200.0)],
        vec![cv_text("Banking"), cv_text("2,650.00")],
        // Rent — all text (large amounts stored as strings with commas)
        vec![cv_text("Rent"), cv_text("1,400.00")],
    ]
}

pub(super) fn mixed_type_fields() -> Vec<PivotField> {
    vec![
        PivotField {
            id: FieldId::from("category"),
            name: "Category".to_string(),
            source_column: 0,
            data_type: DetectedDataType::String,
            ..Default::default()
        },
        PivotField {
            id: FieldId::from("amount"),
            name: "Amount".to_string(),
            source_column: 1,
            data_type: DetectedDataType::Number,
            ..Default::default()
        },
    ]
}

pub(super) fn mixed_type_avg_config() -> PivotTableConfig {
    let fields = mixed_type_fields();
    let placements = vec![
        make_placement("category", PivotFieldArea::Row, 0, None),
        make_placement(
            "amount",
            PivotFieldArea::Value,
            0,
            Some(AggregateFunction::Average),
        ),
    ];
    let mut config = make_base_config(fields, placements, vec![]);
    config.layout = Some(PivotTableLayout {
        show_row_grand_totals: Some(true),
        show_column_grand_totals: Some(false),
        layout_form: Some(LayoutForm::Tabular),
        ..Default::default()
    });
    config
}
