//! Workbook-path contracts for REGEXEXTRACT/REGEXREPLACE/REGEXMATCH/REGEXTEST.

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

fn assert_pos_bool(mirror: &CellMirror, row: u32, col: u32, expected: bool) {
    match pos_value(mirror, row, col) {
        Some(CellValue::Boolean(actual)) => assert_eq!(
            actual, expected,
            "pos ({row},{col}) expected Boolean({expected}), got Boolean({actual})",
        ),
        other => panic!("pos ({row},{col}) expected Boolean({expected}), got {other:?}"),
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
fn regex_parsed_formula_smoke_cases() {
    let (mut core, mut mirror) = init_empty();

    let _ = set(
        &mut core,
        &mut mirror,
        0,
        0,
        0,
        r#"=REGEXTEST("Alpha-123","[0-9]+")"#,
    );
    assert_pos_bool(&mirror, 0, 0, true);

    let _ = set(
        &mut core,
        &mut mirror,
        0,
        1,
        0,
        r#"=_xlfn.REGEXTEST("Alpha","alpha",1)"#,
    );
    assert_pos_bool(&mirror, 1, 0, true);

    let _ = set(
        &mut core,
        &mut mirror,
        0,
        2,
        0,
        r#"=REGEXMATCH("abc123","^[a-z]+[0-9]+$")"#,
    );
    assert_pos_bool(&mirror, 2, 0, true);

    let _ = set(
        &mut core,
        &mut mirror,
        0,
        3,
        0,
        r#"=REGEXREPLACE("a1 b22 c333","[0-9]+","x")"#,
    );
    assert_pos_text(&mirror, 3, 0, "ax bx cx");

    let _ = set(
        &mut core,
        &mut mirror,
        0,
        4,
        0,
        r#"=REGEXEXTRACT("id: A12, id: B345","[A-Z][0-9]+",0)"#,
    );
    assert_pos_text(&mirror, 4, 0, "A12");
}

#[test]
fn regexextract_all_matches_spills_vertically() {
    let (mut core, mut mirror) = init_empty();
    let _ = set(
        &mut core,
        &mut mirror,
        0,
        0,
        0,
        r#"=REGEXEXTRACT("id: A12, id: B345","[A-Z][0-9]+",1)"#,
    );

    assert_pos_text(&mirror, 0, 0, "A12");
    assert_pos_text(&mirror, 1, 0, "B345");
    assert_pos_null(&mirror, 0, 2, 0);
}

#[test]
fn regexextract_captures_spill_horizontally() {
    let (mut core, mut mirror) = init_empty();
    let _ = set(
        &mut core,
        &mut mirror,
        0,
        0,
        0,
        r#"=REGEXEXTRACT("name=alice id=42","name=([a-z]+) id=([0-9]+)",2)"#,
    );

    assert_pos_text(&mirror, 0, 0, "alice");
    assert_pos_text(&mirror, 0, 1, "42");
    assert_pos_null(&mirror, 0, 0, 2);
}

#[test]
fn regexextract_spill_consumers_and_scalar_context() {
    let (mut core, mut mirror) = init_empty();

    let _ = set(
        &mut core,
        &mut mirror,
        0,
        0,
        0,
        r#"=ROWS(REGEXEXTRACT("a1 b2 c3","[a-z][0-9]",1))"#,
    );
    assert_pos_number(&mirror, 0, 0, 0, 3.0);

    let _ = set(
        &mut core,
        &mut mirror,
        0,
        1,
        0,
        r#"=TEXTJOIN(",",TRUE,REGEXEXTRACT("a1 b2","[a-z][0-9]",1))"#,
    );
    assert_pos_text(&mirror, 1, 0, "a1,b2");

    let _ = set(
        &mut core,
        &mut mirror,
        0,
        2,
        0,
        r#"=LEN(REGEXEXTRACT("abc123","[0-9]+",0))"#,
    );
    assert_pos_number(&mirror, 0, 2, 0, 3.0);

    let _ = set(
        &mut core,
        &mut mirror,
        0,
        3,
        0,
        "=REGEXEXTRACT(\"abc123\",\"[0-9]+\",0)&\"!\"",
    );
    assert_pos_text(&mirror, 3, 0, "123!");
}

#[test]
fn regexextract_array_input_nested_spill_is_value_error() {
    let (mut core, mut mirror) = init_empty();
    let _ = set(&mut core, &mut mirror, 0, 0, 0, "a1 b2");
    let _ = set(
        &mut core,
        &mut mirror,
        0,
        1,
        0,
        r#"=REGEXEXTRACT(A1:A1,"[a-z][0-9]",1)"#,
    );

    assert_pos_error(&mirror, 1, 0, CellError::Value);
}
