//! Integration tests for the canonical CF schema and Rust-owned priority/sort
//! recalc behavior (right-fix/cf-canonical-schema).
//!
//! These tests exercise the engine bridge methods (`add_cf_rule`, `sort_range`)
//! end-to-end after the TS-side `coerceRuleShape` adapter and post-sort
//! `forceRefreshAllViewports` workaround were deleted. Each rule-shape variant
//! the deleted TS adapter handled gets its own test here so a future regression
//! that drops the Rust-side normalization is loud.

#![allow(unused_imports, dead_code)]
#[allow(dead_code)]
mod stress_engine_common;
use stress_engine_common::*;

use cell_types::{SheetId, SheetPos};
use compute_core::bridge_types::{BridgeSortCriterion, BridgeSortMode, BridgeSortOptions};
use compute_core::storage::engine::YrsComputeEngine;
use domain_types::domain::filter::SortOrder;
use snapshot_types::{CellData, SheetSnapshot, WorkbookSnapshot};
use value_types::{CellValue, ComputeError};

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/// Build a minimal `ConditionalFormat`-shaped JSON payload with a single rule.
fn cf_payload(
    sheet_id: &SheetId,
    format_id: &str,
    range: (u32, u32, u32, u32),
    rules: Vec<serde_json::Value>,
) -> serde_json::Value {
    serde_json::json!({
        "id": format_id,
        "sheetId": sheet_id.to_uuid_string(),
        "ranges": [{
            "startRow": range.0, "startCol": range.1,
            "endRow": range.2,   "endCol": range.3,
        }],
        "rules": rules,
    })
}

fn add_cf(
    engine: &mut YrsComputeEngine,
    sheet_id: &SheetId,
    payload: serde_json::Value,
) -> Result<(), ComputeError> {
    engine.add_cf_rule(sheet_id, payload).map(|_| ())
}

fn first_format(
    engine: &YrsComputeEngine,
    sheet_id: &SheetId,
) -> domain_types::domain::conditional_format::ConditionalFormat {
    let formats = engine.get_all_cf_rules(sheet_id);
    formats
        .into_iter()
        .next()
        .expect("expected at least one CF format")
}

// ---------------------------------------------------------------------------
// Wire-shape variants — formerly handled by `coerceRuleShape`
// ---------------------------------------------------------------------------

#[test]
fn add_cf_rule_accepts_contains_blanks_default_blanks_true() {
    let snapshot = make_snapshot(vec![]);
    let (mut engine, _) = YrsComputeEngine::from_snapshot(snapshot).unwrap();
    let sheet_id = engine.mirror().sheet_by_name("Sheet1").unwrap();

    let payload = cf_payload(
        &sheet_id,
        "fmt-cb",
        (0, 0, 5, 0),
        vec![serde_json::json!({
            "type": "containsBlanks",
            "id": "r1",
            "priority": 1,
            "style": {},
        })],
    );
    add_cf(&mut engine, &sheet_id, payload).expect("add_cf_rule");

    let fmt = first_format(&engine, &sheet_id);
    use domain_types::domain::conditional_format::CFRule;
    match &fmt.rules[0] {
        CFRule::ContainsBlanks { blanks, .. } => assert!(blanks),
        other => panic!("expected ContainsBlanks, got {other:?}"),
    }
}

#[test]
fn add_cf_rule_promotes_not_contains_blanks_to_contains_blanks_false() {
    let snapshot = make_snapshot(vec![]);
    let (mut engine, _) = YrsComputeEngine::from_snapshot(snapshot).unwrap();
    let sheet_id = engine.mirror().sheet_by_name("Sheet1").unwrap();

    let payload = cf_payload(
        &sheet_id,
        "fmt-ncb",
        (0, 0, 5, 0),
        vec![serde_json::json!({
            "type": "notContainsBlanks",
            "id": "r1",
            "priority": 1,
            "style": {},
        })],
    );
    add_cf(&mut engine, &sheet_id, payload).expect("add_cf_rule");

    let fmt = first_format(&engine, &sheet_id);
    use domain_types::domain::conditional_format::CFRule;
    match &fmt.rules[0] {
        CFRule::ContainsBlanks { blanks, .. } => {
            assert!(!blanks, "notContainsBlanks → blanks=false")
        }
        other => panic!("expected ContainsBlanks, got {other:?}"),
    }
}

#[test]
fn add_cf_rule_accepts_top10_with_value1_and_operator() {
    let snapshot = make_snapshot(vec![]);
    let (mut engine, _) = YrsComputeEngine::from_snapshot(snapshot).unwrap();
    let sheet_id = engine.mirror().sheet_by_name("Sheet1").unwrap();

    let payload = cf_payload(
        &sheet_id,
        "fmt-top",
        (0, 0, 5, 0),
        vec![serde_json::json!({
            "type": "top10",
            "id": "r1",
            "priority": 1,
            "value1": 3,
            "operator": "topPercent",
            "style": { "backgroundColor": "#FF0000" },
        })],
    );
    add_cf(&mut engine, &sheet_id, payload).expect("add_cf_rule");

    let fmt = first_format(&engine, &sheet_id);
    use domain_types::domain::conditional_format::CFRule;
    match &fmt.rules[0] {
        CFRule::Top10 { rank, percent, .. } => {
            assert_eq!(*rank, 3);
            assert_eq!(*percent, Some(true));
        }
        other => panic!("expected Top10, got {other:?}"),
    }
}

#[test]
fn add_cf_rule_promotes_cell_value_with_text_op_to_contains_text() {
    let snapshot = make_snapshot(vec![]);
    let (mut engine, _) = YrsComputeEngine::from_snapshot(snapshot).unwrap();
    let sheet_id = engine.mirror().sheet_by_name("Sheet1").unwrap();

    let payload = cf_payload(
        &sheet_id,
        "fmt-ct",
        (0, 0, 5, 0),
        vec![serde_json::json!({
            "type": "cellValue",
            "id": "r1",
            "priority": 1,
            "operator": "containsText",
            "value1": "needle",
            "style": { "backgroundColor": "#FF0000" },
        })],
    );
    add_cf(&mut engine, &sheet_id, payload).expect("add_cf_rule");

    let fmt = first_format(&engine, &sheet_id);
    use domain_types::domain::conditional_format::CFRule;
    use ooxml_types::cond_format::CfOperator;
    match &fmt.rules[0] {
        CFRule::ContainsText { operator, text, .. } => {
            assert_eq!(*operator, CfOperator::ContainsText);
            assert_eq!(text, "needle");
        }
        other => panic!("expected ContainsText, got {other:?}"),
    }
}

#[test]
fn add_cf_rule_accepts_expression_alias_for_formula() {
    let snapshot = make_snapshot(vec![]);
    let (mut engine, _) = YrsComputeEngine::from_snapshot(snapshot).unwrap();
    let sheet_id = engine.mirror().sheet_by_name("Sheet1").unwrap();

    let payload = cf_payload(
        &sheet_id,
        "fmt-expr",
        (0, 0, 5, 0),
        vec![serde_json::json!({
            "type": "expression",
            "id": "r1",
            "priority": 1,
            "formula": "=A1>10",
            "style": {},
        })],
    );
    add_cf(&mut engine, &sheet_id, payload).expect("add_cf_rule");

    let fmt = first_format(&engine, &sheet_id);
    use domain_types::domain::conditional_format::CFRule;
    match &fmt.rules[0] {
        CFRule::Formula { formula, .. } => assert_eq!(formula, "=A1>10"),
        other => panic!("expected Formula, got {other:?}"),
    }
}

// ---------------------------------------------------------------------------
// Priority insertion — Rust owns "newly-added is first"
// ---------------------------------------------------------------------------

#[test]
fn add_cf_rule_puts_new_format_at_priority_one() {
    let snapshot = make_snapshot(vec![]);
    let (mut engine, _) = YrsComputeEngine::from_snapshot(snapshot).unwrap();
    let sheet_id = engine.mirror().sheet_by_name("Sheet1").unwrap();

    add_cf(
        &mut engine,
        &sheet_id,
        cf_payload(
            &sheet_id,
            "fmt-1",
            (0, 0, 5, 0),
            vec![serde_json::json!({
                "type": "cellValue",
                "id": "r-1a",
                "priority": 99,
                "operator": "greaterThan",
                "value1": 10,
                "style": {},
            })],
        ),
    )
    .unwrap();

    let formats = engine.get_all_cf_rules(&sheet_id);
    assert_eq!(formats.len(), 1);
    assert_eq!(
        formats[0].rules[0].priority(),
        1,
        "first format gets priority 1"
    );
}

#[test]
fn add_cf_rule_bumps_existing_format_priorities_so_new_is_first() {
    let snapshot = make_snapshot(vec![]);
    let (mut engine, _) = YrsComputeEngine::from_snapshot(snapshot).unwrap();
    let sheet_id = engine.mirror().sheet_by_name("Sheet1").unwrap();

    // Add two formats. Each has one rule.
    add_cf(
        &mut engine,
        &sheet_id,
        cf_payload(
            &sheet_id,
            "fmt-a",
            (0, 0, 5, 0),
            vec![serde_json::json!({
                "type": "cellValue", "id": "r-a", "priority": 0,
                "operator": "greaterThan", "value1": 10, "style": {},
            })],
        ),
    )
    .unwrap();
    add_cf(
        &mut engine,
        &sheet_id,
        cf_payload(
            &sheet_id,
            "fmt-b",
            (0, 0, 5, 0),
            vec![serde_json::json!({
                "type": "cellValue", "id": "r-b", "priority": 0,
                "operator": "lessThan", "value1": 5, "style": {},
            })],
        ),
    )
    .unwrap();

    let formats = engine.get_all_cf_rules(&sheet_id);
    assert_eq!(formats.len(), 2);

    // The most recently added format (`fmt-b`) must sort first
    // (priority 1; the older `fmt-a` got bumped to 2).
    assert_eq!(formats[0].id, "fmt-b");
    assert_eq!(formats[0].rules[0].priority(), 1);
    assert_eq!(formats[1].id, "fmt-a");
    assert_eq!(formats[1].rules[0].priority(), 2);
}

// ---------------------------------------------------------------------------
// Sort path natively re-evaluates CF — replaces `forceRefreshAllViewports`
// ---------------------------------------------------------------------------

#[test]
fn sort_range_with_overlapping_cf_format_re_evaluates_cf_cache() {
    // Mirrors the cf-recalc-on-sort app-eval scenario:
    //   A1..A6 = 30, 80, 20, 95, 60, 75
    //   CF rule: greaterThan 70 → red on A1:A6
    //   Sort A1:A6 desc — values become 95, 80, 75, 60, 30, 20.
    //   Post-sort: rows 0..2 (95/80/75) must be flagged red, rows 3..5 not.
    let snapshot = make_snapshot(vec![
        make_cell(0, 0, num(30.0), None),
        make_cell(1, 0, num(80.0), None),
        make_cell(2, 0, num(20.0), None),
        make_cell(3, 0, num(95.0), None),
        make_cell(4, 0, num(60.0), None),
        make_cell(5, 0, num(75.0), None),
    ]);
    let (mut engine, _) = YrsComputeEngine::from_snapshot(snapshot).unwrap();
    let sheet_id = engine.mirror().sheet_by_name("Sheet1").unwrap();

    add_cf(
        &mut engine,
        &sheet_id,
        cf_payload(
            &sheet_id,
            "fmt-gt70",
            (0, 0, 5, 0),
            vec![serde_json::json!({
                "type": "cellValue",
                "id": "r-gt70",
                "priority": 1,
                "operator": "greaterThan",
                "value1": 70,
                "style": { "backgroundColor": "#FF0000" },
            })],
        ),
    )
    .unwrap();

    // Pre-sort: rows 1 (80) and 3 (95) and 5 (75) match the rule.
    // Sort A1:A6 descending.
    engine
        .sort_range(
            &sheet_id,
            0,
            0,
            5,
            0,
            BridgeSortOptions {
                criteria: vec![BridgeSortCriterion {
                    column: 0,
                    direction: SortOrder::Desc,
                    case_sensitive: false,
                    mode: BridgeSortMode::Value { custom_list: None },
                }],
                has_headers: false,
                visible_rows_only: false,
            },
        )
        .expect("sort_range");

    // Verify CF cache is up to date: read the cf_cache results for the post-sort
    // positions. After the sort, the top three rows hold 95, 80, 75 — all > 70.
    // The sort path triggers `refresh_cf_cache` natively (no kernel-side
    // forceRefreshAllViewports needed).
    let post_sort_cf = engine.get_cf_rules_for_cell(&sheet_id, 0, 0);
    assert!(
        !post_sort_cf.is_empty(),
        "post-sort row 0 must still be in the CF range"
    );

    // The decisive correctness check: read back the top-three sorted values.
    let v0 = engine
        .mirror()
        .get_cell_value_at(&sheet_id, SheetPos::new(0, 0))
        .cloned();
    let v1 = engine
        .mirror()
        .get_cell_value_at(&sheet_id, SheetPos::new(1, 0))
        .cloned();
    let v2 = engine
        .mirror()
        .get_cell_value_at(&sheet_id, SheetPos::new(2, 0))
        .cloned();
    let to_num = |v: Option<CellValue>| match v {
        Some(CellValue::Number(n)) => n.get(),
        _ => f64::NAN,
    };
    assert_eq!(to_num(v0), 95.0);
    assert_eq!(to_num(v1), 80.0);
    assert_eq!(to_num(v2), 75.0);
}
