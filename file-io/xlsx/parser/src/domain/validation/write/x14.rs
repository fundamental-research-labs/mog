use super::format::xml_escape;

pub fn x14_validations_ext_xml_from_domain_with_opts(
    specs: &[domain_types::ValidationSpec],
    disable_prompts: bool,
    x_window: Option<u32>,
    y_window: Option<u32>,
    declared_count: Option<u32>,
) -> String {
    if specs.is_empty()
        && !disable_prompts
        && x_window.is_none()
        && y_window.is_none()
        && declared_count.is_none()
    {
        return String::new();
    }

    let mut xml = String::new();
    xml.push_str(r#"<ext uri="{CCE6A557-97BC-4B89-ADB6-D9C93CAAB3DF}">"#);
    xml.push_str(r#"<x14:dataValidations xmlns:x14="http://schemas.microsoft.com/office/spreadsheetml/2009/9/main" xmlns:xm="http://schemas.microsoft.com/office/excel/2006/main" xmlns:xr="http://schemas.microsoft.com/office/spreadsheetml/2014/revision""#);
    xml.push_str(&format!(
        r#" count="{}""#,
        declared_count.unwrap_or(specs.len() as u32)
    ));
    if disable_prompts {
        xml.push_str(r#" disablePrompts="1""#);
    }
    if let Some(x) = x_window {
        xml.push_str(&format!(r#" xWindow="{x}""#));
    }
    if let Some(y) = y_window {
        xml.push_str(&format!(r#" yWindow="{y}""#));
    }

    if specs.is_empty() {
        xml.push_str("/>");
        xml.push_str("</ext>");
        return xml;
    }

    xml.push('>');
    for spec in specs {
        append_x14_validation(&mut xml, spec);
    }
    xml.push_str("</x14:dataValidations>");
    xml.push_str("</ext>");
    xml
}

fn append_x14_validation(xml: &mut String, spec: &domain_types::ValidationSpec) {
    let (validation_type, operator, formula1, formula2, show_dropdown) = match &spec.rule {
        domain_types::ValidationRule::WholeNumber {
            operator,
            formula1,
            formula2,
        } => (
            "whole",
            Some(operator.as_str()),
            formula1.as_str(),
            formula2.as_deref(),
            true,
        ),
        domain_types::ValidationRule::Decimal {
            operator,
            formula1,
            formula2,
        } => (
            "decimal",
            Some(operator.as_str()),
            formula1.as_str(),
            formula2.as_deref(),
            true,
        ),
        domain_types::ValidationRule::List {
            formula1,
            show_dropdown,
        } => ("list", None, formula1.as_str(), None, *show_dropdown),
        domain_types::ValidationRule::Date {
            operator,
            formula1,
            formula2,
        } => (
            "date",
            Some(operator.as_str()),
            formula1.as_str(),
            formula2.as_deref(),
            true,
        ),
        domain_types::ValidationRule::Time {
            operator,
            formula1,
            formula2,
        } => (
            "time",
            Some(operator.as_str()),
            formula1.as_str(),
            formula2.as_deref(),
            true,
        ),
        domain_types::ValidationRule::TextLength {
            operator,
            formula1,
            formula2,
        } => (
            "textLength",
            Some(operator.as_str()),
            formula1.as_str(),
            formula2.as_deref(),
            true,
        ),
        domain_types::ValidationRule::Custom { formula1 } => {
            ("custom", None, formula1.as_str(), None, true)
        }
        domain_types::ValidationRule::None { formula1 } => {
            ("none", None, formula1.as_str(), None, true)
        }
    };

    xml.push_str("<x14:dataValidation");
    if validation_type != "none" {
        xml.push_str(&format!(r#" type="{validation_type}""#));
    }
    if let Some(op) = operator {
        if op != "between" {
            xml.push_str(&format!(r#" operator="{op}""#));
        }
    }
    if spec.allow_blank {
        xml.push_str(r#" allowBlank="1""#);
    }
    if spec.show_prompt {
        xml.push_str(r#" showInputMessage="1""#);
    }
    if spec.show_error {
        xml.push_str(r#" showErrorMessage="1""#);
    }
    if validation_type == "list" && !show_dropdown {
        xml.push_str(r#" showDropDown="1""#);
    }
    if spec.error_style != domain_types::ErrorStyle::Stop {
        xml.push_str(&format!(r#" errorStyle="{}""#, spec.error_style.as_str()));
    }
    if spec.ime_mode != domain_types::ImeMode::NoControl {
        xml.push_str(&format!(r#" imeMode="{}""#, spec.ime_mode.as_str()));
    }
    if let Some(title) = &spec.error_title {
        xml.push_str(&format!(r#" errorTitle="{}""#, xml_escape(title)));
    }
    if let Some(message) = &spec.error_message {
        xml.push_str(&format!(r#" error="{}""#, xml_escape(message)));
    }
    if let Some(title) = &spec.prompt_title {
        xml.push_str(&format!(r#" promptTitle="{}""#, xml_escape(title)));
    }
    if let Some(message) = &spec.prompt_message {
        xml.push_str(&format!(r#" prompt="{}""#, xml_escape(message)));
    }
    if let Some(uid) = &spec.uid {
        xml.push_str(&format!(r#" xr:uid="{}""#, xml_escape(uid)));
    }
    xml.push('>');
    if !formula1.is_empty() {
        xml.push_str("<x14:formula1><xm:f>");
        xml.push_str(&xml_escape(formula1));
        xml.push_str("</xm:f></x14:formula1>");
    }
    if let Some(f2) = formula2 {
        xml.push_str("<x14:formula2><xm:f>");
        xml.push_str(&xml_escape(f2));
        xml.push_str("</xm:f></x14:formula2>");
    }
    xml.push_str("<xm:sqref>");
    xml.push_str(&xml_escape(&spec.ranges.join(" ")));
    xml.push_str("</xm:sqref>");
    xml.push_str("</x14:dataValidation>");
}
