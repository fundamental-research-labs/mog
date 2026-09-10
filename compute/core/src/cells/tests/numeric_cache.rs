use crate::cells::{CellStore, test_helpers::simple_snapshot};
use crate::eval::context::traits::EvalMetadata;
use crate::eval::{Evaluator, sync_block_on};
use crate::eval_bridge::{EvalContext, OverrideContext, StoreCellRefResolver};
use crate::snapshot::CellData;
use crate::storage::engine::ComputeEngine;
use cell_types::{CellId, RowId, SheetId, SheetPos};
use formula_types::StructureChange;
use rustc_hash::{FxHashMap, FxHashSet};
use std::cell::RefCell;
use value_types::{CellError, CellValue};

const ROWS: u32 = 2048;

fn snapshot() -> crate::snapshot::WorkbookSnapshot {
    let mut snapshot = simple_snapshot();
    let sheet = &mut snapshot.sheets[0];
    sheet.rows = ROWS;
    sheet.cols = 2;
    sheet.cells = (0..ROWS)
        .map(|row| CellData {
            cell_id: CellId::from_raw(row as u128 + 100).to_uuid_string(),
            row,
            col: 0,
            value: CellValue::number(1.0),
            formula: None,
            identity_formula: None,
            array_ref: None,
        })
        .collect();
    snapshot
}

fn numeric_column(cell_store: &CellStore, sheet: SheetId) -> Option<&value_types::DenseColumn> {
    cell_store.dense_cache().get_numeric_for_range(
        sheet,
        0,
        0,
        ROWS - 1,
        cell_store,
    )
}

#[test]
fn native_numeric_cache_is_lazy_and_updates_or_falls_back_with_value_types() {
    let mut cell_store = CellStore::from_snapshot(snapshot()).unwrap();
    let sid = *cell_store.sheet_ids().next().unwrap();
    assert!(cell_store.dense_cache().is_empty());
    let access = EvalContext::new(&cell_store, CellId::from_raw(100), sid);
    assert!(access.get_dense_column_for_range(&sid, 0, 0, 10).is_none());
    if cfg!(feature = "dd-precision") {
        assert!(numeric_column(&cell_store, sid).is_none());
        return;
    }
    let pointer = numeric_column(&cell_store, sid).unwrap().values().as_ptr();
    cell_store.set_value_mut(&CellId::from_raw(100), CellValue::number(8.0));
    assert_eq!(
        numeric_column(&cell_store, sid).unwrap().values().as_ptr(),
        pointer
    );
    assert_eq!(
        numeric_column(&cell_store, sid)
            .unwrap()
            .sum_range(0, ROWS - 1),
        ROWS as f64 + 7.0
    );

    cell_store.set_value_mut(&CellId::from_raw(100), CellValue::Null);
    let dense = numeric_column(&cell_store, sid).unwrap();
    assert_eq!(dense.values().as_ptr(), pointer);
    assert_eq!(dense.numeric_count(), ROWS as usize - 1);
    assert_eq!(dense.sum_range(0, ROWS - 1), ROWS as f64 - 1.0);

    for value in [
        CellValue::Text("text".into()),
        CellValue::Boolean(true),
        CellValue::Error(CellError::Div0, None),
    ] {
        cell_store.set_value_mut(&CellId::from_raw(100), value);
        assert!(numeric_column(&cell_store, sid).is_none());
        cell_store.set_value_mut(&CellId::from_raw(100), CellValue::number(1.0));
        assert!(numeric_column(&cell_store, sid).is_some());
    }
}

#[test]
fn native_numeric_cache_recalc_tracks_numeric_text_blank_and_error_edits() {
    let (mut engine, _) = ComputeEngine::from_snapshot(snapshot()).unwrap();
    let sid = *engine.cell_store().sheet_ids().next().unwrap();
    engine
        .set_cell_value_parsed(&sid, 0, 1, "=SUM(A1:A2048)")
        .unwrap();
    assert_eq!(
        engine.get_cell_value(&sid, 0, 1),
        CellValue::number(ROWS as f64)
    );
    assert_eq!(
        engine.cell_store().dense_cache().get(&sid, 0).is_some(),
        !cfg!(feature = "dd-precision"),
        "the ordinary SUM evaluator should populate only a lossless numeric cache"
    );
    for (input, expected) in [
        ("8", CellValue::number(ROWS as f64 + 7.0)),
        ("text", CellValue::number(ROWS as f64 - 1.0)),
        ("TRUE", CellValue::number(ROWS as f64 - 1.0)),
        ("", CellValue::number(ROWS as f64 - 1.0)),
        ("=1/0", CellValue::Error(CellError::Div0, None)),
        ("1", CellValue::number(ROWS as f64)),
    ] {
        engine.set_cell_value_parsed(&sid, 0, 0, input).unwrap();
        assert_eq!(engine.get_cell_value(&sid, 0, 1), expected, "input {input}");
    }
}

#[test]
fn native_numeric_cache_invalidates_on_moves_and_structural_changes() {
    let mut cell_store = CellStore::from_snapshot(snapshot()).unwrap();
    let sid = *cell_store.sheet_ids().next().unwrap();
    let _ = numeric_column(&cell_store, sid);
    cell_store.move_cell(&CellId::from_raw(100), &sid, SheetPos::new(ROWS, 0));
    assert!(cell_store.dense_cache().get(&sid, 0).is_none());
    if let Some(dense) = numeric_column(&cell_store, sid) {
        assert!(dense.values()[0].is_nan());
        assert_eq!(dense.values()[ROWS as usize], 1.0);
    }
    cell_store.apply_structure_change(
        &sid,
        &StructureChange::InsertRows {
            at: 0,
            count: 1,
            new_row_ids: vec![RowId::from_raw(9000)],
        },
    );
    assert!(cell_store.dense_cache().get(&sid, 0).is_none());
    if let Some(dense) = numeric_column(&cell_store, sid) {
        assert!(dense.values()[0].is_nan());
        assert!(dense.values()[1].is_nan());
        assert_eq!(dense.values()[2], 1.0);
    }
    cell_store.remove_sheet(&sid);
    assert!(cell_store.dense_cache().is_empty());
}

#[test]
fn native_numeric_cache_is_bypassed_by_what_if_and_pending_overrides() {
    let cell_store = CellStore::from_snapshot(snapshot()).unwrap();
    let sid = *cell_store.sheet_ids().next().unwrap();
    let _ = numeric_column(&cell_store, sid);
    let resolver = StoreCellRefResolver {
        cell_store: &cell_store,
        current_sheet: sid,
    };
    let ast = compute_parser::parse_formula("SUM(A1:A2048)", Some(&resolver))
        .unwrap()
        .node;
    let overrides = FxHashMap::from_iter([(CellId::from_raw(100), CellValue::number(8.0))]);
    let ast_cache = FxHashMap::default();
    let eval_cache = RefCell::new(FxHashMap::default());
    let evaluating = RefCell::new(FxHashSet::default());
    let context = OverrideContext::new(
        &cell_store,
        CellId::from_raw(100),
        sid,
        &overrides,
        &ast_cache,
        &eval_cache,
        &evaluating,
    );
    assert!(
        context
            .get_dense_column_for_range(&sid, 0, 0, ROWS - 1)
            .is_none()
    );
    assert_eq!(
        sync_block_on(Evaluator::evaluate(&ast, &context, &context)).unwrap(),
        CellValue::number(ROWS as f64 + 7.0)
    );
    let context = EvalContext::with_pending_override(
        &cell_store,
        CellId::from_raw(100),
        sid,
        crate::eval_bridge::store_access::PendingCellOverride {
            sheet: sid,
            pos: SheetPos::new(0, 0),
            value: CellValue::number(8.0),
        },
    );
    assert!(
        context
            .get_dense_column_for_range(&sid, 0, 0, ROWS - 1)
            .is_none()
    );
    assert_eq!(
        sync_block_on(Evaluator::evaluate(&ast, &context, &context)).unwrap(),
        CellValue::number(ROWS as f64 + 7.0)
    );
    assert_eq!(
        cell_store.get_cell_value(&CellId::from_raw(100)),
        Some(&CellValue::number(1.0))
    );
}
