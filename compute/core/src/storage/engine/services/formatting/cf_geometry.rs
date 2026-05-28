use crate::storage::sheet::cf_store;
use crate::storage::sheet::cf_store::{CFCellRange, CFIconSetPreset, CFPresetCategory};

pub(in crate::storage::engine) fn cf_ranges_overlap(a: &CFCellRange, b: &CFCellRange) -> bool {
    cf_store::cf_ranges_overlap(a, b)
}

pub(in crate::storage::engine) fn cf_range_contains(
    outer: &CFCellRange,
    inner: &CFCellRange,
) -> bool {
    cf_store::cf_range_contains(outer, inner)
}

pub(in crate::storage::engine) fn cf_subtract_range(
    original: &CFCellRange,
    subtract: &CFCellRange,
) -> Vec<CFCellRange> {
    cf_store::cf_subtract_range(original, subtract)
}

pub(in crate::storage::engine) fn cf_intersect_ranges(
    a: &CFCellRange,
    b: &CFCellRange,
) -> Option<CFCellRange> {
    cf_store::cf_intersect_ranges(a, b)
}

pub(in crate::storage::engine) fn cf_is_valid_range(range: &CFCellRange) -> bool {
    cf_store::cf_is_valid_range(range)
}

pub(in crate::storage::engine) fn get_icon_set_presets() -> Vec<CFIconSetPreset> {
    cf_store::icon_set_presets()
}

pub(in crate::storage::engine) fn get_cf_preset_by_id(id: &str) -> Option<CFPresetCategory> {
    cf_store::get_preset_by_id(id)
}
