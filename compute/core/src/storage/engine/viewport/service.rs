use std::cell::{Ref, RefCell, RefMut};

use rustc_hash::FxHashMap;

use cell_types::SheetId;
use compute_wire::ViewportBounds;
use compute_wire::palette as format_palette;

/// A registered viewport with explicit bounds and associated metadata.
///
/// Viewports are first-class registered entities in the engine. Registration
/// is decoupled from data fetching — bounds are set explicitly via
/// `register_viewport` / `update_viewport_bounds`, and read during
/// `get_viewport_binary` / `get_viewport_binary_delta`.
pub(crate) struct ViewportRegistration {
    /// The sheet this viewport is viewing.
    pub sheet_id: SheetId,
    /// Viewport bounds.
    pub bounds: ViewportBounds,
    /// Palette length at last binary response, used as `palette_start_index` for deltas.
    pub palette_len: u16,
}

/// Groups viewport-specific state: named viewport registry and per-sheet format palettes.
///
/// This is the first sub-struct extracted from `ComputeEngine` to reduce
/// god-object field sprawl. Both fields are exclusively used by viewport
/// rendering / patch production and have zero entanglement with the mutation
/// pipeline or CellStore.
///
/// ## Interior mutability
///
/// Both inner maps are wrapped in `RefCell` so that `get_viewport_binary` and
/// `get_viewport_binary_delta` can be `&self` reads.
///
/// Palette interning and the sheet→bounds registry are both *observational*
/// caches, not authoritative workbook state — mutating them from a logical
/// read preserves the engine's read contract. `RefCell` is safe
/// here because the engine runs on a dedicated single thread (under the
/// native dispatch loop) or on the main WASM thread via `Rc<RefCell<Engine>>`;
/// nested borrows are impossible by construction because no method reads a
/// palette or registration entry while holding a prior borrow across a call
/// into a method that also borrows.
pub(crate) struct ViewportService {
    /// Named viewport registry for first-class viewport tracking.
    /// Keys are viewport IDs (e.g., "main", "split-bottom"), values are registrations.
    registered_viewports: RefCell<FxHashMap<String, ViewportRegistration>>,
    /// Per-sheet format palettes for binary viewport transfer.
    /// Append-only within a sheet; cleared on sheet switch.
    format_palettes: RefCell<FxHashMap<SheetId, format_palette::FormatPalette>>,
}

impl ViewportService {
    pub fn new() -> Self {
        Self {
            registered_viewports: RefCell::new(FxHashMap::default()),
            format_palettes: RefCell::new(FxHashMap::default()),
        }
    }

    /// Clear all viewport state (used on document reload).
    pub fn clear(&self) {
        self.registered_viewports.borrow_mut().clear();
        self.format_palettes.borrow_mut().clear();
    }

    /// Clear all format palettes without clearing viewport registrations.
    ///
    /// Used when the theme palette changes at runtime — cached format palettes
    /// may contain stale theme-resolved colors and must be rebuilt on the next
    /// viewport render.
    pub fn clear_all_palettes(&self) {
        self.format_palettes.borrow_mut().clear();
    }

    /// Borrow the registered-viewports map for reading. Callers that need
    /// mutable access use [`ViewportService::registered_viewports_mut`].
    pub(super) fn registered_viewports(&self) -> Ref<'_, FxHashMap<String, ViewportRegistration>> {
        self.registered_viewports.borrow()
    }

    /// Borrow the registered-viewports map for mutation.
    pub(super) fn registered_viewports_mut(
        &self,
    ) -> RefMut<'_, FxHashMap<String, ViewportRegistration>> {
        self.registered_viewports.borrow_mut()
    }

    /// Borrow the format-palettes map for reading.
    pub(super) fn format_palettes(
        &self,
    ) -> Ref<'_, FxHashMap<SheetId, format_palette::FormatPalette>> {
        self.format_palettes.borrow()
    }

    /// Borrow the format-palettes map for mutation.
    pub(super) fn format_palettes_mut(
        &self,
    ) -> RefMut<'_, FxHashMap<SheetId, format_palette::FormatPalette>> {
        self.format_palettes.borrow_mut()
    }

    /// Snapshot all viewports registered for a given sheet.
    ///
    /// Returns owned tuples so callers don't hold a `Ref` guard across
    /// subsequent borrows of the registry (e.g. `&mut` inside a render pass).
    pub(crate) fn viewports_for_sheet(&self, sheet_id: &SheetId) -> Vec<(String, ViewportBounds)> {
        self.registered_viewports
            .borrow()
            .iter()
            .filter(|(_, reg)| reg.sheet_id == *sheet_id)
            .map(|(id, reg)| (id.clone(), reg.bounds))
            .collect()
    }
}
