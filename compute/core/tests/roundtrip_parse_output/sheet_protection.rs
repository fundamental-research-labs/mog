use std::sync::Arc;

use super::helpers::*;
use domain_types::SheetProtection;
use value_types::CellValue;

#[test]
fn roundtrip_sheet_protection_basic() {
    let mut output = make_single_sheet(
        "Protected",
        vec![cell(0, 0, CellValue::Text(Arc::from("Locked cell")))],
    );
    output.sheets[0].protection = Some(SheetProtection {
        is_protected: true,
        select_locked: true,
        select_unlocked: true,
        format_cells: false,
        format_columns: false,
        format_rows: false,
        insert_columns: false,
        insert_rows: false,
        insert_hyperlinks: false,
        delete_columns: false,
        delete_rows: false,
        sort: false,
        auto_filter: false,
        pivot_tables: false,
        objects: false,
        scenarios: false,
        ..Default::default()
    });

    let rt = roundtrip(&output);
    let rt_prot = rt.sheets[0]
        .protection
        .as_ref()
        .expect("Sheet protection should survive round-trip");

    assert_eq!(rt_prot.is_protected, true, "is_protected should be true");
    assert_eq!(
        rt_prot.select_locked, true,
        "select_locked should be preserved"
    );
    assert_eq!(
        rt_prot.select_unlocked, true,
        "select_unlocked should be preserved"
    );
    assert_eq!(
        rt_prot.format_cells, false,
        "format_cells should be preserved"
    );
    assert_eq!(
        rt_prot.insert_rows, false,
        "insert_rows should be preserved"
    );
    assert_eq!(rt_prot.sort, false, "sort should be preserved");
}

#[test]
fn roundtrip_sheet_protection_permissive() {
    let mut output = make_single_sheet(
        "PermissiveProtection",
        vec![cell(0, 0, CellValue::Text(Arc::from("Editable")))],
    );
    output.sheets[0].protection = Some(SheetProtection {
        is_protected: true,
        select_locked: true,
        select_unlocked: true,
        format_cells: true,
        format_columns: true,
        format_rows: true,
        insert_columns: true,
        insert_rows: true,
        insert_hyperlinks: true,
        delete_columns: true,
        delete_rows: true,
        sort: true,
        auto_filter: true,
        pivot_tables: true,
        objects: true,
        scenarios: true,
        ..Default::default()
    });

    let rt = roundtrip(&output);
    let rt_prot = rt.sheets[0]
        .protection
        .as_ref()
        .expect("Permissive protection should survive");

    assert_eq!(rt_prot.is_protected, true);
    // Verify permissive flags survived
    assert_eq!(rt_prot.format_cells, true, "format_cells should be true");
    assert_eq!(
        rt_prot.format_columns, true,
        "format_columns should be true"
    );
    assert_eq!(rt_prot.format_rows, true, "format_rows should be true");
    assert_eq!(
        rt_prot.insert_columns, true,
        "insert_columns should be true"
    );
    assert_eq!(rt_prot.insert_rows, true, "insert_rows should be true");
    assert_eq!(
        rt_prot.insert_hyperlinks, true,
        "insert_hyperlinks should be true"
    );
    assert_eq!(
        rt_prot.delete_columns, true,
        "delete_columns should be true"
    );
    assert_eq!(rt_prot.delete_rows, true, "delete_rows should be true");
    assert_eq!(rt_prot.sort, true, "sort should be true");
    assert_eq!(rt_prot.auto_filter, true, "auto_filter should be true");
    assert_eq!(rt_prot.pivot_tables, true, "pivot_tables should be true");
    assert_eq!(rt_prot.objects, true, "objects should be true");
    assert_eq!(rt_prot.scenarios, true, "scenarios should be true");
}
