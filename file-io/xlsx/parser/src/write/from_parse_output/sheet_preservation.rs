use std::collections::HashSet;

use domain_types::{SheetData, SheetRoundTripContext};

use crate::write::sheet::SheetWriter;

pub(super) fn preserved_elements_for_export(
    sheet_data: &SheetData,
    sheet_rt: &SheetRoundTripContext,
) -> Option<crate::roundtrip::unknown_elements::PreservedElements> {
    if sheet_rt.sheet_preserved_elements.is_empty() {
        return None;
    }

    let pairs: Vec<_> = sheet_rt
        .sheet_preserved_elements
        .iter()
        .filter(|(_, xml)| raw_worksheet_element_is_compatible(sheet_data, xml))
        .cloned()
        .collect();

    (!pairs.is_empty())
        .then(|| crate::roundtrip::unknown_elements::PreservedElements::from_position_pairs(&pairs))
}

pub(super) fn original_dimension_for_export<'a>(
    sheet_data: &SheetData,
    sheet_rt: &'a SheetRoundTripContext,
) -> Option<&'a String> {
    sheet_rt.original_dimension.as_ref().filter(|dimension| {
        parse_dimension_ref(dimension)
            .zip(modeled_dimension(sheet_data))
            .is_some_and(|(original, modeled)| original == modeled)
    })
}

pub(super) fn apply_row_hints_for_export(
    writer: &mut SheetWriter,
    sheet_data: &SheetData,
    sheet_rt: &SheetRoundTripContext,
) {
    let rows = modeled_rows(sheet_data);

    for (row, spans) in &sheet_rt.row_spans {
        if rows.contains(row) {
            writer.set_row_spans(*row, spans.clone());
        }
    }
    for &row in &sheet_rt.row_thick_bot {
        if rows.contains(&row) {
            writer.set_row_thick_bot(row, true);
        }
    }
    for &row in &sheet_rt.row_thick_top {
        if rows.contains(&row) {
            writer.set_row_thick_top(row, true);
        }
    }
    for (&row, &collapsed) in &sheet_rt.row_collapsed {
        if rows.contains(&row) {
            writer.set_row_collapsed(row, collapsed);
        }
    }
    for &row in &sheet_rt.row_hidden_explicit_false {
        if rows.contains(&row) {
            writer.set_row_hidden(row, false);
        }
    }
    for &row in &sheet_rt.row_outline_level_zero {
        if rows.contains(&row) {
            writer.set_row_outline_level(row, 0);
        }
    }
    for &row in &sheet_rt.bare_empty_rows {
        if rows.contains(&row) {
            writer.mark_bare_empty_row(row);
        }
    }
}

pub(super) fn apply_visible_row_hints_for_export(
    writer: &mut SheetWriter,
    sheet_data: &SheetData,
    sheet_rt: &SheetRoundTripContext,
) {
    let rows = modeled_rows(sheet_data);
    for &row in &sheet_rt.row_hidden_explicit_false {
        if rows.contains(&row) {
            writer.set_row_hidden(row, false);
        }
    }
}

pub(super) fn standalone_ext_lst_for_export<'a>(
    sheet_data: &SheetData,
    sheet_rt: &'a SheetRoundTripContext,
) -> Option<&'a String> {
    sheet_rt
        .ext_lst_xml
        .as_ref()
        .filter(|xml| raw_worksheet_ext_lst_is_compatible(sheet_data, xml))
}

pub(super) fn empty_ext_lst_for_export(
    sheet_data: &SheetData,
    sheet_rt: &SheetRoundTripContext,
) -> bool {
    if !sheet_rt.has_empty_ext_lst || sheet_has_modeled_ext_lst_owner(sheet_data) {
        return false;
    }

    if sheet_rt
        .ext_lst_xml
        .as_ref()
        .is_some_and(|xml| !raw_worksheet_ext_lst_is_compatible(sheet_data, xml))
    {
        return false;
    }

    !sheet_rt.sheet_preserved_elements.iter().any(|(_, xml)| {
        xml.contains("<extLst") && !raw_worksheet_ext_lst_is_compatible(sheet_data, xml)
    })
}

fn raw_worksheet_element_is_compatible(sheet_data: &SheetData, xml: &str) -> bool {
    if xml.contains("<tableParts") {
        return false;
    }

    !xml.contains("<extLst") || raw_worksheet_ext_lst_is_compatible(sheet_data, xml)
}

fn raw_worksheet_ext_lst_is_compatible(sheet_data: &SheetData, xml: &str) -> bool {
    if sheet_has_modeled_ext_lst_owner(sheet_data) {
        return false;
    }

    !raw_ext_lst_contains_modeled_owner(xml)
}

fn sheet_has_modeled_ext_lst_owner(sheet_data: &SheetData) -> bool {
    !sheet_data.sparklines.is_empty()
        || !sheet_data.sparkline_groups.is_empty()
        || !sheet_data.data_validations.is_empty()
        || !sheet_data.conditional_formats.is_empty()
}

fn raw_ext_lst_contains_modeled_owner(xml: &str) -> bool {
    [
        "dataValidations",
        "dataValidation",
        "conditionalFormattings",
        "conditionalFormatting",
        "sparklineGroups",
        "sparklineGroup",
    ]
    .iter()
    .any(|marker| xml.contains(marker))
}

fn modeled_dimension(sheet_data: &SheetData) -> Option<(u32, u32, u32, u32)> {
    let mut min_row = u32::MAX;
    let mut max_row = 0u32;
    let mut min_col = u32::MAX;
    let mut max_col = 0u32;

    for cell in &sheet_data.cells {
        min_row = min_row.min(cell.row);
        max_row = max_row.max(cell.row);
        min_col = min_col.min(cell.col);
        max_col = max_col.max(cell.col);
    }

    if min_row <= max_row && min_col <= max_col {
        Some((min_row, min_col, max_row, max_col))
    } else {
        None
    }
}

fn modeled_rows(sheet_data: &SheetData) -> HashSet<u32> {
    let mut rows: HashSet<u32> = sheet_data.cells.iter().map(|cell| cell.row).collect();
    rows.extend(sheet_data.dimensions.row_heights.iter().map(|row| row.row));
    rows.extend(sheet_data.row_styles.iter().map(|row| row.row));
    for run in &sheet_data.authored_style_runs {
        rows.extend(run.start_row..=run.end_row);
    }
    for group in &sheet_data.outline_groups {
        if group.is_row {
            rows.extend(group.start..=group.end);
            if group.collapsed && !group.collapsed_on_member {
                rows.insert(group.end + 1);
            }
        }
    }
    rows
}

fn parse_dimension_ref(dimension: &str) -> Option<(u32, u32, u32, u32)> {
    crate::infra::a1::parse_a1_range(dimension).or_else(|| {
        crate::infra::a1::parse_a1_cell(dimension).map(|(row, col)| (row, col, row, col))
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use domain_types::{CellData, CellValue};

    fn sheet_rt_with_ext(xml: &str) -> SheetRoundTripContext {
        SheetRoundTripContext {
            ext_lst_xml: Some(xml.to_string()),
            ..Default::default()
        }
    }

    #[test]
    fn drops_known_modeled_extension_owners_without_current_domain_state() {
        let sheet_data = SheetData::default();
        let sheet_rt =
            sheet_rt_with_ext(r#"<extLst><ext><x14:dataValidations count="1"/></ext></extLst>"#);

        assert!(standalone_ext_lst_for_export(&sheet_data, &sheet_rt).is_none());
    }

    #[test]
    fn drops_raw_ext_lst_when_current_sheet_has_modeled_owner() {
        let sheet_data = SheetData {
            data_validations: vec![domain_types::ValidationSpec::default()],
            ..Default::default()
        };
        let sheet_rt = sheet_rt_with_ext(r#"<extLst><ext uri="{unknown}"/></extLst>"#);

        assert!(standalone_ext_lst_for_export(&sheet_data, &sheet_rt).is_none());
    }

    #[test]
    fn keeps_unknown_extension_when_no_modeled_owner_exists() {
        let sheet_data = SheetData::default();
        let sheet_rt = sheet_rt_with_ext(r#"<extLst><ext uri="{vendor}"/></extLst>"#);

        assert!(standalone_ext_lst_for_export(&sheet_data, &sheet_rt).is_some());
    }

    #[test]
    fn preserves_original_dimension_only_when_it_matches_modeled_cells() {
        let sheet_data = SheetData {
            cells: vec![
                CellData {
                    row: 0,
                    col: 0,
                    value: CellValue::number(1.0),
                    ..Default::default()
                },
                CellData {
                    row: 1,
                    col: 1,
                    value: CellValue::number(2.0),
                    ..Default::default()
                },
            ],
            ..Default::default()
        };
        let sheet_rt = SheetRoundTripContext {
            original_dimension: Some("A1:B2".to_string()),
            ..Default::default()
        };

        assert_eq!(
            original_dimension_for_export(&sheet_data, &sheet_rt).map(String::as_str),
            Some("A1:B2")
        );
    }

    #[test]
    fn drops_original_dimension_when_it_is_stale() {
        let sheet_data = SheetData {
            cells: vec![CellData {
                row: 0,
                col: 0,
                value: CellValue::number(1.0),
                ..Default::default()
            }],
            ..Default::default()
        };
        let sheet_rt = SheetRoundTripContext {
            original_dimension: Some("A1:Z99".to_string()),
            ..Default::default()
        };

        assert!(original_dimension_for_export(&sheet_data, &sheet_rt).is_none());
    }
}
