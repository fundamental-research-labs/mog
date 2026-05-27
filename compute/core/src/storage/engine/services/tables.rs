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
