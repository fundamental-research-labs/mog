//! Native inverses grouped by user action. The live native stores remain authoritative.

use std::sync::{
    Arc, Mutex,
    atomic::{AtomicBool, Ordering},
};

use cell_types::{CellId, SheetId};
use rustc_hash::{FxHashMap, FxHashSet};

use crate::{cells::CellStore, snapshot::MutationResult};

mod boundaries;
pub(crate) mod cells;
pub(crate) mod metadata;
pub(crate) mod relocate;
mod replay;
pub(crate) mod structure;
mod ui_formats;

use cells::CellPatch;
use metadata::{MetadataKey, MetadataPatch};
use structure::{SheetExtentPatch, SheetPatch, StructurePatch};

#[derive(Debug, Clone, PartialEq, Eq, Hash)]
pub(crate) enum HistoryKey {
    Cell(SheetId, CellId),
    SheetExtent(SheetId),
    Metadata(MetadataKey),
}

#[derive(Debug)]
pub(crate) enum HistoryPatch {
    Cell(CellPatch),
    Structure(StructurePatch),
    Relocate(relocate::RelocatePatch),
    Sheet(SheetPatch),
    SheetExtent(SheetExtentPatch),
    Metadata(MetadataPatch),
}

impl HistoryPatch {
    fn is_changed(&self, stores: &super::stores::EngineStores, cell_store: &CellStore) -> bool {
        match self {
            Self::Relocate(patch) => patch.is_changed(stores, cell_store),
            Self::Structure(patch) => patch.is_changed(stores, cell_store),
            Self::Sheet(patch) => patch.is_changed(stores, cell_store),
            Self::SheetExtent(patch) => patch.is_changed(stores, cell_store),
            Self::Cell(patch) => patch.is_changed(stores, cell_store),
            Self::Metadata(patch) => patch.is_changed(&stores.storage, cell_store),
        }
    }
}

#[derive(Debug, Default)]
struct CaptureState {
    keys: FxHashSet<HistoryKey>,
    patches: Vec<HistoryPatch>,
    owned_sheets: FxHashSet<SheetId>,
    owned_cells: FxHashSet<CellId>,
}

#[derive(Debug, Default)]
struct CaptureInner {
    active: AtomicBool,
    state: Mutex<CaptureState>,
    untracked_identities: Mutex<FxHashSet<(SheetId, CellId)>>,
}

/// Capture context shared only by the live stores of one engine.
/// Cloning document state deliberately creates an inactive context: staged
/// imports and temporary cell stores must never record changes against live state.
#[derive(Debug, Default)]
pub(crate) struct HistoryCapture(Arc<CaptureInner>);

impl Clone for HistoryCapture {
    fn clone(&self) -> Self {
        Self::default()
    }
}

impl HistoryCapture {
    pub(crate) fn share(&self) -> Self {
        Self(Arc::clone(&self.0))
    }

    pub(crate) fn is_active(&self) -> bool {
        self.0.active.load(Ordering::Relaxed)
    }

    /// Ordered mutations separate record-once segments: cells edited on either
    /// side of an axis operation must retain inverses at their respective positions.
    pub(crate) fn record(&self, make: impl FnOnce() -> HistoryPatch) {
        if !self.is_active() {
            return;
        }
        let patch = make();
        let mut state = self
            .0
            .state
            .lock()
            .expect("native history capture poisoned");
        state.keys.clear();
        state.patches.push(patch);
    }

    pub(crate) fn mark_sheet_owned(&self, sheet: SheetId) {
        if self.is_active() {
            self.0
                .state
                .lock()
                .expect("native history capture poisoned")
                .owned_sheets
                .insert(sheet);
        }
    }

    pub(crate) fn owns_sheet(&self, sheet: SheetId) -> bool {
        self.is_active()
            && self
                .0
                .state
                .lock()
                .expect("native history capture poisoned")
                .owned_sheets
                .contains(&sheet)
    }

    pub(crate) fn mark_cell_owned(&self, cell: CellId) {
        if self.is_active() {
            self.0
                .state
                .lock()
                .expect("native history capture poisoned")
                .owned_cells
                .insert(cell);
        }
    }

    pub(crate) fn owns_cell(&self, cell: CellId) -> bool {
        self.is_active()
            && self
                .0
                .state
                .lock()
                .expect("native history capture poisoned")
                .owned_cells
                .contains(&cell)
    }

    pub(crate) fn retain_untracked_identity(&self, sheet: SheetId, cell: CellId) {
        if !self.is_active() {
            self.0
                .untracked_identities
                .lock()
                .expect("native identity retention poisoned")
                .insert((sheet, cell));
        }
    }

    pub(crate) fn retained_identities(&self, sheet: SheetId) -> Vec<CellId> {
        self.0
            .untracked_identities
            .lock()
            .expect("native identity retention poisoned")
            .iter()
            .filter(|(owner, _)| *owner == sheet)
            .map(|(_, cell)| *cell)
            .collect()
    }

    pub(crate) fn record_once(&self, key: HistoryKey, make: impl FnOnce() -> HistoryPatch) {
        if !self.is_active() {
            return;
        }
        let mut state = self
            .0
            .state
            .lock()
            .expect("native history capture poisoned");
        if state.keys.insert(key) {
            state.patches.push(make());
        }
    }

    fn begin(&self) {
        debug_assert!(!self.is_active());
        self.0.active.store(true, Ordering::Relaxed);
    }

    fn finish(&self) -> Vec<HistoryPatch> {
        self.0.active.store(false, Ordering::Relaxed);
        let mut state = self
            .0
            .state
            .lock()
            .expect("native history capture poisoned");
        state.keys.clear();
        state.owned_sheets.clear();
        state.owned_cells.clear();
        std::mem::take(&mut state.patches)
    }
}

#[derive(Debug, Default)]
struct Action {
    patches: Vec<HistoryPatch>,
}

#[derive(Debug, Default)]
pub(super) struct HistoryStack {
    undo: Vec<Action>,
    redo: Vec<Action>,
    group: Action,
    group_depth: usize,
    action_depth: usize,
    suppressed: usize,
    replaying: bool,
}

pub(crate) struct HistoryEffects {
    pub(crate) result: MutationResult,
    pub(crate) sheets: FxHashSet<SheetId>,
    pub(crate) recalc: bool,
    pub(crate) topology: bool,
    pub(crate) lifecycle: FxHashMap<SheetId, Option<String>>,
    pub(crate) tables: bool,
    pub(crate) named_ranges: bool,
    pub(crate) settings: bool,
    pub(crate) cells: FxHashMap<CellId, (SheetId, u32, u32)>,
    pub(crate) sparkline_sheets: FxHashSet<SheetId>,
    pub(crate) format_rects: Vec<(SheetId, u32, u32, u32, u32)>,
    pub(crate) metadata_events: metadata::MetadataEvents,
    pub(crate) old_values: FxHashMap<CellId, value_types::CellValue>,
    pub(crate) old_formulas: FxHashMap<CellId, Option<String>>,
    pub(crate) projections: Vec<(CellId, crate::projection::Projection)>,
    pub(crate) formula_texts: FxHashMap<CellId, Option<String>>,
}

impl Default for HistoryEffects {
    fn default() -> Self {
        Self {
            result: MutationResult::empty(),
            sheets: Default::default(),
            recalc: false,
            topology: false,
            lifecycle: Default::default(),
            tables: false,
            named_ranges: false,
            settings: false,
            cells: Default::default(),
            formula_texts: Default::default(),
            metadata_events: Default::default(),
            format_rects: Default::default(),
            sparkline_sheets: Default::default(),
            old_values: Default::default(),
            old_formulas: Default::default(),
            projections: Default::default(),
        }
    }
}
