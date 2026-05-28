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

pub(super) fn apply_visible_row_hints_for_export(writer: &mut SheetWriter, sheet_data: &SheetData) {
    for row_dim in &sheet_data.dimensions.row_heights {
        if row_dim.explicit_hidden && !row_dim.hidden {
            writer.set_row_hidden(row_dim.row, false);
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

fn raw_worksheet_element_is_compatible(sheet_data: &SheetData, xml: &str) -> bool {
    if raw_xml_contains_element(xml, "sheetPr") {
        return false;
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
    if crate::infra::xml::raw_xml_contains_relationship_attr(xml) {
        return false;
    }

    !raw_ext_lst_conflicts_with_modeled_owner(sheet_data, xml)
}

fn sheet_has_modeled_ext_lst_owner(sheet_data: &SheetData) -> bool {
    !sheet_data.sparklines.is_empty()
        || !sheet_data.sparkline_groups.is_empty()
        || !sheet_data.data_validations.is_empty()
        || !sheet_data.x14_data_validations.is_empty()
        || !sheet_data.conditional_formats.is_empty()
}

fn raw_ext_lst_conflicts_with_modeled_owner(sheet_data: &SheetData, xml: &str) -> bool {
    let owners = RawExtLstOwners::from_xml(xml);

    if owners.sparkline_groups {
        return true;
    }

    if owners.standard_data_validations || owners.standard_conditional_formatting {
        return true;
    }

    if owners.x14_data_validations
        && (!sheet_data.data_validations.is_empty() || !sheet_data.x14_data_validations.is_empty())
    {
        return true;
    }

    if owners.x14_conditional_formatting && !sheet_data.conditional_formats.is_empty() {
        return true;
    }

    if owners.has_unmodeled_x14_owner() {
        return false;
    }

    sheet_has_modeled_ext_lst_owner(sheet_data)
}

#[derive(Default)]
struct RawExtLstOwners {
    standard_data_validations: bool,
    x14_data_validations: bool,
    standard_conditional_formatting: bool,
    x14_conditional_formatting: bool,
    sparkline_groups: bool,
}

impl RawExtLstOwners {
    fn from_xml(xml: &str) -> Self {
        let mut owners = Self::default();
        for (prefix, local_name) in raw_xml_start_element_names(xml) {
            match local_name {
                "dataValidations" | "dataValidation" => {
                    if prefix == Some("x14") {
                        owners.x14_data_validations = true;
                    } else {
                        owners.standard_data_validations = true;
                    }
                }
                "conditionalFormattings" | "conditionalFormatting" => {
                    if prefix == Some("x14") {
                        owners.x14_conditional_formatting = true;
                    } else {
                        owners.standard_conditional_formatting = true;
                    }
                }
                "sparklineGroups" | "sparklineGroup" => {
                    owners.sparkline_groups = true;
                }
                _ => {}
            }
        }
        owners
    }

    fn has_unmodeled_x14_owner(&self) -> bool {
        self.x14_data_validations || self.x14_conditional_formatting
    }
}

fn raw_xml_start_element_names(xml: &str) -> Vec<(Option<&str>, &str)> {
    let mut names = Vec::new();
    let bytes = xml.as_bytes();
    let mut pos = 0;

    while let Some(offset) = bytes[pos..].iter().position(|&b| b == b'<') {
        let lt = pos + offset;
        let name_start = lt + 1;
        if name_start >= bytes.len() {
            break;
        }

        if matches!(bytes[name_start], b'/' | b'!' | b'?') {
            pos = name_start + 1;
            continue;
        }

        let mut name_end = name_start;
        while name_end < bytes.len()
            && !matches!(bytes[name_end], b' ' | b'\t' | b'\n' | b'\r' | b'>' | b'/')
        {
            name_end += 1;
        }

        if name_start < name_end {
            let qname = &xml[name_start..name_end];
            if let Some((prefix, local_name)) = qname.split_once(':') {
                names.push((Some(prefix), local_name));
            } else {
                names.push((None, qname));
            }
        }

        pos = name_end;
    }

    names
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
    fn preserves_relationship_free_x14_validation_extension_without_current_domain_state() {
        let sheet_data = SheetData::default();
        let sheet_rt =
            sheet_rt_with_ext(r#"<extLst><ext><x14:dataValidations count="1"/></ext></extLst>"#);

        assert!(standalone_ext_lst_for_export(&sheet_data, &sheet_rt).is_some());
    }

    #[test]
    fn drops_x14_validation_extension_when_current_standard_owner_is_modeled() {
        let sheet_data = SheetData {
            data_validations: vec![domain_types::ValidationSpec::default()],
            ..Default::default()
        };
        let sheet_rt =
            sheet_rt_with_ext(r#"<extLst><ext><x14:dataValidations count="1"/></ext></extLst>"#);

        assert!(standalone_ext_lst_for_export(&sheet_data, &sheet_rt).is_none());
    }

    #[test]
    fn drops_x14_conditional_formatting_extension_when_current_standard_owner_is_modeled() {
        let sheet_data = SheetData {
            conditional_formats: vec![domain_types::ConditionalFormat {
                id: "cf-1".to_string(),
                sheet_id: "sheet-1".to_string(),
                pivot: None,
                ranges: Vec::new(),
                range_identities: None,
                rules: Vec::new(),
            }],
            ..Default::default()
        };
        let sheet_rt = sheet_rt_with_ext(
            r#"<extLst><ext><x14:conditionalFormattings count="1"/></ext></extLst>"#,
        );

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
    fn drops_relationship_bearing_x14_extension() {
        let sheet_data = SheetData::default();
        let sheet_rt = sheet_rt_with_ext(
            r#"<extLst><ext><x14:dataValidations r:id="rIdStale"/></ext></extLst>"#,
        );

        assert!(standalone_ext_lst_for_export(&sheet_data, &sheet_rt).is_none());
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
