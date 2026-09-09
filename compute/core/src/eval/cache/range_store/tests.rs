use super::*;
use crate::cells::{CellEntry, CellStore, SheetStore};
use crate::eval::{Evaluator, sync_block_on};
use crate::eval_bridge::store_access::PendingCellOverride;
use crate::eval_bridge::{EvalContext, StoreCellRefResolver};
use cell_types::SheetPos;
use compute_parser::parse_formula;
use value_types::CellError;

fn fixture() -> (CellStore, SheetId) {
    let sheet = SheetId::from_raw(1);
    let mut source = CellStore::new();
    source.add_sheet_store(
        sheet,
        "Data".into(),
        SheetStore::new(sheet, "Data".into(), 3, 3),
    );
    for row in 0..3 {
        for col in 0..2 {
            source.insert_cell(
                &sheet,
                CellId::from_raw((100 + row * 10 + col) as u128),
                SheetPos::new(row, col),
                CellEntry {
                    value: CellValue::number((row * 10 + col) as f64),
                },
            );
        }
    }
    (source, sheet)
}

fn planned(formula: &str, source: &CellStore, sheet: SheetId) -> (ASTNode, DataPlan) {
    let resolver = StoreCellRefResolver {
        cell_store: source,
        current_sheet: sheet,
    };
    let ast = parse_formula(formula, Some(&resolver))
        .unwrap()
        .into_inner();
    let mut plan = DataPlan::default();
    collect_static_ranges_pub(&ast, Some(sheet), source, &mut plan);
    (ast, plan)
}

#[test]
fn direct_aggregate_arguments_defer_arrays() {
    let (source, sheet) = fixture();
    for name in [
        "SUM",
        "AVERAGE",
        "COUNT",
        "COUNTA",
        "COUNTBLANK",
        "MIN",
        "MAX",
        "sum",
    ] {
        for range in ["A1:A3", "A1:B3", "(A1:A3)", "Data!A1:A3"] {
            let formula = format!("={name}({range})");
            let (_, plan) = planned(&formula, &source, sheet);
            assert!(plan.is_empty(), "{formula} can obtain column data directly");
        }
    }

    let (ast, plan) = planned("=SUM(A1:A3)", &source, sheet);
    let ranges = RangeStore::with_plan(&plan, &source);
    let mut context = EvalContext::new(&source, CellId::from_raw(200), sheet);
    context.range_store = Some(&ranges);
    assert_eq!(
        sync_block_on(Evaluator::evaluate(&ast, &context, &context)).unwrap(),
        CellValue::number(30.0)
    );
    assert!(
        ranges
            .get_cached(&RangeKey::new(sheet, 0, 0, 2, 0))
            .is_none()
    );
}

#[test]
fn array_consumers_keep_their_eager_requirements() {
    let (source, sheet) = fixture();
    let key = RangeKey::new(sheet, 0, 0, 2, 0);
    for formula in [
        "=SUM(A1:A3)+INDEX(A1:A3,2)",
        "=SUM(INDEX(A1:A3,0))",
        "=SUM(A1:A3*2)",
        "=SUM(A1:A3,1)",
        "=MEDIAN(A1:A3)",
    ] {
        let (_, plan) = planned(formula, &source, sheet);
        assert!(plan.contains(&key), "{formula} needs an intermediate array");
    }

    // Requirements from independent cells are unioned by the scheduler.
    let (_, mut plan) = planned("=SUM(A1:A3)", &source, sheet);
    let (_, other) = planned("=INDEX(A1:A3,2)", &source, sheet);
    plan.extend(other);
    let ranges = RangeStore::with_plan(&plan, &source);
    assert_eq!(
        ranges.get_cached(&key).unwrap().get(1, 0),
        Some(&CellValue::number(10.0))
    );
}

#[test]
fn aggregate_fallback_materializes_on_demand_and_refreshes_after_edits() {
    let (mut source, sheet) = fixture();
    // COUNTA must fall back for a matrix containing an error, including when a
    // numeric cache exists: an error is nonempty, not a numeric-cache blank.
    source.set_value_mut(
        &CellId::from_raw(110),
        CellValue::Error(CellError::Div0, None),
    );
    let (ast, plan) = planned("=COUNTA(A1:B3)", &source, sheet);
    assert!(plan.is_empty());
    let mut ranges = RangeStore::with_plan(&plan, &source);
    let key = RangeKey::new(sheet, 0, 0, 2, 1);
    for expected in [6.0, 5.0] {
        let mut context = EvalContext::new(&source, CellId::from_raw(200), sheet);
        context.range_store = Some(&ranges);
        assert_eq!(
            sync_block_on(Evaluator::evaluate(&ast, &context, &context)).unwrap(),
            CellValue::number(expected)
        );
        assert!(
            ranges.get_cached(&key).is_some(),
            "fallback shares its on-demand array"
        );
        source.set_value_mut(&CellId::from_raw(100), CellValue::Null);
        ranges.invalidate_dirty(&[(sheet, 0, 0)]);
    }
}

#[test]
fn deferred_aggregate_fallback_sees_pending_overrides() {
    let (source, sheet) = fixture();
    let (ast, plan) = planned("=SUM(A1:A3)", &source, sheet);
    let ranges = RangeStore::with_plan(&plan, &source);
    let key = RangeKey::new(sheet, 0, 0, 2, 0);
    // Another consumer may already have cached the committed values.
    ranges.get_or_materialize(key, &source);
    let mut context = EvalContext::with_pending_override(
        &source,
        CellId::from_raw(200),
        sheet,
        PendingCellOverride {
            sheet,
            pos: SheetPos::new(0, 0),
            value: CellValue::number(30.0),
        },
    );
    context.range_store = Some(&ranges);
    assert_eq!(
        sync_block_on(Evaluator::evaluate(&ast, &context, &context)).unwrap(),
        CellValue::number(60.0)
    );
    assert_eq!(
        ranges.get_cached(&key).unwrap().get(0, 0),
        Some(&CellValue::number(0.0))
    );
}
