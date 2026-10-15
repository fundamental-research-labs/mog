use compute_api::{CellEditStatus, Workbook};
use mog::run_office_js_with_workbook;

fn run(workbook: &Workbook, source: &str) {
    run_office_js_with_workbook(workbook, source).unwrap();
}

fn imported() -> Workbook {
    let workbook = Workbook::blank().unwrap().0;
    run(
        &workbook,
        r#"await Excel.run(async c => {
        const s = c.workbook.worksheets.getItem('Sheet1');
        s.getRange('A1').values = [[10]];
        s.getRange('B1').formulas = [['=RAND()']];
        await c.sync();
    });"#,
    );
    Workbook::from_xlsx_bytes(&workbook.to_xlsx_bytes().unwrap())
        .unwrap()
        .0
}

const EDIT: &str = r#"await Excel.run(async c => {
    c.workbook.worksheets.getItem('Sheet1').getRange('A1').values = [[11]];
    await c.sync();
});"#;

#[test]
fn read_noop_and_volatile_cache_changes_are_not_authored_edits() {
    let workbook = imported();
    let checkpoint = workbook.begin_cell_edit_checkpoint().unwrap();
    let before = workbook.to_xlsx_bytes().unwrap();
    run(
        &workbook,
        r#"await Excel.run(async c => {
        const r = c.workbook.worksheets.getItem('Sheet1').getRange('A1:B1');
        r.load('values'); await c.sync();
        c.workbook.worksheets.getItem('Sheet1').getRange('A1').values = [[10]];
        await c.sync();
    });"#,
    );
    workbook.recalculate().unwrap();
    assert_ne!(before, workbook.to_xlsx_bytes().unwrap());
    assert_eq!(
        workbook.cell_edit_evidence(checkpoint).unwrap().status,
        CellEditStatus::NoNetCellEdit
    );
}

#[test]
fn manual_revert_does_not_use_history_depth_or_changed_volatile_bytes_as_proof() {
    let workbook = imported();
    let checkpoint = workbook.begin_cell_edit_checkpoint().unwrap();
    let before = workbook.to_xlsx_bytes().unwrap();
    run(&workbook, EDIT);
    assert_eq!(
        workbook.cell_edit_evidence(checkpoint).unwrap().status,
        CellEditStatus::NetCellEdit
    );
    run(
        &workbook,
        r#"await Excel.run(async c => {
        c.workbook.worksheets.getItem('Sheet1').getRange('A1').values = [[10]];
        await c.sync();
    });"#,
    );
    workbook.recalculate().unwrap();
    assert!(workbook.history().get_undo_state().unwrap().undo_depth > 0);
    assert_ne!(before, workbook.to_xlsx_bytes().unwrap());
    assert_eq!(
        workbook.cell_edit_evidence(checkpoint).unwrap().status,
        CellEditStatus::NoNetCellEdit
    );
}

#[test]
fn formulas_and_literal_equals_strings_remain_distinct() {
    let workbook = imported();
    let checkpoint = workbook.begin_cell_edit_checkpoint().unwrap();
    run(
        &workbook,
        r#"await Excel.run(async c => {
        c.workbook.worksheets.getItem('Sheet1').getRange('B1').formulas = [['=A1*2']];
        c.workbook.worksheets.getItem('Sheet1').getRange('C1').values = [['=literal']];
        await c.sync();
    });"#,
    );
    assert_eq!(
        workbook.cell_edit_evidence(checkpoint).unwrap().status,
        CellEditStatus::NetCellEdit
    );
}

#[test]
fn unsupported_mutations_invalidate_even_after_a_proven_edit() {
    for script in [
        "c.workbook.worksheets.getItem('Sheet1').getRange('A1').format.font.bold = true;",
        "c.workbook.worksheets.add('Other');",
        "c.workbook.worksheets.getItem('Sheet1').getRange('A1').clear();",
    ] {
        let workbook = imported();
        let checkpoint = workbook.begin_cell_edit_checkpoint().unwrap();
        run(&workbook, EDIT);
        run(
            &workbook,
            &format!("await Excel.run(async c => {{ {script} await c.sync(); }});"),
        );
        assert_eq!(
            workbook.cell_edit_evidence(checkpoint).unwrap().status,
            CellEditStatus::Unavailable,
            "{script}"
        );
    }
}

#[test]
fn undo_and_legacy_bulk_setters_are_unavailable_in_this_partial_contract() {
    let workbook = imported();
    let checkpoint = workbook.begin_cell_edit_checkpoint().unwrap();
    run(&workbook, EDIT);
    workbook.history().undo().unwrap();
    assert_eq!(
        workbook.cell_edit_evidence(checkpoint).unwrap().status,
        CellEditStatus::Unavailable
    );
    let workbook = imported();
    let checkpoint = workbook.begin_cell_edit_checkpoint().unwrap();
    workbook
        .sheet_by_index(0)
        .unwrap()
        .set_range("A1", &[vec!["11".into()]])
        .unwrap();
    assert_eq!(
        workbook.cell_edit_evidence(checkpoint).unwrap().status,
        CellEditStatus::Unavailable
    );
}

#[test]
fn checkpoints_cannot_be_reset_reused_on_other_workbooks_or_mutated_after_freeze() {
    let workbook = imported();
    let checkpoint = workbook.begin_cell_edit_checkpoint().unwrap();
    assert!(workbook.begin_cell_edit_checkpoint().is_err());
    let other = imported();
    other.begin_cell_edit_checkpoint().unwrap();
    assert!(other.cell_edit_evidence(checkpoint).is_err());
    run(&workbook, EDIT);
    let frozen = workbook.freeze_cell_edit_checkpoint(checkpoint).unwrap();
    assert_eq!(frozen.status, CellEditStatus::NetCellEdit);
    let clone = workbook.clone();
    let late = std::thread::spawn(move || run_office_js_with_workbook(&clone, EDIT))
        .join()
        .unwrap();
    assert!(late.is_err());
    assert!(workbook.recalculate().is_err());
    assert_eq!(
        frozen.revision,
        workbook
            .freeze_cell_edit_checkpoint(checkpoint)
            .unwrap()
            .revision
    );
}

#[test]
fn failed_script_can_keep_partial_artifacts_but_cannot_prove_recovery() {
    let workbook = imported();
    let checkpoint = workbook.begin_cell_edit_checkpoint().unwrap();
    let result = run_office_js_with_workbook(
        &workbook,
        r#"await Excel.run(async c => {
        c.workbook.worksheets.getItem('Sheet1').getRange('A1').values = [[11]];
        c.workbook.worksheets.getItem('Missing'); await c.sync();
    });"#,
    );
    assert!(result.is_err());
    workbook.invalidate_cell_edit_checkpoint().unwrap();
    assert_eq!(
        workbook.cell_edit_evidence(checkpoint).unwrap().status,
        CellEditStatus::Unavailable
    );
    assert!(!workbook.to_xlsx_bytes().unwrap().is_empty());
}

#[test]
fn array_projection_values_are_not_mistaken_for_authored_literals() {
    let workbook = imported();
    let checkpoint = workbook.begin_cell_edit_checkpoint().unwrap();
    run(
        &workbook,
        r#"await Excel.run(async c => {
        c.workbook.worksheets.getItem('Sheet1').getRange('D1').formulas = [['=SEQUENCE(2,1)']];
        await c.sync();
    });"#,
    );
    let evidence = workbook.cell_edit_evidence(checkpoint).unwrap();
    assert_eq!(evidence.status, CellEditStatus::Unavailable);
    assert_eq!(
        evidence.reason.as_deref(),
        Some("array_projection_unavailable")
    );
}

#[test]
fn temporary_array_projection_is_still_outside_the_admitted_mutation_contract() {
    let workbook = imported();
    let checkpoint = workbook.begin_cell_edit_checkpoint().unwrap();
    run(
        &workbook,
        r#"await Excel.run(async c => {
        const r = c.workbook.worksheets.getItem('Sheet1').getRange('D1');
        r.formulas = [['=SEQUENCE(2,1)']]; await c.sync();
        r.values = [[8]]; await c.sync();
    });"#,
    );
    assert_eq!(
        workbook.cell_edit_evidence(checkpoint).unwrap().status,
        CellEditStatus::Unavailable
    );
}
