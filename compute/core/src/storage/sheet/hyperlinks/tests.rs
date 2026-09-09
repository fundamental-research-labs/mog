use super::StoredHyperlink;
use crate::snapshot::{CellData, SheetSnapshot, WorkbookSnapshot};
use crate::storage::engine::ComputeEngine;
use cell_types::{CellId, SheetId, SheetPos};
use domain_types::domain::hyperlink::{Hyperlink, HyperlinkTargetKind};
use value_types::CellValue;

pub(super) fn engine() -> (ComputeEngine, SheetId) {
    let id = SheetId::from_raw(1);
    let (engine, _) = ComputeEngine::from_snapshot(WorkbookSnapshot {
        sheets: vec![SheetSnapshot {
            id: id.to_uuid_string(),
            name: "Sheet1".into(),
            rows: 100,
            cols: 26,
            cells: vec![
                CellData {
                    cell_id: CellId::from_raw(2).to_uuid_string(),
                    row: 0,
                    col: 0,
                    value: CellValue::from(42.0),
                    formula: None,
                    identity_formula: None,
                    array_ref: None,
                },
                CellData {
                    cell_id: CellId::from_raw(3).to_uuid_string(),
                    row: 1,
                    col: 0,
                    value: CellValue::Null,
                    formula: Some("A1*2".into()),
                    identity_formula: None,
                    array_ref: None,
                },
            ],
            identities: vec![],
            ranges: vec![],
            row_axis: None,
            col_axis: None,
        }],
        ..Default::default()
    })
    .unwrap();
    (engine, id)
}

#[test]
fn hyperlink_mutations_preserve_native_values_formulas_and_identities() {
    let (mut engine, sid) = engine();
    for row in [0, 1, 99] {
        let before = engine.get_raw_value(&sid, row, 0);
        engine
            .set_hyperlink(&sid, row, 0, "https://example.com")
            .unwrap();
        let id = engine
            .cell_store()
            .resolve_cell_id(&sid, SheetPos::new(row, 0))
            .unwrap();
        assert_eq!(
            engine.get_hyperlink(&sid, row, 0).as_deref(),
            Some("https://example.com")
        );
        engine
            .set_hyperlink(&sid, row, 0, "https://updated.example.com")
            .unwrap();
        engine.remove_hyperlink(&sid, row, 0).unwrap();
        assert_eq!(engine.get_hyperlink(&sid, row, 0), None);
        assert_eq!(
            engine
                .cell_store()
                .resolve_cell_id(&sid, SheetPos::new(row, 0)),
            Some(id)
        );
        assert_eq!(engine.get_raw_value(&sid, row, 0), before);
    }
    assert_eq!(engine.get_cell_count(&sid), 2);
    assert!(engine.remove_hyperlink(&sid, 40, 4).is_err());
    assert_eq!(engine.get_hyperlink(&sid, 40, 4), None);
}

#[test]
fn hyperlink_formula_uses_canonical_source() {
    let (mut engine, sid) = engine();
    engine
        .set_cell(
            &sid,
            CellId::from_raw(4),
            2,
            0,
            crate::bridge_types::CellInput::Parse {
                text: r#"=HYPERLINK("https://formula.example", A1)"#.into(),
            },
        )
        .unwrap();
    assert_eq!(
        engine.get_hyperlink(&sid, 2, 0).as_deref(),
        Some("https://formula.example")
    );
    assert!(engine.get_hyperlinks(&sid).is_empty());
}

#[test]
fn explicit_metadata_preserves_overlapping_ranges_order_and_all_attributes() {
    let (mut engine, sid) = engine();
    engine
        .set_hyperlink(&sid, 4, 4, "https://seed.example")
        .unwrap();
    let start = engine
        .cell_store()
        .resolve_cell_id(&sid, cell_types::SheetPos::new(0, 0))
        .unwrap();
    let end = engine
        .cell_store()
        .resolve_cell_id(&sid, cell_types::SheetPos::new(4, 4))
        .unwrap();
    let data = Hyperlink {
        target: Some("#Sheet2!A1".into()),
        location: Some("Sheet2!B2".into()),
        display: Some("Example".into()),
        tooltip: Some("Open".into()),
        uid: Some("{uid-1}".into()),
        target_kind: Some(HyperlinkTargetKind::Relationship),
        target_mode: Some("External".into()),
        ..Default::default()
    };
    engine
        .storage_mut()
        .sheet_metadata
        .get_mut(&sid)
        .unwrap()
        .hyperlinks = vec![
        StoredHyperlink {
            start_id: start,
            end_id: Some(end),
            data: data.clone(),
        },
        StoredHyperlink {
            start_id: start,
            end_id: None,
            data: Hyperlink {
                uid: Some("{uid-only}".into()),
                ..Default::default()
            },
        },
    ];
    let links = engine.get_hyperlinks(&sid);
    let mut expected = data;
    expected.cell_ref = "A1:E5".into();
    assert_eq!(links[0], expected);
    assert_eq!(links[1].cell_ref, "A1");
    assert_eq!(links[1].uid.as_deref(), Some("{uid-only}"));
    assert_eq!(links[1].target, None);
    assert_eq!(links[1].location, None);
    engine
        .clear_hyperlinks_in_range(&sid, 0, 0, 1_048_575, 16_383)
        .unwrap();
    assert!(engine.get_hyperlinks(&sid).is_empty());
}

#[test]
fn hyperlinks_support_url_schemes_and_native_axis_growth() {
    let (mut engine, sid) = engine();
    for (offset, url) in [
        "https://example.com",
        "http://example.com",
        "mailto:user@example.com",
        "ftp://files.example.com/doc.pdf",
        "#Sheet2!A1",
        "Target!B2",
    ]
    .into_iter()
    .enumerate()
    {
        let row = 1000 + offset as u32;
        engine.set_hyperlink(&sid, row, 30, url).unwrap();
        assert_eq!(engine.get_hyperlink(&sid, row, 30).as_deref(), Some(url));
        let id = engine
            .cell_store()
            .resolve_cell_id(&sid, SheetPos::new(row, 30))
            .unwrap();
        assert_eq!(
            engine
                .cell_store()
                .get_sheet(&sid)
                .unwrap()
                .cell_position(&id),
            Some((row, 30))
        );
        assert_eq!(
            engine
                .cell_store()
                .get_cell_value_at(&sid, SheetPos::new(row, 30)),
            None
        );
    }
}
