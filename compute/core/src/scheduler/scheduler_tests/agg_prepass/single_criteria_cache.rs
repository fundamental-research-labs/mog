use super::super::*;
use super::helpers::*;

#[test]
fn mapped_text_sumif_reuses_grouped_sums_and_refreshes_after_edits() {
    let mut cells = Vec::new();
    let mut id = 0xA000;
    for row in 0..200 {
        cells.push(text_cell(
            &mut id,
            row,
            0,
            if row % 2 == 0 { "Alpha" } else { "Beta" },
        ));
        cells.push(number_cell(&mut id, row, 1, 1.0));
    }
    cells.push(formula_cell(
        &mut id,
        0,
        3,
        "=LET(keys,UNIQUE(A1:A200),SUM(MAP(keys,LAMBDA(key,SUMIF(A1:A200,key,B1:B200)))))".into(),
    ));
    let (mut core, mut mirror) = init_core(single_sheet_snapshot("Sheet1", 210, 5, cells));
    let sheet = sid(1);
    assert_number_at(&core, &mirror, &sheet, 0, 3, 200.0, "mapped SUMIF");
    let value_id = mirror
        .resolve_cell_id(&sheet, cell_types::SheetPos::new(0, 1))
        .unwrap();
    core.set_cell(&mut mirror, &sheet, value_id, 0, 1, "9")
        .unwrap();
    assert_number_at(&core, &mirror, &sheet, 0, 3, 208.0, "updated sum column");
    let category_id = mirror
        .resolve_cell_id(&sheet, cell_types::SheetPos::new(0, 0))
        .unwrap();
    core.set_cell(&mut mirror, &sheet, category_id, 0, 0, "Gamma")
        .unwrap();
    assert_number_at(
        &core,
        &mirror,
        &sheet,
        0,
        3,
        208.0,
        "updated category column",
    );
}

#[test]
fn mapped_numeric_sumif_reuses_groups_and_invalidates_source_columns() {
    let mut cells = Vec::new();
    let mut id = 0xB000;
    for row in 0..200 {
        cells.push(number_cell(&mut id, row, 0, (row % 17) as f64));
        cells.push(number_cell(&mut id, row, 1, 1.0));
    }
    cells.push(formula_cell(
        &mut id,
        0,
        3,
        "=LET(keys,UNIQUE(A1:A200),SUM(MAP(keys,LAMBDA(key,SUMIF(A1:A200,key,B1:B200)))))".into(),
    ));
    let (mut core, mut mirror) = init_core(single_sheet_snapshot("Sheet1", 210, 5, cells));
    let sheet = sid(1);
    assert_number_at(&core, &mirror, &sheet, 0, 3, 200.0, "mapped numeric SUMIF");
    let value_id = mirror
        .resolve_cell_id(&sheet, cell_types::SheetPos::new(0, 1))
        .unwrap();
    core.set_cell(&mut mirror, &sheet, value_id, 0, 1, "9")
        .unwrap();
    assert_number_at(
        &core,
        &mirror,
        &sheet,
        0,
        3,
        208.0,
        "updated numeric sum column",
    );
    let category_id = mirror
        .resolve_cell_id(&sheet, cell_types::SheetPos::new(0, 0))
        .unwrap();
    core.set_cell(&mut mirror, &sheet, category_id, 0, 0, "18")
        .unwrap();
    assert_number_at(
        &core,
        &mirror,
        &sheet,
        0,
        3,
        208.0,
        "updated numeric criteria column",
    );
}
