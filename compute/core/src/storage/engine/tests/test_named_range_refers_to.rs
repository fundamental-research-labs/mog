//! Native typed defined names preserve reference identity and export metadata.

use super::super::*;
use super::helpers::*;
use crate::snapshot::{CellData, SheetSnapshot, WorkbookSnapshot};
use crate::storage::workbook::named_ranges;
use domain_types::DefinedName;
use formula_types::{IdentityFormula, IdentityFormulaRef, NamedRangeDef, Scope};
use value_types::{CellValue, FiniteF64};

/// Insert a typed native name to exercise query and metadata projection.
fn plant_defined_name(
    engine: &mut ComputeEngine,
    id: u64,
    name: &str,
    refers_to: IdentityFormula,
    raw_refers_to: Option<String>,
    visible: bool,
) {
    let defined_name = DefinedName {
        id: format!("{id:032x}"),
        name: name.to_string(),
        refers_to,
        raw_refers_to,
        scope: None,
        comment: None,
        custom_menu: None,
        description: None,
        help: None,
        status_bar: None,
        visible,
        xlm: false,
        function: false,
        vb_procedure: false,
        publish_to_server: false,
        workbook_parameter: false,
        xml_space_preserve: false,
        order: None,
        linked_range_id: None,
    };
    named_ranges::upsert_named_range(&mut engine.stores.storage.metadata, &defined_name);
}

fn plant_refers_to_with_id(
    engine: &mut ComputeEngine,
    id: u64,
    name: &str,
    refers_to: IdentityFormula,
) {
    plant_defined_name(engine, id, name, refers_to, None, true);
}

fn plant_refers_to(engine: &mut ComputeEngine, name: &str, refers_to: IdentityFormula) {
    plant_refers_to_with_id(engine, 0x7357_0000u64, name, refers_to);
}

fn raw_a1_defined_name_replay_snapshot() -> WorkbookSnapshot {
    WorkbookSnapshot {
        sheets: vec![SheetSnapshot {
            identities: Vec::new(),
            row_axis: None,
            col_axis: None,
            id: "550e8400-e29b-41d4-a716-446655440000".to_string(),
            name: "Sheet1".to_string(),
            rows: 100,
            cols: 26,
            cells: vec![
                CellData {
                    cell_id: "550e8400-e29b-41d4-a716-446655440001".to_string(),
                    row: 0,
                    col: 0,
                    value: CellValue::Number(FiniteF64::must(10.0)),
                    formula: None,
                    identity_formula: None,
                    array_ref: None,
                },
                CellData {
                    cell_id: "550e8400-e29b-41d4-a716-446655440002".to_string(),
                    row: 1,
                    col: 0,
                    value: CellValue::Number(FiniteF64::must(20.0)),
                    formula: None,
                    identity_formula: None,
                    array_ref: None,
                },
                CellData {
                    cell_id: "550e8400-e29b-41d4-a716-446655440003".to_string(),
                    row: 0,
                    col: 1,
                    value: CellValue::Number(FiniteF64::must(0.0)),
                    formula: Some("=SUM(SalesData)".to_string()),
                    identity_formula: None,
                    array_ref: None,
                },
            ],
            ranges: vec![],
        }],
        ..Default::default()
    }
}

fn named_range_replay_cell_ids() -> (CellId, CellId, CellId) {
    (
        CellId::from_uuid_str("550e8400-e29b-41d4-a716-446655440001").unwrap(),
        CellId::from_uuid_str("550e8400-e29b-41d4-a716-446655440002").unwrap(),
        CellId::from_uuid_str("550e8400-e29b-41d4-a716-446655440003").unwrap(),
    )
}

#[test]
fn typed_identity_formula_round_trips_to_wire() {
    let snap = simple_snapshot();
    let (mut engine, _) = ComputeEngine::from_snapshot(snap).unwrap();

    let identity = IdentityFormula {
        template: "\"canonical-constant\"".to_string(),
        refs: vec![],
        is_dynamic_array: false,
        is_volatile: false,
        is_aggregate: false,
    };
    plant_refers_to(&mut engine, "MyConst", identity);

    let wire = engine.get_all_named_ranges_wire();
    let found = wire.iter().find(|dn| dn.name == "MyConst");
    assert!(
        found.is_some(),
        "typed IdentityFormula entry must round-trip to the wire"
    );
    let found = found.unwrap();
    assert_eq!(found.refers_to.template, "\"canonical-constant\"");
    assert!(found.refers_to.refs.is_empty());
}

#[test]
fn preserved_opaque_hidden_imported_name_round_trips_to_wire() {
    let snap = simple_snapshot();
    let (mut engine, _) = ComputeEngine::from_snapshot(snap).unwrap();

    let raw_refers_to = "'[1]1601 Detail information'!$H$97:$H$129".to_string();
    plant_defined_name(
        &mut engine,
        0x7357_0001u64,
        "HiddenImported",
        named_ranges::expression_template(&raw_refers_to),
        Some(raw_refers_to.clone()),
        false,
    );

    let wire = engine.get_all_named_ranges_wire();
    let found = wire
        .iter()
        .find(|dn| dn.name == "HiddenImported")
        .expect("preserved opaque imported names should be visible to the all-names wire query");
    assert!(!found.visible);
    assert_eq!(found.refers_to.template, raw_refers_to);
    assert!(found.refers_to.refs.is_empty());
}

#[test]
fn visible_preserved_opaque_broken_ref_import_is_omitted_from_wire() {
    let snap = simple_snapshot();
    let (mut engine, _) = ComputeEngine::from_snapshot(snap).unwrap();

    plant_defined_name(
        &mut engine,
        0x7357_0002u64,
        "ImportedBroken",
        named_ranges::expression_template("#REF!"),
        Some("#REF!".to_string()),
        true,
    );

    let wire = engine.get_all_named_ranges_wire();
    assert!(
        wire.iter().all(|dn| dn.name != "ImportedBroken"),
        "visible preserved opaque #REF! imports should be storage/export metadata, not API wire names"
    );
}

#[test]
fn typed_broken_ref_name_round_trips_to_wire() {
    let snap = simple_snapshot();
    let (mut engine, _) = ComputeEngine::from_snapshot(snap).unwrap();

    let identity = IdentityFormula {
        template: "#REF!".to_string(),
        refs: vec![],
        is_dynamic_array: false,
        is_volatile: false,
        is_aggregate: false,
    };
    plant_defined_name(
        &mut engine,
        0x7357_0003u64,
        "ApiCreatedBroken",
        identity,
        None,
        true,
    );

    let wire = engine.get_all_named_ranges_wire();
    let found = wire
        .iter()
        .find(|dn| dn.name == "ApiCreatedBroken")
        .expect("typed #REF! names should stay API-visible");
    assert_eq!(found.refers_to.template, "#REF!");
    assert!(found.refers_to.refs.is_empty());
}

#[test]
fn non_ascii_template_round_trips() {
    // Typed references preserve non-ASCII formula literals through query projection.
    let snap = simple_snapshot();
    let (mut engine, _) = ComputeEngine::from_snapshot(snap).unwrap();

    let identity = IdentityFormula {
        template: "\"Πλήρης_Εκτύπωση\"".to_string(), // Greek literal constant
        refs: vec![],
        is_dynamic_array: false,
        is_volatile: false,
        is_aggregate: false,
    };
    plant_refers_to(&mut engine, "GreekName", identity);

    let wire = engine.get_all_named_ranges_wire();
    let found = wire
        .iter()
        .find(|dn| dn.name == "GreekName")
        .expect("Greek-template entry must round-trip");
    assert_eq!(found.refers_to.template, "\"Πλήρης_Εκτύπωση\"");
}

#[test]
fn snapshot_with_reference_bearing_defined_name_recalculates_formula_dependents() {
    let (a1, a2, formula_cell) = named_range_replay_cell_ids();
    let mut snap = raw_a1_defined_name_replay_snapshot();
    snap.named_ranges.push(NamedRangeDef {
        name: "SalesData".to_string(),
        scope: Scope::Workbook,
        refers_to: IdentityFormula {
            template: "{0}".to_string(),
            refs: vec![IdentityFormulaRef::Range(formula_types::IdentityRangeRef {
                start_id: a1,
                end_id: a2,
                start_row_absolute: true,
                start_col_absolute: true,
                end_row_absolute: true,
                end_col_absolute: true,
            })],
            is_dynamic_array: false,
            is_volatile: false,
            is_aggregate: false,
        },
        raw_expression: Some("=Sheet1!$A$1:$A$2".to_string()),
        linked_range_id: None,
    });

    let (engine, _) = ComputeEngine::from_snapshot(snap).unwrap();

    assert_eq!(
        engine.cell_store().get_cell_value(&formula_cell),
        Some(&CellValue::Number(FiniteF64::must(30.0))),
        "snapshot init should evaluate formulas against reference-bearing named ranges"
    );
}

#[test]
fn snapshot_with_raw_a1_defined_name_exposes_backing_cell_dependencies() {
    let mut snap = raw_a1_defined_name_replay_snapshot();
    snap.sheets[0].cells.push(CellData {
        cell_id: "550e8400-e29b-41d4-a716-446655440004".to_string(),
        row: 2,
        col: 0,
        value: CellValue::Number(FiniteF64::must(30.0)),
        formula: None,
        identity_formula: None,
        array_ref: None,
    });
    snap.named_ranges.push(NamedRangeDef::from_expression(
        "SalesData".to_string(),
        Scope::Workbook,
        "=Sheet1!$A$1:$A$3".to_string(),
    ));

    let (engine, _) = ComputeEngine::from_snapshot(snap).unwrap();
    let (_a1, _a2, formula_cell) = named_range_replay_cell_ids();
    let sheet_id = SheetId::from_uuid_str("550e8400-e29b-41d4-a716-446655440000").unwrap();

    assert_eq!(
        engine.cell_store().get_cell_value(&formula_cell),
        Some(&CellValue::Number(FiniteF64::must(60.0))),
        "raw-A1 defined names should still evaluate during snapshot init"
    );

    let precedents: Vec<_> = engine
        .get_precedents(&sheet_id, 0, 1)
        .into_iter()
        .map(|pos| (pos.row, pos.col))
        .collect();
    assert!(
        precedents.contains(&(0, 0))
            && precedents.contains(&(1, 0))
            && precedents.contains(&(2, 0)),
        "formula cells that use imported raw-A1 names should expose backing cells as precedents, got {precedents:?}"
    );

    for row in [0, 1, 2] {
        let dependents: Vec<_> = engine
            .get_dependents(&sheet_id, row, 0)
            .into_iter()
            .map(|pos| (pos.row, pos.col))
            .collect();
        assert!(
            dependents.contains(&(0, 1)),
            "backing cell A{} should expose the formula cell as a dependent, got {dependents:?}",
            row + 1
        );
    }
}

#[test]
fn api_a1_name_is_normalized_to_typed_reference_before_query() {
    let (mut engine, _) = ComputeEngine::from_snapshot(simple_snapshot()).unwrap();
    engine
        .create_named_range(domain_types::DefinedNameInput {
            name: "TypedRange".to_string(),
            refers_to: "=Sheet1!$A$1:$A$10".to_string(),
            scope: None,
            comment: None,
        })
        .unwrap();
    let native =
        named_ranges::get_named_range_by_name(&engine.stores.storage.metadata, "TypedRange", None)
            .unwrap();
    assert!(!native.refers_to.refs.is_empty());
    let wire = engine.get_all_named_ranges_wire();
    assert_eq!(
        wire.iter()
            .find(|name| name.name == "TypedRange")
            .unwrap()
            .refers_to,
        native.refers_to
    );
}

#[test]
fn named_range_rename_preserves_scope_and_incremental_dependencies() {
    let first = sheet_id();
    let second = SheetId::from_raw(0x1234);
    let second_value = CellId::from_raw(0x1235);
    let second_formula = CellId::from_raw(0x1236);
    let mut snapshot = simple_snapshot();
    snapshot.sheets[0].cells[2].formula = Some("=Sales+1".to_string());
    snapshot.sheets.push(SheetSnapshot {
        identities: Vec::new(),
        row_axis: None,
        col_axis: None,
        id: second.to_uuid_string(),
        name: "Local".to_string(),
        rows: 10,
        cols: 4,
        cells: vec![
            CellData {
                cell_id: second_value.to_uuid_string(),
                row: 0,
                col: 0,
                value: num(100.0),
                formula: None,
                identity_formula: None,
                array_ref: None,
            },
            CellData {
                cell_id: second_formula.to_uuid_string(),
                row: 1,
                col: 0,
                value: num(0.0),
                formula: Some("=Sales+1".to_string()),
                identity_formula: None,
                array_ref: None,
            },
        ],
        ranges: vec![],
    });
    snapshot.named_ranges = vec![
        NamedRangeDef::from_expression(
            "Sales".to_string(),
            Scope::Workbook,
            "=Sheet1!$A$1".to_string(),
        ),
        NamedRangeDef::from_expression(
            "Sales".to_string(),
            Scope::Sheet(second),
            "=Local!$A$1".to_string(),
        ),
    ];
    let (mut engine, _) = ComputeEngine::from_snapshot(snapshot).unwrap();
    assert_eq!(cell_value_at(&engine, &first, 1, 0), num(11.0));
    assert_eq!(cell_value_at(&engine, &second, 1, 0), num(101.0));
    let name = engine.get_named_range_by_name("Sales", None).unwrap();
    engine
        .update_named_range(
            &name.id,
            domain_types::NamedRangeUpdate {
                name: Some("Revenue".to_string()),
                ..Default::default()
            },
        )
        .unwrap();
    assert!(
        engine
            .stores
            .compute
            .get_formula(&cell_id_a2())
            .unwrap()
            .contains("Revenue")
    );
    assert!(
        engine
            .stores
            .compute
            .get_formula(&second_formula)
            .unwrap()
            .contains("Sales")
    );
    engine
        .set_cell(&first, cell_id_a1(), 0, 0, "15".into())
        .unwrap();
    engine
        .set_cell(&second, second_value, 0, 0, "200".into())
        .unwrap();
    assert_eq!(cell_value_at(&engine, &first, 1, 0), num(16.0));
    assert_eq!(cell_value_at(&engine, &second, 1, 0), num(201.0));
    let rebuilt = construction::build_workbook_snapshot(&engine.stores, &engine.cell_store);
    assert_eq!(rebuilt.named_ranges.len(), 2);
    let (reloaded, _) = ComputeEngine::from_snapshot(rebuilt).unwrap();
    assert_eq!(cell_value_at(&reloaded, &first, 1, 0), num(16.0));
    assert_eq!(cell_value_at(&reloaded, &second, 1, 0), num(201.0));
}
