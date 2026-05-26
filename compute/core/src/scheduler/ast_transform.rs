//! AST transformation functions — shifting cell references for CF evaluation and volatility detection.
//!
//! Free functions used by the scheduler for manipulating and inspecting AST nodes.
//! Uses [`AstFold`] for owned tree transformations and [`AstVisitor`] for read-only
//! inspections, eliminating manual recursive match boilerplate.

use super::VOLATILE_FUNCTIONS;

use cell_types::SheetId;
use compute_parser::ASTNode;
use compute_parser::{AstFold, AstVisitor, CellRefNode, RangeRef};
use formula_types::CellRef;

// ---------------------------------------------------------------------------
// CfShifter — AstFold implementation for shift_ast_for_cf
// ---------------------------------------------------------------------------

/// Shifts relative cell references by a row/col delta for CF formula evaluation.
struct CfShifter {
    row_delta: i64,
    col_delta: i64,
    current_sheet: SheetId,
}

impl AstFold for CfShifter {
    fn fold_cell_ref(&mut self, r: CellRefNode) -> ASTNode {
        let shifted = shift_cell_ref(
            &r.reference,
            r.abs_row,
            r.abs_col,
            self.row_delta,
            self.col_delta,
            self.current_sheet,
        );
        ASTNode::CellReference(CellRefNode {
            reference: shifted,
            abs_row: r.abs_row,
            abs_col: r.abs_col,
        })
    }

    fn fold_range(&mut self, r: RangeRef) -> ASTNode {
        let shifted_start = shift_cell_ref(
            &r.start,
            r.abs_start.row,
            r.abs_start.col,
            self.row_delta,
            self.col_delta,
            self.current_sheet,
        );
        let shifted_end = shift_cell_ref(
            &r.end,
            r.abs_end.row,
            r.abs_end.col,
            self.row_delta,
            self.col_delta,
            self.current_sheet,
        );
        ASTNode::Range(RangeRef {
            start: shifted_start,
            end: shifted_end,
            abs_start: r.abs_start,
            abs_end: r.abs_end,
            range_type: r.range_type,
        })
    }

    fn fold_sheet_ref(&mut self, sheet: SheetId, inner: ASTNode) -> ASTNode {
        let prev = self.current_sheet;
        self.current_sheet = sheet;
        let folded = self.fold(inner);
        self.current_sheet = prev;
        ASTNode::SheetRef {
            sheet,
            inner: Box::new(folded),
        }
    }
}

/// Shift cell references in an AST for CF formula evaluation.
///
/// CF formulas are authored relative to the top-left cell of the CF range.
/// When evaluating for a cell at (target_row, target_col), we need to shift
/// relative references by the offset from the top-left (origin_row, origin_col).
///
/// - Relative references (abs_row=false / abs_col=false) are shifted by the delta.
/// - Absolute references ($A$1, abs_row=true / abs_col=true) are NOT shifted.
/// - Mixed references ($A1 or A$1) shift only the non-absolute component.
///
/// The `current_sheet` parameter is used to replace `SheetId(0)` (the placeholder
/// used when parsing without a resolver) with the actual sheet ID.
pub(crate) fn shift_ast_for_cf(
    ast: &ASTNode,
    row_delta: i64,
    col_delta: i64,
    current_sheet: SheetId,
) -> ASTNode {
    let mut shifter = CfShifter {
        row_delta,
        col_delta,
        current_sheet,
    };
    shifter.fold(ast.clone())
}

/// Shift a single CellRef by the given delta, respecting absolute flags.
pub(super) fn shift_cell_ref(
    cell_ref: &CellRef,
    abs_row: bool,
    abs_col: bool,
    row_delta: i64,
    col_delta: i64,
    current_sheet: SheetId,
) -> CellRef {
    match cell_ref {
        CellRef::Positional { sheet, row, col } => {
            let effective_sheet = if sheet.as_u128() == 0 {
                current_sheet
            } else {
                *sheet
            };
            let new_row = if abs_row {
                *row
            } else {
                (*row as i64 + row_delta).max(0) as u32
            };
            let new_col = if abs_col {
                *col
            } else {
                (*col as i64 + col_delta).max(0) as u32
            };
            CellRef::Positional {
                sheet: effective_sheet,
                row: new_row,
                col: new_col,
            }
        }
        // Resolved refs should not appear in CF formulas parsed without a resolver,
        // but if they do, return them unchanged.
        CellRef::Resolved(_) => *cell_ref,
    }
}

// ---------------------------------------------------------------------------
// VolatileChecker — AstVisitor implementation for contains_volatile_function
// ---------------------------------------------------------------------------

/// Checks if any node in the AST is a volatile function call.
#[allow(dead_code)]
struct VolatileChecker {
    found: bool,
}

impl AstVisitor for VolatileChecker {
    fn visit(&mut self, node: &ASTNode) {
        if self.found {
            return;
        }
        self.walk(node);
    }

    fn visit_function(&mut self, name: &str, args: &[ASTNode]) {
        if VOLATILE_FUNCTIONS
            .iter()
            .any(|v| v.eq_ignore_ascii_case(name))
        {
            self.found = true;
            return;
        }
        for arg in args {
            self.visit(arg);
        }
    }
}

/// Check if an AST contains any volatile function calls.
#[allow(dead_code)]
pub(super) fn contains_volatile_function(ast: &ASTNode) -> bool {
    let mut checker = VolatileChecker { found: false };
    checker.visit(ast);
    checker.found
}

// ---------------------------------------------------------------------------
// StructuralPositionalShifter — adjust `CellRef::Positional` refs in the
// cached AST to match a row/col insert or delete on a specific sheet.
// ---------------------------------------------------------------------------
//
// Why this exists
// ---------------
// The scheduler caches an `ASTNode` per formula cell. References to cells
// that *did* exist at parse time are stored as `CellRef::Resolved(CellId)` —
// those auto-track post-shift positions via `mirror.resolve_position`, no
// rewrite needed. References to cells that did *not* exist at parse time
// are stored as `CellRef::Positional { sheet, row, col }` — these encode a
// snapshot position that has no implicit shift on a structural op.
//
// Without this transform, the cached AST keeps the pre-shift positions and:
//   - A positional ref pointing **into** a deleted band silently re-resolves
//     to whatever cell shifted into that slot (instead of `#REF!`).
//   - A positional ref **past** a deleted band still reads the original
//     column/row (now containing a different cell after the shift).
//
// The transform mirrors `mirror.apply_structure_change`'s position model:
//   - For deletes: positional refs in `[at, at+count)` on the affected
//     sheet/axis become `ASTNode::Error(CellError::Ref)`; refs past the
//     band shift back by `count`.
//   - For inserts: positional refs at or past `at` shift forward by `count`.
//   - Refs on **other** sheets are untouched (structural ops are sheet-scoped).
//   - Absolute (`$`) flags do not exempt a ref from the shift here — Excel
//     parity rewrites both relative and absolute refs on row/col delete.
//
// `Resolved` refs are left alone (the mirror's `id_to_pos` is already the
// shifted truth) except the **deletion-by-identity** case: a `Resolved`
// ref to a cell whose backing `CellId` has been retired surfaces `#REF!`
// at eval time naturally, via `get_cell_value_by_ref`'s
// `sheet_for_cell(id).is_none()` check (no AST rewrite needed).

struct StructuralPositionalShifter {
    /// The sheet the structural op applies to. Refs on other sheets are
    /// untouched.
    target_sheet: SheetId,
    /// True iff this op affects rows; otherwise columns.
    is_row: bool,
    /// True iff this op is an insert; otherwise a delete.
    is_insert: bool,
    /// First affected row/col index.
    at: u32,
    /// Number of rows/cols inserted or deleted.
    count: u32,
}

impl StructuralPositionalShifter {
    /// Compute the new ref (or `Some(ASTNode::Error(Ref))` for doomed refs).
    /// Returns `Ok(new_ref)` for a normal shift, `Err(())` for a doomed ref
    /// that the caller must replace with `ASTNode::Error(CellError::Ref)`.
    fn shift_one(&self, r: &CellRef) -> Result<CellRef, ()> {
        let CellRef::Positional { sheet, row, col } = *r else {
            return Ok(*r);
        };
        if sheet != self.target_sheet {
            return Ok(*r);
        }
        let axis_val = if self.is_row { row } else { col };

        let new_axis = if self.is_insert {
            // Inserts shift positions at or past `at` forward by `count`.
            if axis_val >= self.at {
                axis_val + self.count
            } else {
                axis_val
            }
        } else {
            // Deletes: refs in [at, at+count) are doomed; refs past shift back.
            let end = self.at.saturating_add(self.count);
            if axis_val >= self.at && axis_val < end {
                return Err(());
            }
            if axis_val >= end {
                axis_val - self.count
            } else {
                axis_val
            }
        };

        let (new_row, new_col) = if self.is_row {
            (new_axis, col)
        } else {
            (row, new_axis)
        };
        Ok(CellRef::Positional {
            sheet,
            row: new_row,
            col: new_col,
        })
    }
}

impl AstFold for StructuralPositionalShifter {
    fn fold_cell_ref(&mut self, r: CellRefNode) -> ASTNode {
        match self.shift_one(&r.reference) {
            Ok(new_ref) => ASTNode::CellReference(CellRefNode {
                reference: new_ref,
                ..r
            }),
            Err(()) => ASTNode::Error(value_types::CellError::Ref),
        }
    }

    fn fold_range(&mut self, r: RangeRef) -> ASTNode {
        // Range corners can be Positional or Resolved. We only care about
        // Positional corners on the target sheet.
        let start_doomed = self.shift_one(&r.start).is_err();
        let end_doomed = self.shift_one(&r.end).is_err();

        // If either corner is fully inside the doomed band, the entire range
        // collapses to #REF! — Excel parity for `=SUM(A1:B1)` after deleting
        // a column inside the range is `#REF!`. (We don't do the more nuanced
        // single-corner re-anchor here; that's handled at the IdentityFormula
        // layer via `pre_delete_re_anchor_range_refs` for ranges with
        // `Resolved` corners. Positional-corner ranges this aggressive default
        // matches Excel's "if any corner is gone, the whole range is gone".)
        if start_doomed || end_doomed {
            return ASTNode::Error(value_types::CellError::Ref);
        }

        let start = self.shift_one(&r.start).unwrap_or(r.start);
        let end = self.shift_one(&r.end).unwrap_or(r.end);
        ASTNode::Range(RangeRef { start, end, ..r })
    }
}

/// Apply a structural-position transform to an AST.
///
/// Returns the transformed AST. See [`StructuralPositionalShifter`] for the
/// semantic contract.
pub(super) fn shift_ast_for_structure_change(
    ast: &ASTNode,
    target_sheet: SheetId,
    change: &formula_types::StructureChange,
) -> ASTNode {
    use formula_types::StructureChange;
    let (is_row, is_insert, at, count) = match change {
        StructureChange::InsertRows { at, count, .. } => (true, true, *at, *count),
        StructureChange::DeleteRows { at, count, .. } => (true, false, *at, *count),
        StructureChange::InsertCols { at, count, .. } => (false, true, *at, *count),
        StructureChange::DeleteCols { at, count, .. } => (false, false, *at, *count),
        StructureChange::RemapPositions { .. } => return ast.clone(),
    };
    let mut shifter = StructuralPositionalShifter {
        target_sheet,
        is_row,
        is_insert,
        at,
        count,
    };
    shifter.fold(ast.clone())
}
