use crate::infra::xml::parse_string_attr;

use super::super::types::{SlicerCrossFilter, SlicerSortOrder};

pub(super) fn parse_sort_order_attr(elem: &[u8], attr: &[u8]) -> SlicerSortOrder {
    if let Some(val) = parse_string_attr(elem, attr) {
        match val.as_str() {
            "descending" | "Descending" => SlicerSortOrder::Descending,
            _ => SlicerSortOrder::Ascending,
        }
    } else {
        SlicerSortOrder::Ascending
    }
}

pub(super) fn parse_cross_filter_attr(elem: &[u8], attr: &[u8]) -> SlicerCrossFilter {
    if let Some(val) = parse_string_attr(elem, attr) {
        match val.as_str() {
            "none" | "None" => SlicerCrossFilter::None,
            "showItemsWithNoData" | "ShowItemsWithNoData" => SlicerCrossFilter::ShowItemsWithNoData,
            _ => SlicerCrossFilter::ShowItemsWithDataAtTop,
        }
    } else {
        SlicerCrossFilter::ShowItemsWithDataAtTop
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn sort_order_default_type_value_is_ascending() {
        assert_eq!(SlicerSortOrder::default(), SlicerSortOrder::Ascending);
    }

    #[test]
    fn cross_filter_default_type_value_is_show_items_with_data_at_top() {
        assert_eq!(
            SlicerCrossFilter::default(),
            SlicerCrossFilter::ShowItemsWithDataAtTop
        );
    }

    #[test]
    fn parses_sort_order_values() {
        assert_eq!(
            parse_sort_order_attr(b"sortOrder=\"ascending\"", b"sortOrder=\""),
            SlicerSortOrder::Ascending
        );
        assert_eq!(
            parse_sort_order_attr(b"sortOrder=\"descending\"", b"sortOrder=\""),
            SlicerSortOrder::Descending
        );
        assert_eq!(
            parse_sort_order_attr(b"sortOrder=\"Descending\"", b"sortOrder=\""),
            SlicerSortOrder::Descending
        );
        assert_eq!(
            parse_sort_order_attr(b"other=\"value\"", b"sortOrder=\""),
            SlicerSortOrder::Ascending
        );
    }

    #[test]
    fn parses_cross_filter_values() {
        assert_eq!(
            parse_cross_filter_attr(b"crossFilter=\"none\"", b"crossFilter=\""),
            SlicerCrossFilter::None
        );
        assert_eq!(
            parse_cross_filter_attr(b"crossFilter=\"showItemsWithDataAtTop\"", b"crossFilter=\""),
            SlicerCrossFilter::ShowItemsWithDataAtTop
        );
        assert_eq!(
            parse_cross_filter_attr(b"crossFilter=\"showItemsWithNoData\"", b"crossFilter=\""),
            SlicerCrossFilter::ShowItemsWithNoData
        );
        assert_eq!(
            parse_cross_filter_attr(b"other=\"value\"", b"crossFilter=\""),
            SlicerCrossFilter::ShowItemsWithDataAtTop
        );
    }
}
