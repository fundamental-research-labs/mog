use crate::mirror::CellMirror;
use crate::snapshot::{ChangeKind, MutationResult, NamedRangeChange};
use crate::storage::engine::stores::EngineStores;
use cell_types::SheetId;
use formula_types::{IdentityFormula, NamedRangeDef};
use value_types::ComputeError;

// -------------------------------------------------------------------
// ComputeCore delegations
// -------------------------------------------------------------------

pub(in crate::storage::engine) fn eval_cf(
    stores: &EngineStores,
    mirror: &CellMirror,
    sheet_id: &SheetId,
    rules: Vec<crate::cf::types::CFRuleWire>,
) -> Vec<crate::cf::types::CellCFResult> {
    let rules: Vec<crate::cf::types::CFRule> = rules
        .into_iter()
        .filter_map(|w| crate::cf::types::CFRule::try_from(w).ok())
        .collect();
    stores.compute.eval_cf(mirror, sheet_id, &rules)
}

pub(in crate::storage::engine) fn to_identity_formula(
    stores: &mut EngineStores,
    mirror: &mut CellMirror,
    sheet_id: &SheetId,
    formula_a1: &str,
) -> Result<IdentityFormula, ComputeError> {
    stores
        .compute
        .to_identity_formula(mirror, sheet_id, formula_a1)
}

pub(in crate::storage::engine) fn to_a1_display(
    stores: &EngineStores,
    mirror: &CellMirror,
    sheet_id: &SheetId,
    formula: &IdentityFormula,
) -> String {
    stores.compute.to_a1_display(mirror, sheet_id, formula)
}

pub(in crate::storage::engine) fn set_named_range(
    stores: &mut EngineStores,
    mirror: &mut CellMirror,
    name: String,
    def: NamedRangeDef,
) -> Result<MutationResult, ComputeError> {
    stores.compute.set_named_range(mirror, name.clone(), def);
    let mut result = MutationResult::empty();
    result.named_range_changes.push(NamedRangeChange {
        name,
        kind: ChangeKind::Set,
    });
    Ok(result)
}

pub(in crate::storage::engine) fn remove_named_range(
    stores: &mut EngineStores,
    mirror: &mut CellMirror,
    name: &str,
) -> Result<MutationResult, ComputeError> {
    stores.compute.remove_named_range(mirror, name);
    let mut result = MutationResult::empty();
    result.named_range_changes.push(NamedRangeChange {
        name: name.to_string(),
        kind: ChangeKind::Removed,
    });
    Ok(result)
}
