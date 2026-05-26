//! Workbook-path contracts for BAHTTEXT, ENCODEURL, JOIN, and SPLIT.

#[allow(dead_code)]
mod stress_common;
use stress_common::*;

use cell_types::SheetPos;
use compute_core::mirror::CellMirror;
use compute_core::scheduler::ComputeCore;
use value_types::{CellError, CellValue};

fn init_empty() -> (ComputeCore, CellMirror) {
    let mut core = ComputeCore::new();
    let mut mirror = CellMirror::default();
    let snapshot = build_snapshot(vec![("Sheet1", 100, 26, vec![])]);
    core.init_from_snapshot(&mut mirror, snapshot)
        .expect("init_from_snapshot failed");
    (core, mirror)
}

fn pos_value(mirror: &CellMirror, row: u32, col: u32) -> Option<CellValue> {
    mirror
        .get_cell_value_at(&sid(0), SheetPos::new(row, col))
        .cloned()
}

fn assert_pos_text(mirror: &CellMirror, row: u32, col: u32, expected: &str) {
    match pos_value(mirror, row, col) {
        Some(CellValue::Text(t)) => assert_eq!(
            &*t, expected,
            "pos ({row},{col}) expected Text({expected:?}), got Text({t:?})",
        ),
        other => panic!("pos ({row},{col}) expected Text({expected:?}), got {other:?}"),
    }
}

fn assert_pos_error(mirror: &CellMirror, row: u32, col: u32, expected: CellError) {
    match pos_value(mirror, row, col) {
        Some(CellValue::Error(actual, _)) => assert_eq!(
            actual, expected,
            "pos ({row},{col}) expected Error({expected:?}), got Error({actual:?})",
        ),
        other => panic!("pos ({row},{col}) expected Error({expected:?}), got {other:?}"),
    }
}

#[test]
fn formula_string_smoke_cases() {
    let (mut core, mut mirror) = init_empty();

    let _ = set(&mut core, &mut mirror, 0, 0, 0, "=BAHTTEXT(1234)");
    assert_pos_text(&mirror, 0, 0, "หนึ่งพันสองร้อยสามสิบสี่บาทถ้วน");

    let _ = set(
        &mut core,
        &mut mirror,
        0,
        1,
        0,
        r#"=ENCODEURL("hello, world!")"#,
    );
    assert_pos_text(&mirror, 1, 0, "hello%2C%20world%21");

    let _ = set(&mut core, &mut mirror, 0, 2, 0, "red");
    let _ = set(&mut core, &mut mirror, 0, 2, 1, "green");
    let _ = set(&mut core, &mut mirror, 0, 2, 2, "blue");
    let _ = set(&mut core, &mut mirror, 0, 3, 0, r#"=JOIN("|",A3:C3)"#);
    assert_pos_text(&mirror, 3, 0, "red|green|blue");

    let _ = set(&mut core, &mut mirror, 0, 4, 0, r#"=SPLIT("a,b",",")"#);
    assert_pos_text(&mirror, 4, 0, "a");
    assert_pos_text(&mirror, 4, 1, "b");
}

#[test]
fn split_spills_horizontally_and_one_cell_results_remain_arrays() {
    let (mut core, mut mirror) = init_empty();

    let _ = set(&mut core, &mut mirror, 0, 0, 0, r#"=SPLIT("a,b,c",",")"#);
    assert_pos_text(&mirror, 0, 0, "a");
    assert_pos_text(&mirror, 0, 1, "b");
    assert_pos_text(&mirror, 0, 2, "c");
    assert_pos_null(&mirror, 0, 0, 3);

    let _ = set(&mut core, &mut mirror, 0, 2, 0, r#"=SPLIT("abc",",")"#);
    assert_pos_text(&mirror, 2, 0, "abc");
    assert_pos_null(&mirror, 0, 2, 1);

    let _ = set(&mut core, &mut mirror, 0, 3, 0, "=A3");
    assert_pos_text(&mirror, 3, 0, "abc");
}

#[test]
fn split_spill_shrink_grow_and_dependents_recalculate() {
    let (mut core, mut mirror) = init_empty();

    let _ = set(&mut core, &mut mirror, 0, 0, 0, "a,b,c");
    let _ = set(&mut core, &mut mirror, 0, 1, 0, ",");
    let _ = set(&mut core, &mut mirror, 0, 2, 0, r#"=SPLIT(A1,A2)"#);
    let _ = set(
        &mut core,
        &mut mirror,
        0,
        3,
        0,
        r#"=TEXTJOIN("-",TRUE,A3#)"#,
    );
    let _ = set(&mut core, &mut mirror, 0, 4, 0, "=C3");

    assert_pos_text(&mirror, 2, 0, "a");
    assert_pos_text(&mirror, 2, 1, "b");
    assert_pos_text(&mirror, 2, 2, "c");
    assert_pos_text(&mirror, 3, 0, "a-b-c");
    assert_pos_text(&mirror, 4, 0, "c");

    let _ = set(&mut core, &mut mirror, 0, 0, 0, "a,b");
    assert_pos_text(&mirror, 2, 0, "a");
    assert_pos_text(&mirror, 2, 1, "b");
    assert_pos_null(&mirror, 0, 2, 2);
    assert_pos_text(&mirror, 3, 0, "a-b");
    assert_pos_number(&mirror, 0, 4, 0, 0.0);

    let _ = set(&mut core, &mut mirror, 0, 0, 0, "a,b,c,d");
    assert_pos_text(&mirror, 2, 3, "d");
    assert_pos_text(&mirror, 3, 0, "a-b-c-d");
    assert_pos_text(&mirror, 4, 0, "c");
}

#[test]
fn split_blocked_spill_and_editing_member_preserves_anchor_formula() {
    let (mut core, mut mirror) = init_empty();

    let _ = set(&mut core, &mut mirror, 0, 0, 1, "blocker");
    let _ = set(&mut core, &mut mirror, 0, 0, 0, r#"=SPLIT("a,b",",")"#);
    assert_pos_error(&mirror, 0, 0, CellError::Spill);
    assert_pos_text(&mirror, 0, 1, "blocker");

    let _ = set(&mut core, &mut mirror, 0, 0, 1, "");
    assert_pos_text(&mirror, 0, 0, "a");
    assert_pos_text(&mirror, 0, 1, "b");

    let _ = set(&mut core, &mut mirror, 0, 0, 1, "typed");
    assert_pos_error(&mirror, 0, 0, CellError::Spill);
    assert_eq!(
        core.get_formula(&cid(0, 0, 0)),
        Some(r#"=SPLIT("a,b",",")"#)
    );
    assert_pos_text(&mirror, 0, 1, "typed");
}

#[test]
fn production_path_rejects_invalid_array_inputs() {
    let (mut core, mut mirror) = init_empty();

    let _ = set(&mut core, &mut mirror, 0, 0, 0, "a,b");
    let _ = set(&mut core, &mut mirror, 0, 1, 0, "c,d");
    let _ = set(&mut core, &mut mirror, 0, 2, 0, "e,f");
    let _ = set(&mut core, &mut mirror, 0, 0, 2, r#"=SPLIT(A1:A3,",")"#);
    assert_pos_error(&mirror, 0, 2, CellError::Value);

    let _ = set(&mut core, &mut mirror, 0, 4, 0, "a");
    let _ = set(&mut core, &mut mirror, 0, 4, 1, "b");
    let _ = set(&mut core, &mut mirror, 0, 5, 0, "c");
    let _ = set(&mut core, &mut mirror, 0, 5, 1, "d");
    let _ = set(&mut core, &mut mirror, 0, 6, 0, r#"=JOIN(",",A5:B6)"#);
    assert_pos_error(&mirror, 6, 0, CellError::Value);
}

#[test]
fn join_blank_delimiter_formula_path() {
    let (mut core, mut mirror) = init_empty();

    let _ = set(&mut core, &mut mirror, 0, 0, 0, r#"=JOIN(,{1,2,3})"#);
    assert_pos_text(&mirror, 0, 0, "123");
}
