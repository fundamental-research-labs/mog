use super::*;

pub(super) fn cf_ranges_overlap(_engine: &ComputeEngine, a: &CFCellRange, b: &CFCellRange) -> bool {
    services::formatting::cf_ranges_overlap(a, b)
}

pub(super) fn cf_range_contains(
    _engine: &ComputeEngine,
    outer: &CFCellRange,
    inner: &CFCellRange,
) -> bool {
    services::formatting::cf_range_contains(outer, inner)
}

pub(super) fn cf_subtract_range(
    _engine: &ComputeEngine,
    original: &CFCellRange,
    subtract: &CFCellRange,
) -> Vec<CFCellRange> {
    services::formatting::cf_subtract_range(original, subtract)
}

pub(super) fn cf_intersect_ranges(
    _engine: &ComputeEngine,
    a: &CFCellRange,
    b: &CFCellRange,
) -> Option<CFCellRange> {
    services::formatting::cf_intersect_ranges(a, b)
}

pub(super) fn cf_is_valid_range(_engine: &ComputeEngine, range: &CFCellRange) -> bool {
    services::formatting::cf_is_valid_range(range)
}

pub(super) fn get_icon_set_presets(_engine: &ComputeEngine) -> Vec<CFIconSetPreset> {
    services::formatting::get_icon_set_presets()
}

pub(super) fn get_cf_preset_by_id(_engine: &ComputeEngine, id: &str) -> Option<CFPresetCategory> {
    services::formatting::get_cf_preset_by_id(id)
}
