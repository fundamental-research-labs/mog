use crate::domain::pivot::read::{
    PivotCache, PivotField as ReadPivotField, PivotItemType, SharedItem, SortType,
};
use pivot_types::{FieldId, SortByValueConfig, SortDirection};
use value_types::CellValue;

use super::value_map::{shared_item_to_cell_value, shared_item_to_key};

pub(super) fn resolve_sort(
    field_def: Option<&ReadPivotField>,
    cache: &PivotCache,
    field_idx: usize,
) -> (Option<SortDirection>, Option<Vec<CellValue>>) {
    let fd = match field_def {
        Some(fd) => fd,
        None => return (None, None),
    };

    let sort_dir = match fd.sort_type {
        Some(SortType::Ascending) => Some(SortDirection::Asc),
        Some(SortType::Descending) => Some(SortDirection::Desc),
        _ => None,
    };

    if !fd.items.is_empty() {
        let shared_items = cache.fields.get(field_idx).map(|cf| &cf.shared_items);
        let custom_list: Vec<CellValue> = fd
            .items
            .iter()
            .filter(|item| matches!(item.item_type, PivotItemType::Data))
            .filter_map(|item| {
                let idx = item.x? as usize;
                shared_items
                    .and_then(|si| si.get(idx))
                    .map(shared_item_to_cell_value)
            })
            .collect();

        if !custom_list.is_empty() {
            return (sort_dir, Some(custom_list));
        }
    }

    (sort_dir, None)
}

pub(super) fn resolve_sort_by_value(
    field_def: Option<&ReadPivotField>,
    sort_order: &Option<SortDirection>,
    data_field_ids: &[FieldId],
    cache: &PivotCache,
) -> Option<SortByValueConfig> {
    let fd = field_def?;
    let data_field_pos = fd.auto_sort_data_field? as usize;
    let value_field_id = data_field_ids.get(data_field_pos)?.clone();
    let order = (*sort_order)?;

    let column_key = fd
        .auto_sort_column_field
        .zip(fd.auto_sort_column_item)
        .and_then(|(col_field_idx, col_item_idx)| {
            let cache_field = cache.fields.get(col_field_idx as usize)?;
            let shared_item = cache_field.shared_items.get(col_item_idx as usize)?;
            Some(shared_item_to_key(shared_item))
        });

    Some(SortByValueConfig {
        value_field_id,
        order,
        column_key,
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::domain::pivot::read::{CacheField, PivotField, PivotItem};

    fn make_cache_with_shared_items(items: Vec<SharedItem>) -> PivotCache {
        PivotCache {
            id: 1,
            fields: vec![CacheField {
                name: "FiscalYear".to_string(),
                shared_items: items,
                ..Default::default()
            }],
            ..Default::default()
        }
    }

    fn make_data_item(x: u32) -> PivotItem {
        PivotItem {
            item_type: PivotItemType::Data,
            x: Some(x),
            hidden: false,
            show_details: true,
            s: None,
        }
    }

    #[test]
    fn custom_sort_list_uses_excel_item_order_with_sort_direction() {
        let cache = make_cache_with_shared_items(vec![
            SharedItem::String("B".to_string()),
            SharedItem::String("A".to_string()),
        ]);
        let field = PivotField {
            sort_type: Some(SortType::Descending),
            items: vec![make_data_item(0), make_data_item(1)],
            ..Default::default()
        };

        let (sort_order, custom_sort_list) = resolve_sort(Some(&field), &cache, 0);

        assert_eq!(sort_order, Some(SortDirection::Desc));
        assert_eq!(
            custom_sort_list,
            Some(vec![
                CellValue::Text("B".into()),
                CellValue::Text("A".into())
            ])
        );
    }

    #[test]
    fn auto_sort_scope_populates_column_key() {
        let cache = make_cache_with_shared_items(vec![
            SharedItem::String("FY2023".to_string()),
            SharedItem::String("FY2024".to_string()),
        ]);
        let field = PivotField {
            sort_type: Some(SortType::Descending),
            auto_sort_data_field: Some(0),
            auto_sort_column_field: Some(0),
            auto_sort_column_item: Some(1),
            ..Default::default()
        };

        let result = resolve_sort_by_value(
            Some(&field),
            &Some(SortDirection::Desc),
            &[FieldId::from("amount")],
            &cache,
        )
        .expect("sort-by-value should resolve");

        assert_eq!(result.value_field_id, FieldId::from("amount"));
        assert_eq!(result.order, SortDirection::Desc);
        assert_eq!(result.column_key, Some("T:fy2024".to_string()));
    }

    #[test]
    fn malformed_auto_sort_scope_leaves_column_key_empty() {
        let cache = make_cache_with_shared_items(vec![SharedItem::String("FY2024".to_string())]);
        let field = PivotField {
            sort_type: Some(SortType::Ascending),
            auto_sort_data_field: Some(0),
            auto_sort_column_field: Some(2),
            auto_sort_column_item: Some(4),
            ..Default::default()
        };

        let result = resolve_sort_by_value(
            Some(&field),
            &Some(SortDirection::Asc),
            &[FieldId::from("amount")],
            &cache,
        )
        .expect("sort-by-value should still resolve without a column key");

        assert_eq!(result.column_key, None);
    }
}
