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
        .filter(|(_, xml)| {
            !raw_xml_contains_element(xml, "extLst")
                && raw_worksheet_element_is_compatible(sheet_data, xml)
        })
        .cloned()
        .collect();

    (!pairs.is_empty())
        .then(|| crate::roundtrip::unknown_elements::PreservedElements::from_position_pairs(&pairs))
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
    let xml = sheet_rt.ext_lst_xml.as_ref()?;
    if !raw_worksheet_ext_lst_is_compatible(sheet_data, xml) {
        return None;
    }
    Some(xml)
}

pub(super) fn empty_ext_lst_for_export(
    sheet_data: &SheetData,
    sheet_rt: &SheetRoundTripContext,
) -> bool {
    sheet_rt.has_empty_ext_lst && !sheet_has_modeled_ext_lst_owner(sheet_data)
}

fn raw_worksheet_element_is_compatible(sheet_data: &SheetData, xml: &str) -> bool {
    if raw_xml_contains_element(xml, "sheetPr") {
        if sheet_data.outline_properties.is_some() || raw_xml_contains_element(xml, "outlinePr") {
            return false;
        }
        if sheet_data.print_settings.is_some() && raw_xml_contains_element(xml, "pageSetUpPr") {
            return false;
        }
    }
    if raw_worksheet_element_contains_modeled_child(xml) {
        return false;
    }
    if xml.contains("<tableParts") {
        return false;
    }
    if raw_worksheet_element_contains_unresolved_relationship(xml) {
        return false;
    }

    !xml.contains("<extLst") || raw_worksheet_ext_lst_is_compatible(sheet_data, xml)
}

fn raw_worksheet_element_contains_modeled_child(xml: &str) -> bool {
    [
        "dimension",
        "sheetViews",
        "sheetFormatPr",
        "cols",
        "sheetData",
        "mergeCells",
        "conditionalFormatting",
        "dataValidations",
        "hyperlinks",
        "autoFilter",
        "sortState",
        "sheetProtection",
        "printOptions",
        "pageMargins",
        "pageSetup",
        "headerFooter",
        "rowBreaks",
        "colBreaks",
    ]
    .iter()
    .any(|name| raw_xml_contains_element(xml, name))
}

fn raw_worksheet_element_contains_unresolved_relationship(xml: &str) -> bool {
    if crate::infra::xml::raw_xml_contains_relationship_attr(xml)
        && !raw_xml_contains_element(xml, "pivotTableDefinition")
    {
        return true;
    }

    [
        "customProperties",
        "drawing",
        "legacyDrawing",
        "legacyDrawingHF",
        "controls",
        "oleObjects",
        "picture",
    ]
    .iter()
    .any(|name| raw_xml_contains_element(xml, name))
}

fn raw_xml_contains_element(raw_xml: &str, local_name: &str) -> bool {
    raw_xml.contains(&format!("<{local_name}")) || raw_xml.contains(&format!(":{local_name}"))
}

fn raw_worksheet_ext_lst_is_compatible(sheet_data: &SheetData, xml: &str) -> bool {
    if sheet_has_modeled_ext_lst_owner(sheet_data) {
        return false;
    }

    !crate::infra::xml::raw_xml_contains_relationship_attr(xml)
        && !raw_ext_lst_contains_modeled_owner(xml)
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

#[cfg(test)]
mod tests {
    use super::*;

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
    fn drops_prefixed_relationship_bearing_preserved_elements() {
        let sheet_data = SheetData::default();
        let sheet_rt = SheetRoundTripContext {
            sheet_preserved_elements: vec![(
                "worksheet\0after\0sheetData".to_string(),
                r#"<x:legacyDrawing r:id="rIdStale"/>"#.to_string(),
            )],
            ..Default::default()
        };

        assert!(preserved_elements_for_export(&sheet_data, &sheet_rt).is_none());
    }

    #[test]
    fn drops_sheet_pr_page_setup_pr_when_print_settings_are_modeled() {
        let sheet_data = SheetData {
            print_settings: Some(domain_types::PrintSettings {
                has_page_setup: true,
                scale: Some(75),
                ..Default::default()
            }),
            ..Default::default()
        };
        let sheet_rt = SheetRoundTripContext {
            sheet_preserved_elements: vec![(
                "worksheet\0first\0\0sheetPr".to_string(),
                r#"<sheetPr><pageSetUpPr fitToPage="1"/></sheetPr>"#.to_string(),
            )],
            ..Default::default()
        };

        assert!(preserved_elements_for_export(&sheet_data, &sheet_rt).is_none());
    }

    #[test]
    fn drops_unknown_preserved_elements_with_raw_relationship_id_attributes() {
        let sheet_data = SheetData::default();
        let sheet_rt = SheetRoundTripContext {
            sheet_preserved_elements: vec![(
                "worksheet\0after\0sheetData".to_string(),
                r#"<vendor:state r:id = "rIdStale"/>"#.to_string(),
            )],
            ..Default::default()
        };

        assert!(preserved_elements_for_export(&sheet_data, &sheet_rt).is_none());
    }

    #[test]
    fn drops_unknown_preserved_elements_with_prefixed_relationship_id_attributes() {
        let sheet_data = SheetData::default();
        let sheet_rt = SheetRoundTripContext {
            sheet_preserved_elements: vec![(
                "worksheet\0after\0sheetData".to_string(),
                r#"<vendor:state rel:id = "rIdStale"/>"#.to_string(),
            )],
            ..Default::default()
        };

        assert!(preserved_elements_for_export(&sheet_data, &sheet_rt).is_none());
    }

    #[test]
    fn drops_unknown_preserved_elements_with_nonstandard_prefixed_relationship_ids() {
        let sheet_data = SheetData::default();
        let sheet_rt = SheetRoundTripContext {
            sheet_preserved_elements: vec![(
                "worksheet\0after\0sheetData".to_string(),
                r#"<vendor:state rel:id = "customRelationship"/>"#.to_string(),
            )],
            ..Default::default()
        };

        assert!(preserved_elements_for_export(&sheet_data, &sheet_rt).is_none());
    }

    #[test]
    fn keeps_unknown_prefixed_preserved_elements_without_relationships() {
        let sheet_data = SheetData::default();
        let sheet_rt = SheetRoundTripContext {
            sheet_preserved_elements: vec![(
                "worksheet\0after\0sheetData".to_string(),
                r#"<x:vendorState custom="1"/>"#.to_string(),
            )],
            ..Default::default()
        };

        assert!(preserved_elements_for_export(&sheet_data, &sheet_rt).is_some());
    }
}
