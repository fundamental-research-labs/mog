//! Native worksheet pane, scroll, and display state.
use crate::storage::WorkbookStorage;
use cell_types::SheetId;
use domain_types::domain::sheet::{FrozenPanes, SheetScrollPosition, SheetViewOptions};
use domain_types::{SheetPaneConfig, SheetPaneId, SheetPaneState};

pub(crate) fn get_frozen_panes(storage: &WorkbookStorage, sheet_id: &SheetId) -> FrozenPanes {
    storage
        .sheet_metadata
        .get(sheet_id)
        .and_then(|meta| meta.view.pane.as_ref())
        .filter(|pane| pane.state.is_frozen())
        .map(|pane| FrozenPanes {
            rows: pane.y_split as u32,
            cols: pane.x_split as u32,
        })
        .unwrap_or(FrozenPanes { rows: 0, cols: 0 })
}

pub(crate) fn set_frozen_panes(
    storage: &mut WorkbookStorage,
    sheet_id: &SheetId,
    rows: u32,
    cols: u32,
) {
    crate::storage::engine::history::metadata::capture_sheet_field!(
        storage,
        *sheet_id,
        split_config
    );
    crate::storage::engine::history::metadata::capture_sheet_field!(storage, *sheet_id, view.pane);
    let Some(meta) = storage.sheet_metadata.get_mut(sheet_id) else {
        return;
    };
    meta.split_config = None;
    meta.view.pane = if rows > 0 || cols > 0 {
        Some(SheetPaneConfig {
            state: SheetPaneState::Frozen,
            x_split: cols as f64,
            y_split: rows as f64,
            top_left_cell: Some(to_a1_cell(rows, cols)),
            active_pane: Some(match (rows > 0, cols > 0) {
                (true, true) => SheetPaneId::BottomRight,
                (true, false) => SheetPaneId::BottomLeft,
                (false, true) => SheetPaneId::TopRight,
                (false, false) => SheetPaneId::TopLeft,
            }),
        })
    } else {
        None
    };
}

pub(super) fn to_a1_cell(row: u32, col: u32) -> String {
    let mut col_num = col + 1;
    let mut letters = String::new();
    while col_num > 0 {
        col_num -= 1;
        letters.insert(0, (b'A' + (col_num % 26) as u8) as char);
        col_num /= 26;
    }
    format!("{}{}", letters, row + 1)
}

pub(crate) fn get_scroll_position(
    storage: &WorkbookStorage,
    sheet_id: &SheetId,
) -> SheetScrollPosition {
    storage
        .sheet_metadata
        .get(sheet_id)
        .map(|meta| SheetScrollPosition {
            top_row: meta.view.scroll_row,
            left_col: meta.view.scroll_col,
        })
        .unwrap_or(SheetScrollPosition {
            top_row: 0,
            left_col: 0,
        })
}

pub(crate) fn set_scroll_position(
    storage: &mut WorkbookStorage,
    sheet_id: &SheetId,
    top_row: u32,
    left_col: u32,
) {
    if let Some(meta) = storage.sheet_metadata.get_mut(sheet_id) {
        meta.view.scroll_row = top_row;
        meta.view.scroll_col = left_col;
    }
}

pub(crate) fn get_view_options(storage: &WorkbookStorage, sheet_id: &SheetId) -> SheetViewOptions {
    let default_view = domain_types::SheetView::default().into();
    let view = storage
        .sheet_metadata
        .get(sheet_id)
        .map(|meta| &meta.view)
        .unwrap_or(&default_view);
    SheetViewOptions {
        show_gridlines: view.show_gridlines,
        show_row_headers: view.show_row_headers,
        show_column_headers: view.show_column_headers,
        right_to_left: view.right_to_left,
        show_formulas: view.show_formulas,
        show_zeros: view.show_zeros,
        zoom_scale: view.zoom_scale,
    }
}

pub(crate) fn set_view_option(
    storage: &mut WorkbookStorage,
    sheet_id: &SheetId,
    key: &str,
    value: bool,
) {
    crate::storage::engine::history::metadata::capture_sheet_field!(
        storage,
        *sheet_id,
        view.show_gridlines
    );
    crate::storage::engine::history::metadata::capture_sheet_field!(
        storage,
        *sheet_id,
        view.show_row_headers
    );
    crate::storage::engine::history::metadata::capture_sheet_field!(
        storage,
        *sheet_id,
        view.show_column_headers
    );
    crate::storage::engine::history::metadata::capture_sheet_field!(
        storage,
        *sheet_id,
        view.right_to_left
    );
    crate::storage::engine::history::metadata::capture_sheet_field!(
        storage,
        *sheet_id,
        view.show_formulas
    );
    crate::storage::engine::history::metadata::capture_sheet_field!(
        storage,
        *sheet_id,
        view.show_zeros
    );
    if let Some(meta) = storage.sheet_metadata.get_mut(sheet_id) {
        match key {
            "showGridlines" => meta.view.show_gridlines = value,
            "showRowHeaders" => meta.view.show_row_headers = value,
            "showColumnHeaders" => meta.view.show_column_headers = value,
            "rightToLeft" => meta.view.right_to_left = value,
            "showFormulas" => meta.view.show_formulas = value,
            "showZeroValues" => meta.view.show_zeros = value,
            _ => {}
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::storage::sheet::test_support::setup;

    #[test]
    fn test_frozen_panes() {
        let (mut storage, _mirror, sid) = setup();
        assert_eq!(
            get_frozen_panes(&storage, &sid),
            FrozenPanes { rows: 0, cols: 0 }
        );

        set_frozen_panes(&mut storage, &sid, 3, 2);
        assert_eq!(
            get_frozen_panes(&storage, &sid),
            FrozenPanes { rows: 3, cols: 2 }
        );

        // Unfreeze
        set_frozen_panes(&mut storage, &sid, 0, 0);
        assert_eq!(
            get_frozen_panes(&storage, &sid),
            FrozenPanes { rows: 0, cols: 0 }
        );
    }

    #[test]
    fn test_scroll_position() {
        let (mut storage, _mirror, sid) = setup();
        assert_eq!(
            get_scroll_position(&storage, &sid),
            SheetScrollPosition {
                top_row: 0,
                left_col: 0
            }
        );

        set_scroll_position(&mut storage, &sid, 99, 5);
        assert_eq!(
            get_scroll_position(&storage, &sid),
            SheetScrollPosition {
                top_row: 99,
                left_col: 5
            }
        );

        // Reset to origin
        set_scroll_position(&mut storage, &sid, 0, 0);
        assert_eq!(
            get_scroll_position(&storage, &sid),
            SheetScrollPosition {
                top_row: 0,
                left_col: 0
            }
        );
    }

    #[test]
    fn test_view_options() {
        let (mut storage, _mirror, sid) = setup();
        let opts = get_view_options(&storage, &sid);
        assert!(opts.show_gridlines);
        assert!(opts.show_row_headers);
        assert!(opts.show_column_headers);

        set_view_option(&mut storage, &sid, "showGridlines", false);
        let opts = get_view_options(&storage, &sid);
        assert!(!opts.show_gridlines);
        assert!(opts.show_row_headers);
    }
}
