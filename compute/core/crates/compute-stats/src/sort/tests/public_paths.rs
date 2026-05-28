use value_types::CellValue;

use super::super::{
    KeyConfig, SortConfig, sort_by_custom_order_in_place, sort_by_in_place,
    sort_by_multiple_in_place, sort_values,
};
use super::fixtures::mixed_values_for_sort_path_parity;

#[test]
fn public_sort_paths_share_mixed_value_semantics() {
    for config in [SortConfig::asc(), SortConfig::desc()] {
        let values = mixed_values_for_sort_path_parity();

        let mut direct = values.clone();
        sort_values(&mut direct, &config);

        let mut single_key = values.clone();
        sort_by_in_place(&mut single_key, Clone::clone, &config);

        let mut multi_key = values.clone();
        let key_configs: Vec<KeyConfig<CellValue>> = vec![KeyConfig {
            key_fn: Box::new(Clone::clone),
            config: config.clone(),
        }];
        sort_by_multiple_in_place(&mut multi_key, &key_configs);

        assert_eq!(single_key, direct);
        assert_eq!(multi_key, direct);
    }
}

#[test]
fn custom_order_empty_list_shares_non_custom_mixed_value_semantics() {
    for config in [SortConfig::asc(), SortConfig::desc()] {
        let values = mixed_values_for_sort_path_parity();

        let mut direct = values.clone();
        sort_values(&mut direct, &config);

        let mut custom_fallback = values.clone();
        sort_by_custom_order_in_place(&mut custom_fallback, Clone::clone, &[], &config);

        assert_eq!(custom_fallback, direct);
    }
}
