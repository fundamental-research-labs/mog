use crate::snapshot::{ChangeKind, MutationResult, NamedRangeChange};
use crate::storage::engine::stores::EngineStores;
use crate::storage::workbook::named_ranges;
use value_types::ComputeError;

// -------------------------------------------------------------------
// Named range write helpers
// -------------------------------------------------------------------

pub(in crate::storage::engine) fn remove_named_range_by_id(
    stores: &mut EngineStores,
    id: &str,
) -> Result<MutationResult, ComputeError> {
    named_ranges::remove_named_range_by_id(
        stores.storage.doc(),
        stores.storage.workbook_map(),
        id,
    )?;
    let mut result = MutationResult::empty();
    result.named_range_changes.push(NamedRangeChange {
        name: id.to_string(),
        kind: ChangeKind::Removed,
    });
    Ok(result)
}

pub(in crate::storage::engine) fn remove_named_ranges_by_scope(
    stores: &mut EngineStores,
    scope: Option<&str>,
) -> Result<MutationResult, ComputeError> {
    named_ranges::remove_named_ranges_by_scope(
        stores.storage.doc(),
        stores.storage.workbook_map(),
        scope,
    );
    let mut result = MutationResult::empty();
    result.named_range_changes.push(NamedRangeChange {
        name: scope.unwrap_or_default().to_string(),
        kind: ChangeKind::Removed,
    });
    Ok(result)
}
