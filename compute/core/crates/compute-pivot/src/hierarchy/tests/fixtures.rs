use crate::types::{FieldId, PivotHeader, PivotRow};
use compute_relational::AggregatedNode;
use value_types::CellValue;

// These rows model the flattened pivot output consumed by the hierarchy builders.

/// Create a PivotHeader for testing.
pub(super) fn make_header(
    key: &str,
    value: CellValue,
    field_id: &str,
    depth: usize,
) -> PivotHeader {
    PivotHeader {
        key: key.to_string(),
        value,
        field_id: FieldId::from(field_id.to_string()),
        depth,
        span: 1,
        is_expandable: false,
        is_expanded: true,
        is_subtotal: false,
        is_grand_total: false,
        parent_key: None,
        child_keys: None,
    }
}

/// Create a data row (not subtotal, not grand total).
pub(super) fn make_data_row(
    key: &str,
    headers: Vec<PivotHeader>,
    values: Vec<CellValue>,
) -> PivotRow {
    let depth = headers.last().map_or(0, |h| h.depth);
    PivotRow {
        key: key.to_string(),
        headers,
        values,
        depth,
        is_subtotal: false,
        is_grand_total: false,
        source_row_indices: None,
    }
}

/// Create a subtotal row.
pub(super) fn make_subtotal_row(
    key: &str,
    headers: Vec<PivotHeader>,
    depth: usize,
    values: Vec<CellValue>,
) -> PivotRow {
    PivotRow {
        key: key.to_string(),
        headers,
        values,
        depth,
        is_subtotal: true,
        is_grand_total: false,
        source_row_indices: None,
    }
}

/// Create a grand total row.
pub(super) fn make_grand_total_row(values: Vec<CellValue>) -> PivotRow {
    PivotRow {
        key: "__grand_total__".to_string(),
        headers: vec![],
        values,
        depth: 0,
        is_subtotal: false,
        is_grand_total: true,
        source_row_indices: None,
    }
}

pub(super) fn make_node(
    key: &str,
    value: CellValue,
    field_id: &str,
    depth: usize,
    children: Vec<AggregatedNode>,
    parent_key: Option<&str>,
) -> AggregatedNode {
    AggregatedNode {
        key: key.to_string(),
        value,
        field_id: field_id.to_string(),
        depth,
        values: vec![],
        subtotal_values: None,
        row_indices: vec![],
        children,
        parent_key: parent_key.map(str::to_string),
    }
}

/// Build a standard 2-level hierarchy for testing.
///
/// Structure (Region > Product):
///   Row 0: East / Widget  (data)
///   Row 1: East / Gadget  (data)
///   Row 2: East subtotal
///   Row 3: West / Widget  (data)
///   Row 4: West subtotal
///   Row 5: Grand total
pub(super) fn build_two_level_rows() -> (Vec<PivotRow>, Vec<String>) {
    let field_names = vec!["Region".to_string(), "Product".to_string()];

    let rows = vec![
        // Row 0: East / Widget
        make_data_row(
            "east\x00widget",
            vec![
                make_header("east", CellValue::Text("East".into()), "region", 0),
                make_header(
                    "east\x00widget",
                    CellValue::Text("Widget".into()),
                    "product",
                    1,
                ),
            ],
            vec![CellValue::number(100.0)],
        ),
        // Row 1: East / Gadget
        make_data_row(
            "east\x00gadget",
            vec![
                make_header("east", CellValue::Text("East".into()), "region", 0),
                make_header(
                    "east\x00gadget",
                    CellValue::Text("Gadget".into()),
                    "product",
                    1,
                ),
            ],
            vec![CellValue::number(200.0)],
        ),
        // Row 2: East subtotal
        make_subtotal_row(
            "east__SUBTOTAL__",
            vec![make_header(
                "east",
                CellValue::Text("East Total".into()),
                "region",
                0,
            )],
            0,
            vec![CellValue::number(300.0)],
        ),
        // Row 3: West / Widget
        make_data_row(
            "west\x00widget",
            vec![
                make_header("west", CellValue::Text("West".into()), "region", 0),
                make_header(
                    "west\x00widget",
                    CellValue::Text("Widget".into()),
                    "product",
                    1,
                ),
            ],
            vec![CellValue::number(150.0)],
        ),
        // Row 4: West subtotal
        make_subtotal_row(
            "west__SUBTOTAL__",
            vec![make_header(
                "west",
                CellValue::Text("West Total".into()),
                "region",
                0,
            )],
            0,
            vec![CellValue::number(150.0)],
        ),
        // Row 5: Grand total
        make_grand_total_row(vec![CellValue::number(450.0)]),
    ];

    (rows, field_names)
}

// ---- build_group_hierarchy: basic structure ----

pub(super) fn build_single_level_rows(values: Vec<CellValue>) -> (Vec<PivotRow>, Vec<String>) {
    let field_names = vec!["Category".to_string()];
    let mut rows: Vec<PivotRow> = values
        .into_iter()
        .enumerate()
        .map(|(i, val)| {
            let key = format!("row{i}");
            make_data_row(
                &key,
                vec![make_header(&key, val, "category", 0)],
                vec![CellValue::number(i as f64)],
            )
        })
        .collect();
    rows.push(make_grand_total_row(vec![CellValue::number(0.0)]));
    (rows, field_names)
}
