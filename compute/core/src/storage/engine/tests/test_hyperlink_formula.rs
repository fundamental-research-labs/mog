//! Hyperlink formula metadata regressions.

use super::super::*;
use super::helpers::*;
use compute_wire::flags as render_flags;
use value_types::CellValue;

#[test]
fn hyperlink_formula_writes_metadata_for_all_read_surfaces() {
    let snap = simple_snapshot();
    let (mut engine, _) = YrsComputeEngine::from_snapshot(snap).unwrap();
    let sid = sheet_id();
    let cell_id = cell_id_a1();

    engine
        .set_cell(
            &sid,
            cell_id,
            0,
            0,
            crate::bridge_types::CellInput::Parse {
                text: r#"=HYPERLINK("https://example.com","Example")"#.into(),
            },
        )
        .expect("set hyperlink formula");

    assert_eq!(
        engine.mirror().get_cell_value(&cell_id),
        Some(&CellValue::Text("Example".into()))
    );
    assert_eq!(
        engine.get_hyperlink(&sid, 0, 0),
        Some("https://example.com".to_string())
    );
    assert_eq!(
        engine.get_active_cell(&sid, &cell_id).hyperlink_url,
        Some("https://example.com".to_string())
    );
    assert_eq!(
        engine.get_active_cell(&sid, &cell_id).formula.as_deref(),
        Some("=HYPERLINK(\"https://example.com\",\"Example\")")
    );
    assert_eq!(
        engine
            .get_raw_cell_data(&sid, 0, 0, true)
            .and_then(|data| data.formula),
        Some("=HYPERLINK(\"https://example.com\",\"Example\")".to_string())
    );
    assert_eq!(
        engine.query_range(&sid, 0, 0, 0, 0).cells[0].hyperlink_url,
        Some("https://example.com".to_string())
    );
    assert_eq!(
        engine.query_range(&sid, 0, 0, 0, 0).cells[0]
            .formula
            .as_deref(),
        Some("=HYPERLINK(\"https://example.com\",\"Example\")")
    );
    let viewport = engine.build_viewport_render_data(&sid, 0, 0, 1, 1);
    assert!(
        viewport.cells[0].flags & render_flags::HAS_HYPERLINK != 0,
        "rendered formula cell should carry HAS_HYPERLINK"
    );
}

#[test]
fn hyperlink_formula_url_only_form_writes_metadata() {
    let snap = simple_snapshot();
    let (mut engine, _) = YrsComputeEngine::from_snapshot(snap).unwrap();
    let sid = sheet_id();

    engine
        .set_cell(
            &sid,
            cell_id_a1(),
            0,
            0,
            crate::bridge_types::CellInput::Parse {
                text: r#"=HYPERLINK("mailto:help@example.com")"#.into(),
            },
        )
        .expect("set url-only hyperlink formula");

    assert_eq!(
        engine.get_hyperlink(&sid, 0, 0),
        Some("mailto:help@example.com".to_string())
    );
}

#[test]
fn copied_hyperlink_formula_reads_back_target_metadata() {
    let snap = simple_snapshot();
    let (mut engine, _) = YrsComputeEngine::from_snapshot(snap).unwrap();
    let sid = sheet_id();

    engine
        .set_cell(
            &sid,
            cell_id_a1(),
            0,
            0,
            crate::bridge_types::CellInput::Parse {
                text: r#"=HYPERLINK("https://example.com","Example")"#.into(),
            },
        )
        .expect("set hyperlink formula");

    engine
        .apply_mutation(EngineMutation::CopyRange {
            source_sheet_id: sid,
            src_start_row: 0,
            src_start_col: 0,
            src_end_row: 0,
            src_end_col: 0,
            target_sheet_id: sid,
            target_row: 0,
            target_col: 1,
            copy_type: domain_types::CopyType::All,
            skip_blanks: false,
            transpose: false,
        })
        .expect("copy hyperlink formula");

    assert_eq!(
        engine.get_hyperlink(&sid, 0, 1),
        Some("https://example.com".to_string())
    );
    assert_eq!(
        engine.query_range(&sid, 0, 1, 0, 1).cells[0]
            .hyperlink_url
            .as_deref(),
        Some("https://example.com")
    );
    assert_eq!(
        engine
            .get_raw_cell_data(&sid, 0, 1, true)
            .and_then(|data| data.formula),
        Some("=HYPERLINK(\"https://example.com\",\"Example\")".to_string())
    );
}

#[test]
fn hyperlink_formula_metadata_is_removed_on_overwrite() {
    let snap = simple_snapshot();
    let (mut engine, _) = YrsComputeEngine::from_snapshot(snap).unwrap();
    let sid = sheet_id();

    engine
        .set_cell(
            &sid,
            cell_id_a1(),
            0,
            0,
            crate::bridge_types::CellInput::Parse {
                text: r#"=HYPERLINK("https://example.com","Example")"#.into(),
            },
        )
        .expect("set hyperlink formula");
    assert_eq!(
        engine.get_hyperlink(&sid, 0, 0),
        Some("https://example.com".to_string())
    );

    engine
        .set_cell(
            &sid,
            cell_id_a1(),
            0,
            0,
            crate::bridge_types::CellInput::Parse {
                text: "=UPPER(\"plain\")".into(),
            },
        )
        .expect("overwrite with non-hyperlink formula");
    assert_eq!(engine.get_hyperlink(&sid, 0, 0), None);

    engine
        .set_cell(
            &sid,
            cell_id_a1(),
            0,
            0,
            crate::bridge_types::CellInput::Parse {
                text: "literal".into(),
            },
        )
        .expect("overwrite with literal value");
    assert_eq!(engine.get_hyperlink(&sid, 0, 0), None);
}

#[test]
fn hyperlink_formula_metadata_follows_undo_redo() {
    let snap = simple_snapshot();
    let (mut engine, _) = YrsComputeEngine::from_snapshot(snap).unwrap();
    let sid = sheet_id();

    engine
        .set_cell(
            &sid,
            cell_id_a1(),
            0,
            0,
            crate::bridge_types::CellInput::Parse {
                text: r#"=HYPERLINK("https://example.com","Link")"#.into(),
            },
        )
        .expect("set hyperlink formula");
    assert_eq!(
        engine.get_hyperlink(&sid, 0, 0),
        Some("https://example.com".to_string())
    );

    engine.undo().expect("undo hyperlink formula");
    assert_eq!(engine.get_hyperlink(&sid, 0, 0), None);

    engine.redo().expect("redo hyperlink formula");
    assert_eq!(
        engine.get_hyperlink(&sid, 0, 0),
        Some("https://example.com".to_string())
    );
}
