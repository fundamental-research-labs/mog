use super::super::*;
use super::helpers::*;

#[cfg(feature = "native")]
fn wrapped_sumifs_parallel_snapshot() -> WorkbookSnapshot {
    let categories = ["Alpha", "Beta", "Gamma", "Delta"];
    let formula_count = level_eval::PARALLEL_THRESHOLD + 100;
    let mut cells = Vec::new();
    let mut id_counter = 0x9000u128;

    for row in 0..20u32 {
        let cat = categories[(row % 4) as usize];

        cells.push(text_cell(&mut id_counter, row, 0, cat));
        cells.push(number_cell(&mut id_counter, row, 2, (row + 1) as f64));
    }

    for row in 0..formula_count as u32 {
        let cat = categories[(row % 4) as usize];

        cells.push(text_cell(&mut id_counter, row, 4, cat));
        cells.push(formula_cell(
            &mut id_counter,
            row,
            5,
            format!("=IFERROR(SUMIFS(C$1:C$20,A$1:A$20,E{}),0)", row + 1),
        ));
    }

    single_sheet_snapshot("Sheet1", formula_count as u32 + 20, 6, cells)
}

#[cfg(feature = "native")]
#[test]
fn test_wrapped_sumifs_warm_cache_seeds_parallel_eval() {
    let (mut core, mut mirror) = init_core(wrapped_sumifs_parallel_snapshot());

    compute_functions::helpers::sumifs_result_cache::reset_diagnostics();
    let sheet_id = sid(1);
    let source_id = mirror
        .resolve_cell_id(&sheet_id, cell_types::SheetPos::new(0, 2))
        .expect("source value cell");
    core.set_cell(&mut mirror, &sheet_id, source_id, 0, 2, "1000")
        .unwrap();

    let diag = compute_functions::helpers::sumifs_result_cache::diagnostics();
    assert!(
        diag.builds >= 1,
        "warm prepass should build at least one SUMIFS result map: {:?}",
        diag
    );
    assert!(
        diag.seeds > 0,
        "parallel evaluation should seed warmed SUMIFS data into rayon TLS: {:?}",
        diag
    );
    assert!(
        diag.hits >= level_eval::PARALLEL_THRESHOLD as u64,
        "wrapped SUMIFS formulas should hit seeded warm cache during parallel eval: {:?}",
        diag
    );
}

#[cfg(feature = "native")]
#[test]
fn test_sumifs_worker_tls_entries_do_not_survive_recalc_epoch() {
    let (mut core, mut mirror) = init_core(wrapped_sumifs_parallel_snapshot());

    let sheet_id = sid(1);
    let formula_id = mirror
        .resolve_cell_id(&sheet_id, cell_types::SheetPos::new(0, 5))
        .expect("formula cell");
    assert_eq!(
        core.get_cell_value(&mirror, &formula_id).cloned(),
        Some(CellValue::number(45.0))
    );

    let source_id = mirror
        .resolve_cell_id(&sheet_id, cell_types::SheetPos::new(0, 2))
        .expect("source value cell");
    core.set_cell(&mut mirror, &sheet_id, source_id, 0, 2, "1000")
        .unwrap();

    assert_eq!(
        core.get_cell_value(&mirror, &formula_id).cloned(),
        Some(CellValue::number(1044.0))
    );
}

#[test]
fn test_sumifs_cache_preserves_criteria_order_for_multiple_layouts() {
    let cells = vec![
        CellData {
            cell_id: "00000000-0000-0000-0000-000000009001".to_string(),
            row: 0,
            col: 0,
            value: CellValue::Text("X".into()),
            formula: None,
            identity_formula: None,
            array_ref: None,
        },
        CellData {
            cell_id: "00000000-0000-0000-0000-000000009002".to_string(),
            row: 1,
            col: 0,
            value: CellValue::Text("X".into()),
            formula: None,
            identity_formula: None,
            array_ref: None,
        },
        CellData {
            cell_id: "00000000-0000-0000-0000-000000009003".to_string(),
            row: 2,
            col: 0,
            value: CellValue::Text("X".into()),
            formula: None,
            identity_formula: None,
            array_ref: None,
        },
        CellData {
            cell_id: "00000000-0000-0000-0000-000000009004".to_string(),
            row: 0,
            col: 1,
            value: CellValue::Text("N".into()),
            formula: None,
            identity_formula: None,
            array_ref: None,
        },
        CellData {
            cell_id: "00000000-0000-0000-0000-000000009005".to_string(),
            row: 1,
            col: 1,
            value: CellValue::Text("S".into()),
            formula: None,
            identity_formula: None,
            array_ref: None,
        },
        CellData {
            cell_id: "00000000-0000-0000-0000-000000009006".to_string(),
            row: 2,
            col: 1,
            value: CellValue::Text("N".into()),
            formula: None,
            identity_formula: None,
            array_ref: None,
        },
        CellData {
            cell_id: "00000000-0000-0000-0000-000000009007".to_string(),
            row: 0,
            col: 2,
            value: CellValue::number(10.0),
            formula: None,
            identity_formula: None,
            array_ref: None,
        },
        CellData {
            cell_id: "00000000-0000-0000-0000-000000009008".to_string(),
            row: 1,
            col: 2,
            value: CellValue::number(20.0),
            formula: None,
            identity_formula: None,
            array_ref: None,
        },
        CellData {
            cell_id: "00000000-0000-0000-0000-000000009009".to_string(),
            row: 2,
            col: 2,
            value: CellValue::number(30.0),
            formula: None,
            identity_formula: None,
            array_ref: None,
        },
        CellData {
            cell_id: "00000000-0000-0000-0000-00000000900a".to_string(),
            row: 0,
            col: 4,
            value: CellValue::Text("X".into()),
            formula: None,
            identity_formula: None,
            array_ref: None,
        },
        CellData {
            cell_id: "00000000-0000-0000-0000-00000000900b".to_string(),
            row: 0,
            col: 6,
            value: CellValue::Text("N".into()),
            formula: None,
            identity_formula: None,
            array_ref: None,
        },
        CellData {
            cell_id: "00000000-0000-0000-0000-00000000900c".to_string(),
            row: 0,
            col: 7,
            value: CellValue::number(0.0),
            formula: Some(
                "=IFERROR(SUMIFS(C$1:C$3,A$1:A$3,E1,B$1:B$3,G1)+SUMIFS(C$1:C$3,B$1:B$3,G1,A$1:A$3,E1),0)"
                    .to_string(),
            ),
            identity_formula: None,
            array_ref: None,
        },
    ];
    let snap = single_sheet_snapshot("Sheet1", 3, 8, cells);
    let (core, mirror) = init_core(snap);
    let formula_id = CellId::from_uuid_str("00000000-0000-0000-0000-00000000900c").unwrap();

    assert_eq!(
        core.get_cell_value(&mirror, &formula_id).cloned(),
        Some(CellValue::number(80.0))
    );
}
