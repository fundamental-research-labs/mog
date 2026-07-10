//! Identity resolvers for formula persistence.
//!
//! Immutable parse-time cell references use the shared
//! [`MirrorCellRefResolver`](crate::eval_bridge::MirrorCellRefResolver).
//! These resolvers create stable identities for empty referenced cells.

use super::*;

// ---------------------------------------------------------------------------
// IdentityResolver implementation for ComputeCore
// ---------------------------------------------------------------------------

#[cfg(feature = "native")]
use dashmap::DashMap;
use std::cell::RefCell;

/// Resolver that wraps a `CellMirror` behind `RefCell` for building [`IdentityFormula`]s.
///
/// # Why `RefCell`?
///
/// The [`IdentityResolver`] trait (defined in `compute-parser`) requires `&self` on all
/// methods — `compute-parser` cannot depend on `CellMirror`, so the trait must stay
/// object-safe and borrow-agnostic. However, [`IdentityResolver::get_or_create_cell_id`]
/// needs to *mutate* the mirror to allocate [`CellId`]s for empty cells. `RefCell`
/// bridges this gap by providing interior mutability checked at runtime.
///
/// The same `&self` constraint is also required by [`ConcurrentIdentityResolver`], which
/// must be `Sync` for parallel identity resolution — so the trait signature cannot simply
/// be changed to `&mut self`.
///
/// # Safety invariant
///
/// **All `borrow()` and `borrow_mut()` guards are scoped to a single method body and
/// dropped before the method returns.** No guard ever escapes into a caller or is held
/// across multiple method calls. This guarantees that a `borrow()` and `borrow_mut()`
/// can never be alive simultaneously, so the runtime borrow check will never panic.
///
/// **Warning:** Any refactoring that stores a borrow guard in a field, returns one to a
/// caller, or holds one across a call to another method on `self` will violate this
/// invariant and cause a runtime panic.
pub(super) struct CoreIdentityResolver<'a> {
    pub mirror: RefCell<&'a mut CellMirror>,
    pub id_alloc: &'a IdAllocator,
    pub current_sheet: SheetId,
}

impl IdentityResolver for CoreIdentityResolver<'_> {
    fn get_or_create_cell_id(&self, sheet: &SheetId, row: u32, col: u32) -> CellId {
        self.mirror
            .borrow_mut()
            .ensure_cell_id(sheet, SheetPos::new(row, col), self.id_alloc)
            .unwrap()
    }

    fn get_row_id(&self, sheet: &SheetId, row: u32) -> Option<RowId> {
        self.mirror.borrow().row_id_lookup(sheet, row)
    }

    fn get_col_id(&self, sheet: &SheetId, col: u32) -> Option<ColId> {
        self.mirror.borrow().col_id_lookup(sheet, col)
    }

    fn resolve_sheet_name(&self, name: &str) -> Option<SheetId> {
        self.mirror.borrow().sheet_by_name(name)
    }

    fn current_sheet(&self) -> SheetId {
        self.current_sheet
    }
}

// ---------------------------------------------------------------------------
// ConcurrentIdentityResolver for parallel init (native only — uses DashMap)
// ---------------------------------------------------------------------------

#[cfg(feature = "native")]
/// Thread-safe identity resolver for parallel identity resolution during bulk init.
///
/// Uses the immutable `CellMirror` for lookups and a shared `DashMap` for
/// concurrent ghost cell ID allocation. Ghost cells are flushed into the
/// mirror after the parallel phase completes.
pub(super) struct ConcurrentIdentityResolver<'a> {
    pub mirror: &'a CellMirror,
    pub ghost_cells: &'a DashMap<(SheetId, SheetPos), CellId>,
    pub id_alloc: &'a IdAllocator,
    pub current_sheet: SheetId,
}

#[cfg(feature = "native")]
impl IdentityResolver for ConcurrentIdentityResolver<'_> {
    fn get_or_create_cell_id(&self, sheet: &SheetId, row: u32, col: u32) -> CellId {
        let pos = SheetPos::new(row, col);
        // Fast path: cell already exists in mirror (read-only, no lock)
        if let Some(id) = self.mirror.resolve_cell_id(sheet, pos) {
            return id;
        }
        // Check/allocate in concurrent ghost map
        let key = (*sheet, pos);
        *self
            .ghost_cells
            .entry(key)
            .or_insert_with(|| self.id_alloc.next_cell_id())
    }

    fn get_row_id(&self, sheet: &SheetId, row: u32) -> Option<RowId> {
        self.mirror.row_id_lookup(sheet, row)
    }

    fn get_col_id(&self, sheet: &SheetId, col: u32) -> Option<ColId> {
        self.mirror.col_id_lookup(sheet, col)
    }

    fn resolve_sheet_name(&self, name: &str) -> Option<SheetId> {
        self.mirror.sheet_by_name(name)
    }

    fn current_sheet(&self) -> SheetId {
        self.current_sheet
    }
}
