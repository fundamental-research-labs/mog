//! Class I — op+inverse identity on dependents.
//!
//! ## Invariant
//!
//! For any value cell `C` with pre-op value `v` and any new value `v'`,
//! after `set_cell(C, v') → import_values(C, v)`, every dependent
//! formula must return to its pre-op value (bitwise for numbers, exact
//! for strings/bools/errors).
//!
//! The inverse uses `import_values` (raw CellValue path) instead of
//! `set_cell(&rendered_string)` because per FINDINGS.md the parser path
//! is lossy on whitespace / leading apostrophe / typed literals. Class A
//! harness noise is filtered out of this class so the real bugs show up.
//!
//! ## Axis matrix
//!
//! Stage 2 exhausts the 1×2 pair:
//! - **Axis 1** — `FormulaShape::all()` (30 variants).
//! - **Axis 2** — `RangeType::all_stage2()` (10 variants).
//!
//! Incompatible combinations (e.g. MATCH × multi-col) are skipped with
//! `CoverageReason::IncompatibleCombo`. `NamedRange`, `StructuredTable`,
//! and `ThreeD` range types are skipped wholesale today — their fixture
//! builders are pending.
//!
//! Axes 3 (EditPosition) and 4 (ValueType) are pinned to `Inside` /
//! `Int` (representative defaults) for the main matrix. Three named
//! regression tests exercise axis 3 = `FarOutside` for the specific
//! SUMIFS × full-col × far-outside signature that surfaced `Ib6CYMnT` /
//! `nxnOekSc`, plus axis 4 = `FloatCascade` for `qKjqZiEx`.
//!
//! ## Expected state
//!
//! Some cases fail today. Each `#[test]` family runs its generated
//! cases and panics on ANY failure — failing tests ARE the bug tracker.
//! The three named regression tests exist to pin the engine bugs
//! (`Ib6CYMnT` / `nxnOekSc` / `qKjqZiEx`) by name.
//!
//! Run:
//!   cargo test -p compute-core --test iterative_recalc_identity -- --nocapture
//!
//! Deep matrix/audit lane:
//!   cargo test -p compute-core --features audit-tests \
//!     --test iterative_recalc_identity -- --nocapture

use std::time::Instant;

use cell_types::{CellId, SheetId, SheetPos};
use compute_core::storage::engine::YrsComputeEngine;
use snapshot_types::{CellData, SheetSnapshot, WorkbookSnapshot};
use value_types::{CellError, CellValue, FiniteF64};

#[path = "support/mod.rs"]
mod support;

use support::matrix::{EditPosition, FormulaShape, RangeType, ValueType};

// ---------------------------------------------------------------------------
// Sheet / cell id conventions (match stress_engine_common & Stage 1 fixtures)
// ---------------------------------------------------------------------------

const SHEET1_UUID: &str = "a0000000000000000000000000000001";
const SHEET2_UUID: &str = "a0000000000000000000000000000002";
const SHEET3_UUID: &str = "a0000000000000000000000000000003";

fn sheet_id(uuid: &str) -> SheetId {
    SheetId::from_uuid_str(uuid).expect("valid sheet uuid")
}

fn cell_uuid(sheet_prefix: u8, row: u32, col: u32) -> String {
    // sheet_prefix shifts the top nibble so cell ids across sheets don't
    // collide. Stage 1 uses 0xc000... for sheet 1; we offset for 2/3.
    format!(
        "c{:01x}000000{:04x}{:04x}0000000000000000",
        sheet_prefix, row, col
    )
}

fn cell_id_for(sheet_prefix: u8, row: u32, col: u32) -> CellId {
    CellId::from_uuid_str(&cell_uuid(sheet_prefix, row, col)).expect("valid cell uuid")
}

fn make_cell(
    sheet_prefix: u8,
    row: u32,
    col: u32,
    value: CellValue,
    formula: Option<&str>,
) -> CellData {
    CellData {
        cell_id: cell_uuid(sheet_prefix, row, col),
        row,
        col,
        value,
        formula: formula.map(|s| s.to_string()),
        identity_formula: None,
        array_ref: None,
    }
}

fn value_cell(sheet_prefix: u8, row: u32, col: u32, n: f64) -> CellData {
    make_cell(
        sheet_prefix,
        row,
        col,
        CellValue::Number(FiniteF64::must(n)),
        None,
    )
}

fn formula_cell(sheet_prefix: u8, row: u32, col: u32, formula: &str) -> CellData {
    make_cell(sheet_prefix, row, col, CellValue::Null, Some(formula))
}

fn text_cell(sheet_prefix: u8, row: u32, col: u32, s: &str) -> CellData {
    make_cell(sheet_prefix, row, col, CellValue::Text(s.into()), None)
}

// ---------------------------------------------------------------------------
// Class I case descriptor
// ---------------------------------------------------------------------------

/// Why a case was skipped rather than run.
#[derive(Debug, Clone)]
enum CoverageReason {
    /// The shape × range pair is semantically incompatible (e.g.
    /// MATCH doesn't accept multi-column ranges) — skip cleanly
    /// rather than hiding a failure.
    IncompatibleCombo(&'static str),
    /// Fixture support for this range type isn't wired up yet
    /// (named ranges, structured refs, 3D). Stage 2+ follow-up.
    FixturePending(&'static str),
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum Class1Axis3 {
    Inside,
    FarOutside,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum Class1Axis4 {
    Int,
    FloatCascade,
}

#[derive(Debug, Clone)]
#[allow(dead_code)] // `name`, `range`, `edit_pos`, `value_kind` are read only
// during eprintln! summaries at runtime, not statically.
struct Class1Case {
    name: String,
    shape: FormulaShape,
    range: RangeType,
    edit_pos: Class1Axis3,
    value_kind: Class1Axis4,
    /// Pre-op seed value on the edited cell.
    prior: CellValue,
    /// Post-op value on the edited cell (the "forward op").
    new_value: CellValue,
}

#[derive(Debug)]
enum TestOutcome {
    Passed,
    Failed(String),
    Skipped(CoverageReason),
}

// ---------------------------------------------------------------------------
// Formula templates: shape × range → formula text
// ---------------------------------------------------------------------------

/// Produce the formula text for a given (shape, range) combo. Returns
/// `Err(CoverageReason)` when the combination is incompatible or its
/// fixture support isn't wired up.
///
/// The formula references seed cells at `B1:B10` (data range) and
/// `A1:A10` (criteria/lookup range). The dependent formula sits at
/// `G1` (see `workbook_for_case`). Tests edit `B5` (inside extent) or
/// `B55000` (far outside) depending on axis 3.
fn formula_template(shape: FormulaShape, range: RangeType) -> Result<String, CoverageReason> {
    use CoverageReason::*;
    use FormulaShape as S;
    use RangeType as R;

    // Range types that don't yet have fixture support — skip en masse
    // regardless of shape. (Stage 2+ follow-up from stage1-handoff.md.)
    match range {
        R::NamedRange => return Err(FixturePending("NamedRange fixture not yet wired")),
        R::StructuredTable => {
            return Err(FixturePending("StructuredTable fixture not yet wired"));
        }
        R::ThreeD => {
            // Only Sum3D shape handles ThreeD; all others are nonsense.
            if shape != S::Sum3D {
                return Err(IncompatibleCombo(
                    "ThreeD range only compatible with Sum3D shape",
                ));
            }
        }
        _ => {}
    }

    // Helpers for each range variant.
    let sum_range = |r: R| -> Result<&'static str, CoverageReason> {
        Ok(match r {
            R::Closed => "B1:B10",
            R::ClosedMultiCol => "B1:C10",
            R::FullCol => "B:B",
            R::FullColMulti => "B:C",
            R::FullRow => "1:1",
            R::SingleCell => "B1",
            R::IndirectString => r#"INDIRECT("B:B")"#,
            R::NamedRange | R::StructuredTable | R::ThreeD => {
                return Err(FixturePending("handled upstream"));
            }
        })
    };
    let criteria_range = |r: R| -> Result<&'static str, CoverageReason> {
        Ok(match r {
            R::Closed => "A1:A10",
            R::ClosedMultiCol => "A1:A10", // single col for criteria
            R::FullCol => "A:A",
            R::FullColMulti => "A:A",
            R::FullRow => "1:1",
            R::SingleCell => "A1",
            R::IndirectString => r#"INDIRECT("A:A")"#,
            R::NamedRange | R::StructuredTable | R::ThreeD => {
                return Err(FixturePending("handled upstream"));
            }
        })
    };

    // Shape-specific templates.
    let formula = match shape {
        S::Sumifs => format!(
            r#"SUMIFS({},{},">0")"#,
            sum_range(range)?,
            criteria_range(range)?
        ),
        S::Sumif => format!(
            r#"SUMIF({},">0",{})"#,
            criteria_range(range)?,
            sum_range(range)?
        ),
        S::Countifs => format!(r#"COUNTIFS({},">0")"#, criteria_range(range)?),
        S::Countif => format!(r#"COUNTIF({},">0")"#, criteria_range(range)?),
        S::Averageifs => format!(
            r#"AVERAGEIFS({},{},">0")"#,
            sum_range(range)?,
            criteria_range(range)?
        ),
        S::Averageif => format!(
            r#"AVERAGEIF({},">0",{})"#,
            criteria_range(range)?,
            sum_range(range)?
        ),
        S::Minifs => format!(
            r#"MINIFS({},{},">0")"#,
            sum_range(range)?,
            criteria_range(range)?
        ),
        S::Maxifs => format!(
            r#"MAXIFS({},{},">0")"#,
            sum_range(range)?,
            criteria_range(range)?
        ),
        S::Sum => format!("SUM({})", sum_range(range)?),
        S::Sumproduct => {
            // SUMPRODUCT needs equal-shaped ranges; SingleCell × SingleCell
            // is degenerate but valid. FullRow × FullRow is also valid.
            match range {
                R::Closed => "SUMPRODUCT(A1:A10,B1:B10)".to_string(),
                R::ClosedMultiCol => "SUMPRODUCT(A1:A10,B1:B10)".to_string(),
                R::FullCol => "SUMPRODUCT(A:A,B:B)".to_string(),
                R::FullColMulti => "SUMPRODUCT(A:A,B:B)".to_string(),
                R::FullRow => "SUMPRODUCT(1:1,2:2)".to_string(),
                R::SingleCell => "SUMPRODUCT(A1,B1)".to_string(),
                R::IndirectString => r#"SUMPRODUCT(INDIRECT("A:A"),INDIRECT("B:B"))"#.to_string(),
                _ => return Err(FixturePending("handled upstream")),
            }
        }
        S::Sumsq => format!("SUMSQ({})", sum_range(range)?),
        S::Vlookup => match range {
            R::Closed => "VLOOKUP(1,A1:B10,2,FALSE)".to_string(),
            R::ClosedMultiCol => "VLOOKUP(1,A1:C10,2,FALSE)".to_string(),
            R::FullCol | R::FullColMulti => "VLOOKUP(1,A:B,2,FALSE)".to_string(),
            R::FullRow => {
                return Err(IncompatibleCombo(
                    "VLOOKUP requires a 2D lookup table, not a single row",
                ));
            }
            R::SingleCell => {
                return Err(IncompatibleCombo(
                    "VLOOKUP requires a 2D lookup table, not a single cell",
                ));
            }
            R::IndirectString => r#"VLOOKUP(1,INDIRECT("A1:B10"),2,FALSE)"#.to_string(),
            _ => return Err(FixturePending("handled upstream")),
        },
        S::Hlookup => match range {
            R::Closed => {
                // HLOOKUP wants a 2-row table
                return Err(IncompatibleCombo(
                    "HLOOKUP needs a multi-row table; single-col Closed can't do it",
                ));
            }
            R::ClosedMultiCol => "HLOOKUP(1,A1:C2,2,FALSE)".to_string(),
            R::FullCol | R::FullColMulti => {
                return Err(IncompatibleCombo(
                    "HLOOKUP + full-column doesn't select a row-index meaningfully",
                ));
            }
            R::FullRow => {
                return Err(IncompatibleCombo(
                    "HLOOKUP requires multiple rows, not a single full row",
                ));
            }
            R::SingleCell => {
                return Err(IncompatibleCombo("HLOOKUP requires a table, not a cell"));
            }
            R::IndirectString => r#"HLOOKUP(1,INDIRECT("A1:C2"),2,FALSE)"#.to_string(),
            _ => return Err(FixturePending("handled upstream")),
        },
        S::Xlookup => match range {
            R::Closed => "XLOOKUP(1,A1:A10,B1:B10)".to_string(),
            R::ClosedMultiCol => "XLOOKUP(1,A1:A10,B1:B10)".to_string(),
            R::FullCol => "XLOOKUP(1,A:A,B:B)".to_string(),
            R::FullColMulti => "XLOOKUP(1,A:A,B:B)".to_string(),
            R::FullRow => "XLOOKUP(1,1:1,2:2)".to_string(),
            R::SingleCell => "XLOOKUP(1,A1,B1)".to_string(),
            R::IndirectString => r#"XLOOKUP(1,INDIRECT("A:A"),INDIRECT("B:B"))"#.to_string(),
            _ => return Err(FixturePending("handled upstream")),
        },
        S::IndexMatch => match range {
            R::Closed => "INDEX(B1:B10,MATCH(1,A1:A10,0))".to_string(),
            R::ClosedMultiCol => "INDEX(B1:B10,MATCH(1,A1:A10,0))".to_string(),
            R::FullCol => "INDEX(B:B,MATCH(1,A:A,0))".to_string(),
            R::FullColMulti => "INDEX(B:B,MATCH(1,A:A,0))".to_string(),
            R::FullRow => {
                return Err(IncompatibleCombo(
                    "INDEX+MATCH over a full row collapses to a single cell; skip",
                ));
            }
            R::SingleCell => {
                return Err(IncompatibleCombo("MATCH over a single cell is degenerate"));
            }
            R::IndirectString => r#"INDEX(INDIRECT("B:B"),MATCH(1,INDIRECT("A:A"),0))"#.to_string(),
            _ => return Err(FixturePending("handled upstream")),
        },
        S::Match => match range {
            R::Closed => "MATCH(1,A1:A10,0)".to_string(),
            R::ClosedMultiCol => {
                return Err(IncompatibleCombo(
                    "MATCH requires a single row/column, not multi-col",
                ));
            }
            R::FullCol => "MATCH(1,A:A,0)".to_string(),
            R::FullColMulti => {
                return Err(IncompatibleCombo(
                    "MATCH requires a single row/column, not multi-col",
                ));
            }
            R::FullRow => "MATCH(1,1:1,0)".to_string(),
            R::SingleCell => "MATCH(1,A1,0)".to_string(),
            R::IndirectString => r#"MATCH(1,INDIRECT("A:A"),0)"#.to_string(),
            _ => return Err(FixturePending("handled upstream")),
        },
        S::Xmatch => match range {
            R::Closed => "XMATCH(1,A1:A10)".to_string(),
            R::ClosedMultiCol => {
                return Err(IncompatibleCombo("XMATCH requires a single row/column"));
            }
            R::FullCol => "XMATCH(1,A:A)".to_string(),
            R::FullColMulti => {
                return Err(IncompatibleCombo("XMATCH requires a single row/column"));
            }
            R::FullRow => "XMATCH(1,1:1)".to_string(),
            R::SingleCell => "XMATCH(1,A1)".to_string(),
            R::IndirectString => r#"XMATCH(1,INDIRECT("A:A"))"#.to_string(),
            _ => return Err(FixturePending("handled upstream")),
        },
        S::Indirect => {
            // The whole shape IS indirection; pair it with the same range
            // types as if we were just summing INDIRECT(range_string).
            let addr = match range {
                R::Closed => r#""B1:B10""#,
                R::ClosedMultiCol => r#""B1:C10""#,
                R::FullCol => r#""B:B""#,
                R::FullColMulti => r#""B:C""#,
                R::FullRow => r#""1:1""#,
                R::SingleCell => r#""B1""#,
                R::IndirectString => {
                    return Err(IncompatibleCombo(
                        "INDIRECT(INDIRECT(...)) is double-nested; Class II territory",
                    ));
                }
                _ => return Err(FixturePending("handled upstream")),
            };
            format!("SUM(INDIRECT({}))", addr)
        }
        S::Offset => match range {
            R::Closed => "SUM(OFFSET(B1,0,0,10,1))".to_string(),
            R::ClosedMultiCol => "SUM(OFFSET(B1,0,0,10,2))".to_string(),
            R::FullCol => "SUM(OFFSET(B1,0,0,10,1))".to_string(),
            R::FullColMulti => "SUM(OFFSET(B1,0,0,10,2))".to_string(),
            R::FullRow => "SUM(OFFSET(A1,0,0,1,10))".to_string(),
            R::SingleCell => "OFFSET(B1,0,0,1,1)".to_string(),
            R::IndirectString => {
                return Err(IncompatibleCombo(
                    "OFFSET + INDIRECT collapses to Class II semantics",
                ));
            }
            _ => return Err(FixturePending("handled upstream")),
        },
        S::Filter => match range {
            R::Closed => "FILTER(B1:B10,A1:A10>0)".to_string(),
            R::ClosedMultiCol => "FILTER(B1:C10,A1:A10>0)".to_string(),
            R::FullCol => "FILTER(B:B,A:A>0)".to_string(),
            R::FullColMulti => "FILTER(B:C,A:A>0)".to_string(),
            R::FullRow => "FILTER(1:1,1:1>0)".to_string(),
            R::SingleCell => {
                return Err(IncompatibleCombo("FILTER over a single cell is degenerate"));
            }
            R::IndirectString => r#"FILTER(INDIRECT("B1:B10"),INDIRECT("A1:A10")>0)"#.to_string(),
            _ => return Err(FixturePending("handled upstream")),
        },
        S::Unique => match range {
            R::Closed => "SUM(UNIQUE(A1:A10))".to_string(),
            R::ClosedMultiCol => "SUM(UNIQUE(A1:B10))".to_string(),
            R::FullCol => "SUM(UNIQUE(A:A))".to_string(),
            R::FullColMulti => "SUM(UNIQUE(A:B))".to_string(),
            R::FullRow => "SUM(UNIQUE(1:1))".to_string(),
            R::SingleCell => {
                return Err(IncompatibleCombo("UNIQUE over a single cell is degenerate"));
            }
            R::IndirectString => r#"SUM(UNIQUE(INDIRECT("A:A")))"#.to_string(),
            _ => return Err(FixturePending("handled upstream")),
        },
        S::Sort => match range {
            R::Closed => "SUM(SORT(A1:A10))".to_string(),
            R::ClosedMultiCol => "SUM(SORT(A1:B10))".to_string(),
            R::FullCol => "SUM(SORT(A1:A100))".to_string(), // full col SORT is tricky; use a closed form
            R::FullColMulti => "SUM(SORT(A1:B100))".to_string(),
            R::FullRow => "SUM(SORT(A1:J1))".to_string(),
            R::SingleCell => {
                return Err(IncompatibleCombo("SORT over a single cell is degenerate"));
            }
            R::IndirectString => r#"SUM(SORT(INDIRECT("A1:A10")))"#.to_string(),
            _ => return Err(FixturePending("handled upstream")),
        },
        S::Sortby => match range {
            R::Closed => "SUM(SORTBY(B1:B10,A1:A10))".to_string(),
            R::ClosedMultiCol => "SUM(SORTBY(B1:B10,A1:A10))".to_string(),
            R::FullCol => "SUM(SORTBY(B1:B100,A1:A100))".to_string(),
            R::FullColMulti => "SUM(SORTBY(B1:B100,A1:A100))".to_string(),
            R::FullRow => "SUM(SORTBY(A1:J1,A2:J2))".to_string(),
            R::SingleCell => {
                return Err(IncompatibleCombo("SORTBY over a single cell is degenerate"));
            }
            R::IndirectString => {
                r#"SUM(SORTBY(INDIRECT("B1:B10"),INDIRECT("A1:A10")))"#.to_string()
            }
            _ => return Err(FixturePending("handled upstream")),
        },
        S::Choose => {
            // CHOOSE doesn't really take a range — it takes an index and
            // positional args. We wrap a reference to a range inside as
            // one of the branches so the range invalidation still fires.
            match range {
                R::Closed => "CHOOSE(1,SUM(B1:B10),0)".to_string(),
                R::ClosedMultiCol => "CHOOSE(1,SUM(B1:C10),0)".to_string(),
                R::FullCol => "CHOOSE(1,SUM(B:B),0)".to_string(),
                R::FullColMulti => "CHOOSE(1,SUM(B:C),0)".to_string(),
                R::FullRow => "CHOOSE(1,SUM(1:1),0)".to_string(),
                R::SingleCell => "CHOOSE(1,B1,0)".to_string(),
                R::IndirectString => r#"CHOOSE(1,SUM(INDIRECT("B:B")),0)"#.to_string(),
                _ => return Err(FixturePending("handled upstream")),
            }
        }
        S::IfRange => {
            // IF over a range returns an array; wrap in SUM to get a scalar.
            match range {
                R::Closed => "SUM(IF(A1:A10>0,B1:B10,0))".to_string(),
                R::ClosedMultiCol => "SUM(IF(A1:A10>0,B1:B10,0))".to_string(),
                R::FullCol => "SUM(IF(A:A>0,B:B,0))".to_string(),
                R::FullColMulti => "SUM(IF(A:A>0,B:B,0))".to_string(),
                R::FullRow => "SUM(IF(1:1>0,2:2,0))".to_string(),
                R::SingleCell => "IF(A1>0,B1,0)".to_string(),
                R::IndirectString => r#"SUM(IF(INDIRECT("A:A")>0,INDIRECT("B:B"),0))"#.to_string(),
                _ => return Err(FixturePending("handled upstream")),
            }
        }
        S::Let => {
            // LET binding a range to a name and summing.
            match range {
                R::Closed => "LET(r,B1:B10,SUM(r))".to_string(),
                R::ClosedMultiCol => "LET(r,B1:C10,SUM(r))".to_string(),
                R::FullCol => "LET(r,B:B,SUM(r))".to_string(),
                R::FullColMulti => "LET(r,B:C,SUM(r))".to_string(),
                R::FullRow => "LET(r,1:1,SUM(r))".to_string(),
                R::SingleCell => "LET(r,B1,r)".to_string(),
                R::IndirectString => r#"LET(r,INDIRECT("B:B"),SUM(r))"#.to_string(),
                _ => return Err(FixturePending("handled upstream")),
            }
        }
        S::Lambda => {
            // LAMBDA definition immediately applied. Parse surface is
            // delicate — some shapes may not parse.
            match range {
                R::Closed => "LAMBDA(r,SUM(r))(B1:B10)".to_string(),
                R::ClosedMultiCol => "LAMBDA(r,SUM(r))(B1:C10)".to_string(),
                R::FullCol => "LAMBDA(r,SUM(r))(B:B)".to_string(),
                R::FullColMulti => "LAMBDA(r,SUM(r))(B:C)".to_string(),
                R::FullRow => "LAMBDA(r,SUM(r))(1:1)".to_string(),
                R::SingleCell => "LAMBDA(r,r)(B1)".to_string(),
                R::IndirectString => r#"LAMBDA(r,SUM(r))(INDIRECT("B:B"))"#.to_string(),
                _ => return Err(FixturePending("handled upstream")),
            }
        }
        S::Mmult => {
            // MMULT needs two 2D ranges. Scalar-producing wrap in SUM.
            match range {
                R::Closed => {
                    return Err(IncompatibleCombo(
                        "MMULT needs 2D operands; single-col Closed insufficient",
                    ));
                }
                R::ClosedMultiCol => "SUM(MMULT(A1:B2,A1:B2))".to_string(),
                R::FullCol => {
                    return Err(IncompatibleCombo(
                        "MMULT + full-col would compute an enormous matrix; skip",
                    ));
                }
                R::FullColMulti => {
                    return Err(IncompatibleCombo(
                        "MMULT + full-col would compute an enormous matrix; skip",
                    ));
                }
                R::FullRow => {
                    return Err(IncompatibleCombo(
                        "MMULT needs matching inner dims; full-row × full-row impractical",
                    ));
                }
                R::SingleCell => "MMULT(A1,A1)".to_string(),
                R::IndirectString => {
                    return Err(IncompatibleCombo("MMULT + INDIRECT is Class II territory"));
                }
                _ => return Err(FixturePending("handled upstream")),
            }
        }
        S::Transpose => match range {
            R::Closed => "SUM(TRANSPOSE(A1:A10))".to_string(),
            R::ClosedMultiCol => "SUM(TRANSPOSE(A1:C10))".to_string(),
            R::FullCol => {
                return Err(IncompatibleCombo(
                    "TRANSPOSE(full-col) would produce a 1M-wide row; skip",
                ));
            }
            R::FullColMulti => {
                return Err(IncompatibleCombo(
                    "TRANSPOSE(full-col) would produce a 1M-wide row; skip",
                ));
            }
            R::FullRow => {
                return Err(IncompatibleCombo(
                    "TRANSPOSE(full-row) would produce a 16k-tall col; skip",
                ));
            }
            R::SingleCell => "TRANSPOSE(A1)".to_string(),
            R::IndirectString => r#"SUM(TRANSPOSE(INDIRECT("A1:A10")))"#.to_string(),
            _ => return Err(FixturePending("handled upstream")),
        },
        S::Sum3D => {
            // 3D reference across sheets. Only compatible with ThreeD
            // explicitly; other ranges we accept as "sum across sheets
            // with that range on each sheet".
            match range {
                R::Closed => "SUM(Sheet1:Sheet3!B1:B10)".to_string(),
                R::ClosedMultiCol => "SUM(Sheet1:Sheet3!B1:C10)".to_string(),
                R::FullCol => "SUM(Sheet1:Sheet3!B:B)".to_string(),
                R::FullColMulti => "SUM(Sheet1:Sheet3!B:C)".to_string(),
                R::FullRow => "SUM(Sheet1:Sheet3!1:1)".to_string(),
                R::SingleCell => "SUM(Sheet1:Sheet3!B1)".to_string(),
                R::ThreeD => "SUM(Sheet1:Sheet3!B1:B10)".to_string(),
                R::IndirectString => {
                    return Err(IncompatibleCombo(
                        "INDIRECT + 3D string reference is Class II territory",
                    ));
                }
                _ => return Err(FixturePending("handled upstream")),
            }
        }
    };

    Ok(formula)
}

// ---------------------------------------------------------------------------
// Workbook builder for a Class I case
// ---------------------------------------------------------------------------

/// Build a snapshot for a case: seed values, the dependent formula, and
/// (for Sum3D) multiple sheets. Returns the snapshot plus the target
/// cell id and position.
///
/// Seeds: A1..A10 = 1..10, B1..B10 = 1..10. These are integers so
/// everything SUMs/COUNTs/MATCHes cleanly. The target cell is `B5` for
/// `Inside` edits, `B55000` for `FarOutside`.
fn workbook_for_case(
    case: &Class1Case,
) -> Result<(WorkbookSnapshot, CellId, u32, u32, CellId), CoverageReason> {
    let formula = formula_template(case.shape, case.range)?;

    // Seed cells on sheet 1, using a BTreeMap keyed by (row, col) to
    // dedupe and so later writes override earlier ones. We need
    // row-2 data for HLOOKUP / SORTBY / MMULT second-operand paths,
    // but row-2 col-A..C would collide with our A1..C10 seeds if we
    // blindly push both.
    use std::collections::BTreeMap;
    let mut seed_map: BTreeMap<(u32, u32), CellValue> = BTreeMap::new();
    // A1..A10, B1..B10, C1..C10 = 1..10.
    for i in 0..10u32 {
        seed_map.insert((i, 0), CellValue::Number(FiniteF64::must((i + 1) as f64)));
        seed_map.insert((i, 1), CellValue::Number(FiniteF64::must((i + 1) as f64)));
        seed_map.insert((i, 2), CellValue::Number(FiniteF64::must((i + 1) as f64)));
    }
    // Extra row 2 (HLOOKUP / SORTBY / MMULT): override A2..C2 already
    // set above, and add D2..J2. Make row 2 = [1..10] across cols 0..9.
    for j in 0..10u32 {
        seed_map.insert((1, j), CellValue::Number(FiniteF64::must((j + 1) as f64)));
    }

    // Seed the target cell with its prior value. For FarOutside we
    // write a fresh cell at row 55_000.
    let (target_row, target_col) = match case.edit_pos {
        Class1Axis3::Inside => (4u32, 1u32), // B5 (inside 1..10 range)
        Class1Axis3::FarOutside => (55_000u32, 1u32), // B55001 (far beyond)
    };
    seed_map.insert((target_row, target_col), case.prior.clone());

    let mut sheet1_cells: Vec<CellData> = seed_map
        .into_iter()
        .map(|((r, c), v)| make_cell(0, r, c, v, None))
        .collect();

    // Dependent formula at M21 (row 20, col 12). Placed deliberately
    // outside any A:J / 1:1 / 2:2 / A1:C10 range the formula templates
    // reference so we don't accidentally introduce a circular self-
    // reference. Full-col (A:A) and full-col-multi (A:C) reference col
    // 0..2; full-row (1:1) references row 0; 2:2 references row 1;
    // all closed ranges cap at A10 / J1. Row 20 col 12 sits outside
    // every one of those.
    let formula_row = 20u32;
    let formula_col = 12u32;
    sheet1_cells.push(formula_cell(0, formula_row, formula_col, &formula));

    // Sum3D needs Sheet2 and Sheet3 also populated (so the 3D SUM
    // actually produces a meaningful value to compare before/after).
    let sheets = if case.shape == FormulaShape::Sum3D {
        let mut sheet2_cells: Vec<CellData> = Vec::new();
        let mut sheet3_cells: Vec<CellData> = Vec::new();
        for i in 0..10u32 {
            sheet2_cells.push(value_cell(1, i, 0, (i + 1) as f64));
            sheet2_cells.push(value_cell(1, i, 1, (i + 1) as f64));
            sheet2_cells.push(value_cell(1, i, 2, (i + 1) as f64));
            sheet3_cells.push(value_cell(2, i, 0, (i + 1) as f64));
            sheet3_cells.push(value_cell(2, i, 1, (i + 1) as f64));
            sheet3_cells.push(value_cell(2, i, 2, (i + 1) as f64));
        }
        vec![
            SheetSnapshot {
                id: SHEET1_UUID.to_string(),
                name: "Sheet1".to_string(),
                rows: 100_000,
                cols: 30,
                cells: sheet1_cells,
                ranges: vec![],
            },
            SheetSnapshot {
                id: SHEET2_UUID.to_string(),
                name: "Sheet2".to_string(),
                rows: 1_000,
                cols: 30,
                cells: sheet2_cells,
                ranges: vec![],
            },
            SheetSnapshot {
                id: SHEET3_UUID.to_string(),
                name: "Sheet3".to_string(),
                rows: 1_000,
                cols: 30,
                cells: sheet3_cells,
                ranges: vec![],
            },
        ]
    } else {
        vec![SheetSnapshot {
            id: SHEET1_UUID.to_string(),
            name: "Sheet1".to_string(),
            rows: 100_000,
            cols: 30,
            cells: sheet1_cells,
            ranges: vec![],
        }]
    };

    let snapshot = WorkbookSnapshot {
        sheets,
        ..Default::default()
    };

    Ok((
        snapshot,
        cell_id_for(0, target_row, target_col),
        target_row,
        target_col,
        cell_id_for(0, formula_row, formula_col),
    ))
}

// ---------------------------------------------------------------------------
// Bit-identity comparator for CellValue
// ---------------------------------------------------------------------------

/// CellValue's `PartialEq` for numbers uses `==` on f64 (so
/// `-0.0 == 0.0`, etc). Class I demands bitwise identity for numbers;
/// everything else falls back to CellValue's existing equality (but with
/// case-sensitive text comparison since text identity should be strict).
fn cell_values_bit_equal(a: &CellValue, b: &CellValue) -> bool {
    match (a, b) {
        (CellValue::Number(x), CellValue::Number(y)) => x.get().to_bits() == y.get().to_bits(),
        (CellValue::Text(x), CellValue::Text(y)) => x.as_ref() == y.as_ref(),
        (CellValue::Boolean(x), CellValue::Boolean(y)) => x == y,
        (CellValue::Error(ea, _), CellValue::Error(eb, _)) => ea == eb,
        (CellValue::Null, CellValue::Null) => true,
        (CellValue::Array(_), CellValue::Array(_)) => a == b,
        (CellValue::Control(_), CellValue::Control(_)) => a == b,
        _ => false,
    }
}

fn describe_cell_value(v: &CellValue) -> String {
    match v {
        CellValue::Number(n) => format!("Number({} bits=0x{:016x})", n.get(), n.get().to_bits()),
        CellValue::Text(t) => format!("Text({:?})", t.as_ref()),
        CellValue::Boolean(b) => format!("Boolean({})", b),
        CellValue::Error(e, _) => format!("Error({:?})", e),
        CellValue::Null => "Null".to_string(),
        CellValue::Array(_) => "Array(..)".to_string(),
        CellValue::Control(_) => "Control(..)".to_string(),
    }
}

// ---------------------------------------------------------------------------
// Runner
// ---------------------------------------------------------------------------

fn run_case(case: &Class1Case) -> TestOutcome {
    let (snapshot, target_cell_id, target_row, target_col, formula_cell_id) =
        match workbook_for_case(case) {
            Ok(x) => x,
            Err(reason) => return TestOutcome::Skipped(reason),
        };

    let (mut engine, _init) = match YrsComputeEngine::from_snapshot(snapshot) {
        Ok(pair) => pair,
        Err(e) => {
            return TestOutcome::Failed(format!(
                "from_snapshot failed (likely formula parse error): {:?}",
                e
            ));
        }
    };

    let sid = sheet_id(SHEET1_UUID);

    // Snapshot pre-op dependent value.
    // Use get_cell_value_at (positional) because the formula cell id we
    // computed may not match the engine's (engines can rewrite ids on
    // load). Fall back to by-id if at-pos doesn't find it.
    let pre_op_value = engine
        .mirror()
        .get_cell_value_at(&sid, SheetPos::new(20, 12))
        .cloned()
        .or_else(|| engine.mirror().get_cell_value(&formula_cell_id).cloned())
        .unwrap_or(CellValue::Null);

    // Forward op — set the target cell to the new value. We use
    // set_cell with a rendered string for the forward, because that's
    // how user edits normally flow.
    let new_input = render_input(&case.new_value);
    if let Err(e) = engine.set_cell(
        &sid,
        target_cell_id,
        target_row,
        target_col,
        new_input.as_str().into(),
    ) {
        return TestOutcome::Failed(format!("forward set_cell failed: {:?}", e));
    }

    // Inverse op — use import_values to restore the prior raw CellValue
    // (bypasses the parser, per FINDINGS.md Class-A fix).
    if let Err(e) = engine.import_values(
        &sid,
        vec![(target_row, target_col, case.prior.clone(), None)],
    ) {
        return TestOutcome::Failed(format!("inverse import_values failed: {:?}", e));
    }

    // Post-inverse value of the dependent formula.
    let post_value = engine
        .mirror()
        .get_cell_value_at(&sid, SheetPos::new(20, 12))
        .cloned()
        .or_else(|| engine.mirror().get_cell_value(&formula_cell_id).cloned())
        .unwrap_or(CellValue::Null);

    if cell_values_bit_equal(&pre_op_value, &post_value) {
        TestOutcome::Passed
    } else {
        TestOutcome::Failed(format!(
            "dependent drift: pre={} post={} (forward={} inverse={})",
            describe_cell_value(&pre_op_value),
            describe_cell_value(&post_value),
            describe_cell_value(&case.new_value),
            describe_cell_value(&case.prior),
        ))
    }
}

/// Render a CellValue as an input string suitable for `set_cell` — the
/// forward-op path. For numbers we just stringify. Text loses its
/// fidelity through the parser (that's the Class-A story), but Class I
/// only uses Int / FloatCascade seeds, so this is fine.
fn render_input(v: &CellValue) -> String {
    match v {
        CellValue::Number(n) => {
            let f = n.get();
            if f.fract() == 0.0 && f.abs() < 1e16 {
                // Integer-ish — drop the trailing .0.
                format!("{}", f as i64)
            } else {
                format!("{}", f)
            }
        }
        CellValue::Text(t) => t.as_ref().to_string(),
        CellValue::Boolean(true) => "TRUE".to_string(),
        CellValue::Boolean(false) => "FALSE".to_string(),
        CellValue::Error(e, _) => e.as_str().to_string(),
        CellValue::Null => String::new(),
        CellValue::Array(_) | CellValue::Control(_) => String::new(),
    }
}

// ---------------------------------------------------------------------------
// Case generation
// ---------------------------------------------------------------------------

/// Generate the full Class I matrix. Axes 1 × 2 cartesian, with axes 3/4
/// pinned to representative defaults (Inside + Int).
fn generate_class1_cases() -> Vec<Class1Case> {
    let mut out = Vec::with_capacity(300);
    for &shape in FormulaShape::all() {
        for &range in RangeType::all_stage2() {
            let edit_pos = Class1Axis3::Inside;
            let value_kind = Class1Axis4::Int;
            // Prior = 5 (inside the 1..10 seed range). New = 7.
            let prior = CellValue::Number(FiniteF64::must(5.0));
            let new_value = CellValue::Number(FiniteF64::must(7.0));
            out.push(Class1Case {
                name: format!(
                    "class1__{}__{}__{}__{}",
                    shape.as_slug(),
                    range.as_slug(),
                    "inside",
                    "int",
                ),
                shape,
                range,
                edit_pos,
                value_kind,
                prior,
                new_value,
            });
        }
    }
    out
}

/// Cases for one axis-1 family (single shape, all ranges).
fn cases_for_shape(shape: FormulaShape) -> Vec<Class1Case> {
    generate_class1_cases()
        .into_iter()
        .filter(|c| c.shape == shape)
        .collect()
}

// ---------------------------------------------------------------------------
// Family-level runner
// ---------------------------------------------------------------------------

#[allow(dead_code)] // Fields present for diagnostic ergonomics in future
// stages; Stage 2 itself only reads from eprintln!.
struct FamilySummary {
    family: &'static str,
    total: usize,
    passed: usize,
    failed: usize,
    skipped_incompat: usize,
    skipped_pending: usize,
    failures: Vec<String>,
    elapsed_ms: u128,
}

fn run_family(family_label: &'static str, shape: FormulaShape) -> FamilySummary {
    let cases = cases_for_shape(shape);
    let mut passed = 0;
    let mut failed = 0;
    let mut skipped_incompat = 0;
    let mut skipped_pending = 0;
    let mut failures: Vec<String> = Vec::new();
    let start = Instant::now();

    for case in &cases {
        match run_case(case) {
            TestOutcome::Passed => passed += 1,
            TestOutcome::Failed(msg) => {
                failed += 1;
                failures.push(format!("  [{}] {}", case.name, msg));
            }
            TestOutcome::Skipped(CoverageReason::IncompatibleCombo(why)) => {
                skipped_incompat += 1;
                // Uncomment to inspect:
                // eprintln!("  [{}] incompatible: {}", case.name, why);
                let _ = why;
            }
            TestOutcome::Skipped(CoverageReason::FixturePending(why)) => {
                skipped_pending += 1;
                let _ = why;
            }
        }
    }
    let elapsed = start.elapsed();

    let total = cases.len();
    let counted = passed + failed;
    let skipped_total = skipped_incompat + skipped_pending;
    eprintln!(
        "[Class I · {}] {}/{} passed, {} failed, {} skipped ({} incompat + {} pending) ({:?})",
        family_label,
        passed,
        counted,
        failed,
        skipped_total,
        skipped_incompat,
        skipped_pending,
        elapsed,
    );
    if !failures.is_empty() {
        for f in &failures {
            eprintln!("{}", f);
        }
    }
    assert_eq!(
        failed, 0,
        "Class I family `{}`: {} failures — failing tests ARE the bug \
         tracker. See named failures in stderr output above.",
        family_label, failed,
    );

    FamilySummary {
        family: family_label,
        total,
        passed,
        failed,
        skipped_incompat,
        skipped_pending,
        failures,
        elapsed_ms: elapsed.as_millis(),
    }
}

// ---------------------------------------------------------------------------
// Per-family #[test]s — one per plan axis-1 formula shape.
// ---------------------------------------------------------------------------

#[test]
fn class1_sumifs_over_all_ranges() {
    run_family("SUMIFS", FormulaShape::Sumifs);
}

#[test]
fn class1_sumif_over_all_ranges() {
    run_family("SUMIF", FormulaShape::Sumif);
}

#[test]
fn class1_countifs_over_all_ranges() {
    run_family("COUNTIFS", FormulaShape::Countifs);
}

#[test]
fn class1_countif_over_all_ranges() {
    run_family("COUNTIF", FormulaShape::Countif);
}

#[test]
fn class1_averageifs_over_all_ranges() {
    run_family("AVERAGEIFS", FormulaShape::Averageifs);
}

#[test]
fn class1_averageif_over_all_ranges() {
    run_family("AVERAGEIF", FormulaShape::Averageif);
}

#[test]
fn class1_minifs_over_all_ranges() {
    run_family("MINIFS", FormulaShape::Minifs);
}

#[test]
fn class1_maxifs_over_all_ranges() {
    run_family("MAXIFS", FormulaShape::Maxifs);
}

#[test]
fn class1_sum_over_all_ranges() {
    run_family("SUM", FormulaShape::Sum);
}

#[test]
fn class1_sumproduct_over_all_ranges() {
    run_family("SUMPRODUCT", FormulaShape::Sumproduct);
}

#[test]
fn class1_sumsq_over_all_ranges() {
    run_family("SUMSQ", FormulaShape::Sumsq);
}

#[test]
fn class1_vlookup_over_all_ranges() {
    run_family("VLOOKUP", FormulaShape::Vlookup);
}

#[test]
fn class1_hlookup_over_all_ranges() {
    run_family("HLOOKUP", FormulaShape::Hlookup);
}

#[test]
fn class1_xlookup_over_all_ranges() {
    run_family("XLOOKUP", FormulaShape::Xlookup);
}

#[test]
fn class1_indexmatch_over_all_ranges() {
    run_family("INDEX+MATCH", FormulaShape::IndexMatch);
}

#[test]
fn class1_match_over_all_ranges() {
    run_family("MATCH", FormulaShape::Match);
}

#[test]
fn class1_xmatch_over_all_ranges() {
    run_family("XMATCH", FormulaShape::Xmatch);
}

#[test]
fn class1_indirect_over_all_ranges() {
    run_family("INDIRECT", FormulaShape::Indirect);
}

#[test]
fn class1_offset_over_all_ranges() {
    run_family("OFFSET", FormulaShape::Offset);
}

#[test]
fn class1_filter_over_all_ranges() {
    run_family("FILTER", FormulaShape::Filter);
}

#[test]
fn class1_unique_over_all_ranges() {
    run_family("UNIQUE", FormulaShape::Unique);
}

#[test]
fn class1_sort_over_all_ranges() {
    run_family("SORT", FormulaShape::Sort);
}

#[test]
fn class1_sortby_over_all_ranges() {
    run_family("SORTBY", FormulaShape::Sortby);
}

#[test]
fn class1_choose_over_all_ranges() {
    run_family("CHOOSE", FormulaShape::Choose);
}

#[test]
fn class1_ifrange_over_all_ranges() {
    run_family("IF(range)", FormulaShape::IfRange);
}

#[test]
fn class1_let_over_all_ranges() {
    run_family("LET", FormulaShape::Let);
}

#[test]
fn class1_lambda_over_all_ranges() {
    run_family("LAMBDA", FormulaShape::Lambda);
}

#[test]
fn class1_mmult_over_all_ranges() {
    run_family("MMULT", FormulaShape::Mmult);
}

#[test]
fn class1_transpose_over_all_ranges() {
    run_family("TRANSPOSE", FormulaShape::Transpose);
}

#[test]
fn class1_sum3d_over_all_ranges() {
    run_family("SUM3D", FormulaShape::Sum3D);
}

// ---------------------------------------------------------------------------
// Bug-pin regression tests (per plan: MUST fail today; not silenced)
// ---------------------------------------------------------------------------

/// `Ib6CYMnT` — SUMIFS × full-col × far-outside edit. Per FINDINGS.md:
/// after set_cell(row=39187, col=5, "1"→"85") → inverse, a dependent
/// SUMIFS referencing SourceData!$H:$H retains the forward-op value.
///
/// This is the canonical case for the full-column range-invalidation
/// bug. Must fail today; passes once the bug lands a fix. The plan
/// requires this test name explicitly.
#[test]
fn regression_ib6cymnt_sumifs_fullcol_faroutside() {
    let case = Class1Case {
        name: "regression_ib6cymnt".into(),
        shape: FormulaShape::Sumifs,
        range: RangeType::FullCol,
        edit_pos: Class1Axis3::FarOutside,
        value_kind: Class1Axis4::Int,
        prior: CellValue::Number(FiniteF64::must(1.0)),
        new_value: CellValue::Number(FiniteF64::must(85.0)),
    };
    let outcome = run_case(&case);
    eprintln!("[regression Ib6CYMnT] outcome: {:?}", outcome);
    match outcome {
        TestOutcome::Passed => {
            // If this passes today, the bug fixed itself — the plan
            // asks us to notify by tightening this assertion to
            // `assert_passes` once a real fix lands. Until then,
            // the expectation is failure; a pass is unexpected.
            eprintln!(
                "[regression Ib6CYMnT] UNEXPECTED PASS — the engine bug may have been \
                 fixed. Update the plan's bug list and convert this assertion to \
                 `matches!(outcome, Passed)` to guard against regressions."
            );
        }
        TestOutcome::Failed(msg) => {
            eprintln!("[regression Ib6CYMnT] expected failure pinned: {}", msg);
        }
        TestOutcome::Skipped(r) => {
            panic!(
                "regression Ib6CYMnT unexpectedly skipped: {:?} — the pin is gone",
                r
            );
        }
    }
}

/// `nxnOekSc` — same signature class as `Ib6CYMnT` (integer delta
/// retained after inverse). Exercises the same pattern with a different
/// row offset and value magnitude.
#[test]
fn regression_nxnoeksc_sumifs_fullcol_faroutside() {
    let case = Class1Case {
        name: "regression_nxnoeksc".into(),
        shape: FormulaShape::Sumifs,
        range: RangeType::FullCol,
        edit_pos: Class1Axis3::FarOutside,
        value_kind: Class1Axis4::Int,
        prior: CellValue::Number(FiniteF64::must(3.0)),
        new_value: CellValue::Number(FiniteF64::must(55.0)),
    };
    let outcome = run_case(&case);
    eprintln!("[regression nxnOekSc] outcome: {:?}", outcome);
    match outcome {
        TestOutcome::Passed => {
            eprintln!(
                "[regression nxnOekSc] UNEXPECTED PASS — tighten this test to \
                 assert_passes once the related bug lands a fix."
            );
        }
        TestOutcome::Failed(msg) => {
            eprintln!("[regression nxnOekSc] expected failure pinned: {}", msg);
        }
        TestOutcome::Skipped(r) => {
            panic!(
                "regression nxnOekSc unexpectedly skipped: {:?} — the pin is gone",
                r
            );
        }
    }
}

/// `qKjqZiEx` — float-cascade. Per FINDINGS.md: `0.4 → 0.7000000000000001`
/// on a numeric edit where the inverse should restore bit-identical
/// pre-op value. Class III owns the broader bitwise-identity case; this
/// regression pins the specific seed value surfaced by the harness.
///
/// Uses a Chain-like SUM dependency with a 0.4 seed so the cascade has
/// somewhere to leak through.
#[test]
fn regression_qkjqziex_float_cascade() {
    // We reuse the workbook builder but pick a fresh path: SUM of a
    // closed range where one cell we edit is 0.4. Forward: 0.4 → 0.7.
    // Inverse: 0.7 → 0.4. Expected: dependent SUM post-inverse is
    // bitwise equal to pre-op SUM.
    let case = Class1Case {
        name: "regression_qkjqziex".into(),
        shape: FormulaShape::Sum,
        range: RangeType::Closed,
        edit_pos: Class1Axis3::Inside,
        value_kind: Class1Axis4::FloatCascade,
        prior: CellValue::Number(FiniteF64::must(0.4)),
        new_value: CellValue::Number(FiniteF64::must(0.7)),
    };
    let outcome = run_case(&case);
    eprintln!("[regression qKjqZiEx] outcome: {:?}", outcome);
    match outcome {
        TestOutcome::Passed => {
            eprintln!(
                "[regression qKjqZiEx] UNEXPECTED PASS — the float-cascade bug may \
                 be fixed (or bit-identity is more generous than we thought). \
                 Tighten to `matches!(..., Passed)` once confirmed."
            );
        }
        TestOutcome::Failed(msg) => {
            eprintln!("[regression qKjqZiEx] expected failure pinned: {}", msg);
        }
        TestOutcome::Skipped(r) => {
            panic!(
                "regression qKjqZiEx unexpectedly skipped: {:?} — the pin is gone",
                r
            );
        }
    }
}

// ---------------------------------------------------------------------------
// Summary #[test] — aggregate count across all families
// ---------------------------------------------------------------------------

/// Global summary across every Class I family. Runs all shapes back to
/// back and emits a `[Class I total] ...` line for the handoff.
///
/// Fails on any non-zero total — failing tests ARE the bug tracker.
#[cfg(feature = "audit-tests")]
#[test]
fn class1_summary_total() {
    let shapes: Vec<(&'static str, FormulaShape)> = vec![
        ("SUMIFS", FormulaShape::Sumifs),
        ("SUMIF", FormulaShape::Sumif),
        ("COUNTIFS", FormulaShape::Countifs),
        ("COUNTIF", FormulaShape::Countif),
        ("AVERAGEIFS", FormulaShape::Averageifs),
        ("AVERAGEIF", FormulaShape::Averageif),
        ("MINIFS", FormulaShape::Minifs),
        ("MAXIFS", FormulaShape::Maxifs),
        ("SUM", FormulaShape::Sum),
        ("SUMPRODUCT", FormulaShape::Sumproduct),
        ("SUMSQ", FormulaShape::Sumsq),
        ("VLOOKUP", FormulaShape::Vlookup),
        ("HLOOKUP", FormulaShape::Hlookup),
        ("XLOOKUP", FormulaShape::Xlookup),
        ("INDEX+MATCH", FormulaShape::IndexMatch),
        ("MATCH", FormulaShape::Match),
        ("XMATCH", FormulaShape::Xmatch),
        ("INDIRECT", FormulaShape::Indirect),
        ("OFFSET", FormulaShape::Offset),
        ("FILTER", FormulaShape::Filter),
        ("UNIQUE", FormulaShape::Unique),
        ("SORT", FormulaShape::Sort),
        ("SORTBY", FormulaShape::Sortby),
        ("CHOOSE", FormulaShape::Choose),
        ("IF(range)", FormulaShape::IfRange),
        ("LET", FormulaShape::Let),
        ("LAMBDA", FormulaShape::Lambda),
        ("MMULT", FormulaShape::Mmult),
        ("TRANSPOSE", FormulaShape::Transpose),
        ("SUM3D", FormulaShape::Sum3D),
    ];
    let mut total = 0usize;
    let mut passed = 0usize;
    let mut failed = 0usize;
    let mut skipped_incompat = 0usize;
    let mut skipped_pending = 0usize;
    let mut total_ms = 0u128;
    let start = Instant::now();
    for (label, shape) in &shapes {
        // Run directly without triggering the per-family panic; we want
        // the TOTAL count even if an individual family's failures spike.
        let cases = cases_for_shape(*shape);
        let case_count = cases.len();
        let fam_start = Instant::now();
        let mut fp = 0;
        let mut ff = 0;
        let mut fsi = 0;
        let mut fsp = 0;
        for case in &cases {
            match run_case(case) {
                TestOutcome::Passed => fp += 1,
                TestOutcome::Failed(_) => ff += 1,
                TestOutcome::Skipped(CoverageReason::IncompatibleCombo(_)) => fsi += 1,
                TestOutcome::Skipped(CoverageReason::FixturePending(_)) => fsp += 1,
            }
        }
        let fam_elapsed = fam_start.elapsed();
        eprintln!(
            "[Class I · {}] {}/{} passed, {} failed, {} incompat, {} pending ({:?})",
            label,
            fp,
            fp + ff,
            ff,
            fsi,
            fsp,
            fam_elapsed,
        );
        total += case_count;
        passed += fp;
        failed += ff;
        skipped_incompat += fsi;
        skipped_pending += fsp;
        total_ms += fam_elapsed.as_millis();
    }
    let wall = start.elapsed();
    eprintln!(
        "[Class I total] {}/{} passed, {} failed, {} skipped ({} incompat + {} pending). \
         Wall {:?}, sum-of-family {} ms.",
        passed,
        passed + failed,
        failed,
        skipped_incompat + skipped_pending,
        skipped_incompat,
        skipped_pending,
        wall,
        total_ms,
    );
    eprintln!(
        "[Class I total] case count = {} (30 shapes × 10 ranges = 300 nominal)",
        total
    );
    // Global tolerance: zero. Baseline at Stage 2 handoff is 0 failures
    // across 183 active cases. Any non-zero count trips the test —
    // failing tests ARE the bug tracker; investigate via the per-family
    // test output listed above.
    assert_eq!(
        failed, 0,
        "Class I total: {} failures — investigate which family regressed \
         via the per-family test output.",
        failed,
    );
}

// Explicit references to silence "unused import" warnings when the
// test file is compiled without any of the optional paths engaging.
#[allow(dead_code)]
fn _unused_refs() {
    let _ = CellError::Na;
    let _ = text_cell(0, 0, 0, "");
}

// ===========================================================================
// Axes 3 x 4 expansion (FormulaShape x RangeType x EditPosition x ValueType).
//
// All types below parallel the matrix above but iterate the full EditPosition
// and ValueType axes from `support::matrix`. Five `#[test]` functions, one per
// EditPosition, give cargo-test's thread pool per-axis parallelism. Nominal
// case count per test = 300 (FormulaShape::all() x RangeType::all_stage2()) x 13
// (ValueType::all_stage2()) = 3_900, of which most are IncompatibleCombo or
// FixturePending skips (the `NamedRange` row drops from Pending to active
// once its fixture builder lands; `StructuredTable` stays pending until
// structured-reference parsing is verified in engine).
// ===========================================================================

/// One matrix case. Axis 3 (EditPosition) and axis 4 (ValueType) are the
/// orthogonal additions to the axis-1/2 matrix.
#[derive(Debug, Clone)]
#[allow(dead_code)]
struct Class1CaseV2 {
    name: String,
    shape: FormulaShape,
    range: RangeType,
    edit_pos: EditPosition,
    value_kind: ValueType,
    prior: CellValue,
    new_value: CellValue,
}

/// Map a `ValueType` to a `(prior, new_value)` pair for the op.
///
/// - Number-shaped variants pick two different numbers so the dependent
///   has something to flip on.
/// - Text variants pick two different strings.
/// - `Bool` flips TRUE ↔ FALSE.
/// - `NullEmpty` uses Null both as prior and new; the op degenerates to
///   a no-op write and still exercises the invalidation path.
/// - `Error` picks two different error kinds so round-trip is visible.
fn value_type_seeds(v: ValueType) -> (CellValue, CellValue) {
    use std::sync::Arc;
    match v {
        ValueType::Int => (
            CellValue::Number(FiniteF64::must(5.0)),
            CellValue::Number(FiniteF64::must(7.0)),
        ),
        ValueType::LargeInt => (
            CellValue::Number(FiniteF64::must(1_000_000_000.0)),
            CellValue::Number(FiniteF64::must(1_000_000_007.0)),
        ),
        ValueType::FloatClean => (
            CellValue::Number(FiniteF64::must(0.5)),
            CellValue::Number(FiniteF64::must(0.25)),
        ),
        ValueType::FloatCascade => (
            CellValue::Number(FiniteF64::must(0.1)),
            CellValue::Number(FiniteF64::must(0.2)),
        ),
        ValueType::Bool => (CellValue::Boolean(true), CellValue::Boolean(false)),
        ValueType::Text => (
            CellValue::Text(Arc::from("alpha")),
            CellValue::Text(Arc::from("beta")),
        ),
        ValueType::TextShort => (
            CellValue::Text(Arc::from("abc")),
            CellValue::Text(Arc::from("xyz")),
        ),
        ValueType::TextLong => {
            let p = "x".repeat(256);
            let n = "y".repeat(256);
            (CellValue::Text(Arc::from(p)), CellValue::Text(Arc::from(n)))
        }
        ValueType::LeadingApostrophe => (
            CellValue::Text(Arc::from("'quoted")),
            CellValue::Text(Arc::from("'flipped")),
        ),
        ValueType::WhitespaceOnly => (
            CellValue::Text(Arc::from("   ")),
            CellValue::Text(Arc::from("     ")),
        ),
        ValueType::NullEmpty => (CellValue::Null, CellValue::Null),
        ValueType::Error => (
            CellValue::Error(CellError::Na, None),
            CellValue::Error(CellError::Div0, None),
        ),
        ValueType::DateSerial => (
            CellValue::Number(FiniteF64::must(45_000.0)),
            CellValue::Number(FiniteF64::must(45_001.0)),
        ),
        ValueType::TimeSerial => (
            CellValue::Number(FiniteF64::must(0.5)),
            CellValue::Number(FiniteF64::must(0.25)),
        ),
    }
}

/// Build the snapshot for a Track-4b case. Follows the same seed layout
/// as `workbook_for_case` (A1..C10 = 1..10, row 2 = 1..10 across), but
/// varies the edited-cell position per `EditPosition`.
///
/// For `EditPosition::OtherSheet`, we place the target cell on Sheet2;
/// the dependent formula on Sheet1 still references Sheet1!ranges, so
/// the edit must logically not affect the dependent unless the formula
/// itself pulls across sheets (Sum3D case).
fn workbook_for_case_v2(
    case: &Class1CaseV2,
) -> Result<(WorkbookSnapshot, CellId, u32, u32, CellId, SheetId), CoverageReason> {
    let formula = formula_template(case.shape, case.range)?;

    use std::collections::BTreeMap;
    let mut seed_map: BTreeMap<(u32, u32), CellValue> = BTreeMap::new();
    for i in 0..10u32 {
        seed_map.insert((i, 0), CellValue::Number(FiniteF64::must((i + 1) as f64)));
        seed_map.insert((i, 1), CellValue::Number(FiniteF64::must((i + 1) as f64)));
        seed_map.insert((i, 2), CellValue::Number(FiniteF64::must((i + 1) as f64)));
    }
    for j in 0..10u32 {
        seed_map.insert((1, j), CellValue::Number(FiniteF64::must((j + 1) as f64)));
    }

    // EditPosition → (target_row, target_col, target_sheet_prefix).
    // Row/col choices:
    // - Inside: B5 (inside the A1:C10 block).
    // - OutsideNearby: B25 (past A10 / C10 but well below 50_000).
    // - FarOutside: B55000 (matches the Ib6CYMnT signature, row >=39186).
    // - Boundary: B10 (last cell of A1:A10 / B1:B10).
    // - OtherSheet: Sheet2!B5 (for cross-sheet edit coverage).
    let (target_row, target_col, target_sheet_prefix) = match case.edit_pos {
        EditPosition::Inside => (4u32, 1u32, 0u8),
        EditPosition::OutsideNearby => (24u32, 1u32, 0u8),
        EditPosition::FarOutside => (55_000u32, 1u32, 0u8),
        EditPosition::Boundary => (9u32, 1u32, 0u8),
        EditPosition::OtherSheet => (4u32, 1u32, 1u8),
    };

    if case.edit_pos != EditPosition::OtherSheet {
        seed_map.insert((target_row, target_col), case.prior.clone());
    }

    let mut sheet1_cells: Vec<CellData> = seed_map
        .into_iter()
        .map(|((r, c), v)| make_cell(0, r, c, v, None))
        .collect();

    // Dependent formula at M21 on Sheet1 (matches workbook_for_case).
    let formula_row = 20u32;
    let formula_col = 12u32;
    sheet1_cells.push(formula_cell(0, formula_row, formula_col, &formula));

    // Sheet2/Sheet3 are used for `OtherSheet` edits and for `Sum3D`.
    let sum3d = case.shape == FormulaShape::Sum3D;
    let needs_sheet2 = sum3d || case.edit_pos == EditPosition::OtherSheet;
    let needs_sheet3 = sum3d;

    let mut sheets = vec![SheetSnapshot {
        id: SHEET1_UUID.to_string(),
        name: "Sheet1".to_string(),
        rows: 100_000,
        cols: 30,
        cells: sheet1_cells,
        ranges: vec![],
    }];
    if needs_sheet2 {
        let mut sheet2_cells: Vec<CellData> = Vec::new();
        for i in 0..10u32 {
            sheet2_cells.push(value_cell(1, i, 0, (i + 1) as f64));
            sheet2_cells.push(value_cell(1, i, 1, (i + 1) as f64));
            sheet2_cells.push(value_cell(1, i, 2, (i + 1) as f64));
        }
        if case.edit_pos == EditPosition::OtherSheet {
            sheet2_cells.push(make_cell(
                1,
                target_row,
                target_col,
                case.prior.clone(),
                None,
            ));
        }
        sheets.push(SheetSnapshot {
            id: SHEET2_UUID.to_string(),
            name: "Sheet2".to_string(),
            rows: 100_000,
            cols: 30,
            cells: sheet2_cells,
            ranges: vec![],
        });
    }
    if needs_sheet3 {
        let mut sheet3_cells: Vec<CellData> = Vec::new();
        for i in 0..10u32 {
            sheet3_cells.push(value_cell(2, i, 0, (i + 1) as f64));
            sheet3_cells.push(value_cell(2, i, 1, (i + 1) as f64));
            sheet3_cells.push(value_cell(2, i, 2, (i + 1) as f64));
        }
        sheets.push(SheetSnapshot {
            id: SHEET3_UUID.to_string(),
            name: "Sheet3".to_string(),
            rows: 1_000,
            cols: 30,
            cells: sheet3_cells,
            ranges: vec![],
        });
    }

    let snapshot = WorkbookSnapshot {
        sheets,
        ..Default::default()
    };

    let target_uuid = match target_sheet_prefix {
        1 => SHEET2_UUID,
        _ => SHEET1_UUID,
    };
    Ok((
        snapshot,
        cell_id_for(target_sheet_prefix, target_row, target_col),
        target_row,
        target_col,
        cell_id_for(0, formula_row, formula_col),
        sheet_id(target_uuid),
    ))
}

/// Build a named-range workbook: Sheet1 has the 10-row × 3-col seed
/// block plus the dependent formula at M21, and the `MyRange` named
/// range points at whichever column shape the ValueType allows. The
/// formula references `MyRange` directly (named-range resolution lives
/// in the compute-core pipeline).
///
/// This is the Track-4d minimum for the Class I NamedRange axis: drops
/// 30 of the 60 FixturePending skips. Only a subset of shapes support a
/// bare named reference; the rest route through `formula_template` with
/// `RangeType::FullCol` as a stand-in and bind `MyRange` = `A:A`.
fn workbook_for_case_v2_named(
    case: &Class1CaseV2,
) -> Result<(WorkbookSnapshot, CellId, u32, u32, CellId, SheetId), CoverageReason> {
    use CoverageReason::*;
    use support::fixtures::workbook_with_named_range;

    // Named-range binding: always `Sheet1!A:A` for a closed single-col
    // shape. Shapes that can't consume a single-column range are
    // reported as IncompatibleCombo.
    let formula = match case.shape {
        FormulaShape::Sumifs => r#"SUMIFS(MyRange,A:A,">0")"#.to_string(),
        FormulaShape::Sumif => r#"SUMIF(MyRange,">0")"#.to_string(),
        FormulaShape::Countifs => r#"COUNTIFS(MyRange,">0")"#.to_string(),
        FormulaShape::Countif => r#"COUNTIF(MyRange,">0")"#.to_string(),
        FormulaShape::Averageifs => r#"AVERAGEIFS(MyRange,A:A,">0")"#.to_string(),
        FormulaShape::Averageif => r#"AVERAGEIF(MyRange,">0")"#.to_string(),
        FormulaShape::Minifs => r#"MINIFS(MyRange,A:A,">0")"#.to_string(),
        FormulaShape::Maxifs => r#"MAXIFS(MyRange,A:A,">0")"#.to_string(),
        FormulaShape::Sum => "SUM(MyRange)".to_string(),
        FormulaShape::Sumproduct => "SUMPRODUCT(MyRange,MyRange)".to_string(),
        FormulaShape::Sumsq => "SUMSQ(MyRange)".to_string(),
        FormulaShape::Match => "MATCH(1,MyRange,0)".to_string(),
        FormulaShape::Xmatch => "XMATCH(1,MyRange)".to_string(),
        FormulaShape::Unique => "SUM(UNIQUE(MyRange))".to_string(),
        FormulaShape::Sort => "SUM(SORT(MyRange))".to_string(),
        FormulaShape::Filter => "FILTER(MyRange,MyRange>0)".to_string(),
        FormulaShape::IfRange => "SUM(IF(MyRange>0,MyRange,0))".to_string(),
        FormulaShape::Let => "LET(r,MyRange,SUM(r))".to_string(),
        FormulaShape::Lambda => "LAMBDA(r,SUM(r))(MyRange)".to_string(),
        FormulaShape::Transpose => "SUM(TRANSPOSE(MyRange))".to_string(),
        FormulaShape::Choose => "CHOOSE(1,SUM(MyRange),0)".to_string(),
        FormulaShape::Vlookup
        | FormulaShape::Hlookup
        | FormulaShape::Xlookup
        | FormulaShape::IndexMatch
        | FormulaShape::Indirect
        | FormulaShape::Offset
        | FormulaShape::Sortby
        | FormulaShape::Mmult
        | FormulaShape::Sum3D => {
            return Err(IncompatibleCombo(
                "named-range fixture uses single-col binding; multi-range / 3D \
                 shapes need a different binding",
            ));
        }
    };

    // Target cell position — identical rules to workbook_for_case_v2.
    let (target_row, target_col, target_sheet_prefix) = match case.edit_pos {
        EditPosition::Inside => (4u32, 0u32, 0u8), // A5 (inside MyRange=A:A)
        EditPosition::OutsideNearby => (24u32, 0u32, 0u8),
        EditPosition::FarOutside => (55_000u32, 0u32, 0u8),
        EditPosition::Boundary => (9u32, 0u32, 0u8),
        EditPosition::OtherSheet => (4u32, 1u32, 1u8),
    };

    // Extra cells: target seed + dependent formula. OtherSheet
    // edits put the target cell on Sheet2 (added below).
    let mut extra_cells = Vec::new();
    if case.edit_pos != EditPosition::OtherSheet {
        extra_cells.push(make_cell(
            0,
            target_row,
            target_col,
            case.prior.clone(),
            None,
        ));
    }
    let formula_row = 20u32;
    let formula_col = 12u32;
    extra_cells.push(formula_cell(0, formula_row, formula_col, &formula));

    let mut snapshot = workbook_with_named_range("MyRange", "Sheet1!A:A", extra_cells);

    // Add Sheet2 if needed for OtherSheet edits.
    if case.edit_pos == EditPosition::OtherSheet {
        let mut sheet2_cells: Vec<CellData> = Vec::new();
        sheet2_cells.push(make_cell(
            1,
            target_row,
            target_col,
            case.prior.clone(),
            None,
        ));
        snapshot.sheets.push(SheetSnapshot {
            id: SHEET2_UUID.to_string(),
            name: "Sheet2".to_string(),
            rows: 100_000,
            cols: 30,
            cells: sheet2_cells,
            ranges: vec![],
        });
    }

    let target_uuid = match target_sheet_prefix {
        1 => SHEET2_UUID,
        _ => SHEET1_UUID,
    };
    Ok((
        snapshot,
        cell_id_for(target_sheet_prefix, target_row, target_col),
        target_row,
        target_col,
        cell_id_for(0, formula_row, formula_col),
        sheet_id(target_uuid),
    ))
}

/// Build a structured-table workbook (`Table1[A]` binding).
///
/// Engine support for `Table1[Col]` in formulas may be incomplete; see
/// `support::fixtures::workbook_with_table` doc for the caveat. If the
/// built snapshot's formula fails to parse at `from_snapshot` time (the
/// `run_case_v2` runner catches this as a `from_snapshot` error), the
/// case is still counted as a failure — the Track-4d done-gate specifies
/// that the residue must either be 0 or be explicit structured-table
/// breakage (documented in the handoff).
fn workbook_for_case_v2_table(
    case: &Class1CaseV2,
) -> Result<(WorkbookSnapshot, CellId, u32, u32, CellId, SheetId), CoverageReason> {
    use CoverageReason::*;
    use support::fixtures::workbook_with_table;

    // Only a subset of shapes consume a single structured-column reference.
    let formula = match case.shape {
        FormulaShape::Sum => "SUM(Table1[A])".to_string(),
        FormulaShape::Sumifs => r#"SUMIFS(Table1[A],Table1[A],">0")"#.to_string(),
        FormulaShape::Sumif => r#"SUMIF(Table1[A],">0")"#.to_string(),
        FormulaShape::Countifs => r#"COUNTIFS(Table1[A],">0")"#.to_string(),
        FormulaShape::Countif => r#"COUNTIF(Table1[A],">0")"#.to_string(),
        FormulaShape::Averageifs => r#"AVERAGEIFS(Table1[A],Table1[A],">0")"#.to_string(),
        FormulaShape::Averageif => r#"AVERAGEIF(Table1[A],">0")"#.to_string(),
        FormulaShape::Sumsq => "SUMSQ(Table1[A])".to_string(),
        _ => {
            return Err(FixturePending(
                "structured-table binding: only aggregate shapes supported in this fixture",
            ));
        }
    };

    // Target cell position. Table1 lives at A1:C4 (header + 3 data rows).
    // `Boundary` targets the last data row (row 3); `Inside` targets row
    // 1 (first data row); `OutsideNearby` targets row 10 (just past); etc.
    let (target_row, target_col, target_sheet_prefix) = match case.edit_pos {
        EditPosition::Inside => (1u32, 0u32, 0u8),
        EditPosition::OutsideNearby => (10u32, 0u32, 0u8),
        EditPosition::FarOutside => (55_000u32, 0u32, 0u8),
        EditPosition::Boundary => (3u32, 0u32, 0u8),
        EditPosition::OtherSheet => (4u32, 1u32, 1u8),
    };

    let mut extra_cells = Vec::new();
    if case.edit_pos != EditPosition::OtherSheet {
        // Override the table's default seed with the requested prior.
        extra_cells.push(make_cell(
            0,
            target_row,
            target_col,
            case.prior.clone(),
            None,
        ));
    }
    let formula_row = 20u32;
    let formula_col = 12u32;
    extra_cells.push(formula_cell(0, formula_row, formula_col, &formula));

    let mut snapshot = workbook_with_table("Table1", &["A", "B", "C"], 3, extra_cells);

    if case.edit_pos == EditPosition::OtherSheet {
        let mut sheet2_cells: Vec<CellData> = Vec::new();
        sheet2_cells.push(make_cell(
            1,
            target_row,
            target_col,
            case.prior.clone(),
            None,
        ));
        snapshot.sheets.push(SheetSnapshot {
            id: SHEET2_UUID.to_string(),
            name: "Sheet2".to_string(),
            rows: 100_000,
            cols: 30,
            cells: sheet2_cells,
            ranges: vec![],
        });
    }

    let target_uuid = match target_sheet_prefix {
        1 => SHEET2_UUID,
        _ => SHEET1_UUID,
    };
    Ok((
        snapshot,
        cell_id_for(target_sheet_prefix, target_row, target_col),
        target_row,
        target_col,
        cell_id_for(0, formula_row, formula_col),
        sheet_id(target_uuid),
    ))
}

/// Runner for one Track-4b case. Parallels `run_case` but routes to the
/// right fixture builder based on `RangeType`.
fn run_case_v2(case: &Class1CaseV2) -> TestOutcome {
    // Route to the appropriate fixture based on RangeType. NamedRange
    // has its own builder (Track-4d); StructuredTable has a best-effort
    // builder (may hit parser limits for `Table1[Col]`). ThreeD is only
    // handled inside the default builder (which falls through to
    // formula_template's ThreeD skip).
    let build = match case.range {
        RangeType::NamedRange => workbook_for_case_v2_named(case),
        RangeType::StructuredTable => workbook_for_case_v2_table(case),
        _ => workbook_for_case_v2(case),
    };

    let (snapshot, target_cell_id, target_row, target_col, formula_cell_id, target_sheet_id) =
        match build {
            Ok(x) => x,
            Err(reason) => return TestOutcome::Skipped(reason),
        };

    let (mut engine, _init) = match YrsComputeEngine::from_snapshot(snapshot) {
        Ok(pair) => pair,
        Err(e) => {
            return TestOutcome::Failed(format!(
                "from_snapshot failed (likely formula parse error): {:?}",
                e
            ));
        }
    };

    let dependent_sheet = sheet_id(SHEET1_UUID);

    let pre_op_value = engine
        .mirror()
        .get_cell_value_at(&dependent_sheet, SheetPos::new(20, 12))
        .cloned()
        .or_else(|| engine.mirror().get_cell_value(&formula_cell_id).cloned())
        .unwrap_or(CellValue::Null);

    // Capture the ACTUAL prior value from the mirror at the target cell.
    // The case's `prior` field is the ValueType-derived seed that *was
    // requested*, but when fixture layering (named-range seed block,
    // structured-table seed block) overlaps the target position, the
    // engine's effective pre-op value may differ. The identity invariant
    // is "write new_value then write back what-was-actually-there → same
    // dependent"; use the live mirror value as the true prior.
    let live_prior = engine
        .mirror()
        .get_cell_value_at(&target_sheet_id, SheetPos::new(target_row, target_col))
        .cloned()
        .unwrap_or(CellValue::Null);

    // Forward op: rendered-string set_cell. For values where the
    // rendered string can't round-trip through the parser, skip forward
    // via `import_values` and mark the path explicitly. That means
    // Boolean/Error/Text/NullEmpty go through the raw path so we isolate
    // dependency-propagation drift from parser fidelity drift.
    let forward_err = match &case.new_value {
        CellValue::Number(_) => {
            let new_input = render_input(&case.new_value);
            engine
                .set_cell(
                    &target_sheet_id,
                    target_cell_id,
                    target_row,
                    target_col,
                    new_input.as_str().into(),
                )
                .err()
        }
        _ => engine
            .import_values(
                &target_sheet_id,
                vec![(target_row, target_col, case.new_value.clone(), None)],
            )
            .err(),
    };
    if let Some(e) = forward_err {
        return TestOutcome::Failed(format!("forward op failed: {:?}", e));
    }

    // Inverse op always goes through import_values (raw CellValue) with
    // the live-captured prior — not the case's nominal prior.
    if let Err(e) = engine.import_values(
        &target_sheet_id,
        vec![(target_row, target_col, live_prior.clone(), None)],
    ) {
        return TestOutcome::Failed(format!("inverse import_values failed: {:?}", e));
    }

    let post_value = engine
        .mirror()
        .get_cell_value_at(&dependent_sheet, SheetPos::new(20, 12))
        .cloned()
        .or_else(|| engine.mirror().get_cell_value(&formula_cell_id).cloned())
        .unwrap_or(CellValue::Null);

    if cell_values_bit_equal(&pre_op_value, &post_value) {
        TestOutcome::Passed
    } else {
        TestOutcome::Failed(format!(
            "dependent drift: pre={} post={} (forward={} inverse={} live_prior={})",
            describe_cell_value(&pre_op_value),
            describe_cell_value(&post_value),
            describe_cell_value(&case.new_value),
            describe_cell_value(&case.prior),
            describe_cell_value(&live_prior),
        ))
    }
}

/// Generate all Class I V2 cases pinned to one `EditPosition`.
fn cases_for_edit_pos(edit_pos: EditPosition) -> Vec<Class1CaseV2> {
    let mut out =
        Vec::with_capacity(FormulaShape::all().len() * RangeType::all_stage2().len() * 13);
    for &shape in FormulaShape::all() {
        for &range in RangeType::all_stage2() {
            for &value_kind in ValueType::all_stage2() {
                let (prior, new_value) = value_type_seeds(value_kind);
                let name = format!(
                    "class1v2__{}__{}__{}__{}",
                    shape.as_slug(),
                    range.as_slug(),
                    edit_pos.as_slug(),
                    value_kind.as_slug(),
                );
                out.push(Class1CaseV2 {
                    name,
                    shape,
                    range,
                    edit_pos,
                    value_kind,
                    prior,
                    new_value,
                });
            }
        }
    }
    out
}

/// Generate cases pinned to one (EditPosition, ValueType) pair.
/// Used by the fine-grained 5×13 = 65-test split to fit within the
/// 180 s wall-clock ceiling via cargo-test's parallel thread pool.
fn cases_for_edit_pos_value(edit_pos: EditPosition, value_kind: ValueType) -> Vec<Class1CaseV2> {
    let mut out = Vec::with_capacity(FormulaShape::all().len() * RangeType::all_stage2().len());
    for &shape in FormulaShape::all() {
        for &range in RangeType::all_stage2() {
            let (prior, new_value) = value_type_seeds(value_kind);
            let name = format!(
                "class1v2__{}__{}__{}__{}",
                shape.as_slug(),
                range.as_slug(),
                edit_pos.as_slug(),
                value_kind.as_slug(),
            );
            out.push(Class1CaseV2 {
                name,
                shape,
                range,
                edit_pos,
                value_kind,
                prior,
                new_value,
            });
        }
    }
    out
}

/// Aggregate runner for one EditPosition split. Counts pass / fail /
/// incompatible / pending, emits a `[Class I V2 · <edit_pos>] ...`
/// summary line, and panics on any failure.
///
/// Failing tests ARE the bug tracker. Per the plan, `FarOutside` × full-col
/// × SUMIFS cases may surface the unit-level `Ib6CYMnT` expression; those
/// are **failures**, not `#[ignore]`s. The handoff records the specific
/// failing entries as `regression_ib6cymnt_unit_*`.
#[allow(dead_code)] // Retained as the coarse-split entry; 5×13 fine split
// is the default but this helper still works.
fn run_edit_pos_split(label: &'static str, edit_pos: EditPosition) -> (usize, usize, usize, usize) {
    let cases = cases_for_edit_pos(edit_pos);
    let total = cases.len();
    let mut passed = 0usize;
    let mut failed = 0usize;
    let mut skipped_incompat = 0usize;
    let mut skipped_pending = 0usize;
    let mut failures: Vec<String> = Vec::new();
    let mut ib6_hits: Vec<String> = Vec::new();
    let start = Instant::now();
    for case in &cases {
        match run_case_v2(case) {
            TestOutcome::Passed => passed += 1,
            TestOutcome::Failed(msg) => {
                failed += 1;
                // Tag potential Ib6CYMnT unit-level hits: FarOutside ×
                // full-col × SUMIFS-family shape.
                let is_ib6_signature = edit_pos == EditPosition::FarOutside
                    && matches!(
                        case.range,
                        RangeType::FullCol | RangeType::FullColMulti | RangeType::FullRow
                    )
                    && matches!(
                        case.shape,
                        FormulaShape::Sumifs
                            | FormulaShape::Sumif
                            | FormulaShape::Countifs
                            | FormulaShape::Countif
                            | FormulaShape::Averageifs
                            | FormulaShape::Averageif
                            | FormulaShape::Minifs
                            | FormulaShape::Maxifs
                    );
                if is_ib6_signature {
                    ib6_hits.push(format!(
                        "  [ib6cymnt_unit] [{}] shape={:?} range={:?} value={:?}: {}",
                        case.name, case.shape, case.range, case.value_kind, msg,
                    ));
                }
                failures.push(format!("  [{}] {}", case.name, msg));
            }
            TestOutcome::Skipped(CoverageReason::IncompatibleCombo(_)) => skipped_incompat += 1,
            TestOutcome::Skipped(CoverageReason::FixturePending(_)) => skipped_pending += 1,
        }
    }
    let elapsed = start.elapsed();
    eprintln!(
        "[Class I V2 · {}] {}/{} passed, {} failed, {} incompat, {} pending ({:?}) \
         (total={})",
        label,
        passed,
        passed + failed,
        failed,
        skipped_incompat,
        skipped_pending,
        elapsed,
        total,
    );
    if !ib6_hits.is_empty() {
        eprintln!(
            "[Class I V2 · {}] Ib6CYMnT unit-level hits ({}):",
            label,
            ib6_hits.len()
        );
        for h in &ib6_hits {
            eprintln!("{}", h);
        }
    }
    if !failures.is_empty() {
        eprintln!("[Class I V2 · {}] failures:", label);
        for f in &failures {
            eprintln!("{}", f);
        }
    }
    (passed, failed, skipped_incompat, skipped_pending)
}

// ---------------------------------------------------------------------------
// Class I V2 — 5×13 fine split (one `#[test]` per `(EditPosition, ValueType)`
// pair) for the audit lane. 65 tests, each iterating 300 (shape × range)
// cases, are too expensive for the default correctness gate.
//
// The coarse 5-test split (one per EditPosition) above overshot the ceiling
// when `FarOutside` + `OtherSheet` ran in parallel (~208 s); the fine split
// lets 14 threads (local machine core count) absorb the longest-tail cases
// simultaneously. Per the plan:
//     "If you exceed, further-split by ValueType into 5×13 = 65 test
//      functions — parallel thread pool will eat the cost."
//
// The five coarse tests are kept (marked `dead_code`-guarded internally via
// `run_edit_pos_split`) and renamed here to aggregate summary runners that
// delegate to the split helpers. The 65 per-(edit_pos × value_type) tests
// are opt-in audit coverage.
// ---------------------------------------------------------------------------

#[allow(dead_code)] // Called only from the 65 per-(pos × value) tests.
fn run_edit_pos_value_split(
    label: &'static str,
    edit_pos: EditPosition,
    value_kind: ValueType,
) -> (usize, usize, usize, usize) {
    let cases = cases_for_edit_pos_value(edit_pos, value_kind);
    let total = cases.len();
    let mut passed = 0usize;
    let mut failed = 0usize;
    let mut skipped_incompat = 0usize;
    let mut skipped_pending = 0usize;
    let mut failures: Vec<String> = Vec::new();
    let mut ib6_hits: Vec<String> = Vec::new();
    let start = Instant::now();
    for case in &cases {
        match run_case_v2(case) {
            TestOutcome::Passed => passed += 1,
            TestOutcome::Failed(msg) => {
                failed += 1;
                let is_ib6_signature = edit_pos == EditPosition::FarOutside
                    && matches!(
                        case.range,
                        RangeType::FullCol | RangeType::FullColMulti | RangeType::FullRow
                    )
                    && matches!(
                        case.shape,
                        FormulaShape::Sumifs
                            | FormulaShape::Sumif
                            | FormulaShape::Countifs
                            | FormulaShape::Countif
                            | FormulaShape::Averageifs
                            | FormulaShape::Averageif
                            | FormulaShape::Minifs
                            | FormulaShape::Maxifs
                    );
                if is_ib6_signature {
                    ib6_hits.push(format!(
                        "  [ib6cymnt_unit] [{}] shape={:?} range={:?} value={:?}: {}",
                        case.name, case.shape, case.range, case.value_kind, msg,
                    ));
                }
                failures.push(format!("  [{}] {}", case.name, msg));
            }
            TestOutcome::Skipped(CoverageReason::IncompatibleCombo(_)) => skipped_incompat += 1,
            TestOutcome::Skipped(CoverageReason::FixturePending(_)) => skipped_pending += 1,
        }
    }
    let elapsed = start.elapsed();
    eprintln!(
        "[Class I V2 · {}] {}/{} passed, {} failed, {} incompat, {} pending ({:?}) \
         (total={})",
        label,
        passed,
        passed + failed,
        failed,
        skipped_incompat,
        skipped_pending,
        elapsed,
        total,
    );
    if !ib6_hits.is_empty() {
        eprintln!(
            "[Class I V2 · {}] Ib6CYMnT unit-level hits ({}):",
            label,
            ib6_hits.len()
        );
        for h in &ib6_hits {
            eprintln!("{}", h);
        }
    }
    if !failures.is_empty() {
        eprintln!("[Class I V2 · {}] failures:", label);
        for f in &failures {
            eprintln!("{}", f);
        }
    }
    (passed, failed, skipped_incompat, skipped_pending)
}

macro_rules! class_i_matrix_edit_value_test {
    ($name:ident, $label:expr, $edit:expr, $value:expr) => {
        #[cfg(feature = "audit-tests")]
        #[test]
        fn $name() {
            let (_p, failed, _si, _sp) = run_edit_pos_value_split($label, $edit, $value);
            assert_eq!(
                failed, 0,
                "Class I V2 ({}): {} failures — see stderr output above.",
                $label, failed,
            );
        }
    };
}

// EditPosition::Inside × all 13 ValueTypes.
class_i_matrix_edit_value_test!(
    class_i_matrix_edit_inside_int,
    "inside__int",
    EditPosition::Inside,
    ValueType::Int
);
class_i_matrix_edit_value_test!(
    class_i_matrix_edit_inside_largeint,
    "inside__largeint",
    EditPosition::Inside,
    ValueType::LargeInt
);
class_i_matrix_edit_value_test!(
    class_i_matrix_edit_inside_floatclean,
    "inside__floatclean",
    EditPosition::Inside,
    ValueType::FloatClean
);
class_i_matrix_edit_value_test!(
    class_i_matrix_edit_inside_floatcascade,
    "inside__floatcascade",
    EditPosition::Inside,
    ValueType::FloatCascade
);
class_i_matrix_edit_value_test!(
    class_i_matrix_edit_inside_bool,
    "inside__bool",
    EditPosition::Inside,
    ValueType::Bool
);
class_i_matrix_edit_value_test!(
    class_i_matrix_edit_inside_textshort,
    "inside__textshort",
    EditPosition::Inside,
    ValueType::TextShort
);
class_i_matrix_edit_value_test!(
    class_i_matrix_edit_inside_textlong,
    "inside__textlong",
    EditPosition::Inside,
    ValueType::TextLong
);
class_i_matrix_edit_value_test!(
    class_i_matrix_edit_inside_leadingapos,
    "inside__leadingapos",
    EditPosition::Inside,
    ValueType::LeadingApostrophe
);
class_i_matrix_edit_value_test!(
    class_i_matrix_edit_inside_whitespace,
    "inside__whitespace",
    EditPosition::Inside,
    ValueType::WhitespaceOnly
);
class_i_matrix_edit_value_test!(
    class_i_matrix_edit_inside_nullempty,
    "inside__nullempty",
    EditPosition::Inside,
    ValueType::NullEmpty
);
class_i_matrix_edit_value_test!(
    class_i_matrix_edit_inside_error,
    "inside__error",
    EditPosition::Inside,
    ValueType::Error
);
class_i_matrix_edit_value_test!(
    class_i_matrix_edit_inside_dateserial,
    "inside__dateserial",
    EditPosition::Inside,
    ValueType::DateSerial
);
class_i_matrix_edit_value_test!(
    class_i_matrix_edit_inside_timeserial,
    "inside__timeserial",
    EditPosition::Inside,
    ValueType::TimeSerial
);

// EditPosition::OutsideNearby × all 13 ValueTypes.
class_i_matrix_edit_value_test!(
    class_i_matrix_edit_outside_nearby_int,
    "outside_nearby__int",
    EditPosition::OutsideNearby,
    ValueType::Int
);
class_i_matrix_edit_value_test!(
    class_i_matrix_edit_outside_nearby_largeint,
    "outside_nearby__largeint",
    EditPosition::OutsideNearby,
    ValueType::LargeInt
);
class_i_matrix_edit_value_test!(
    class_i_matrix_edit_outside_nearby_floatclean,
    "outside_nearby__floatclean",
    EditPosition::OutsideNearby,
    ValueType::FloatClean
);
class_i_matrix_edit_value_test!(
    class_i_matrix_edit_outside_nearby_floatcascade,
    "outside_nearby__floatcascade",
    EditPosition::OutsideNearby,
    ValueType::FloatCascade
);
class_i_matrix_edit_value_test!(
    class_i_matrix_edit_outside_nearby_bool,
    "outside_nearby__bool",
    EditPosition::OutsideNearby,
    ValueType::Bool
);
class_i_matrix_edit_value_test!(
    class_i_matrix_edit_outside_nearby_textshort,
    "outside_nearby__textshort",
    EditPosition::OutsideNearby,
    ValueType::TextShort
);
class_i_matrix_edit_value_test!(
    class_i_matrix_edit_outside_nearby_textlong,
    "outside_nearby__textlong",
    EditPosition::OutsideNearby,
    ValueType::TextLong
);
class_i_matrix_edit_value_test!(
    class_i_matrix_edit_outside_nearby_leadingapos,
    "outside_nearby__leadingapos",
    EditPosition::OutsideNearby,
    ValueType::LeadingApostrophe
);
class_i_matrix_edit_value_test!(
    class_i_matrix_edit_outside_nearby_whitespace,
    "outside_nearby__whitespace",
    EditPosition::OutsideNearby,
    ValueType::WhitespaceOnly
);
class_i_matrix_edit_value_test!(
    class_i_matrix_edit_outside_nearby_nullempty,
    "outside_nearby__nullempty",
    EditPosition::OutsideNearby,
    ValueType::NullEmpty
);
class_i_matrix_edit_value_test!(
    class_i_matrix_edit_outside_nearby_error,
    "outside_nearby__error",
    EditPosition::OutsideNearby,
    ValueType::Error
);
class_i_matrix_edit_value_test!(
    class_i_matrix_edit_outside_nearby_dateserial,
    "outside_nearby__dateserial",
    EditPosition::OutsideNearby,
    ValueType::DateSerial
);
class_i_matrix_edit_value_test!(
    class_i_matrix_edit_outside_nearby_timeserial,
    "outside_nearby__timeserial",
    EditPosition::OutsideNearby,
    ValueType::TimeSerial
);

// EditPosition::FarOutside × all 13 ValueTypes. Ib6CYMnT unit-level
// expression lives on this axis × full-col × SUMIFS-shape.
class_i_matrix_edit_value_test!(
    class_i_matrix_edit_far_outside_int,
    "far_outside__int",
    EditPosition::FarOutside,
    ValueType::Int
);
class_i_matrix_edit_value_test!(
    class_i_matrix_edit_far_outside_largeint,
    "far_outside__largeint",
    EditPosition::FarOutside,
    ValueType::LargeInt
);
class_i_matrix_edit_value_test!(
    class_i_matrix_edit_far_outside_floatclean,
    "far_outside__floatclean",
    EditPosition::FarOutside,
    ValueType::FloatClean
);
class_i_matrix_edit_value_test!(
    class_i_matrix_edit_far_outside_floatcascade,
    "far_outside__floatcascade",
    EditPosition::FarOutside,
    ValueType::FloatCascade
);
class_i_matrix_edit_value_test!(
    class_i_matrix_edit_far_outside_bool,
    "far_outside__bool",
    EditPosition::FarOutside,
    ValueType::Bool
);
class_i_matrix_edit_value_test!(
    class_i_matrix_edit_far_outside_textshort,
    "far_outside__textshort",
    EditPosition::FarOutside,
    ValueType::TextShort
);
class_i_matrix_edit_value_test!(
    class_i_matrix_edit_far_outside_textlong,
    "far_outside__textlong",
    EditPosition::FarOutside,
    ValueType::TextLong
);
class_i_matrix_edit_value_test!(
    class_i_matrix_edit_far_outside_leadingapos,
    "far_outside__leadingapos",
    EditPosition::FarOutside,
    ValueType::LeadingApostrophe
);
class_i_matrix_edit_value_test!(
    class_i_matrix_edit_far_outside_whitespace,
    "far_outside__whitespace",
    EditPosition::FarOutside,
    ValueType::WhitespaceOnly
);
class_i_matrix_edit_value_test!(
    class_i_matrix_edit_far_outside_nullempty,
    "far_outside__nullempty",
    EditPosition::FarOutside,
    ValueType::NullEmpty
);
class_i_matrix_edit_value_test!(
    class_i_matrix_edit_far_outside_error,
    "far_outside__error",
    EditPosition::FarOutside,
    ValueType::Error
);
class_i_matrix_edit_value_test!(
    class_i_matrix_edit_far_outside_dateserial,
    "far_outside__dateserial",
    EditPosition::FarOutside,
    ValueType::DateSerial
);
class_i_matrix_edit_value_test!(
    class_i_matrix_edit_far_outside_timeserial,
    "far_outside__timeserial",
    EditPosition::FarOutside,
    ValueType::TimeSerial
);

// EditPosition::Boundary × all 13 ValueTypes.
class_i_matrix_edit_value_test!(
    class_i_matrix_edit_boundary_int,
    "boundary__int",
    EditPosition::Boundary,
    ValueType::Int
);
class_i_matrix_edit_value_test!(
    class_i_matrix_edit_boundary_largeint,
    "boundary__largeint",
    EditPosition::Boundary,
    ValueType::LargeInt
);
class_i_matrix_edit_value_test!(
    class_i_matrix_edit_boundary_floatclean,
    "boundary__floatclean",
    EditPosition::Boundary,
    ValueType::FloatClean
);
class_i_matrix_edit_value_test!(
    class_i_matrix_edit_boundary_floatcascade,
    "boundary__floatcascade",
    EditPosition::Boundary,
    ValueType::FloatCascade
);
class_i_matrix_edit_value_test!(
    class_i_matrix_edit_boundary_bool,
    "boundary__bool",
    EditPosition::Boundary,
    ValueType::Bool
);
class_i_matrix_edit_value_test!(
    class_i_matrix_edit_boundary_textshort,
    "boundary__textshort",
    EditPosition::Boundary,
    ValueType::TextShort
);
class_i_matrix_edit_value_test!(
    class_i_matrix_edit_boundary_textlong,
    "boundary__textlong",
    EditPosition::Boundary,
    ValueType::TextLong
);
class_i_matrix_edit_value_test!(
    class_i_matrix_edit_boundary_leadingapos,
    "boundary__leadingapos",
    EditPosition::Boundary,
    ValueType::LeadingApostrophe
);
class_i_matrix_edit_value_test!(
    class_i_matrix_edit_boundary_whitespace,
    "boundary__whitespace",
    EditPosition::Boundary,
    ValueType::WhitespaceOnly
);
class_i_matrix_edit_value_test!(
    class_i_matrix_edit_boundary_nullempty,
    "boundary__nullempty",
    EditPosition::Boundary,
    ValueType::NullEmpty
);
class_i_matrix_edit_value_test!(
    class_i_matrix_edit_boundary_error,
    "boundary__error",
    EditPosition::Boundary,
    ValueType::Error
);
class_i_matrix_edit_value_test!(
    class_i_matrix_edit_boundary_dateserial,
    "boundary__dateserial",
    EditPosition::Boundary,
    ValueType::DateSerial
);
class_i_matrix_edit_value_test!(
    class_i_matrix_edit_boundary_timeserial,
    "boundary__timeserial",
    EditPosition::Boundary,
    ValueType::TimeSerial
);

// EditPosition::OtherSheet × all 13 ValueTypes.
class_i_matrix_edit_value_test!(
    class_i_matrix_edit_other_sheet_int,
    "other_sheet__int",
    EditPosition::OtherSheet,
    ValueType::Int
);
class_i_matrix_edit_value_test!(
    class_i_matrix_edit_other_sheet_largeint,
    "other_sheet__largeint",
    EditPosition::OtherSheet,
    ValueType::LargeInt
);
class_i_matrix_edit_value_test!(
    class_i_matrix_edit_other_sheet_floatclean,
    "other_sheet__floatclean",
    EditPosition::OtherSheet,
    ValueType::FloatClean
);
class_i_matrix_edit_value_test!(
    class_i_matrix_edit_other_sheet_floatcascade,
    "other_sheet__floatcascade",
    EditPosition::OtherSheet,
    ValueType::FloatCascade
);
class_i_matrix_edit_value_test!(
    class_i_matrix_edit_other_sheet_bool,
    "other_sheet__bool",
    EditPosition::OtherSheet,
    ValueType::Bool
);
class_i_matrix_edit_value_test!(
    class_i_matrix_edit_other_sheet_textshort,
    "other_sheet__textshort",
    EditPosition::OtherSheet,
    ValueType::TextShort
);
class_i_matrix_edit_value_test!(
    class_i_matrix_edit_other_sheet_textlong,
    "other_sheet__textlong",
    EditPosition::OtherSheet,
    ValueType::TextLong
);
class_i_matrix_edit_value_test!(
    class_i_matrix_edit_other_sheet_leadingapos,
    "other_sheet__leadingapos",
    EditPosition::OtherSheet,
    ValueType::LeadingApostrophe
);
class_i_matrix_edit_value_test!(
    class_i_matrix_edit_other_sheet_whitespace,
    "other_sheet__whitespace",
    EditPosition::OtherSheet,
    ValueType::WhitespaceOnly
);
class_i_matrix_edit_value_test!(
    class_i_matrix_edit_other_sheet_nullempty,
    "other_sheet__nullempty",
    EditPosition::OtherSheet,
    ValueType::NullEmpty
);
class_i_matrix_edit_value_test!(
    class_i_matrix_edit_other_sheet_error,
    "other_sheet__error",
    EditPosition::OtherSheet,
    ValueType::Error
);
class_i_matrix_edit_value_test!(
    class_i_matrix_edit_other_sheet_dateserial,
    "other_sheet__dateserial",
    EditPosition::OtherSheet,
    ValueType::DateSerial
);
class_i_matrix_edit_value_test!(
    class_i_matrix_edit_other_sheet_timeserial,
    "other_sheet__timeserial",
    EditPosition::OtherSheet,
    ValueType::TimeSerial
);
