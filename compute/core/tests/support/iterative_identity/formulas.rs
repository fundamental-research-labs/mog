//! Formula template generation for Class I identity cases.

use super::cases::CoverageReason;
use crate::support::matrix::{FormulaShape, RangeType};

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
pub(super) fn formula_template(
    shape: FormulaShape,
    range: RangeType,
) -> Result<String, CoverageReason> {
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
