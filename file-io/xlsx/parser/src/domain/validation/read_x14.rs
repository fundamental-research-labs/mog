//! x14 extension data validation parsing.

use compute_parser::parsed_expr::{ParsedExpr, SqrefList};

use crate::domain::validation::read_container::{
    find_validation_element_end, parse_container_attrs,
};
use crate::domain::validation::read_summary::summarize_validations;
use crate::domain::validation::read_support::find_prefixed_tag;
use crate::domain::validation::types::{
    DataValidation, DataValidationErrorStyle, DataValidationOperator, DataValidationType,
    DataValidations, DataValidationsContainerAttrs, ImeMode,
};
use crate::infra::scanner::{find_closing_tag, find_gt_simd, find_tag_simd};
use crate::infra::xml::{
    decode_xml_entities, parse_bool_attr_opt, parse_bytes_attr, parse_element_content,
    parse_string_attr,
};

impl DataValidation {
    pub(crate) fn parse_x14(xml: &[u8]) -> Option<Self> {
        let mut dv = DataValidation::default();

        let tag_end = find_gt_simd(xml, 0)?;
        let tag = &xml[..tag_end];

        if let Some(sqref) = parse_element_content(xml, b"sqref") {
            dv.sqref = SqrefList::parse(&sqref).unwrap_or_default();
        } else {
            return None;
        }

        if let Some(value) = parse_bytes_attr(tag, b"type=\"") {
            dv.validation_type = DataValidationType::from_bytes(value);
        }
        if let Some(value) = parse_bytes_attr(tag, b"operator=\"") {
            dv.operator = DataValidationOperator::from_bytes(value);
        }
        if let Some(value) = parse_bool_attr_opt(tag, b"allowBlank=\"") {
            dv.allow_blank = value;
        }
        if let Some(value) = parse_bool_attr_opt(tag, b"showDropDown=\"") {
            dv.show_drop_down = value;
        }
        if let Some(value) = parse_bool_attr_opt(tag, b"showInputMessage=\"") {
            dv.show_input_message = value;
        }
        if let Some(value) = parse_bool_attr_opt(tag, b"showErrorMessage=\"") {
            dv.show_error_message = value;
        }
        if let Some(value) = parse_bytes_attr(tag, b"errorStyle=\"") {
            dv.error_style = DataValidationErrorStyle::from_bytes(value);
        }
        if let Some(value) = parse_string_attr(tag, b"errorTitle=\"") {
            dv.error_title = Some(value);
        }
        if let Some(value) = parse_string_attr(tag, b"error=\"") {
            dv.error = Some(value);
        }
        if let Some(value) = parse_string_attr(tag, b"promptTitle=\"") {
            dv.prompt_title = Some(value);
        }
        if let Some(value) = parse_string_attr(tag, b"prompt=\"") {
            dv.prompt = Some(value);
        }
        if let Some(value) = parse_bytes_attr(tag, b"imeMode=\"") {
            dv.ime_mode = ImeMode::from_bytes(value);
        }
        dv.uid = parse_string_attr(tag, b"xr:uid=\"");

        if let Some(formula) = parse_x14_formula(xml, b"formula1") {
            dv.formula1 = Some(ParsedExpr::classify(&formula));
            dv.formula1_raw = Some(formula);
        }
        if let Some(formula) = parse_x14_formula(xml, b"formula2") {
            dv.formula2 = Some(ParsedExpr::classify(&formula));
            dv.formula2_raw = Some(formula);
        }

        Some(dv)
    }
}

fn parse_x14_formula(xml: &[u8], tag_name: &[u8]) -> Option<String> {
    let tag_start = find_tag_simd(xml, tag_name, 0)?;
    let tag_end = find_closing_tag(xml, tag_name, tag_start)?;
    let section = &xml[tag_start..tag_end];
    if let Some(f_start) = find_prefixed_tag(section, b"xm", b"f", 0) {
        let content_start = find_gt_simd(section, f_start)? + 1;
        let content_end = find_closing_tag(section, b"f", content_start)?;
        return Some(decode_xml_entities(&section[content_start..content_end]));
    }
    parse_element_content(section, tag_name)
}

pub fn parse_x14_data_validations(
    xml: &[u8],
) -> (
    Vec<crate::output::results::DvSummary>,
    DataValidationsContainerAttrs,
) {
    let Some(dv_start) = find_prefixed_tag(xml, b"x14", b"dataValidations", 0) else {
        return Default::default();
    };
    let open_end = find_gt_simd(xml, dv_start).unwrap_or(xml.len().saturating_sub(1));
    let dv_end = if open_end > dv_start && xml.get(open_end.saturating_sub(1)) == Some(&b'/') {
        open_end + 1
    } else {
        find_closing_tag(xml, b"dataValidations", dv_start).unwrap_or(xml.len())
    };
    let section = &xml[dv_start..dv_end];

    let mut container = DataValidations::default();
    parse_container_attrs(&mut container, section);

    let mut pos = 0;
    while let Some(dv_pos) = find_prefixed_tag(section, b"x14", b"dataValidation", pos) {
        let after_name = dv_pos + 1 + b"x14:dataValidation".len();
        if section.get(after_name) == Some(&b's') {
            pos = dv_pos + 1;
            continue;
        }

        let element_end = find_validation_element_end(section, dv_pos);
        if let Some(dv) = DataValidation::parse_x14(&section[dv_pos..element_end]) {
            container.validations.push(dv);
        }
        pos = element_end;
    }

    summarize_validations(
        &container.validations,
        DataValidationsContainerAttrs::from(&container),
    )
}
