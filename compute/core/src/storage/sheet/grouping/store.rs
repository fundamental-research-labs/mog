//! Native outline groups and their worksheet-owned settings.
use super::types::{GroupDefinition, SheetGroupingConfig};
use crate::storage::WorkbookStorage;
use cell_types::SheetId;

#[derive(Debug, Clone, PartialEq)]
pub(crate) struct GroupingState {
    pub row_groups: Vec<GroupDefinition>,
    pub column_groups: Vec<GroupDefinition>,
    pub show_outline_level_buttons: bool,
}

impl Default for GroupingState {
    fn default() -> Self {
        Self {
            row_groups: Vec::new(),
            column_groups: Vec::new(),
            show_outline_level_buttons: true,
        }
    }
}

impl GroupingState {
    pub fn from_config(config: SheetGroupingConfig) -> Self {
        Self {
            row_groups: config.row_groups,
            column_groups: config.column_groups,
            show_outline_level_buttons: config.show_outline_level_buttons,
        }
    }
}

pub fn get_sheet_grouping_config(
    storage: &WorkbookStorage,
    sheet_id: &SheetId,
) -> SheetGroupingConfig {
    let Some(meta) = storage.sheet_metadata.get(sheet_id) else {
        return SheetGroupingConfig::default();
    };
    let outline = meta
        .properties
        .as_ref()
        .and_then(|properties| properties.outline_pr.as_ref());
    SheetGroupingConfig {
        row_groups: meta.grouping.row_groups.clone(),
        column_groups: meta.grouping.column_groups.clone(),
        show_outline_level_buttons: meta.grouping.show_outline_level_buttons,
        summary_rows_below: outline.is_none_or(|outline| outline.summary_below),
        summary_columns_right: outline.is_none_or(|outline| outline.summary_right),
        show_outline_symbols: outline.is_none_or(|outline| outline.show_outline_symbols),
    }
}

pub(crate) fn set_sheet_grouping_config(
    storage: &mut WorkbookStorage,
    sheet_id: &SheetId,
    config: &SheetGroupingConfig,
) {
    crate::storage::engine::history::metadata::capture_sheet_field!(storage, *sheet_id, grouping);
    crate::storage::engine::history::metadata::capture_sheet_field!(storage, *sheet_id, properties);

    let Some(meta) = storage.sheet_metadata.get_mut(sheet_id) else {
        return;
    };
    meta.grouping = GroupingState::from_config(config.clone());
    let properties = meta.properties.get_or_insert_with(Default::default);
    let outline = properties.outline_pr.get_or_insert_with(Default::default);
    outline.summary_below = config.summary_rows_below;
    outline.summary_right = config.summary_columns_right;
    outline.show_outline_symbols = config.show_outline_symbols;
}
