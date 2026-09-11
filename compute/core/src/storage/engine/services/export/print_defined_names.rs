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
        let sheet_name = sheet_properties::get_sheet_name(&stores.storage, sheet_id)
            .unwrap_or_else(|| format!("Sheet{}", sheet_index + 1));
        let qualified_sheet_name = quote_sheet_name_for_defined_name(&sheet_name);
        let local_sheet_id = Some(sheet_index as u32);

        let areas = print::get_print_areas(&stores.storage, sheet_id);
        if !areas.is_empty() {
            named_ranges.push(NamedRange {
                name: PRINT_AREA_DEFINED_NAME.to_string(),
                refers_to: areas
                    .iter()
                    .map(|area| format!("{}!{}", qualified_sheet_name, format_print_area_ref(area)))
                    .collect::<Vec<_>>()
                    .join(","),
                local_sheet_id,
                ..Default::default()
            });
        }

        let titles = print::get_print_titles(&stores.storage, sheet_id);
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
    // Excel stores repeating columns before repeating rows:
    // `Sheet!$A:$A,Sheet!$1:$5`.
    let mut refs = Vec::new();
    if let Some((start_col, end_col)) = titles.repeat_cols {
        refs.push(format!(
            "{}!${}:${}",
            sheet_name,
            col_index_to_label(start_col),
            col_index_to_label(end_col)
        ));
    }
    if let Some((start_row, end_row)) = titles.repeat_rows {
        refs.push(format!(
            "{}!${}:${}",
            sheet_name,
            start_row + 1,
            end_row + 1
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
        && !looks_like_a1_or_r1c1(name)
    {
        return name.to_string();
    }
    format!("'{}'", name.replace('\'', "''"))
}

/// Sheet names that parse as A1 (`Exp1`) or R1C1 (`R1C1`) must be quoted in
/// defined-name formulas, otherwise Excel treats them as cell references.
fn looks_like_a1_or_r1c1(name: &str) -> bool {
    let bytes = name.as_bytes();
    if bytes.is_empty() {
        return false;
    }
    let letters = bytes.iter().take_while(|b| b.is_ascii_alphabetic()).count();
    if (1..=3).contains(&letters)
        && letters < bytes.len()
        && bytes[letters..].iter().all(|b| b.is_ascii_digit())
    {
        return true;
    }
    // R1C1: R<digits>C<digits>
    let upper = name.to_ascii_uppercase();
    let Some(rest) = upper.strip_prefix('R') else {
        return false;
    };
    let digits = rest.bytes().take_while(u8::is_ascii_digit).count();
    if digits == 0 {
        return false;
    }
    rest.as_bytes()
        .get(digits..)
        .and_then(|rest| rest.strip_prefix(b"C"))
        .is_some_and(|rest| !rest.is_empty() && rest.iter().all(u8::is_ascii_digit))
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
