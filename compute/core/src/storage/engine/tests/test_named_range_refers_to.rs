//! Typed formula boundary: regression — `DefinedName.refers_to` canonical format.
//!
//! W5 picked `serde_json::to_string(&IdentityFormula)` as the single
//! on-disk format for `DefinedName.refers_to` in Yrs and deleted the
//! prior dual-decoder (try JSON, fall back to raw A1) from every reader
//! in `compute/core/src/storage/engine/**`. These tests lock the new
//! invariant so the fallback cannot silently creep back.
//!
//! Two properties under test:
//!
//! 1. A well-formed `IdentityFormula` JSON entry in Yrs round-trips
//!    cleanly to the wire (`get_all_named_ranges_wire`) — the happy
//!    path for the canonical format.
//! 2. A raw-A1 string in Yrs (simulating a pre-W5 write that somehow
//!    bypassed canonicalization — corrupted document, external writer,
//!    etc.) fails to parse as `IdentityFormula` and surfaces as an
//!    **omitted entry + tracing warning** rather than a silently
//!    wrong template-only wrap. This property is the ship-time lock
//!    against runtime fallback regression.

use super::super::*;
use super::helpers::*;
use crate::snapshot::{CellData, SheetSnapshot, WorkbookSnapshot};
use crate::storage::engine::construction;
use crate::storage::workbook::named_ranges;
use domain_types::DefinedName;
use formula_types::{IdentityFormula, IdentityFormulaRef, NamedRangeDef, Scope};
use value_types::{CellValue, FiniteF64};

/// Helper: insert a `DefinedName` into Yrs with a caller-supplied
/// `refers_to` byte string. Bypasses `set_named_range`'s canonicalization
/// so the test can plant a pre-W5-shaped entry directly.
fn plant_defined_name(
    engine: &YrsComputeEngine,
    id: u64,
    name: &str,
    refers_to: String,
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
    named_ranges::upsert_named_range(
        engine.storage().doc(),
        engine.storage().workbook_map(),
        &defined_name,
    );
}

fn plant_refers_to_with_id(engine: &YrsComputeEngine, id: u64, name: &str, refers_to: String) {
    plant_defined_name(engine, id, name, refers_to, None, true);
}

fn plant_refers_to(engine: &YrsComputeEngine, name: &str, refers_to: String) {
    plant_refers_to_with_id(engine, 0x7357_0000u64, name, refers_to);
}

fn raw_a1_defined_name_replay_snapshot() -> WorkbookSnapshot {
    WorkbookSnapshot {
        sheets: vec![SheetSnapshot {
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
fn w5_json_identity_formula_round_trips_to_wire() {
    let snap = simple_snapshot();
    let (engine, _) = YrsComputeEngine::from_snapshot(snap).unwrap();

    // Plant a canonical JSON `IdentityFormula` entry directly in Yrs,
    // as the W5.1-canonicalized write path would have produced.
    let identity = IdentityFormula {
        template: "\"canonical-constant\"".to_string(),
        refs: vec![],
        is_dynamic_array: false,
        is_volatile: false,
        is_aggregate: false,
    };
    let json = serde_json::to_string(&identity).expect("serialize");
    plant_refers_to(&engine, "MyConst", json);

    // Verify the wire query sees the entry (round-trips through the
    // deserializer without the deleted A1-fallback arm).
    let wire = engine.get_all_named_ranges_wire();
    let found = wire.iter().find(|dn| dn.name == "MyConst");
    assert!(
        found.is_some(),
        "canonical JSON IdentityFormula entry must round-trip to the wire"
    );
    let found = found.unwrap();
    assert_eq!(found.refers_to.template, "\"canonical-constant\"");
    assert!(found.refers_to.refs.is_empty());
}

#[test]
fn w5_raw_a1_refers_to_is_rejected_not_silently_wrapped() {
    let snap = simple_snapshot();
    let (engine, _) = YrsComputeEngine::from_snapshot(snap).unwrap();

    // Plant a raw-A1 string entry — the shape pre-W5 documents had on
    // disk before the dual-decoder was deleted. Well-formed JSON would
    // start with `{`; this string is not valid JSON by any decoder.
    //
    // Before W5, the reader's fallback arm would have silently wrapped
    // this as `IdentityFormula { template: "Sheet1!$A$1:$A$10", refs: [],
    // is_dynamic_array: false, is_volatile: false }` and returned it to
    // callers — a valid-looking but semantically wrong `IdentityFormula`
    // (it is a range reference, not an empty-refs template constant).
    //
    // After W5, the reader warns and omits the entry. The property under
    // test: the entry is **not present** in the wire result, i.e. the
    // silent-wrong-semantics path is gone.
    plant_refers_to(&engine, "PreW5Range", "Sheet1!$A$1:$A$10".to_string());

    let wire = engine.get_all_named_ranges_wire();
    let found = wire.iter().find(|dn| dn.name == "PreW5Range");
    assert!(
        found.is_none(),
        "raw-A1 `refers_to` entry must be rejected by the single-format \
         reader, not silently wrapped as a template-only IdentityFormula. \
         A non-None result here means the dual-decoder fallback has \
         regressed."
    );
}

#[test]
fn preserved_opaque_hidden_imported_name_round_trips_to_wire() {
    let snap = simple_snapshot();
    let (engine, _) = YrsComputeEngine::from_snapshot(snap).unwrap();

    let raw_refers_to = "'[1]1601 Detail information'!$H$97:$H$129".to_string();
    plant_defined_name(
        &engine,
        0x7357_0001u64,
        "HiddenImported",
        raw_refers_to.clone(),
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
    let (engine, _) = YrsComputeEngine::from_snapshot(snap).unwrap();

    plant_defined_name(
        &engine,
        0x7357_0002u64,
        "ImportedBroken",
        "#REF!".to_string(),
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
fn canonical_json_broken_ref_name_round_trips_to_wire() {
    let snap = simple_snapshot();
    let (engine, _) = YrsComputeEngine::from_snapshot(snap).unwrap();

    let identity = IdentityFormula {
        template: "#REF!".to_string(),
        refs: vec![],
        is_dynamic_array: false,
        is_volatile: false,
        is_aggregate: false,
    };
    plant_defined_name(
        &engine,
        0x7357_0003u64,
        "ApiCreatedBroken",
        serde_json::to_string(&identity).expect("serialize"),
        None,
        true,
    );

    let wire = engine.get_all_named_ranges_wire();
    let found = wire
        .iter()
        .find(|dn| dn.name == "ApiCreatedBroken")
        .expect("canonical JSON #REF! names should stay API-visible");
    assert_eq!(found.refers_to.template, "#REF!");
    assert!(found.refers_to.refs.is_empty());
}

#[test]
fn w5_malformed_json_refers_to_is_rejected() {
    let snap = simple_snapshot();
    let (engine, _) = YrsComputeEngine::from_snapshot(snap).unwrap();

    // Plant a string that looks like it could be JSON but isn't a valid
    // `IdentityFormula`. Before W5 this would have been swallowed by the
    // fallback and returned as a template-only wrap. After W5 it is
    // omitted with a tracing warning.
    plant_refers_to(
        &engine,
        "Malformed",
        r#"{"not_identity_formula": true}"#.to_string(),
    );

    let wire = engine.get_all_named_ranges_wire();
    let found = wire.iter().find(|dn| dn.name == "Malformed");
    assert!(
        found.is_none(),
        "JSON that is not a valid IdentityFormula must be rejected — the \
         deleted fallback arm would have silently wrapped it as a \
         template-only entry."
    );
}

#[test]
fn w5_multiple_invalid_refers_to_entries_do_not_hide_canonical_entries() {
    let snap = simple_snapshot();
    let (engine, _) = YrsComputeEngine::from_snapshot(snap).unwrap();

    plant_refers_to_with_id(
        &engine,
        0x7357_0001u64,
        "RawRange",
        "Sheet1!$A$1:$A$10".to_string(),
    );
    plant_refers_to_with_id(
        &engine,
        0x7357_0002u64,
        "Malformed",
        r#"{"not_identity_formula": true}"#.to_string(),
    );

    let identity = IdentityFormula {
        template: "\"canonical-constant\"".to_string(),
        refs: vec![],
        is_dynamic_array: false,
        is_volatile: false,
        is_aggregate: false,
    };
    plant_refers_to_with_id(
        &engine,
        0x7357_0003u64,
        "Canonical",
        serde_json::to_string(&identity).expect("serialize"),
    );

    let wire = engine.get_all_named_ranges_wire();
    assert!(
        wire.iter()
            .all(|dn| dn.name != "RawRange" && dn.name != "Malformed"),
        "invalid raw/malformed entries must still be omitted by the single-format reader"
    );
    assert!(
        wire.iter().any(|dn| dn.name == "Canonical"),
        "invalid entries must not prevent canonical IdentityFormula entries from reaching the wire"
    );
}

#[test]
fn w5_non_ascii_template_round_trips() {
    // Typed formula boundary: non-ASCII coverage: ensure a canonical JSON
    // `IdentityFormula` carrying a Greek template (UTF-8 boundary
    // production-incident class) round-trips through Yrs without
    // mojibake / decoder drama. `serde_json` handles non-ASCII
    // transparently — this test locks the property at the W5
    // boundary, not just the serde layer.
    let snap = simple_snapshot();
    let (engine, _) = YrsComputeEngine::from_snapshot(snap).unwrap();

    let identity = IdentityFormula {
        template: "\"Πλήρης_Εκτύπωση\"".to_string(), // Greek literal constant
        refs: vec![],
        is_dynamic_array: false,
        is_volatile: false,
        is_aggregate: false,
    };
    let json = serde_json::to_string(&identity).expect("serialize");
    plant_refers_to(&engine, "GreekName", json);

    let wire = engine.get_all_named_ranges_wire();
    let found = wire
        .iter()
        .find(|dn| dn.name == "GreekName")
        .expect("Greek-template entry must round-trip");
    assert_eq!(found.refers_to.template, "\"Πλήρης_Εκτύπωση\"");
}

#[test]
fn from_yrs_state_rebuilds_after_normalizing_raw_a1_imported_defined_names() {
    let snap = raw_a1_defined_name_replay_snapshot();
    let (engine, _) = YrsComputeEngine::from_snapshot(snap).unwrap();

    // Simulate an XLSX-imported provider state before typed-boundary
    // normalization has been flushed: formulas are persisted normally, but
    // the workbook defined name still carries raw A1 text in Yrs.
    plant_refers_to(&engine, "SalesData", "Sheet1!$A$1:$A$2".to_string());
    let state = compute_collab::encode_full_state(engine.storage().doc());

    let (replayed, _) = YrsComputeEngine::from_yrs_state(&state).unwrap();
    let (_a1, _a2, formula_cell) = named_range_replay_cell_ids();

    let persisted = named_ranges::get_named_range_by_name(
        replayed.storage().doc(),
        replayed.storage().workbook_map(),
        "SalesData",
        None,
    )
    .expect("SalesData should remain persisted after replay");
    let persisted_identity = serde_json::from_str::<IdentityFormula>(&persisted.refers_to)
        .expect("replay should normalize raw-A1 defined name refs to IdentityFormula JSON");
    assert!(
        !persisted_identity.refs.is_empty(),
        "normalized SalesData should carry concrete refs, got {persisted_identity:?}"
    );

    let replay_snapshot = construction::build_workbook_snapshot_from_yrs(replayed.storage())
        .expect("replayed Yrs state should convert to a full workbook snapshot");
    let snapshot_name = replay_snapshot
        .named_ranges
        .iter()
        .find(|nr| nr.name == "SalesData")
        .expect("normalized SalesData should be present in snapshots built from replayed Yrs");
    assert!(
        snapshot_name.refers_to.refs.is_empty(),
        "snapshot SalesData should not carry axis identity refs that WorkbookSnapshot cannot resolve, got {snapshot_name:?}"
    );
    assert_eq!(
        snapshot_name.raw_expression.as_deref(),
        Some("=Sheet1!$A$1:$A$2"),
        "snapshot SalesData should preserve portable A1 semantics"
    );
    assert!(
        replayed.mirror().get_named_range("SalesData").is_some(),
        "normalized defined name should be installed in the replayed mirror"
    );
    assert_eq!(
        replayed.compute().get_formula(&formula_cell),
        Some("=SUM(SalesData)"),
        "formula text must survive the failed first replay parse so rebuild can reparse it"
    );
    let (clean_from_replay_snapshot, _) =
        YrsComputeEngine::from_snapshot(replay_snapshot.clone()).unwrap();
    assert_eq!(
        clean_from_replay_snapshot
            .mirror()
            .get_cell_value(&formula_cell),
        Some(&CellValue::Number(FiniteF64::must(30.0))),
        "the normalized replay-derived snapshot should be sufficient for a clean init"
    );
    assert_eq!(
        replayed.mirror().get_cell_value(&formula_cell),
        Some(&CellValue::Number(FiniteF64::must(30.0))),
        "provider replay must normalize raw-A1 defined names before the final recalc"
    );
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

    let (engine, _) = YrsComputeEngine::from_snapshot(snap).unwrap();

    assert_eq!(
        engine.mirror().get_cell_value(&formula_cell),
        Some(&CellValue::Number(FiniteF64::must(30.0))),
        "snapshot init should evaluate formulas against reference-bearing named ranges"
    );
}
