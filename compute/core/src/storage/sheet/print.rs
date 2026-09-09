//! Native page breaks, print regions, titles, and page setup.
use crate::storage::WorkbookStorage;
use cell_types::SheetId;
use domain_types::domain::print::{
    HeaderFooterImageInfo, PageBreakEntry, PageBreaks, PrintSettings,
};
use domain_types::domain::sheet::{PrintRange, PrintTitles};

pub(crate) fn get_page_breaks(storage: &WorkbookStorage, sheet_id: &SheetId) -> PageBreaks {
    storage
        .sheet_metadata
        .get(sheet_id)
        .and_then(|meta| meta.page_breaks.clone())
        .unwrap_or_default()
}

pub(crate) fn add_horizontal_page_break(
    storage: &mut WorkbookStorage,
    sheet_id: &SheetId,
    row: u32,
) {
    crate::storage::engine::history::metadata::capture_sheet_field!(
        storage,
        *sheet_id,
        page_breaks
    );
    let Some(meta) = storage.sheet_metadata.get_mut(sheet_id) else {
        return;
    };
    let breaks = &mut meta
        .page_breaks
        .get_or_insert_with(PageBreaks::default)
        .row_breaks;
    if breaks.iter().any(|entry| entry.id == row) {
        return;
    }
    breaks.push(PageBreakEntry {
        id: row,
        min: 0,
        max: 16_383,
        manual: true,
        pt: false,
    });
    breaks.sort_by_key(|entry| entry.id);
}

pub(crate) fn add_vertical_page_break(storage: &mut WorkbookStorage, sheet_id: &SheetId, col: u32) {
    crate::storage::engine::history::metadata::capture_sheet_field!(
        storage,
        *sheet_id,
        page_breaks
    );
    let Some(meta) = storage.sheet_metadata.get_mut(sheet_id) else {
        return;
    };
    let breaks = &mut meta
        .page_breaks
        .get_or_insert_with(PageBreaks::default)
        .col_breaks;
    if breaks.iter().any(|entry| entry.id == col) {
        return;
    }
    breaks.push(PageBreakEntry {
        id: col,
        min: 0,
        max: 1_048_575,
        manual: true,
        pt: false,
    });
    breaks.sort_by_key(|entry| entry.id);
}

pub(crate) fn remove_horizontal_page_break(
    storage: &mut WorkbookStorage,
    sheet_id: &SheetId,
    row: u32,
) {
    crate::storage::engine::history::metadata::capture_sheet_field!(
        storage,
        *sheet_id,
        page_breaks
    );
    if let Some(breaks) = storage
        .sheet_metadata
        .get_mut(sheet_id)
        .and_then(|meta| meta.page_breaks.as_mut())
    {
        breaks.row_breaks.retain(|entry| entry.id != row);
    }
}

pub(crate) fn remove_vertical_page_break(
    storage: &mut WorkbookStorage,
    sheet_id: &SheetId,
    col: u32,
) {
    crate::storage::engine::history::metadata::capture_sheet_field!(
        storage,
        *sheet_id,
        page_breaks
    );
    if let Some(breaks) = storage
        .sheet_metadata
        .get_mut(sheet_id)
        .and_then(|meta| meta.page_breaks.as_mut())
    {
        breaks.col_breaks.retain(|entry| entry.id != col);
    }
}

pub(crate) fn clear_all_page_breaks(storage: &mut WorkbookStorage, sheet_id: &SheetId) {
    crate::storage::engine::history::metadata::capture_sheet_field!(
        storage,
        *sheet_id,
        page_breaks
    );
    if let Some(meta) = storage.sheet_metadata.get_mut(sheet_id) {
        meta.page_breaks = None;
    }
}

pub(crate) fn set_page_breaks(
    storage: &mut WorkbookStorage,
    sheet_id: &SheetId,
    breaks: &PageBreaks,
) {
    crate::storage::engine::history::metadata::capture_sheet_field!(
        storage,
        *sheet_id,
        page_breaks
    );
    if let Some(meta) = storage.sheet_metadata.get_mut(sheet_id) {
        meta.page_breaks = Some(breaks.clone());
    }
}

pub(crate) fn get_print_area(storage: &WorkbookStorage, sheet_id: &SheetId) -> Option<PrintRange> {
    storage
        .sheet_metadata
        .get(sheet_id)?
        .print_areas
        .first()
        .cloned()
}

pub(crate) fn get_print_areas(storage: &WorkbookStorage, sheet_id: &SheetId) -> Vec<PrintRange> {
    storage
        .sheet_metadata
        .get(sheet_id)
        .map(|meta| meta.print_areas.clone())
        .unwrap_or_default()
}

pub(crate) fn set_print_area(
    storage: &mut WorkbookStorage,
    sheet_id: &SheetId,
    area: Option<&PrintRange>,
) {
    crate::storage::engine::history::metadata::capture_sheet_field!(
        storage,
        *sheet_id,
        print_areas
    );
    if let Some(meta) = storage.sheet_metadata.get_mut(sheet_id) {
        meta.print_areas = area.cloned().into_iter().collect();
    }
}

pub(crate) fn get_print_titles(storage: &WorkbookStorage, sheet_id: &SheetId) -> PrintTitles {
    storage
        .sheet_metadata
        .get(sheet_id)
        .map(|meta| meta.print_titles.clone())
        .unwrap_or(PrintTitles {
            repeat_rows: None,
            repeat_cols: None,
        })
}

pub(crate) fn set_print_titles(
    storage: &mut WorkbookStorage,
    sheet_id: &SheetId,
    titles: &PrintTitles,
) {
    crate::storage::engine::history::metadata::capture_sheet_field!(
        storage,
        *sheet_id,
        print_titles
    );
    if let Some(meta) = storage.sheet_metadata.get_mut(sheet_id) {
        meta.print_titles = titles.clone();
    }
}

pub(crate) fn get_print_settings(storage: &WorkbookStorage, sheet_id: &SheetId) -> PrintSettings {
    storage
        .sheet_metadata
        .get(sheet_id)
        .and_then(|meta| meta.print_settings.clone())
        .unwrap_or_default()
}

pub(crate) fn set_print_settings(
    storage: &mut WorkbookStorage,
    sheet_id: &SheetId,
    settings: &PrintSettings,
) {
    crate::storage::engine::history::metadata::capture_sheet_field!(
        storage,
        *sheet_id,
        print_settings
    );
    if let Some(meta) = storage.sheet_metadata.get_mut(sheet_id) {
        meta.print_settings = Some(settings.clone());
    }
}

pub(crate) fn get_hf_images(
    storage: &WorkbookStorage,
    sheet_id: &SheetId,
) -> Vec<HeaderFooterImageInfo> {
    storage
        .sheet_metadata
        .get(sheet_id)
        .map(|meta| meta.hf_images.clone())
        .unwrap_or_default()
}

pub(crate) fn set_hf_images(
    storage: &mut WorkbookStorage,
    sheet_id: &SheetId,
    images: &[HeaderFooterImageInfo],
) {
    crate::storage::engine::history::metadata::capture_sheet_field!(storage, *sheet_id, hf_images);
    if let Some(meta) = storage.sheet_metadata.get_mut(sheet_id) {
        meta.hf_images = images.to_vec();
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::storage::sheet::test_support::setup;

    #[test]
    fn test_page_breaks() {
        let (mut storage, _mirror, sid) = setup();

        let pb = get_page_breaks(&storage, &sid);
        assert!(pb.row_breaks.is_empty());
        assert!(pb.col_breaks.is_empty());

        add_horizontal_page_break(&mut storage, &sid, 10);
        add_horizontal_page_break(&mut storage, &sid, 5);
        let pb = get_page_breaks(&storage, &sid);
        let ids: Vec<u32> = pb.row_breaks.iter().map(|e| e.id).collect();
        assert_eq!(ids, vec![5, 10]); // sorted

        // Duplicate is no-op
        add_horizontal_page_break(&mut storage, &sid, 5);
        let ids: Vec<u32> = get_page_breaks(&storage, &sid)
            .row_breaks
            .iter()
            .map(|e| e.id)
            .collect();
        assert_eq!(ids, vec![5, 10]);

        remove_horizontal_page_break(&mut storage, &sid, 5);
        let ids: Vec<u32> = get_page_breaks(&storage, &sid)
            .row_breaks
            .iter()
            .map(|e| e.id)
            .collect();
        assert_eq!(ids, vec![10]);
    }

    #[test]
    fn test_vertical_page_breaks() {
        let (mut storage, _mirror, sid) = setup();

        add_vertical_page_break(&mut storage, &sid, 3);
        add_vertical_page_break(&mut storage, &sid, 7);
        let ids: Vec<u32> = get_page_breaks(&storage, &sid)
            .col_breaks
            .iter()
            .map(|e| e.id)
            .collect();
        assert_eq!(ids, vec![3, 7]);

        remove_vertical_page_break(&mut storage, &sid, 3);
        let ids: Vec<u32> = get_page_breaks(&storage, &sid)
            .col_breaks
            .iter()
            .map(|e| e.id)
            .collect();
        assert_eq!(ids, vec![7]);
    }

    #[test]
    fn test_clear_all_page_breaks() {
        let (mut storage, _mirror, sid) = setup();

        add_horizontal_page_break(&mut storage, &sid, 5);
        add_vertical_page_break(&mut storage, &sid, 3);

        clear_all_page_breaks(&mut storage, &sid);
        let pb = get_page_breaks(&storage, &sid);
        assert!(pb.row_breaks.is_empty());
        assert!(pb.col_breaks.is_empty());
    }

    #[test]
    fn test_print_area() {
        let (mut storage, _mirror, sid) = setup();
        assert!(get_print_area(&storage, &sid).is_none());

        let area = PrintRange {
            start_row: 0,
            start_col: 0,
            end_row: 10,
            end_col: 5,
        };
        set_print_area(&mut storage, &sid, Some(&area));
        assert_eq!(get_print_area(&storage, &sid), Some(area));

        // Clear
        set_print_area(&mut storage, &sid, None);
        assert!(get_print_area(&storage, &sid).is_none());
    }

    #[test]
    fn test_print_titles() {
        let (mut storage, _mirror, sid) = setup();
        let titles = get_print_titles(&storage, &sid);
        assert!(titles.repeat_rows.is_none());
        assert!(titles.repeat_cols.is_none());

        let new_titles = PrintTitles {
            repeat_rows: Some((0, 2)),
            repeat_cols: Some((0, 0)),
        };
        set_print_titles(&mut storage, &sid, &new_titles);
        assert_eq!(get_print_titles(&storage, &sid), new_titles);

        // Clear
        let empty = PrintTitles {
            repeat_rows: None,
            repeat_cols: None,
        };
        set_print_titles(&mut storage, &sid, &empty);
        let result = get_print_titles(&storage, &sid);
        assert!(result.repeat_rows.is_none());
    }

    #[test]
    fn test_print_settings() {
        let (mut storage, _mirror, sid) = setup();
        let ps = get_print_settings(&storage, &sid);
        // Default orientation is None
        assert_eq!(ps.orientation, None);
        assert_eq!(ps.scale, None);

        let custom = domain_types::domain::print::PrintSettings {
            orientation: Some("landscape".to_string()),
            paper_size: Some(9), // a4
            scale: Some(75),
            fit_to_width: Some(1),
            fit_to_height: None,
            h_centered: true,
            v_centered: false,
            gridlines: true,
            headings: false,
            ..Default::default()
        };
        set_print_settings(&mut storage, &sid, &custom);
        let read = get_print_settings(&storage, &sid);
        assert_eq!(read.orientation, custom.orientation);
        assert_eq!(read.paper_size, custom.paper_size);
        assert_eq!(read.scale, custom.scale);
        assert_eq!(read.fit_to_width, custom.fit_to_width);
        assert_eq!(read.fit_to_height, custom.fit_to_height);
        assert_eq!(read.h_centered, custom.h_centered);
        assert_eq!(read.v_centered, custom.v_centered);
        assert_eq!(read.gridlines, custom.gridlines);
        assert_eq!(read.headings, custom.headings);
    }

    #[test]
    fn test_remove_nonexistent_page_break() {
        let (mut storage, _mirror, sid) = setup();
        // Should not panic
        remove_horizontal_page_break(&mut storage, &sid, 99);
        remove_vertical_page_break(&mut storage, &sid, 99);
    }

    #[test]
    fn test_print_settings_serde_roundtrip() {
        let settings = domain_types::domain::print::PrintSettings {
            orientation: Some("landscape".to_string()),
            paper_size: Some(9),
            scale: Some(85),
            fit_to_width: Some(2),
            fit_to_height: Some(1),
            h_centered: true,
            v_centered: true,
            gridlines: true,
            headings: true,
            ..Default::default()
        };
        let json = serde_json::to_string(&settings).unwrap();
        let deserialized: domain_types::domain::print::PrintSettings =
            serde_json::from_str(&json).unwrap();
        assert_eq!(settings, deserialized);
    }

    // -----------------------------------------------------------------------
    // Phase 5D: Range-backed print area tests
    // -----------------------------------------------------------------------

    #[test]
    fn phase5d_print_area_set_and_get() {
        let (mut storage, _mirror, sid) = setup();
        assert!(get_print_area(&storage, &sid).is_none());

        let area = PrintRange {
            start_row: 0,
            start_col: 0,
            end_row: 99,
            end_col: 25,
        };
        set_print_area(&mut storage, &sid, Some(&area));

        // Should be readable via get_print_area (dual-read path).
        let fetched = get_print_area(&storage, &sid);
        assert_eq!(fetched, Some(area));
    }

    #[test]
    fn phase5d_print_area_clear() {
        let (mut storage, _mirror, sid) = setup();

        let area = PrintRange {
            start_row: 5,
            start_col: 2,
            end_row: 20,
            end_col: 10,
        };
        set_print_area(&mut storage, &sid, Some(&area));
        assert!(get_print_area(&storage, &sid).is_some());

        set_print_area(&mut storage, &sid, None);
        assert!(get_print_area(&storage, &sid).is_none());
    }

    #[test]
    fn phase5d_print_area_overwrite() {
        let (mut storage, _mirror, sid) = setup();

        let area1 = PrintRange {
            start_row: 0,
            start_col: 0,
            end_row: 10,
            end_col: 5,
        };
        set_print_area(&mut storage, &sid, Some(&area1));

        let area2 = PrintRange {
            start_row: 5,
            start_col: 5,
            end_row: 50,
            end_col: 20,
        };
        set_print_area(&mut storage, &sid, Some(&area2));

        let fetched = get_print_area(&storage, &sid);
        assert_eq!(fetched, Some(area2));
    }

    #[test]
    fn phase5d_get_print_areas_multiple() {
        let (mut storage, _mirror, sid) = setup();

        // Currently set_print_area replaces all, so get_print_areas
        // returns at most one. This test verifies the API shape.
        let area = PrintRange {
            start_row: 0,
            start_col: 0,
            end_row: 10,
            end_col: 5,
        };
        set_print_area(&mut storage, &sid, Some(&area));

        let areas = get_print_areas(&storage, &sid);
        assert!(!areas.is_empty());
        assert_eq!(areas[0], area);
    }

    #[test]
    fn phase5d_get_print_areas_empty() {
        let (storage, _mirror, sid) = setup();
        let areas = get_print_areas(&storage, &sid);
        assert!(areas.is_empty());
    }

    #[test]
    fn phase5d_full_sheet_print_area() {
        let (mut storage, _mirror, sid) = setup();

        // Full-sheet print area (large range).
        let area = PrintRange {
            start_row: 0,
            start_col: 0,
            end_row: 999,
            end_col: 255,
        };
        set_print_area(&mut storage, &sid, Some(&area));

        let fetched = get_print_area(&storage, &sid);
        assert_eq!(fetched, Some(area));
    }
}
