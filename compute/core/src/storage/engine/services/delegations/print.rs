use crate::snapshot::{
    ChangeKind, MutationResult, PageBreakChange, PrintAreaChange, PrintSettingsChange,
    PrintTitlesChange,
};
use crate::storage::engine::stores::EngineStores;
use crate::storage::sheet::print;
use cell_types::SheetId;
use domain_types::domain::print::PageBreaks;
use domain_types::domain::sheet::{PrintRange, PrintTitles};
use value_types::ComputeError;

// -------------------------------------------------------------------
// Page breaks
// -------------------------------------------------------------------

pub(in crate::storage::engine) fn get_page_breaks(
    stores: &EngineStores,
    sheet_id: &SheetId,
) -> PageBreaks {
    print::get_page_breaks(stores.storage.doc(), stores.storage.sheets(), sheet_id)
}

pub(in crate::storage::engine) fn add_horizontal_page_break(
    stores: &mut EngineStores,
    sheet_id: &SheetId,
    row: u32,
) -> Result<MutationResult, ComputeError> {
    print::add_horizontal_page_break(stores.storage.doc(), stores.storage.sheets(), sheet_id, row);
    let breaks = print::get_page_breaks(stores.storage.doc(), stores.storage.sheets(), sheet_id);
    let mut result = MutationResult::empty();
    result.page_break_changes.push(PageBreakChange {
        sheet_id: sheet_id.to_uuid_string(),
        breaks,
    });
    Ok(result)
}

pub(in crate::storage::engine) fn remove_horizontal_page_break(
    stores: &mut EngineStores,
    sheet_id: &SheetId,
    row: u32,
) -> Result<MutationResult, ComputeError> {
    print::remove_horizontal_page_break(
        stores.storage.doc(),
        stores.storage.sheets(),
        sheet_id,
        row,
    );
    let breaks = print::get_page_breaks(stores.storage.doc(), stores.storage.sheets(), sheet_id);
    let mut result = MutationResult::empty();
    result.page_break_changes.push(PageBreakChange {
        sheet_id: sheet_id.to_uuid_string(),
        breaks,
    });
    Ok(result)
}

pub(in crate::storage::engine) fn add_vertical_page_break(
    stores: &mut EngineStores,
    sheet_id: &SheetId,
    col: u32,
) -> Result<MutationResult, ComputeError> {
    print::add_vertical_page_break(stores.storage.doc(), stores.storage.sheets(), sheet_id, col);
    let breaks = print::get_page_breaks(stores.storage.doc(), stores.storage.sheets(), sheet_id);
    let mut result = MutationResult::empty();
    result.page_break_changes.push(PageBreakChange {
        sheet_id: sheet_id.to_uuid_string(),
        breaks,
    });
    Ok(result)
}

pub(in crate::storage::engine) fn remove_vertical_page_break(
    stores: &mut EngineStores,
    sheet_id: &SheetId,
    col: u32,
) -> Result<MutationResult, ComputeError> {
    print::remove_vertical_page_break(stores.storage.doc(), stores.storage.sheets(), sheet_id, col);
    let breaks = print::get_page_breaks(stores.storage.doc(), stores.storage.sheets(), sheet_id);
    let mut result = MutationResult::empty();
    result.page_break_changes.push(PageBreakChange {
        sheet_id: sheet_id.to_uuid_string(),
        breaks,
    });
    Ok(result)
}

pub(in crate::storage::engine) fn clear_all_page_breaks(
    stores: &mut EngineStores,
    sheet_id: &SheetId,
) -> Result<MutationResult, ComputeError> {
    print::clear_all_page_breaks(stores.storage.doc(), stores.storage.sheets(), sheet_id);
    let breaks = print::get_page_breaks(stores.storage.doc(), stores.storage.sheets(), sheet_id);
    let mut result = MutationResult::empty();
    result.page_break_changes.push(PageBreakChange {
        sheet_id: sheet_id.to_uuid_string(),
        breaks,
    });
    Ok(result)
}

// -------------------------------------------------------------------
// Print area & titles
// -------------------------------------------------------------------

pub(in crate::storage::engine) fn get_print_area(
    stores: &EngineStores,
    sheet_id: &SheetId,
) -> Option<PrintRange> {
    print::get_print_area(stores.storage.doc(), stores.storage.sheets(), sheet_id)
}

pub(in crate::storage::engine) fn set_print_area(
    stores: &mut EngineStores,
    sheet_id: &SheetId,
    area: Option<&PrintRange>,
) -> Result<MutationResult, ComputeError> {
    print::set_print_area(
        stores.storage.doc(),
        stores.storage.sheets(),
        sheet_id,
        area,
    );
    let mut result = MutationResult::empty();
    let kind = if area.is_some() {
        ChangeKind::Set
    } else {
        ChangeKind::Removed
    };
    result.print_area_changes.push(PrintAreaChange {
        sheet_id: sheet_id.to_uuid_string(),
        kind,
        area: area.cloned(),
    });
    Ok(result)
}

pub(in crate::storage::engine) fn get_print_titles(
    stores: &EngineStores,
    sheet_id: &SheetId,
) -> PrintTitles {
    print::get_print_titles(stores.storage.doc(), stores.storage.sheets(), sheet_id)
}

pub(in crate::storage::engine) fn set_print_titles(
    stores: &mut EngineStores,
    sheet_id: &SheetId,
    titles: &PrintTitles,
) -> Result<MutationResult, ComputeError> {
    print::set_print_titles(
        stores.storage.doc(),
        stores.storage.sheets(),
        sheet_id,
        titles,
    );
    let mut result = MutationResult::empty();
    result.print_titles_changes.push(PrintTitlesChange {
        sheet_id: sheet_id.to_uuid_string(),
        titles: titles.clone(),
    });
    Ok(result)
}

pub(in crate::storage::engine) fn set_print_settings(
    stores: &mut EngineStores,
    sheet_id: &SheetId,
    settings: &domain_types::domain::print::PrintSettings,
) -> Result<MutationResult, ComputeError> {
    print::set_print_settings(
        stores.storage.doc(),
        stores.storage.sheets(),
        sheet_id,
        settings,
    );
    let mut result = MutationResult::empty();
    result.print_settings_changes.push(PrintSettingsChange {
        sheet_id: sheet_id.to_uuid_string(),
        settings: settings.clone(),
    });
    Ok(result)
}
