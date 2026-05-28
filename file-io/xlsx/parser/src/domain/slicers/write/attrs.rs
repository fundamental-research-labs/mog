use ooxml_types::slicers::{SlicerCrossFilter, SlicerSortOrder};

pub(super) fn sort_order_str(order: SlicerSortOrder) -> &'static str {
    order.to_ooxml()
}

pub(super) fn cross_filter_str(cf: SlicerCrossFilter) -> &'static str {
    cf.to_ooxml()
}
