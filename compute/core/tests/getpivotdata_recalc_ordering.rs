//! Regression tests for GETPIVOTDATA / pivot-materialization ordering.
//!
//! # The bug
//!
//! `YrsComputeEngine::recalculate()` currently runs `full_recalc()` BEFORE
//! `materialize_all_pivots()`. GETPIVOTDATA formulas inside the user's
//! workbook read the pivot region via the cell mirror, so during
//! `full_recalc` they see the stale / cleared pivot region and coerce Null
//! to 0. The numerator therefore returns 0 (e.g. Fund 2!Y25 = 0), and when
//! both numerator and denominator are Null the ratio collapses to
//! `#DIV/0!` (Fund 1!Y23).
//!
//! Root cause: `compute/core/src/storage/engine/mod.rs:1531-1536` (and the
//! mirror counterpart in `recalculate_with_options` at 1539-1550).
//!
//! # The fix
//!
//! `materialize_all_pivots()` must run BEFORE `full_recalc()` so that every
//! GETPIVOTDATA call sees a freshly materialized pivot region. (Option (b)
//! in the plan — running `materialize_all_pivots` twice, once before recalc
//! and once after — is another acceptable resolution; either way, a
//! materialize call must precede the recalc.)
//!
//! These tests are documentation-style source-inspection tests. They assert
//! the ordering contract by reading `storage/engine/mod.rs` and checking
//! the call order inside `recalculate()` and `recalculate_with_options()`.
//! They FAIL today and PASS once the ordering bug is fixed.
//!
//! A full end-to-end test (build doc + pivot + GETPIVOTDATA formula, call
//! `recalculate()`, assert the numeric ratio) is the right test shape but
//! requires wiring a non-trivial `PivotTableConfig` through the JSON-validated
//! `pivot_create` API. Tracked separately; this narrower contract test
//! guarantees the ordering invariant that the E2E test would verify.

/// Find the body of a function starting at a prefix like
/// `"pub fn recalculate("`. Returns the substring between the opening `{`
/// that follows the signature and the matching closing `}`.
fn slice_fn_body<'a>(source: &'a str, signature_prefix: &str) -> Option<&'a str> {
    let start = source.find(signature_prefix)?;
    let rest = &source[start..];
    let open_rel = rest.find('{')?;
    let bytes = rest.as_bytes();
    let mut depth: i32 = 0;
    let mut i = open_rel;
    while i < bytes.len() {
        match bytes[i] {
            b'{' => depth += 1,
            b'}' => {
                depth -= 1;
                if depth == 0 {
                    return Some(&rest[open_rel + 1..i]);
                }
            }
            _ => {}
        }
        i += 1;
    }
    None
}

fn engine_mod_source() -> String {
    let path = concat!(env!("CARGO_MANIFEST_DIR"), "/src/storage/engine/mod.rs",);
    std::fs::read_to_string(path)
        .unwrap_or_else(|e| panic!("engine mod.rs should be readable at {}: {}", path, e))
}

#[test]
fn recalculate_materializes_pivots_before_full_recalc() {
    let source = engine_mod_source();
    let recalc_body = slice_fn_body(&source, "pub fn recalculate(")
        .expect("recalculate() should exist in storage/engine/mod.rs");

    let full_recalc_pos = recalc_body
        .find("full_recalc(")
        .expect("recalculate() should call full_recalc(...)");
    let materialize_pos = recalc_body
        .find("materialize_all_pivots(")
        .expect("recalculate() should call materialize_all_pivots(...)");

    assert!(
        materialize_pos < full_recalc_pos,
        "GETPIVOTDATA ordering bug (issue 07): materialize_all_pivots() must \
         be called BEFORE full_recalc() inside recalculate(). Current (buggy) \
         order: full_recalc at byte offset {}, materialize_all_pivots at {}. \
         GETPIVOTDATA formulas read the pivot region through the cell \
         mirror during full_recalc, so the pivot must already be \
         materialized when that recalc runs.",
        full_recalc_pos,
        materialize_pos,
    );
}

#[test]
fn recalculate_with_options_materializes_pivots_before_full_recalc() {
    let source = engine_mod_source();
    let body = slice_fn_body(&source, "pub fn recalculate_with_options(")
        .expect("recalculate_with_options() should exist in storage/engine/mod.rs");

    let full_recalc_pos = body
        .find("full_recalc_with_options(")
        .expect("recalculate_with_options() should call full_recalc_with_options(...)");
    let materialize_pos = body
        .find("materialize_all_pivots(")
        .expect("recalculate_with_options() should call materialize_all_pivots(...)");

    assert!(
        materialize_pos < full_recalc_pos,
        "GETPIVOTDATA ordering bug (issue 07): materialize_all_pivots() must \
         be called BEFORE full_recalc_with_options() inside \
         recalculate_with_options(). Current (buggy) order: full_recalc at \
         byte offset {}, materialize_all_pivots at {}. If only recalculate() \
         is fixed but this variant is left buggy, iterative-calc paths will \
         still see stale pivots.",
        full_recalc_pos,
        materialize_pos,
    );
}
