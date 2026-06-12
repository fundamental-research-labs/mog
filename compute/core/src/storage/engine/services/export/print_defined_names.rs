use cell_types::SheetId;
use domain_types::NamedRange;
use domain_types::domain::sheet::{PrintRange, PrintTitles};

use crate::storage::engine::stores::EngineStores;
use crate::storage::sheet::{print, properties as sheet_properties};

const PRINT_AREA_DEFINED_NAME: &str = "_xlnm.Print_Area";
const PRINT_TITLES_DEFINED_NAME: &str = "_xlnm.Print_Titles";

pub(super) fn export_print_defined_names(
    stores: &EngineStores,
    sheet_ids: &[SheetId],
) -> Vec<NamedRange> {
    let mut named_ranges = Vec::new();
    for (sheet_index, sheet_id) in sheet_ids.iter().enumerate() {
        let sheet_name = sheet_properties::get_sheet_name(
            stores.storage.doc(),
            stores.storage.sheets(),
            sheet_id,
        )
        .unwrap_or_else(|| format!("Sheet{}", sheet_index + 1));
        let qualified_sheet_name = quote_sheet_name_for_defined_name(&sheet_name);
        let local_sheet_id = Some(sheet_index as u32);

        if let Some(area) =
            print::get_print_area(stores.storage.doc(), stores.storage.sheets(), sheet_id)
        {
            named_ranges.push(NamedRange {
                name: PRINT_AREA_DEFINED_NAME.to_string(),
                refers_to: format!("{}!{}", qualified_sheet_name, format_print_area_ref(&area)),
                local_sheet_id,
                ..Default::default()
            });
        }

        let titles =
            print::get_print_titles(stores.storage.doc(), stores.storage.sheets(), sheet_id);
        if let Some(refers_to) = format_print_titles_ref(&qualified_sheet_name, &titles) {
            named_ranges.push(NamedRange {
                name: PRINT_TITLES_DEFINED_NAME.to_string(),
                refers_to,
                local_sheet_id,
                ..Default::default()
            });
        }
    }
    named_ranges
}

pub(super) fn collides_with_print_defined_name(
    print_defined_names: &[NamedRange],
    named_range: &NamedRange,
) -> bool {
    print_defined_names.iter().any(|print_defined_name| {
        print_defined_name
            .name
            .eq_ignore_ascii_case(named_range.name.as_str())
            && print_defined_name.local_sheet_id == named_range.local_sheet_id
    })
}

fn format_print_area_ref(area: &PrintRange) -> String {
    format!(
        "${}${}:${}${}",
        col_index_to_label(area.start_col),
        area.start_row + 1,
        col_index_to_label(area.end_col),
        area.end_row + 1
    )
}

fn format_print_titles_ref(sheet_name: &str, titles: &PrintTitles) -> Option<String> {
    let mut refs = Vec::new();
    if let Some((start_row, end_row)) = titles.repeat_rows {
        refs.push(format!(
            "{}!${}:${}",
            sheet_name,
            start_row + 1,
            end_row + 1
        ));
    }
    if let Some((start_col, end_col)) = titles.repeat_cols {
        refs.push(format!(
            "{}!${}:${}",
            sheet_name,
            col_index_to_label(start_col),
            col_index_to_label(end_col)
        ));
    }

    if refs.is_empty() {
        None
    } else {
        Some(refs.join(","))
    }
}

fn quote_sheet_name_for_defined_name(name: &str) -> String {
    if !name.is_empty()
        && name
            .chars()
            .all(|ch| ch.is_ascii_alphanumeric() || ch == '_')
    {
        return name.to_string();
    }
    format!("'{}'", name.replace('\'', "''"))
}

fn col_index_to_label(col: u32) -> String {
    let mut n = col + 1;
    let mut label = Vec::new();
    while n > 0 {
        let rem = ((n - 1) % 26) as u8;
        label.push((b'A' + rem) as char);
        n = (n - 1) / 26;
    }
    label.into_iter().rev().collect()
}
