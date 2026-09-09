use super::*;
use crate::storage::{properties, sheet};
use domain_types::CellFormat;

fn setup() -> (WorkbookStorage, CellMirror, SheetId) {
    let mut storage = WorkbookStorage::new();
    let mut mirror = CellMirror::new();
    let sid = SheetId::from_raw(123);
    storage
        .add_sheet(&mut mirror, sid, "Sheet1", 100, 26)
        .unwrap();
    (storage, mirror, sid)
}
fn finish(storage: &WorkbookStorage, mirror: &CellMirror) -> Vec<MetadataPatch> {
    storage
        .history
        .finish()
        .into_iter()
        .filter_map(|patch| match patch {
            HistoryPatch::Metadata(p) if p.is_changed(storage, mirror) => Some(p),
            _ => None,
        })
        .collect()
}
fn reverse(patches: &mut [MetadataPatch], storage: &mut WorkbookStorage, mirror: &mut CellMirror) {
    for p in patches.iter_mut().rev() {
        p.swap(storage, mirror, &mut HistoryEffects::default());
    }
}
#[test]
fn metadata_history_captures_only_one_property_among_many() {
    let (mut storage, mut mirror, sid) = setup();
    let bold = CellFormat {
        bold: Some(true),
        ..Default::default()
    };
    for id in 1000..2000 {
        properties::set_cell_format(
            &mut storage,
            &sid,
            &CellId::from_raw(id).to_uuid_string(),
            &bold,
        );
    }
    storage.history.begin();
    properties::set_cell_format(
        &mut storage,
        &sid,
        &CellId::from_raw(1500).to_uuid_string(),
        &CellFormat {
            italic: Some(true),
            ..Default::default()
        },
    );
    let mut patches = finish(&storage, &mirror);
    assert_eq!(patches.len(), 1);
    reverse(&mut patches, &mut storage, &mut mirror);
    assert_eq!(
        properties::get_cell_format(&storage, &sid, &CellId::from_raw(1500).to_uuid_string())
            .unwrap(),
        bold
    );
    assert_eq!(storage.sheet_metadata[&sid].cell_properties.len(), 1000);
    reverse(&mut patches, &mut storage, &mut mirror);
    assert_eq!(
        properties::get_cell_format(&storage, &sid, &CellId::from_raw(1500).to_uuid_string())
            .unwrap()
            .italic,
        Some(true)
    );
}
#[test]
fn metadata_history_preserves_ui_settings_and_omits_unchanged_fields() {
    let (mut storage, mut mirror, _) = setup();
    storage.history.begin();
    capture_workbook_settings(&storage);
    storage.metadata.settings.culture = "fr-FR".into();
    let mut patches = finish(&storage, &mirror);
    assert_eq!(patches.len(), 1);
    storage.metadata.settings.selected_sheet_ids = Some(vec!["later-selection".into()]);
    storage.metadata.settings.custom_settings = Some(std::collections::HashMap::from([(
        "local".into(),
        serde_json::json!(7),
    )]));
    reverse(&mut patches, &mut storage, &mut mirror);
    assert_eq!(storage.metadata.settings.culture, "en-US");
    assert_eq!(
        storage.metadata.settings.selected_sheet_ids,
        Some(vec!["later-selection".into()])
    );
    assert_eq!(
        storage.metadata.settings.custom_settings.as_ref().unwrap()["local"],
        serde_json::json!(7)
    );
    reverse(&mut patches, &mut storage, &mut mirror);
    assert_eq!(storage.metadata.settings.culture, "fr-FR");
}
#[test]
fn metadata_history_restores_comment_vector_order_in_both_directions() {
    let (mut storage, mut mirror, sid) = setup();
    storage.sheet_metadata.get_mut(&sid).unwrap().comments = (0..8)
        .map(|i| {
            domain_types::domain::comment::Comment::<String> {
                id: format!("comment-{i}"),
                ..Default::default()
            }
            .map_cell_ref(|_| sheet::comments::CommentAnchor::Cell(CellId::from_raw(i + 1)))
        })
        .collect();
    let before = storage.sheet_metadata[&sid].comments.clone();
    storage.history.begin();
    sheet::comments::clear_all_comments(&mut storage, &sid);
    let mut patches = finish(&storage, &mirror);
    assert_eq!(patches.len(), 8);
    reverse(&mut patches, &mut storage, &mut mirror);
    assert_eq!(storage.sheet_metadata[&sid].comments, before);
    for p in &mut patches {
        p.swap(&mut storage, &mut mirror, &mut HistoryEffects::default());
    }
    assert!(storage.sheet_metadata[&sid].comments.is_empty());
    reverse(&mut patches, &mut storage, &mut mirror);
    assert_eq!(storage.sheet_metadata[&sid].comments, before);
}
#[test]
fn metadata_history_inactive_and_noop_writes_do_not_retain_inverses() {
    let (mut storage, mirror, sid) = setup();
    sheet::view::set_view_option(&mut storage, &sid, "showGridlines", true);
    assert!(storage.history.finish().is_empty());
    storage.history.begin();
    sheet::view::set_view_option(&mut storage, &sid, "showGridlines", true);
    assert!(finish(&storage, &mirror).is_empty());
}

#[test]
fn metadata_history_skips_unchanged_formula_cache_carriers() {
    let (mut storage, _mirror, sid) = setup();
    let imported = CellId::from_raw(12);
    let formatted = CellId::from_raw(13);
    let absent = CellId::from_raw(14);
    properties::set_properties(
        &mut storage,
        &sid,
        &imported.to_uuid_string(),
        &crate::engine_types::formatting::CellProperties {
            style_id: Some(7),
            ..Default::default()
        },
    );
    properties::set_cell_format(
        &mut storage,
        &sid,
        &formatted.to_uuid_string(),
        &CellFormat {
            bold: Some(true),
            ..Default::default()
        },
    );
    storage.history.begin();
    properties::clear_formula_cache_metadata_for_cell_ids(
        &mut storage,
        &sid,
        &[imported, formatted, absent],
    );
    properties::clear_properties(&mut storage, &sid, &absent.to_uuid_string());
    // Inspect captured patches before the action's unchanged-value filtering.
    assert!(storage.history.finish().is_empty());
    assert_eq!(storage.sheet_metadata[&sid].cell_properties.len(), 2);
}

#[test]
fn metadata_history_restores_sparse_ooxml_cell_annotations() {
    let (mut storage, mut mirror, _) = setup();
    let cell = CellId::from_raw(120);
    let old = crate::storage::cell_metadata::CellMetadata {
        array_ref: Some("A1:B3".into()),
        ..Default::default()
    };
    storage.set_cell_metadata(cell, old.clone());
    storage.history.begin();
    storage.clear_cell_metadata(cell);
    storage.clear_cell_metadata(cell);
    let mut patches = finish(&storage, &mirror);
    assert_eq!(patches.len(), 1);
    reverse(&mut patches, &mut storage, &mut mirror);
    assert_eq!(storage.cell_metadata(&cell), Some(&old));
    reverse(&mut patches, &mut storage, &mut mirror);
    assert!(storage.cell_metadata(&cell).is_none());
}

#[test]
fn metadata_history_restores_format_rectangle_order_and_marks_only_touched_bounds() {
    let (mut storage, mut mirror, sid) = setup();
    let sheet = mirror.get_sheet_mut(&sid).unwrap();
    sheet.history = storage.history.share();
    for id in 1..=4 {
        properties::add_format_range(
            sheet,
            cell_types::RangeId::from_raw(id),
            id as u32,
            0,
            id as u32,
            4,
            &CellFormat {
                bold: Some(true),
                ..Default::default()
            },
        );
    }
    let original = sheet.format_ranges.clone();
    storage.history.begin();
    for id in 1..=4 {
        properties::remove_format_range(
            mirror.get_sheet_mut(&sid).unwrap(),
            cell_types::RangeId::from_raw(id),
        );
    }
    let mut patches = finish(&storage, &mirror);
    assert_eq!(patches.len(), 4);
    let mut effects = HistoryEffects::default();
    for patch in patches.iter_mut().rev() {
        patch.swap(&mut storage, &mut mirror, &mut effects);
    }
    assert_eq!(mirror.get_sheet(&sid).unwrap().format_ranges, original);
    assert_eq!(effects.format_rects.len(), 4);
    assert!(
        effects
            .format_rects
            .iter()
            .all(|(_, sr, sc, er, ec)| sr == er && *sc == 0 && *ec == 4)
    );
}
