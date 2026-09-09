//! Session-only format writes rebase only the corresponding retained inverses.

use super::HistoryPatch;
use crate::storage::engine::ComputeEngine;
use cell_types::SheetId;
use domain_types::CellFormat;

impl ComputeEngine {
    pub(crate) fn rebase_history_ui_format(
        &mut self,
        sheet: SheetId,
        ranges: &[(u32, u32, u32, u32)],
        format: &CellFormat,
    ) {
        let format = crate::storage::properties::normalize_format_patch(format);
        if format == CellFormat::default() {
            return;
        }
        let storage = &self.stores.storage;
        let mirror = &self.mirror;
        let rebase = |patch: &mut HistoryPatch| {
            if let HistoryPatch::Metadata(patch) = patch {
                patch.rebase_ui_format(storage, mirror, sheet, ranges, &format);
            }
        };
        for action in self
            .history
            .undo
            .iter_mut()
            .chain(self.history.redo.iter_mut())
            .chain(std::iter::once(&mut self.history.group))
        {
            for patch in &mut action.patches {
                rebase(patch);
            }
        }
        // A UI write can also occur inside a still-open public action.
        for patch in &mut storage
            .history
            .0
            .state
            .lock()
            .expect("native history capture poisoned")
            .patches
        {
            rebase(patch);
        }
    }
}
