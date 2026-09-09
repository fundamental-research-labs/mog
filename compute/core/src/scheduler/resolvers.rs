//! Identity resolvers for formula persistence.
//!
//! Immutable parse-time cell references use the shared
//! [`StoreCellRefResolver`](crate::eval_bridge::StoreCellRefResolver).
//! These resolvers create stable identities for empty referenced cells.

use super::*;

// ---------------------------------------------------------------------------
// IdentityResolver implementation for ComputeCore
// ---------------------------------------------------------------------------

#[cfg(feature = "native")]
use dashmap::DashMap;
use std::cell::RefCell;

/// Resolver that wraps a `CellStore` behind `RefCell` for building [`IdentityFormula`]s.
///
/// # Why `RefCell`?
///
/// The [`IdentityResolver`] trait (defined in `compute-parser`) requires `&self` on all
/// methods — `compute-parser` cannot depend on `CellStore`, so the trait must stay
/// object-safe and borrow-agnostic. However, [`IdentityResolver::get_or_create_cell_id`]
/// needs to *mutate* the cell store to allocate [`CellId`]s for empty cells. `RefCell`
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
    pub cell_store: RefCell<&'a mut CellStore>,
    pub id_alloc: &'a IdAllocator,
    pub current_sheet: SheetId,
}

impl IdentityResolver for CoreIdentityResolver<'_> {
    fn get_or_create_cell_id(&self, sheet: &SheetId, row: u32, col: u32) -> CellId {
        self.cell_store
            .borrow_mut()
            .ensure_cell_id(sheet, SheetPos::new(row, col), self.id_alloc)
            .unwrap()
    }

    fn get_row_id(&self, sheet: &SheetId, row: u32) -> Option<RowId> {
        self.cell_store.borrow().row_id_lookup(sheet, row)
    }

    fn get_col_id(&self, sheet: &SheetId, col: u32) -> Option<ColId> {
        self.cell_store.borrow().col_id_lookup(sheet, col)
    }

    fn resolve_sheet_name(&self, name: &str) -> Option<SheetId> {
        self.cell_store.borrow().sheet_by_name(name)
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
/// Uses the immutable `CellStore` for lookups and a shared `DashMap` for
/// concurrent ghost cell ID allocation. Ghost cells are flushed into the
/// cell_store after the parallel phase completes.
pub(super) struct ConcurrentIdentityResolver<'a> {
    pub cell_store: &'a CellStore,
    pub ghost_cells: &'a DashMap<(SheetId, SheetPos), CellId>,
    pub id_alloc: &'a IdAllocator,
    pub current_sheet: SheetId,
}

#[cfg(feature = "native")]
impl IdentityResolver for ConcurrentIdentityResolver<'_> {
    fn get_or_create_cell_id(&self, sheet: &SheetId, row: u32, col: u32) -> CellId {
        let pos = SheetPos::new(row, col);
        // Fast path: cell already exists in cell_store (read-only, no lock)
        if let Some(id) = self.cell_store.resolve_cell_id(sheet, pos) {
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
        self.cell_store.row_id_lookup(sheet, row)
    }

    fn get_col_id(&self, sheet: &SheetId, col: u32) -> Option<ColId> {
        self.cell_store.col_id_lookup(sheet, col)
    }

    fn resolve_sheet_name(&self, name: &str) -> Option<SheetId> {
        self.cell_store.sheet_by_name(name)
    }

    fn current_sheet(&self) -> SheetId {
        self.current_sheet
    }
}
