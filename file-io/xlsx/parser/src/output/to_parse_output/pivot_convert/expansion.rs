use std::collections::HashSet;

use crate::domain::pivot::read::{PivotCache, PivotItemType, PivotTable};
use pivot_types::PivotExpansionState;

use super::value_map::shared_item_to_key;

pub(super) fn build_expansion_state_from_ooxml(
    pivot: &PivotTable,
    cache: &PivotCache,
) -> Option<PivotExpansionState> {
    let mut expanded_rows = HashSet::new();
    let mut has_any_collapsed = false;

    let num_row_fields = pivot.row_fields.iter().filter(|r| r.x >= 0).count();
    let mut depth = 0usize;
    for field_ref in &pivot.row_fields {
        if field_ref.x < 0 {
            continue;
        }
        if depth >= num_row_fields.saturating_sub(1) {
            depth += 1;
            continue;
        }
        let field_idx = field_ref.x as usize;
        let pf = match pivot.pivot_fields.get(field_idx) {
            Some(pf) => pf,
            None => {
                depth += 1;
                continue;
            }
        };
        let shared_items = cache
            .fields
            .get(field_idx)
            .map(|cf| &cf.shared_items[..])
            .unwrap_or(&[]);

        for item in &pf.items {
            if !matches!(item.item_type, PivotItemType::Data) {
                continue;
            }
            let shared_idx = match item.x {
                Some(idx) => idx as usize,
                None => continue,
            };
            let shared_item = match shared_items.get(shared_idx) {
                Some(si) => si,
                None => continue,
            };
            let key = format!("{}\x01{}", depth, shared_item_to_key(shared_item));

            if item.show_details {
                expanded_rows.insert(key);
            } else {
                has_any_collapsed = true;
            }
        }
        depth += 1;
    }

    if !has_any_collapsed {
        return None;
    }

    Some(PivotExpansionState {
        expanded_rows,
        expanded_columns: HashSet::new(),
        expanded_row_keys: Vec::new(),
        expanded_column_keys: Vec::new(),
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::domain::pivot::read::{
        CacheField, PivotField, PivotFieldRef, PivotItem, SharedItem,
    };

    fn data_item(x: Option<u32>, show_details: bool) -> PivotItem {
        PivotItem {
            item_type: PivotItemType::Data,
            x,
            hidden: false,
            show_details,
            s: None,
        }
    }

    fn cache(shared: Vec<Vec<SharedItem>>) -> PivotCache {
        PivotCache {
            id: 1,
            fields: shared
                .into_iter()
                .enumerate()
                .map(|(idx, shared_items)| CacheField {
                    name: format!("F{idx}"),
                    shared_items,
                    ..Default::default()
                })
                .collect(),
            ..Default::default()
        }
    }

    fn pivot(row_fields: Vec<i32>, fields: Vec<PivotField>) -> PivotTable {
        PivotTable {
            row_fields: row_fields
                .into_iter()
                .map(|x| PivotFieldRef { x })
                .collect(),
            pivot_fields: fields,
            ..Default::default()
        }
    }

    #[test]
    fn all_expanded_returns_none() {
        let cache = cache(vec![
            vec![SharedItem::String("A".to_string())],
            vec![SharedItem::String("Leaf".to_string())],
        ]);
        let pivot = pivot(
            vec![0, 1],
            vec![
                PivotField {
                    items: vec![data_item(Some(0), true)],
                    ..Default::default()
                },
                PivotField {
                    items: vec![data_item(Some(0), true)],
                    ..Default::default()
                },
            ],
        );

        assert!(build_expansion_state_from_ooxml(&pivot, &cache).is_none());
    }

    #[test]
    fn collapsed_first_level_returns_explicit_state() {
        let cache = cache(vec![
            vec![
                SharedItem::String("A".to_string()),
                SharedItem::String("B".to_string()),
            ],
            vec![SharedItem::String("Leaf".to_string())],
        ]);
        let pivot = pivot(
            vec![0, 1],
            vec![
                PivotField {
                    items: vec![data_item(Some(0), true), data_item(Some(1), false)],
                    ..Default::default()
                },
                PivotField {
                    items: vec![data_item(Some(0), true)],
                    ..Default::default()
                },
            ],
        );

        let state = build_expansion_state_from_ooxml(&pivot, &cache).unwrap();
        assert!(state.expanded_rows.contains("0\x01T:a"));
        assert!(!state.expanded_rows.contains("0\x01T:b"));
        assert!(state.expanded_columns.is_empty());
    }

    #[test]
    fn leaf_only_rows_do_not_create_state() {
        let cache = cache(vec![vec![SharedItem::String("A".to_string())]]);
        let pivot = pivot(
            vec![0],
            vec![PivotField {
                items: vec![data_item(Some(0), false)],
                ..Default::default()
            }],
        );

        assert!(build_expansion_state_from_ooxml(&pivot, &cache).is_none());
    }

    #[test]
    fn invalid_item_index_is_ignored() {
        let cache = cache(vec![
            vec![SharedItem::String("A".to_string())],
            vec![SharedItem::String("Leaf".to_string())],
        ]);
        let pivot = pivot(
            vec![0, 1],
            vec![
                PivotField {
                    items: vec![data_item(Some(99), false)],
                    ..Default::default()
                },
                PivotField::default(),
            ],
        );

        assert!(build_expansion_state_from_ooxml(&pivot, &cache).is_none());
    }

    #[test]
    fn values_pseudo_field_is_skipped() {
        let cache = cache(vec![
            vec![SharedItem::String("A".to_string())],
            vec![SharedItem::String("Leaf".to_string())],
        ]);
        let pivot = pivot(
            vec![-1, 0, 1],
            vec![
                PivotField {
                    items: vec![data_item(Some(0), false)],
                    ..Default::default()
                },
                PivotField::default(),
            ],
        );

        let state = build_expansion_state_from_ooxml(&pivot, &cache).unwrap();
        assert!(state.expanded_rows.is_empty());
    }

    #[test]
    fn duplicate_labels_at_different_depths_get_distinct_keys() {
        let cache = cache(vec![
            vec![
                SharedItem::String("Same".to_string()),
                SharedItem::String("Collapsed".to_string()),
            ],
            vec![SharedItem::String("Same".to_string())],
            vec![SharedItem::String("Leaf".to_string())],
        ]);
        let pivot = pivot(
            vec![0, 1, 2],
            vec![
                PivotField {
                    items: vec![data_item(Some(0), true), data_item(Some(1), false)],
                    ..Default::default()
                },
                PivotField {
                    items: vec![data_item(Some(0), true)],
                    ..Default::default()
                },
                PivotField::default(),
            ],
        );

        let state = build_expansion_state_from_ooxml(&pivot, &cache).unwrap();
        assert!(state.expanded_rows.contains("0\x01T:same"));
        assert!(state.expanded_rows.contains("1\x01T:same"));
    }
}
