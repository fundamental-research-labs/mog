use super::*;

// -----------------------------------------------------------------------
// Variables as DAG nodes
// -----------------------------------------------------------------------

#[test]
fn test_variable_synthetic_cell_id_deterministic() {
    use crate::mirror::variable_store::VariableStore;
    use formula_types::Scope;

    // Same (scope, name) always produces the same CellId
    let id1 = VariableStore::synthetic_cell_id(&Scope::Workbook, "tax_rate");
    let id2 = VariableStore::synthetic_cell_id(&Scope::Workbook, "tax_rate");
    assert_eq!(id1, id2);

    // Case-insensitive
    let id3 = VariableStore::synthetic_cell_id(&Scope::Workbook, "TAX_RATE");
    assert_eq!(id1, id3);

    // Different scopes produce different IDs
    let sheet1 = SheetId::from_raw(1);
    let id4 = VariableStore::synthetic_cell_id(&Scope::Sheet(sheet1), "tax_rate");
    assert_ne!(id1, id4);
}

#[test]
fn test_variable_dag_registration() {
    // A variable with a constant expression should get an AST entry
    // and its synthetic CellId should be in the graph.
    use crate::mirror::variable_store::VariableStore;
    use formula_types::{NamedRangeDef, Scope};

    let mut core = ComputeCore::new();
    let mut mirror = CellMirror::new();
    core.init_from_snapshot(&mut mirror, basic_snapshot())
        .unwrap();

    // Add a workbook-scoped variable with a constant expression
    let def =
        NamedRangeDef::from_expression("TaxRate".to_string(), Scope::Workbook, "0.15".to_string());
    core.set_named_range(&mut mirror, "TaxRate".to_string(), def);

    // The variable should have a synthetic CellId in the AST cache
    let synth_id = VariableStore::synthetic_cell_id(&Scope::Workbook, "taxrate");
    assert!(
        core.ast_cache.contains_key(&synth_id),
        "Variable AST should be cached under synthetic CellId"
    );
}

#[test]
fn test_variable_formula_dag_registration() {
    // A variable with a formula expression like "=A1+B1" should have
    // its AST cached AND dependencies registered in the graph.
    use crate::mirror::variable_store::VariableStore;
    use formula_types::{NamedRangeDef, Scope};

    let mut core = ComputeCore::new();
    let mut mirror = CellMirror::new();
    core.init_from_snapshot(&mut mirror, basic_snapshot())
        .unwrap();

    // Add a variable that references cells A1 and B1
    let def =
        NamedRangeDef::from_expression("MySum".to_string(), Scope::Workbook, "A1+B1".to_string());
    core.set_named_range(&mut mirror, "MySum".to_string(), def);

    let synth_id = VariableStore::synthetic_cell_id(&Scope::Workbook, "mysum");

    // AST should be cached
    assert!(core.ast_cache.contains_key(&synth_id));

    // The variable should have precedents (A1 and B1)
    let deps = core.graph.get_precedents(&synth_id);
    assert!(
        !deps.is_empty(),
        "Variable formula should have precedent dependencies"
    );
}

#[test]
fn test_variable_from_snapshot_registered() {
    // Variables loaded from a snapshot should be registered as DAG nodes.
    use crate::mirror::variable_store::VariableStore;
    use formula_types::{NamedRangeDef, Scope};

    let mut snapshot = basic_snapshot();
    snapshot.named_ranges.push(NamedRangeDef::from_expression(
        "Constant".to_string(),
        Scope::Workbook,
        "42".to_string(),
    ));

    let mut core = ComputeCore::new();
    let mut mirror = CellMirror::new();
    core.init_from_snapshot(&mut mirror, snapshot).unwrap();

    let synth_id = VariableStore::synthetic_cell_id(&Scope::Workbook, "constant");
    assert!(
        core.ast_cache.contains_key(&synth_id),
        "Variable from snapshot should have AST in cache"
    );
}

#[test]
fn test_variable_cell_dependency_edge() {
    // When a cell formula references a variable (Identifier node),
    // the dep extractor should emit an edge to the variable's synthetic CellId.
    use crate::mirror::variable_store::VariableStore;
    use formula_types::{NamedRangeDef, Scope};

    let mut snapshot = basic_snapshot();

    // Add a variable "rate" with value 0.1
    snapshot.named_ranges.push(NamedRangeDef::from_expression(
        "rate".to_string(),
        Scope::Workbook,
        "0.1".to_string(),
    ));

    // Add a cell D1 that uses =A1*rate
    snapshot.sheets[0].cells.push(CellData {
        cell_id: "00000000-0000-0000-0000-000000000013".to_string(),
        row: 0,
        col: 3, // D1
        value: CellValue::number(0.0),
        formula: Some("=A1*rate".to_string()),
        identity_formula: None,
        array_ref: None,
    });

    let mut core = ComputeCore::new();
    let mut mirror = CellMirror::new();
    core.init_from_snapshot(&mut mirror, snapshot).unwrap();

    // D1 should depend on the "rate" variable's synthetic CellId
    let d1_id = cid(0x13);
    let var_id = VariableStore::synthetic_cell_id(&Scope::Workbook, "rate");

    let d1_deps = core.graph.get_precedents(&d1_id);
    let depends_on_var = d1_deps.iter().any(|dep| match dep {
        crate::graph::DepTarget::Cell(id) => *id == var_id,
        _ => false,
    });
    assert!(
        depends_on_var,
        "Cell D1 should have a dependency edge to the variable 'rate'"
    );
}

#[test]
fn test_variable_remove_cleans_dag() {
    // Removing a variable should clean up its AST cache and graph entries.
    use crate::mirror::variable_store::VariableStore;
    use formula_types::{NamedRangeDef, Scope};

    let mut core = ComputeCore::new();
    let mut mirror = CellMirror::new();
    core.init_from_snapshot(&mut mirror, basic_snapshot())
        .unwrap();

    let def =
        NamedRangeDef::from_expression("TaxRate".to_string(), Scope::Workbook, "0.15".to_string());
    core.set_named_range(&mut mirror, "TaxRate".to_string(), def);

    let synth_id = VariableStore::synthetic_cell_id(&Scope::Workbook, "taxrate");
    assert!(core.ast_cache.contains_key(&synth_id));

    core.remove_named_range(&mut mirror, "TaxRate");

    assert!(
        !core.ast_cache.contains_key(&synth_id),
        "Removing a variable should clear its AST cache entry"
    );
}

#[test]
fn test_variable_scope_shadowing_in_dag() {
    // Sheet-scoped variable should shadow workbook-scoped variable.
    // Both should have distinct synthetic CellIds.
    use crate::mirror::variable_store::VariableStore;
    use formula_types::{NamedRangeDef, Scope};

    let sheet1 = sid(1);

    let id_wb = VariableStore::synthetic_cell_id(&Scope::Workbook, "tax");
    let id_sh = VariableStore::synthetic_cell_id(&Scope::Sheet(sheet1), "tax");
    assert_ne!(
        id_wb, id_sh,
        "Different scopes must produce different CellIds"
    );

    let mut core = ComputeCore::new();
    let mut mirror = CellMirror::new();
    core.init_from_snapshot(&mut mirror, basic_snapshot())
        .unwrap();

    // Add workbook-scoped "tax"
    core.set_named_range(
        &mut mirror,
        "tax".to_string(),
        NamedRangeDef::from_expression("tax".to_string(), Scope::Workbook, "0.10".to_string()),
    );

    // Add sheet-scoped "tax" (shadows the workbook one for Sheet1)
    core.set_named_range(
        &mut mirror,
        "tax".to_string(),
        NamedRangeDef::from_expression("tax".to_string(), Scope::Sheet(sheet1), "0.20".to_string()),
    );

    // Both should have AST entries under different synthetic CellIds
    assert!(core.ast_cache.contains_key(&id_wb));
    assert!(core.ast_cache.contains_key(&id_sh));
}
