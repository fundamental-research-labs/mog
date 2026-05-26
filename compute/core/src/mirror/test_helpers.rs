//! pivot framing sub-scope C.4 — shared mirror test fixtures.
//!
//! `compute/core/src/mirror/` had no test infrastructure for constructing a
//! fresh mirror with a sheet before this round; the only existing fixtures
//! lived inline in `mod.rs`'s `tests` module and built around UUID-loaded
//! snapshots, which is too heavy for direct unit tests of `materialize_pivot`
//! and friends. This module factors a tiny helper that subsequent rounds
//! touching the materializer should reuse instead of re-deriving.

use cell_types::SheetId;

use super::cell_mirror::CellMirror;
use super::types::SheetMirror;

/// Construct a fresh `CellMirror` containing a single sheet sized
/// `rows × cols`. The sheet's `SheetId` is deterministic (`from_raw(1)`)
/// and its name is `"Sheet1"` — both irrelevant to the tests themselves
/// but stable so failures reproduce.
pub(crate) fn fresh_mirror_with_sheet(rows: u32, cols: u32) -> (CellMirror, SheetId) {
    let sheet_id = SheetId::from_raw(1);
    let mut mirror = CellMirror::new();
    let sheet_mirror = SheetMirror::new(sheet_id, "Sheet1".to_string(), rows, cols);
    mirror.add_sheet_mirror(sheet_id, "Sheet1".to_string(), sheet_mirror);
    (mirror, sheet_id)
}
