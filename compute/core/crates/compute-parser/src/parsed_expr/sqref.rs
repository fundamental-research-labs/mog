use formula_types::CellRef;

use crate::a1_entry::parse_sqref_list;
use crate::ast::RangeRef;

use super::serialize::format_positional_cell;

/// Space-separated list of A1 range references -- the XLSX `sqref` attribute
/// shape.
///
/// # Default
///
/// `Default::default()` yields an empty list (zero ranges).
#[derive(Debug, Clone, PartialEq, Eq, Default)]
pub struct SqrefList(pub Vec<RangeRef>);

impl SqrefList {
    /// Parse a whitespace-separated list of A1 ranges.
    ///
    /// Returns `None` if the input is empty, whitespace-only, or contains any
    /// token that fails to parse as a range.
    #[must_use]
    pub fn parse(input: &str) -> Option<Self> {
        parse_sqref_list(input).map(Self)
    }

    /// Canonical A1 re-emission: space-separated ranges each serialized via
    /// [`RangeRef::to_a1_string`], with 1x1 ranges emitted as the bare cell
    /// form.
    #[must_use]
    pub fn to_a1_string(&self) -> String {
        let mut out = String::new();
        for (i, r) in self.0.iter().enumerate() {
            if i > 0 {
                out.push(' ');
            }
            out.push_str(&range_ref_to_sqref_token(r));
        }
        out
    }

    /// Number of ranges in the list.
    #[must_use]
    #[inline]
    pub fn len(&self) -> usize {
        self.0.len()
    }

    /// Is the list empty?
    #[must_use]
    #[inline]
    pub fn is_empty(&self) -> bool {
        self.0.is_empty()
    }
}

fn range_ref_to_sqref_token(r: &RangeRef) -> String {
    if r.range_type == formula_types::RangeType::CellRange
        && let (
            CellRef::Positional {
                row: sr,
                col: sc,
                sheet: ss,
            },
            CellRef::Positional {
                row: er,
                col: ec,
                sheet: es,
            },
        ) = (&r.start, &r.end)
        && sr == er
        && sc == ec
        && ss == es
        && r.abs_start == r.abs_end
    {
        return format_positional_cell(*sr, *sc, r.abs_start.row, r.abs_start.col);
    }
    r.to_a1_string()
}
