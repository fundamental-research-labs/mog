//! Table management helpers extracted as free functions.
//!
//! Read-only queries take `&CellMirror` (and optionally `&EngineStores`).
//! Mutations take `(&mut EngineStores, &mut CellMirror)`.
//! Bridge methods on `YrsComputeEngine` delegate to these with one-line calls.

use cell_types::{SheetId, SheetPos};
use compute_document::hex::id_to_hex;
use domain_types::CellFormat;
use domain_types::domain::table::{Table as CanonicalTable, TableColumn};
use formula_types::TableDef;
use value_types::ComputeError;
use yrs::{Map, Origin, Out, Transact};

use crate::engine_types::{AutoExpansionResult, TableHitRegion};
use crate::mirror::CellMirror;
use crate::snapshot::{ChangeKind, FilterChange, MutationResult, TableChange};
use crate::storage::cells::structured_ref_updater;
use crate::storage::engine::stores::EngineStores;
use crate::storage::sheet::filters;

mod mutations;
mod options;
mod persistence;
mod queries;
mod range_ids;
#[cfg(test)]
mod tests;

pub(in crate::storage::engine) use mutations::*;
pub(in crate::storage::engine) use options::*;
pub(in crate::storage::engine) use persistence::*;
pub(in crate::storage::engine) use queries::*;
pub(in crate::storage::engine) use range_ids::*;

pub(in crate::storage::engine) fn normalize_table_style_id(
    stores: &EngineStores,
    style_name: Option<String>,
) -> Result<String, ComputeError> {
    let Some(raw) = style_name else {
        return Ok(compute_table::styles::DEFAULT_STYLE_ID.to_string());
    };
    let trimmed = raw.trim();
    if trimmed.is_empty() {
        return Ok(compute_table::styles::DEFAULT_STYLE_ID.to_string());
    }
    if trimmed.eq_ignore_ascii_case("none") {
        return Ok("none".to_string());
    }

    let canonical = canonical_builtin_style_id(trimmed).unwrap_or_else(|| trimmed.to_string());
    if compute_table::styles::get_built_in_style(&canonical).is_some()
        || stores.custom_table_styles.contains_key(&canonical)
    {
        return Ok(canonical);
    }

    Err(ComputeError::Eval {
        message: format!("Unknown table style: {}", raw),
    })
}

fn canonical_builtin_style_id(style_name: &str) -> Option<String> {
    let lower = style_name.to_ascii_lowercase();
    for family in ["Light", "Medium", "Dark"] {
        let lower_family = family.to_ascii_lowercase();
        let full_prefix = format!("tablestyle{}", lower_family);
        if let Some(suffix) = lower.strip_prefix(&full_prefix) {
            if suffix.chars().all(|ch| ch.is_ascii_digit()) {
                return Some(format!("TableStyle{}{}", family, suffix));
            }
        }

        if let Some(suffix) = lower.strip_prefix(&lower_family) {
            if suffix.chars().all(|ch| ch.is_ascii_digit()) {
                return Some(format!("TableStyle{}{}", family, suffix));
            }
        }
    }
    None
}
