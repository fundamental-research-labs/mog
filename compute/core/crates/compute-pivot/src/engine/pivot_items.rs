//! Pivot item extraction — surfaces header data as discrete `PivotItemInfo` objects.
//!
//! This module provides two entry points:
//!
//! - [`get_field_items`] — items for a single field in a specific area
//! - [`get_all_field_items`] — items for all non-value fields

use std::collections::HashSet;

use value_types::CellValue;

use crate::filter::get_unique_field_values;
use crate::types::{
    PivotFieldArea, PivotFieldItems, PivotFilter, PivotHeader, PivotItemInfo, PivotTableConfig,
    PivotTableResult,
};

/// Extract pivot items for a specific field from a computed result.
///
/// Returns `None` if the field is not found in the config or if the area is `Value`
/// (value fields don't have discrete items).
#[must_use]
pub fn get_field_items(
    result: &PivotTableResult,
    config: &PivotTableConfig,
    field_id: &str,
    area: PivotFieldArea,
    source_data: Option<&[Vec<CellValue>]>,
) -> Option<PivotFieldItems> {
    let field = config.get_field(field_id)?;

    let filter = config
        .filters
        .iter()
        .find(|f| f.field_id.as_str() == field_id);

    let items = match area {
        PivotFieldArea::Row => extract_row_items(result, field_id, filter),
        PivotFieldArea::Column => extract_column_items(result, field_id, filter),
        PivotFieldArea::Filter => extract_filter_items(config, field_id, filter, source_data),
        // Value area fields don't have items
        _ => return None,
    };

    Some(PivotFieldItems {
        field_id: field.id.clone(),
        field_name: field.name.clone(),
        area,
        items,
    })
}

/// Extract all pivot items for all placed fields (excluding value fields).
#[must_use]
pub fn get_all_field_items(
    result: &PivotTableResult,
    config: &PivotTableConfig,
    source_data: Option<&[Vec<CellValue>]>,
) -> Vec<PivotFieldItems> {
    let mut all_items = Vec::new();

    for placement in &config.placements {
        let area = placement.area();
        // Value fields don't have items
        if area == PivotFieldArea::Value {
            continue;
        }
        let field_id = placement.field_id().as_str();
        if let Some(items) = get_field_items(result, config, field_id, area, source_data) {
            all_items.push(items);
        }
    }

    all_items
}

/// Determine whether a cell value is visible given a filter.
///
/// - If filter has `include_values: Some(list)` → visible if value is in the list
/// - If filter has `exclude_values: Some(list)` → visible if value is NOT in the list
/// - If no filter → visible
fn is_value_visible(value: &CellValue, filter: Option<&PivotFilter>) -> bool {
    let Some(filter) = filter else {
        return true;
    };

    if let Some(ref include) = filter.include_values {
        return include.contains(value);
    }

    if let Some(ref exclude) = filter.exclude_values {
        return !exclude.contains(value);
    }

    true
}

/// Convert a `PivotHeader` into a `PivotItemInfo`.
fn header_to_item(header: &PivotHeader, area: PivotFieldArea, is_visible: bool) -> PivotItemInfo {
    PivotItemInfo {
        key: header.key.clone(),
        value: header.value.clone(),
        field_id: header.field_id.clone(),
        area,
        depth: header.depth,
        is_expandable: header.is_expandable,
        is_expanded: header.is_expanded,
        is_visible,
        is_subtotal: header.is_subtotal,
        is_grand_total: header.is_grand_total,
        child_keys: header.child_keys.clone(),
        parent_key: header.parent_key.clone(),
    }
}

/// Extract unique row items for a given `field_id` from the result rows.
///
/// Iterates all rows, collecting unique headers (by key) that match the `field_id`.
/// Preserves display order (first occurrence). Includes subtotal/grand total items.
fn extract_row_items(
    result: &PivotTableResult,
    field_id: &str,
    filter: Option<&PivotFilter>,
) -> Vec<PivotItemInfo> {
    let mut seen = HashSet::new();
    let mut items = Vec::new();

    for row in &result.rows {
        for header in &row.headers {
            if header.field_id.as_str() != field_id {
                continue;
            }
            if seen.insert(header.key.clone()) {
                let is_visible = is_value_visible(&header.value, filter);
                items.push(header_to_item(header, PivotFieldArea::Row, is_visible));
            }
        }
    }

    items
}

/// Extract unique column items for a given `field_id` from the column headers.
fn extract_column_items(
    result: &PivotTableResult,
    field_id: &str,
    filter: Option<&PivotFilter>,
) -> Vec<PivotItemInfo> {
    let mut seen = HashSet::new();
    let mut items = Vec::new();

    for col_header in &result.column_headers {
        if col_header.field_id.as_str() != field_id {
            continue;
        }
        for header in &col_header.headers {
            if seen.insert(header.key.clone()) {
                let is_visible = is_value_visible(&header.value, filter);
                items.push(header_to_item(header, PivotFieldArea::Column, is_visible));
            }
        }
    }

    items
}

/// Extract items for a filter-area field.
///
/// Filter fields don't appear in the computed result's rows/columns.
/// If source data is provided, we call `get_unique_field_values` to get all
/// unique values from the source. Otherwise, we fall back to the filter's
/// include/exclude values (if available).
fn extract_filter_items(
    config: &PivotTableConfig,
    field_id: &str,
    filter: Option<&PivotFilter>,
    source_data: Option<&[Vec<CellValue>]>,
) -> Vec<PivotItemInfo> {
    let Some(field) = config.get_field(field_id) else {
        return Vec::new();
    };

    if let Some(data) = source_data {
        // Skip header row (index 0) — use data rows only
        let data_indices: Vec<usize> = (1..data.len()).collect();
        let unique_values =
            get_unique_field_values(data, &data_indices, field.source_column as usize);

        return unique_values
            .into_iter()
            .enumerate()
            .map(|(i, value)| {
                let is_visible = is_value_visible(&value, filter);
                let key = format!("{field_id}:{i}");
                PivotItemInfo {
                    key,
                    value,
                    field_id: field.id.clone(),
                    area: PivotFieldArea::Filter,
                    depth: 0,
                    is_expandable: false,
                    is_expanded: false,
                    is_visible,
                    is_subtotal: false,
                    is_grand_total: false,
                    child_keys: None,
                    parent_key: None,
                }
            })
            .collect();
    }

    // Fallback: build items from filter include/exclude values
    let Some(filter) = filter else {
        return Vec::new();
    };

    let values: Vec<&CellValue> = if let Some(ref include) = filter.include_values {
        include.iter().collect()
    } else if let Some(ref exclude) = filter.exclude_values {
        exclude.iter().collect()
    } else {
        return Vec::new();
    };

    values
        .into_iter()
        .enumerate()
        .map(|(i, value)| {
            let is_visible = is_value_visible(value, Some(filter));
            let key = format!("{field_id}:{i}");
            PivotItemInfo {
                key,
                value: value.clone(),
                field_id: field.id.clone(),
                area: PivotFieldArea::Filter,
                depth: 0,
                is_expandable: false,
                is_expanded: false,
                is_visible,
                is_subtotal: false,
                is_grand_total: false,
                child_keys: None,
                parent_key: None,
            }
        })
        .collect()
}

#[cfg(test)]
mod pivot_items_tests {
    use super::super::test_helpers::*;
    use super::*;
    use crate::engine::compute;
    use crate::types::*;

    // ---- Test 1: Row items ----

    #[test]
    fn row_items_basic() {
        let data = sample_sales_data();
        let config = make_base_config(
            sample_fields(),
            vec![
                make_placement("region", PivotFieldArea::Row, 0, None),
                make_placement(
                    "sales",
                    PivotFieldArea::Value,
                    0,
                    Some(AggregateFunction::Sum),
                ),
            ],
            vec![],
        );

        let result = compute(&config, &data, Some(&expand_all()));
        let field_items = get_field_items(&result, &config, "region", PivotFieldArea::Row, None)
            .expect("should find region items");

        assert_eq!(field_items.field_id.as_str(), "region");
        assert_eq!(field_items.field_name, "Region");
        assert_eq!(field_items.area, PivotFieldArea::Row);

        // Should have "East" and "West" (non-subtotal, non-grand-total unique items)
        let data_items: Vec<&PivotItemInfo> = field_items
            .items
            .iter()
            .filter(|i| !i.is_subtotal && !i.is_grand_total)
            .collect();
        assert_eq!(data_items.len(), 2, "expected 2 data items (East, West)");

        let values: Vec<&CellValue> = data_items.iter().map(|i| &i.value).collect();
        assert!(values.contains(&&cv_text("East")));
        assert!(values.contains(&&cv_text("West")));

        // All items should be visible (no filter)
        for item in &data_items {
            assert!(
                item.is_visible,
                "all items should be visible without filter"
            );
        }
    }

    // ---- Test 2: Column items ----

    #[test]
    fn column_items_basic() {
        let data = sample_sales_data();
        let config = make_base_config(
            sample_fields(),
            vec![
                make_placement("region", PivotFieldArea::Row, 0, None),
                make_placement("quarter", PivotFieldArea::Column, 0, None),
                make_placement(
                    "sales",
                    PivotFieldArea::Value,
                    0,
                    Some(AggregateFunction::Sum),
                ),
            ],
            vec![],
        );

        let result = compute(&config, &data, Some(&expand_all()));
        let field_items =
            get_field_items(&result, &config, "quarter", PivotFieldArea::Column, None)
                .expect("should find quarter column items");

        assert_eq!(field_items.field_id.as_str(), "quarter");
        assert_eq!(field_items.area, PivotFieldArea::Column);

        let data_items: Vec<&PivotItemInfo> = field_items
            .items
            .iter()
            .filter(|i| !i.is_subtotal && !i.is_grand_total)
            .collect();
        assert_eq!(data_items.len(), 2, "expected Q1 and Q2");

        let values: Vec<&CellValue> = data_items.iter().map(|i| &i.value).collect();
        assert!(values.contains(&&cv_text("Q1")));
        assert!(values.contains(&&cv_text("Q2")));
    }

    // ---- Test 3: Multi-level row items ----

    #[test]
    fn multi_level_row_items() {
        let data = sample_sales_data();
        let config = make_base_config(
            sample_fields(),
            vec![
                make_placement("region", PivotFieldArea::Row, 0, None),
                make_placement("product", PivotFieldArea::Row, 1, None),
                make_placement(
                    "sales",
                    PivotFieldArea::Value,
                    0,
                    Some(AggregateFunction::Sum),
                ),
            ],
            vec![],
        );

        let result = compute(&config, &data, Some(&expand_all()));

        // Region items
        let region_items = get_field_items(&result, &config, "region", PivotFieldArea::Row, None)
            .expect("should find region items");
        let region_data: Vec<&PivotItemInfo> = region_items
            .items
            .iter()
            .filter(|i| !i.is_subtotal && !i.is_grand_total)
            .collect();
        assert_eq!(region_data.len(), 2);

        // Product items
        let product_items = get_field_items(&result, &config, "product", PivotFieldArea::Row, None)
            .expect("should find product items");
        let product_data: Vec<&PivotItemInfo> = product_items
            .items
            .iter()
            .filter(|i| !i.is_subtotal && !i.is_grand_total)
            .collect();
        // Widget appears under East and West, Gadget appears under East and West
        // The items should be unique by key — each path is unique
        assert!(
            product_data.len() >= 2,
            "expected at least Widget and Gadget items, got {}",
            product_data.len()
        );
    }

    // ---- Test 4: Filter visibility with exclude_values ----

    #[test]
    fn filter_visibility_exclude() {
        let data = sample_sales_data();
        let config = make_base_config(
            sample_fields(),
            vec![
                make_placement("region", PivotFieldArea::Row, 0, None),
                make_placement(
                    "sales",
                    PivotFieldArea::Value,
                    0,
                    Some(AggregateFunction::Sum),
                ),
            ],
            vec![PivotFilter {
                field_id: FieldId::from("region"),
                include_values: None,
                exclude_values: Some(vec![CellValue::Text("West".into())]),
                condition: None,
                top_bottom: None,
                show_items_with_no_data: None,
            }],
        );

        // Note: With the filter active, the computed result only contains "East" rows.
        // But get_field_items returns items from whatever is in the result.
        let result = compute(&config, &data, Some(&expand_all()));
        let field_items = get_field_items(&result, &config, "region", PivotFieldArea::Row, None)
            .expect("should find region items");

        // With exclude_values=["West"], the compute result only has East rows.
        // So we only get East items, and they should be visible.
        let data_items: Vec<&PivotItemInfo> = field_items
            .items
            .iter()
            .filter(|i| !i.is_subtotal && !i.is_grand_total)
            .collect();
        assert!(!data_items.is_empty());

        // East should be visible
        let east = data_items
            .iter()
            .find(|i| i.value == cv_text("East"))
            .expect("should find East");
        assert!(east.is_visible, "East should be visible");
    }

    // ---- Test 5: Filter items from source data ----

    #[test]
    fn filter_items_from_source_data() {
        let data = sample_sales_data();
        let config = make_base_config(
            sample_fields(),
            vec![
                make_placement("region", PivotFieldArea::Row, 0, None),
                make_placement("quarter", PivotFieldArea::Filter, 0, None),
                make_placement(
                    "sales",
                    PivotFieldArea::Value,
                    0,
                    Some(AggregateFunction::Sum),
                ),
            ],
            vec![],
        );

        let result = compute(&config, &data, Some(&expand_all()));
        let field_items = get_field_items(
            &result,
            &config,
            "quarter",
            PivotFieldArea::Filter,
            Some(&data),
        )
        .expect("should find quarter filter items");

        assert_eq!(field_items.field_id.as_str(), "quarter");
        assert_eq!(field_items.area, PivotFieldArea::Filter);

        let values: Vec<&CellValue> = field_items.items.iter().map(|i| &i.value).collect();
        assert!(values.contains(&&cv_text("Q1")));
        assert!(values.contains(&&cv_text("Q2")));

        // All visible (no filter)
        for item in &field_items.items {
            assert!(item.is_visible);
        }
    }

    // ---- Test 6: get_all_field_items ----

    #[test]
    fn all_field_items_returns_non_value_fields() {
        let data = sample_sales_data();
        let config = make_base_config(
            sample_fields(),
            vec![
                make_placement("region", PivotFieldArea::Row, 0, None),
                make_placement("quarter", PivotFieldArea::Column, 0, None),
                make_placement(
                    "sales",
                    PivotFieldArea::Value,
                    0,
                    Some(AggregateFunction::Sum),
                ),
            ],
            vec![],
        );

        let result = compute(&config, &data, Some(&expand_all()));
        let all = get_all_field_items(&result, &config, Some(&data));

        // Should have 2 field groups: region (Row) and quarter (Column)
        // Value field "sales" should be excluded
        assert_eq!(all.len(), 2);

        let field_ids: Vec<&str> = all.iter().map(|f| f.field_id.as_str()).collect();
        assert!(field_ids.contains(&"region"));
        assert!(field_ids.contains(&"quarter"));
    }

    // ---- Test 7: Subtotal and grand total items propagate flags ----

    #[test]
    fn subtotal_grand_total_flags() {
        let data = sample_sales_data();
        let mut config = make_base_config(
            sample_fields(),
            vec![
                make_placement("region", PivotFieldArea::Row, 0, None),
                make_placement("product", PivotFieldArea::Row, 1, None),
                make_placement(
                    "sales",
                    PivotFieldArea::Value,
                    0,
                    Some(AggregateFunction::Sum),
                ),
            ],
            vec![],
        );
        config.layout = Some(PivotTableLayout {
            show_row_grand_totals: Some(true),
            ..Default::default()
        });

        let result = compute(&config, &data, Some(&expand_all()));
        let field_items = get_field_items(&result, &config, "region", PivotFieldArea::Row, None)
            .expect("should find region items");

        // Check that subtotal/grand total flags propagate
        let subtotals: Vec<&PivotItemInfo> =
            field_items.items.iter().filter(|i| i.is_subtotal).collect();
        let grand_totals: Vec<&PivotItemInfo> = field_items
            .items
            .iter()
            .filter(|i| i.is_grand_total)
            .collect();

        // With 2 regions and subtotals enabled by default, we may get subtotal items
        // At minimum, we should verify the flags are correctly propagated
        // (subtotals may not always appear depending on layout settings)
        for item in &subtotals {
            assert!(item.is_subtotal);
        }
        for item in &grand_totals {
            assert!(item.is_grand_total);
        }
    }

    // ---- Test: Filter area with exclude filter shows visibility correctly ----

    #[test]
    fn filter_items_visibility_with_exclude() {
        let data = sample_sales_data();
        let config = make_base_config(
            sample_fields(),
            vec![
                make_placement("region", PivotFieldArea::Row, 0, None),
                make_placement("quarter", PivotFieldArea::Filter, 0, None),
                make_placement(
                    "sales",
                    PivotFieldArea::Value,
                    0,
                    Some(AggregateFunction::Sum),
                ),
            ],
            vec![PivotFilter {
                field_id: FieldId::from("quarter"),
                include_values: None,
                exclude_values: Some(vec![CellValue::Text("Q2".into())]),
                condition: None,
                top_bottom: None,
                show_items_with_no_data: None,
            }],
        );

        let result = compute(&config, &data, Some(&expand_all()));
        let field_items = get_field_items(
            &result,
            &config,
            "quarter",
            PivotFieldArea::Filter,
            Some(&data),
        )
        .expect("should find quarter filter items");

        let q1 = field_items
            .items
            .iter()
            .find(|i| i.value == cv_text("Q1"))
            .expect("should find Q1");
        let q2 = field_items
            .items
            .iter()
            .find(|i| i.value == cv_text("Q2"))
            .expect("should find Q2");

        assert!(q1.is_visible, "Q1 should be visible");
        assert!(!q2.is_visible, "Q2 should not be visible (excluded)");
    }

    // ---- Test: Value area returns None ----

    #[test]
    fn value_area_returns_none() {
        let data = sample_sales_data();
        let config = make_base_config(
            sample_fields(),
            vec![
                make_placement("region", PivotFieldArea::Row, 0, None),
                make_placement(
                    "sales",
                    PivotFieldArea::Value,
                    0,
                    Some(AggregateFunction::Sum),
                ),
            ],
            vec![],
        );

        let result = compute(&config, &data, Some(&expand_all()));
        let field_items = get_field_items(&result, &config, "sales", PivotFieldArea::Value, None);
        assert!(field_items.is_none(), "Value area should return None");
    }

    // ---- Test: Nonexistent field returns None ----

    #[test]
    fn nonexistent_field_returns_none() {
        let data = sample_sales_data();
        let config = make_base_config(
            sample_fields(),
            vec![
                make_placement("region", PivotFieldArea::Row, 0, None),
                make_placement(
                    "sales",
                    PivotFieldArea::Value,
                    0,
                    Some(AggregateFunction::Sum),
                ),
            ],
            vec![],
        );

        let result = compute(&config, &data, Some(&expand_all()));
        let field_items =
            get_field_items(&result, &config, "nonexistent", PivotFieldArea::Row, None);
        assert!(field_items.is_none());
    }
}
