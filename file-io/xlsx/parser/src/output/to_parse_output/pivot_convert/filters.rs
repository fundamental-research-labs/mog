use std::collections::HashSet;

use crate::domain::pivot::read::{PivotCache, PivotItemType, PivotTable};
use pivot_types::{PivotField, PivotFilter};
use value_types::CellValue;

use super::value_map::shared_item_to_cell_value;

pub(super) fn build_filters(
    pivot: &PivotTable,
    fields: &[PivotField],
    cache: &PivotCache,
) -> Vec<PivotFilter> {
    let mut filters = Vec::new();

    for page_field in &pivot.page_fields {
        let field_idx = page_field.field_index as usize;
        let item_idx = match page_field.item {
            Some(idx) => idx as usize,
            None => continue,
        };

        let field = match fields.get(field_idx) {
            Some(f) => f,
            None => continue,
        };

        let pf = match pivot.pivot_fields.get(field_idx) {
            Some(pf) => pf,
            None => continue,
        };

        let field_item = match pf.items.get(item_idx) {
            Some(item) if matches!(item.item_type, PivotItemType::Data) => item,
            _ => continue,
        };

        let shared_item_idx = match field_item.x {
            Some(idx) => idx as usize,
            None => continue,
        };

        let filter_value = cache
            .fields
            .get(field_idx)
            .and_then(|cf| cf.shared_items.get(shared_item_idx))
            .map(shared_item_to_cell_value);

        if let Some(value) = filter_value {
            filters.push(PivotFilter {
                field_id: field.id.clone(),
                include_values: Some(vec![value]),
                exclude_values: None,
                condition: None,
                top_bottom: None,
                show_items_with_no_data: None,
            });
        }
    }

    let included_field_ids: HashSet<String> =
        filters.iter().map(|f| f.field_id.to_string()).collect();

    for (field_idx, pf) in pivot.pivot_fields.iter().enumerate() {
        if pf.items.is_empty() {
            continue;
        }

        let field = match fields.get(field_idx) {
            Some(f) => f,
            None => continue,
        };

        if included_field_ids.contains(field.id.as_str()) {
            continue;
        }

        let shared_items = cache.fields.get(field_idx).map(|cf| &cf.shared_items);
        let mut exclude_values = Vec::new();

        for item in &pf.items {
            if matches!(item.item_type, PivotItemType::Blank) {
                if item.hidden {
                    exclude_values.push(CellValue::Null);
                }
                continue;
            }

            if !item.hidden || !matches!(item.item_type, PivotItemType::Data) {
                continue;
            }
            if let Some(value_idx) = item.x {
                if let Some(value) = shared_items.and_then(|si| si.get(value_idx as usize)) {
                    exclude_values.push(shared_item_to_cell_value(value));
                }
            }
        }

        if !exclude_values.is_empty() {
            filters.push(PivotFilter {
                field_id: field.id.clone(),
                include_values: None,
                exclude_values: Some(exclude_values),
                condition: None,
                top_bottom: None,
                show_items_with_no_data: None,
            });
        }
    }

    filters
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::domain::pivot::read::{
        CacheField, PageField, PivotField as ReadPivotField, PivotItem,
    };
    use pivot_types::{DetectedDataType, FieldId};

    fn field(id: &str) -> PivotField {
        PivotField {
            id: FieldId::from(id),
            name: id.to_string(),
            source_column: 0,
            data_type: DetectedDataType::String,
            ..Default::default()
        }
    }

    fn data_item(x: u32, hidden: bool) -> PivotItem {
        PivotItem {
            item_type: PivotItemType::Data,
            x: Some(x),
            hidden,
            show_details: true,
            s: None,
        }
    }

    #[test]
    fn page_field_selected_data_item_creates_include_filter() {
        let cache = PivotCache {
            fields: vec![CacheField {
                name: "Region".to_string(),
                shared_items: vec![crate::domain::pivot::read::SharedItem::String(
                    "West".to_string(),
                )],
                ..Default::default()
            }],
            ..Default::default()
        };
        let pivot = PivotTable {
            page_fields: vec![PageField {
                field_index: 0,
                item: Some(0),
                ..Default::default()
            }],
            pivot_fields: vec![ReadPivotField {
                items: vec![data_item(0, false)],
                ..Default::default()
            }],
            ..Default::default()
        };

        let filters = build_filters(&pivot, &[field("Region")], &cache);

        assert_eq!(filters.len(), 1);
        assert_eq!(
            filters[0].include_values,
            Some(vec![CellValue::Text("West".into())])
        );
        assert_eq!(filters[0].exclude_values, None);
    }

    #[test]
    fn hidden_data_and_blank_items_create_exclude_filter() {
        let cache = PivotCache {
            fields: vec![CacheField {
                name: "Region".to_string(),
                shared_items: vec![crate::domain::pivot::read::SharedItem::String(
                    "West".to_string(),
                )],
                ..Default::default()
            }],
            ..Default::default()
        };
        let pivot = PivotTable {
            pivot_fields: vec![ReadPivotField {
                items: vec![
                    data_item(0, true),
                    PivotItem {
                        item_type: PivotItemType::Blank,
                        x: None,
                        hidden: true,
                        show_details: true,
                        s: None,
                    },
                ],
                ..Default::default()
            }],
            ..Default::default()
        };

        let filters = build_filters(&pivot, &[field("Region")], &cache);

        assert_eq!(filters.len(), 1);
        assert_eq!(
            filters[0].exclude_values,
            Some(vec![CellValue::Text("West".into()), CellValue::Null])
        );
        assert_eq!(filters[0].include_values, None);
    }
}
