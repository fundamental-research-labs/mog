//! Region partial-write guards for user-originating cell edits.

use super::*;
use crate::storage::engine::mutation::CellInput;

/// Trust level for value-typed `set_cells_raw` writes.
///
/// **Stream A' trust marker** (per `cse-display-and-batch-write.md`).
/// `set_cells_raw` is value-typed: there's no string parser between the
/// caller's intent and the mirror, which means it has historically been an
/// unguarded backdoor for partial-array writes.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum WriteTrust {
    UserEdit,
    TrustedReplay,
}

/// Outcome of the shared region partial-write guard.
pub(super) enum RegionGuardOutcome {
    Continue,
}

/// Excel rejection family: edits inside CSE arrays, dynamic spill members, or
/// Data Table regions are rejected atomically before storage is mutated. The
/// one allowed CSE case is clearing the CSE anchor, which tears down the CSE.
pub(super) fn check_region_partial_write(
    mirror: &mut CellMirror,
    sheet_id: &SheetId,
    cell_id: CellId,
    row: u32,
    col: u32,
    input: &CellInput,
) -> Result<RegionGuardOutcome, ComputeError> {
    if let Some((anchor_id, anchor_pos)) = mirror.cse_anchor_covering(sheet_id, row, col) {
        if input.is_clear_intent() && anchor_id == cell_id {
            mirror.unmark_cse_anchor(&anchor_id);
            mirror.cse_single_cell.remove(&anchor_id);
            return Ok(RegionGuardOutcome::Continue);
        }
        return Err(ComputeError::PartialArrayWrite {
            sheet_id: sheet_id.to_uuid_string(),
            row,
            col,
            anchor_row: anchor_pos.row(),
            anchor_col: anchor_pos.col(),
        });
    }

    if let Some((_anchor_id, anchor_pos)) = mirror.dynamic_spill_member_covering(sheet_id, row, col)
    {
        return Err(ComputeError::PartialArrayWrite {
            sheet_id: sheet_id.to_uuid_string(),
            row,
            col,
            anchor_row: anchor_pos.row(),
            anchor_col: anchor_pos.col(),
        });
    }

    if let Some(dt) = mirror.find_data_table_at(sheet_id, row, col) {
        return Err(ComputeError::PartialArrayWrite {
            sheet_id: sheet_id.to_uuid_string(),
            row,
            col,
            anchor_row: dt.start_row,
            anchor_col: dt.start_col,
        });
    }

    Ok(RegionGuardOutcome::Continue)
}

impl ComputeCore {
    /// Validate user-originating cell edits against region atomicity rules
    /// before any storage or mirror mutation happens.
    pub fn validate_region_partial_writes(
        &self,
        mirror: &CellMirror,
        edits: &[(SheetId, CellId, u32, u32, CellInput)],
    ) -> Result<(), ComputeError> {
        let anchors_being_cleared: std::collections::HashSet<CellId> = edits
            .iter()
            .filter(|(_, _, _, _, input)| input.is_clear_intent())
            .filter_map(|(sheet_id, cell_id, row, col, _)| {
                mirror
                    .cse_anchor_covering(sheet_id, *row, *col)
                    .filter(|(anchor_id, _)| *anchor_id == *cell_id)
                    .map(|(anchor_id, _)| anchor_id)
            })
            .collect();
        let dynamic_sources_being_cleared: std::collections::HashSet<CellId> = edits
            .iter()
            .filter(|(_, _, _, _, input)| input.is_clear_intent())
            .filter_map(|(_, cell_id, _, _, _)| {
                mirror
                    .projection_registry
                    .get(cell_id)
                    .filter(|_| !mirror.is_cse_anchor(cell_id))
                    .map(|_| *cell_id)
            })
            .collect();

        for (sheet_id, cell_id, row, col, input) in edits {
            if let Some((anchor_id, anchor_pos)) = mirror.cse_anchor_covering(sheet_id, *row, *col)
            {
                let allowed_cse_clear = input.is_clear_intent()
                    && (*cell_id == anchor_id || anchors_being_cleared.contains(&anchor_id));
                if !allowed_cse_clear {
                    return Err(ComputeError::PartialArrayWrite {
                        sheet_id: sheet_id.to_uuid_string(),
                        row: *row,
                        col: *col,
                        anchor_row: anchor_pos.row(),
                        anchor_col: anchor_pos.col(),
                    });
                }
            }

            if let Some((anchor_id, anchor_pos)) =
                mirror.dynamic_spill_member_covering(sheet_id, *row, *col)
            {
                if input.is_clear_intent() && dynamic_sources_being_cleared.contains(&anchor_id) {
                    continue;
                }
                return Err(ComputeError::PartialArrayWrite {
                    sheet_id: sheet_id.to_uuid_string(),
                    row: *row,
                    col: *col,
                    anchor_row: anchor_pos.row(),
                    anchor_col: anchor_pos.col(),
                });
            }

            if let Some(dt) = mirror.find_data_table_at(sheet_id, *row, *col) {
                return Err(ComputeError::PartialArrayWrite {
                    sheet_id: sheet_id.to_uuid_string(),
                    row: *row,
                    col: *col,
                    anchor_row: dt.start_row,
                    anchor_col: dt.start_col,
                });
            }
        }

        Ok(())
    }

    /// Validate lossless value-typed user edits against guarded regions before
    /// storage writes. Trusted replay paths intentionally skip this method.
    pub fn validate_raw_user_edit_region_writes(
        &self,
        mirror: &CellMirror,
        edits: &[(SheetId, CellId, u32, u32, CellValue, Option<String>)],
    ) -> Result<(), ComputeError> {
        for (sheet_id, _cell_id, row, col, _value, _formula) in edits {
            if let Some((_anchor_id, anchor_pos)) = mirror.cse_anchor_covering(sheet_id, *row, *col)
            {
                return Err(ComputeError::PartialArrayWrite {
                    sheet_id: sheet_id.to_uuid_string(),
                    row: *row,
                    col: *col,
                    anchor_row: anchor_pos.row(),
                    anchor_col: anchor_pos.col(),
                });
            }

            if let Some((_anchor_id, anchor_pos)) =
                mirror.dynamic_spill_member_covering(sheet_id, *row, *col)
            {
                return Err(ComputeError::PartialArrayWrite {
                    sheet_id: sheet_id.to_uuid_string(),
                    row: *row,
                    col: *col,
                    anchor_row: anchor_pos.row(),
                    anchor_col: anchor_pos.col(),
                });
            }

            if let Some(dt) = mirror.find_data_table_at(sheet_id, *row, *col) {
                return Err(ComputeError::PartialArrayWrite {
                    sheet_id: sheet_id.to_uuid_string(),
                    row: *row,
                    col: *col,
                    anchor_row: dt.start_row,
                    anchor_col: dt.start_col,
                });
            }
        }

        Ok(())
    }
}
