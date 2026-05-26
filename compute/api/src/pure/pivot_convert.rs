//! Pivot-related data helpers.
//!
//! Most of the old PivotSpec ↔ PivotTableConfig converters have been removed
//! now that the parser produces `ParsedPivotTable` directly. Only `build_source_data`
//! remains — it is still used by `formula-eval` to prepare cache records for
//! `compute_pivot::compute()`.

use domain_types::domain::pivot::PivotCacheSourceDef;
use value_types::CellValue;

/// Prepare source data for `compute_pivot::compute()`.
/// Returns header row + data rows (what `compute()` expects as `data: &[Vec<CellValue>]`).
pub fn build_source_data(
    cache_source: &PivotCacheSourceDef,
    cache_records: &[Vec<CellValue>],
) -> Vec<Vec<CellValue>> {
    let header: Vec<CellValue> = cache_source
        .field_names
        .iter()
        .map(|name| CellValue::Text(name.as_str().into()))
        .collect();

    let mut data = Vec::with_capacity(cache_records.len() + 1);
    data.push(header);
    data.extend_from_slice(cache_records);
    data
}
