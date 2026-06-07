//! Unified formula display — single `format_ref` path for every variant.
//!
//! unified reference model collapsed `a1_display.rs` and `r1c1_display.rs` onto this
//! module. Each reference variant implements [`ReferenceTarget`] in the
//! formula-types crate; here we walk the template, call `resolved_sheet` +
//! `display_body` per placeholder, and emit the sheet prefix iff the ref's
//! sheet differs from the formula's own.

use formula_types::{
    IdentityFormula, IdentityFormulaRef, RefStyle, ReferenceTarget, WorkbookLookup,
};

use crate::ast::needs_quoting;

// ---------------------------------------------------------------------------
// Public entry points — used by `a1_display` and `r1c1_display` shims.
// ---------------------------------------------------------------------------

/// Walk `formula.template`, substituting `{N}` placeholders with the rendered
/// form of `formula.refs[N]` per `style`.
///
/// `always_qualify = true` forces a sheet prefix on every ref (used for
/// named-range display where the sheet context is ambiguous — e.g. XLSX
/// export of `<definedName>` bodies).
pub(crate) fn render_identity_formula(
    formula: &IdentityFormula,
    lookup: &dyn WorkbookLookup,
    style: RefStyle,
    always_qualify: bool,
) -> String {
    render_identity_formula_with_qualifier_flags(formula, lookup, style, always_qualify, &[])
}

pub(crate) fn render_identity_formula_with_qualifier_flags(
    formula: &IdentityFormula,
    lookup: &dyn WorkbookLookup,
    style: RefStyle,
    always_qualify: bool,
    force_qualified_refs: &[bool],
) -> String {
    let template = formula.template.as_bytes();
    let len = template.len();
    let mut out = String::with_capacity(len + 8);
    out.push('=');

    let mut i = 0;
    while i < len {
        if template[i] == b'{'
            && let Some((index, end)) = parse_placeholder(template, i)
        {
            if let Some(ref_) = formula.refs.get(index) {
                format_ref(
                    ref_,
                    lookup,
                    style,
                    always_qualify || force_qualified_refs.get(index).copied().unwrap_or(false),
                    &mut out,
                );
            } else {
                // Index out of bounds — shouldn't happen with well-formed templates.
                out.push_str("#REF!");
            }
            i = end;
            continue;
        }
        out.push(template[i] as char);
        i += 1;
    }
    out
}

/// Render a single `IdentityFormulaRef` into `out` per the unified model.
///
/// Public within the crate so the `a1_display` and `r1c1_display` shims can
/// exercise it directly from tests.
pub(crate) fn format_ref(
    r: &IdentityFormulaRef,
    lookup: &dyn WorkbookLookup,
    style: RefStyle,
    always_qualify: bool,
    out: &mut String,
) {
    if let Some(sid) = r.resolved_sheet(lookup)
        && (always_qualify || sid != lookup.formula_sheet())
    {
        write_sheet_prefix(out, lookup, sid);
    }
    r.display_body(lookup, style, out);
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/// Try to parse `{N}` starting at position `start`.
/// Returns `Some((N, end_pos))` where `end_pos` is one past the `}`.
/// Returns `None` if the content between `{` and `}` is not a valid usize.
fn parse_placeholder(template: &[u8], start: usize) -> Option<(usize, usize)> {
    debug_assert_eq!(template[start], b'{');
    let after_open = start + 1;
    let mut j = after_open;
    while j < template.len() && template[j] != b'}' {
        if !template[j].is_ascii_digit() {
            return None;
        }
        j += 1;
    }
    if j >= template.len() || j == after_open {
        return None;
    }
    let num_str = std::str::from_utf8(&template[after_open..j]).ok()?;
    let index: usize = num_str.parse().ok()?;
    Some((index, j + 1))
}

fn write_sheet_prefix(out: &mut String, lookup: &dyn WorkbookLookup, sheet: cell_types::SheetId) {
    let Some(name) = lookup.sheet_name(&sheet) else {
        // Sheet deleted — signal the broken ref inline.
        out.push_str("#REF!");
        return;
    };
    if needs_quoting(name) {
        out.push('\'');
        // Escape any embedded single quotes by doubling.
        for c in name.chars() {
            if c == '\'' {
                out.push('\'');
            }
            out.push(c);
        }
        out.push('\'');
    } else {
        out.push_str(name);
    }
    out.push('!');
}
