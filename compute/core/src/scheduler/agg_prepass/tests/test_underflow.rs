use super::*;

#[test]
fn post_op_flushes_subnormal_result_and_preserves_normal_boundary() {
    let mirror = test_mirror();
    let min_normal = f64::MIN_POSITIVE;

    let multiply = PostOp {
        op: compute_parser::BinOp::Mul,
        operand: PostOpOperand::Number(0.5),
    };
    assert_eq!(
        apply_post_op(CellValue::number(min_normal), &multiply, &mirror),
        CellValue::number(0.0),
    );

    let preserve = PostOp {
        op: compute_parser::BinOp::Mul,
        operand: PostOpOperand::Number(1.0),
    };
    assert_eq!(
        apply_post_op(CellValue::number(min_normal), &preserve, &mirror),
        CellValue::number(min_normal),
    );
}

#[test]
fn post_op_treats_subnormal_divisor_as_division_by_zero() {
    let mirror = test_mirror();
    let divide = PostOp {
        op: compute_parser::BinOp::Div,
        operand: PostOpOperand::Number(f64::MIN_POSITIVE / 2.0),
    };

    assert_eq!(
        apply_post_op(CellValue::number(1.0), &divide, &mirror),
        CellValue::Error(CellError::Div0, None),
    );
}

#[test]
fn post_op_overflow_keeps_num_classification() {
    let mirror = test_mirror();
    let multiply = PostOp {
        op: compute_parser::BinOp::Mul,
        operand: PostOpOperand::Number(2.0),
    };

    assert_eq!(
        apply_post_op(CellValue::number(f64::MAX), &multiply, &mirror),
        CellValue::Error(CellError::Num, None),
    );
}

#[test]
fn execute_group_applies_formula_boundary_to_post_op_result() {
    let sheet = sheet_id_1();
    let min_normal = f64::MIN_POSITIVE;
    let mirror = {
        let cells = vec![
            CellData {
                cell_id: CellId::from_raw(9001).to_uuid_string(),
                row: 0,
                col: 0,
                value: CellValue::number(min_normal),
                formula: None,
                identity_formula: None,
                array_ref: None,
            },
            CellData {
                cell_id: CellId::from_raw(9002).to_uuid_string(),
                row: 0,
                col: 1,
                value: CellValue::Text("x".into()),
                formula: None,
                identity_formula: None,
                array_ref: None,
            },
            CellData {
                cell_id: CellId::from_raw(9003).to_uuid_string(),
                row: 0,
                col: 2,
                value: CellValue::Text("x".into()),
                formula: None,
                identity_formula: None,
                array_ref: None,
            },
        ];
        CellMirror::from_snapshot(WorkbookSnapshot {
            sheets: vec![SheetSnapshot {
                identities: vec![],
                row_axis: None,
                col_axis: None,
                id: "00000000-0000-0000-0000-000000000001".to_string(),
                name: "Data".to_string(),
                rows: 1,
                cols: 3,
                cells,
                ranges: vec![],
            }],
            named_ranges: vec![],
            tables: vec![],
            pivot_tables: vec![],
            data_table_regions: vec![],
            iterative_calc: false,
            max_iterations: 100,
            max_change: FiniteF64::must(0.001),
            calculation_settings: None,
            ..Default::default()
        })
        .unwrap()
    };

    let pattern = AggPattern {
        agg_fn: AggFn::SumIfs,
        value_range: Some((sheet, 0, 0, 1)),
        pairs: SmallVec::from_vec(vec![AggCriteriaPair {
            data_sheet: sheet,
            data_col: 1,
            data_start_row: 0,
            data_end_row: 1,
            criteria: CriteriaSource::Dynamic { sheet, col: 2 },
        }]),
    };
    let group = AggFormulaGroup {
        sheet,
        col: 3,
        start_row: 0,
        end_row: 1,
        pattern,
        post_op: Some(PostOp {
            op: compute_parser::BinOp::Mul,
            operand: PostOpOperand::Number(0.5),
        }),
        cell_ids: vec![CellId::from_raw(9004)],
    };
    let no_formulas = |_: &SheetId, _: u32, _: u32, _: u32| false;
    let no_stale = |_: &SheetId, _: u32, _: u32, _: u32| false;

    let results = execute_agg_group(&group, &mirror, no_formulas, no_stale).unwrap();
    assert_eq!(
        results,
        vec![(CellId::from_raw(9004), CellValue::number(0.0))]
    );
}
