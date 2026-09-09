//! XLSX round-trip tests for add/remove/update hyperlink.
//!
//! Target: `compute/core/src/storage/sheet/hyperlinks.rs`.
//!
//! Fixture materializes via `from_snapshot` → `export_to_xlsx_bytes` then
//! reloads via `from_xlsx_bytes`. Hyperlinks on XLSX-hydrated cells must
//! survive export.

use compute_core::storage::engine::ComputeEngine;
use snapshot_types::{CellData, SheetSnapshot, WorkbookSnapshot};
use value_types::{CellValue, FiniteF64};

fn one_sheet_snapshot(name: &str, rows: u32, cols: u32, cells: Vec<CellData>) -> WorkbookSnapshot {
    WorkbookSnapshot {
        sheets: vec![SheetSnapshot {
            identities: Vec::new(),
            row_axis: None,
            col_axis: None,
            id: "550e8400-e29b-41d4-a716-446655440000".to_string(),
            name: name.to_string(),
            rows,
            cols,
            cells,
            ranges: vec![],
        }],
        ..Default::default()
    }
}

fn value_cell(uuid_suffix: u32, row: u32, col: u32, n: f64) -> CellData {
    CellData {
        cell_id: format!("a0000000-0000-0000-0000-{:012x}", uuid_suffix),
        row,
        col,
        value: CellValue::Number(FiniteF64::must(n)),
        formula: None,
        identity_formula: None,
        array_ref: None,
    }
}

fn xlsx_bytes_for(snapshot: WorkbookSnapshot) -> Vec<u8> {
    let (engine, _) = ComputeEngine::from_snapshot(snapshot).expect("from_snapshot");
    engine.export_to_xlsx_bytes().expect("export_to_xlsx_bytes")
}

/// Single cell A1=42 — hyperlink target for each test.
fn one_cell_fixture() -> WorkbookSnapshot {
    one_sheet_snapshot("Link", 5, 5, vec![value_cell(1, 0, 0, 42.0)])
}

#[test]
fn xlsx_add_hyperlink_persists_on_export() {
    let bytes = xlsx_bytes_for(one_cell_fixture());
    let (mut engine, _) = ComputeEngine::from_xlsx_bytes(&bytes).expect("from_xlsx_bytes");
    let sid = *engine
        .cell_store()
        .sheet_ids()
        .next()
        .expect("sheet present");

    engine
        .set_hyperlink(&sid, 0, 0, "https://example.com/a")
        .expect("set_hyperlink");

    let out = engine.export_to_xlsx_bytes().expect("export after set");
    let parsed = xlsx_api::parse(&out).expect("re-parse");
    let sheet = &parsed.output.sheets[0];

    assert!(
        !sheet.hyperlinks.is_empty(),
        "hyperlink not in exported XLSX; hyperlinks = {:?}",
        sheet.hyperlinks
    );
}

#[test]
fn xlsx_update_hyperlink_persists_on_export() {
    let bytes = xlsx_bytes_for(one_cell_fixture());
    let (mut engine, _) = ComputeEngine::from_xlsx_bytes(&bytes).expect("from_xlsx_bytes");
    let sid = *engine
        .cell_store()
        .sheet_ids()
        .next()
        .expect("sheet present");

    engine
        .set_hyperlink(&sid, 0, 0, "https://example.com/old")
        .expect("initial set");
    engine
        .set_hyperlink(&sid, 0, 0, "https://example.com/new")
        .expect("update set");

    let out = engine.export_to_xlsx_bytes().expect("export after update");
    let parsed = xlsx_api::parse(&out).expect("re-parse");
    let sheet = &parsed.output.sheets[0];

    assert!(
        sheet
            .hyperlinks
            .iter()
            .any(|h| format!("{:?}", h).contains("example.com/new")),
        "updated hyperlink URL missing; hyperlinks = {:?}",
        sheet.hyperlinks
    );
    assert!(
        !sheet
            .hyperlinks
            .iter()
            .any(|h| format!("{:?}", h).contains("example.com/old")),
        "old hyperlink URL leaked through update; hyperlinks = {:?}",
        sheet.hyperlinks
    );
}

#[test]
fn xlsx_remove_hyperlink_clears_on_export() {
    let bytes = xlsx_bytes_for(one_cell_fixture());
    let (mut engine, _) = ComputeEngine::from_xlsx_bytes(&bytes).expect("from_xlsx_bytes");
    let sid = *engine
        .cell_store()
        .sheet_ids()
        .next()
        .expect("sheet present");

    engine
        .set_hyperlink(&sid, 0, 0, "https://example.com/a")
        .expect("set");
    engine.remove_hyperlink(&sid, 0, 0).expect("remove");

    let out = engine.export_to_xlsx_bytes().expect("export after remove");
    let parsed = xlsx_api::parse(&out).expect("re-parse");
    let sheet = &parsed.output.sheets[0];

    assert!(
        sheet.hyperlinks.is_empty(),
        "remove_hyperlink did not clear exported hyperlinks; got {:?}",
        sheet.hyperlinks
    );
}

#[test]
fn remove_missing_hyperlink_is_an_error() {
    let (mut engine, _) = ComputeEngine::from_snapshot(one_cell_fixture()).expect("from_snapshot");
    let sid = *engine
        .cell_store()
        .sheet_ids()
        .next()
        .expect("sheet present");

    let err = engine
        .remove_hyperlink(&sid, 4, 4)
        .expect_err("missing hyperlink removal must fail");
    assert!(matches!(
        err,
        value_types::ComputeError::InvalidInput { .. }
    ));
}

#[test]
fn compact_hyperlinks_preserve_values_metadata_order_copy_and_structural_anchors() {
    use cell_types::{SheetId, SheetPos};
    use domain_types::domain::hyperlink::{Hyperlink, HyperlinkTargetKind};
    use domain_types::{ParseOutput, SheetData};
    use formula_types::StructureChange;
    let authored = vec![
        Hyperlink {
            cell_ref: "A101:A105".into(),
            target: Some("https://range.example".into()),
            location: Some("Sheet2!B2".into()),
            display: Some("Range".into()),
            tooltip: Some("Details".into()),
            uid: Some("{11111111-1111-1111-1111-111111111111}".into()),
            target_kind: Some(HyperlinkTargetKind::Relationship),
            target_mode: Some("External".into()),
        },
        Hyperlink {
            cell_ref: "A101".into(),
            location: Some("Link!A1".into()),
            target_kind: Some(HyperlinkTargetKind::InlineLocation),
            ..Default::default()
        },
        Hyperlink {
            cell_ref: "A201".into(),
            uid: Some("{22222222-2222-2222-2222-222222222222}".into()),
            ..Default::default()
        },
    ];
    let bytes = xlsx_parser::write::write_xlsx_from_parse_output(&ParseOutput {
        sheets: vec![SheetData {
            name: "Link".into(),
            rows: 512,
            cols: 2,
            cells: (0..512)
                .map(|row| domain_types::CellData {
                    row,
                    col: 0,
                    value: CellValue::from(10.0),
                    ..Default::default()
                })
                .collect(),
            hyperlinks: authored.clone(),
            ..Default::default()
        }],
        ..Default::default()
    })
    .unwrap();
    // Parser output resolves relationship locations into the target URL.
    let authored = xlsx_parser::parse_xlsx_to_output(&bytes)
        .unwrap()
        .0
        .sheets
        .remove(0)
        .hyperlinks;
    let (mut engine, _) = ComputeEngine::from_xlsx_bytes(&bytes).unwrap();
    let sid = *engine.cell_store().sheet_ids().next().unwrap();
    assert!(
        engine
            .cell_store()
            .get_sheet(&sid)
            .unwrap()
            .iter_ranges()
            .next()
            .is_some()
    );
    assert_eq!(engine.get_hyperlinks(&sid), authored);
    for row in [100, 104, 200, 300] {
        assert_eq!(
            engine
                .cell_store()
                .get_cell_value_at(&sid, SheetPos::new(row, 0)),
            Some(&CellValue::from(10.0))
        );
    }
    let existing = engine
        .cell_store()
        .resolve_cell_id(&sid, SheetPos::new(300, 0));
    engine
        .set_hyperlink(&sid, 300, 0, "https://added.example")
        .unwrap();
    assert_eq!(
        engine
            .cell_store()
            .get_cell_value_at(&sid, SheetPos::new(300, 0)),
        Some(&CellValue::from(10.0))
    );
    if let Some(existing) = existing {
        assert_eq!(
            engine
                .cell_store()
                .resolve_cell_id(&sid, SheetPos::new(300, 0)),
            Some(existing)
        );
    }
    engine.remove_hyperlink(&sid, 300, 0).unwrap();
    let (copy, _) = engine.copy_sheet(&sid, "Copy").unwrap();
    let copy = SheetId::from_uuid_str(&copy).unwrap();
    assert_eq!(engine.get_hyperlinks(&copy), authored);
    assert_ne!(
        engine
            .cell_store()
            .get_sheet(&sid)
            .unwrap()
            .cell_id_at(cell_types::SheetPos::new(100, 0)),
        engine
            .cell_store()
            .get_sheet(&copy)
            .unwrap()
            .cell_id_at(cell_types::SheetPos::new(100, 0))
    );

    engine
        .structure_change(
            &sid,
            &StructureChange::DeleteRows {
                at: 100,
                count: 2,
                deleted_cell_ids: Vec::new(),
            },
        )
        .unwrap();
    let mut expected = vec![authored[0].clone(), authored[2].clone()];
    expected[0].cell_ref = "A101:A103".into();
    expected[1].cell_ref = "A199".into();
    assert_eq!(engine.get_hyperlinks(&sid), expected);
    assert_eq!(engine.get_hyperlinks(&copy), authored);
    assert_eq!(
        engine
            .cell_store()
            .get_cell_value_at(&sid, SheetPos::new(100, 0)),
        Some(&CellValue::from(10.0))
    );
    for _ in 0..2 {
        let bytes = engine.export_to_xlsx_bytes().unwrap();
        let (reloaded, _) = ComputeEngine::from_xlsx_bytes(&bytes).unwrap();
        engine = reloaded;
        let original = engine
            .cell_store()
            .sheet_ids()
            .copied()
            .find(|id| engine.cell_store().get_sheet(id).unwrap().name == "Link")
            .unwrap();
        let copied = engine
            .cell_store()
            .sheet_ids()
            .copied()
            .find(|id| engine.cell_store().get_sheet(id).unwrap().name == "Copy")
            .unwrap();
        assert_eq!(engine.get_hyperlinks(&original), expected);
        assert_eq!(engine.get_hyperlinks(&copied), authored);
        assert_eq!(engine.get_raw_value(&original, 100, 0), "10");
    }
}
