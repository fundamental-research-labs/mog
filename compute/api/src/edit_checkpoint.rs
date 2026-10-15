//! Conservative evidence of net authored cell edits through the Rust facade.
//!
//! Only the audited typed range setter is admitted. All other mutable facade
//! calls invalidate the checkpoint, including future methods using call_engine.
//! Formula text, not its calculated cache, participates in equality.
use std::{
    collections::HashMap,
    sync::atomic::{AtomicU64, Ordering},
};

use cell_types::SheetId;
use compute_core::storage::engine::ComputeEngine;
use serde::{Deserialize, Serialize};
use value_types::CellValue;

use crate::ComputeApiError;

const MAX_TRACKED_CELLS: usize = 100_000;
static NEXT_CHECKPOINT: AtomicU64 = AtomicU64::new(1);

/// An opaque, process-local handle bound to one workbook actor and generation.
#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub struct CellEditCheckpoint(u64);

#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum CellEditStatus {
    NetCellEdit,
    NoNetCellEdit,
    Unavailable,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct CellEditEvidence {
    pub checkpoint_id: u64,
    pub revision: u64,
    pub status: CellEditStatus,
    pub tracked_cells: usize,
    pub reason: Option<String>,
}

#[derive(Clone, Debug, PartialEq)]
enum LogicalCell {
    Formula(String),
    Value(CellValue),
}

type Position = (SheetId, u32, u32);

fn logical_cell(engine: &ComputeEngine, (sheet, row, col): Position) -> LogicalCell {
    if let Some(formula) = engine.get_cell_data(&sheet, row, col).and_then(|data| {
        data.get("formula")
            .and_then(|value| value.as_str())
            .map(str::to_owned)
    }) {
        LogicalCell::Formula(formula)
    } else {
        LogicalCell::Value(engine.get_cell_value(&sheet, row, col))
    }
}

struct ActiveCheckpoint {
    id: CellEditCheckpoint,
    revision: u64,
    original: HashMap<Position, LogicalCell>,
    unavailable: Option<String>,
    frozen: bool,
}

#[derive(Default)]
pub(crate) struct CellEditTracker(Option<ActiveCheckpoint>);

impl CellEditTracker {
    pub(crate) fn begin(&mut self) -> Result<CellEditCheckpoint, ComputeApiError> {
        if self.0.is_some() {
            return Err(ComputeApiError::InvalidOperation(
                "cell edit checkpoint already started".into(),
            ));
        }
        let id = NEXT_CHECKPOINT
            .fetch_update(Ordering::Relaxed, Ordering::Relaxed, |id| id.checked_add(1))
            .map_err(|_| {
                ComputeApiError::InvalidOperation(
                    "cell edit checkpoint identifiers exhausted".into(),
                )
            })?;
        let id = CellEditCheckpoint(id);
        self.0 = Some(ActiveCheckpoint {
            id,
            revision: 0,
            original: HashMap::new(),
            unavailable: None,
            frozen: false,
        });
        Ok(id)
    }

    pub(crate) fn allow_mutation(&self) -> Result<(), ComputeApiError> {
        if self.0.as_ref().is_some_and(|state| state.frozen) {
            return Err(ComputeApiError::InvalidOperation(
                "workbook is frozen for output finalization".into(),
            ));
        }
        Ok(())
    }

    pub(crate) fn invalidate(&mut self, reason: &str) {
        if let Some(state) = &mut self.0 {
            state.unavailable.get_or_insert_with(|| reason.to_owned());
        }
    }

    pub(crate) fn capture(
        &mut self,
        engine: &ComputeEngine,
        positions: impl Iterator<Item = Position>,
    ) {
        let Some(state) = &mut self.0 else { return };
        state.revision = match state.revision.checked_add(1) {
            Some(revision) => revision,
            None => {
                state
                    .unavailable
                    .get_or_insert_with(|| "revision_exhausted".into());
                return;
            }
        };
        if state.unavailable.is_some() {
            return;
        }
        for position in positions {
            if state.original.contains_key(&position) {
                continue;
            }
            if state.original.len() == MAX_TRACKED_CELLS {
                state.unavailable = Some("cell_tracking_limit".into());
                state.original.clear();
                return;
            }
            if engine.get_sheet_name(&position.0).is_none() {
                state.unavailable = Some("sheet_identity_unavailable".into());
                return;
            }
            if engine.is_projection_source(&position.0, position.1, position.2)
                || engine.is_projected_position(&position.0, position.1, position.2)
            {
                state.unavailable = Some("array_projection_unavailable".into());
                return;
            }
            state
                .original
                .insert(position, logical_cell(engine, position));
        }
    }

    pub(crate) fn audit_projections(&mut self, engine: &ComputeEngine) {
        let Some(state) = &mut self.0 else { return };
        if state.original.keys().any(|&(sheet, row, col)| {
            engine.is_projection_source(&sheet, row, col)
                || engine.is_projected_position(&sheet, row, col)
        }) {
            state
                .unavailable
                .get_or_insert_with(|| "array_projection_unavailable".into());
        }
    }

    pub(crate) fn inspect(
        &mut self,
        engine: &ComputeEngine,
        id: CellEditCheckpoint,
        freeze: bool,
    ) -> Result<CellEditEvidence, ComputeApiError> {
        self.audit_projections(engine);
        let state = self
            .0
            .as_mut()
            .filter(|state| state.id == id)
            .ok_or_else(|| {
                ComputeApiError::InvalidOperation(
                    "cell edit checkpoint belongs to another workbook or generation".into(),
                )
            })?;
        if freeze {
            state.frozen = true;
        }
        let status = if state.unavailable.is_some() {
            CellEditStatus::Unavailable
        } else if state
            .original
            .iter()
            .any(|(&position, before)| logical_cell(engine, position) != *before)
        {
            CellEditStatus::NetCellEdit
        } else {
            CellEditStatus::NoNetCellEdit
        };
        Ok(CellEditEvidence {
            checkpoint_id: id.0,
            revision: state.revision,
            status,
            tracked_cells: state.original.len(),
            reason: state.unavailable.clone(),
        })
    }
}
