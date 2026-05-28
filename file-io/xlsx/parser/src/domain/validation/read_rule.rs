//! Legacy `<dataValidation>` rule parsing.

use compute_parser::parsed_expr::{ParsedExpr, SqrefList};

use crate::domain::validation::types::{
    DataValidation, DataValidationErrorStyle, DataValidationOperator, DataValidationType, ImeMode,
};
use crate::infra::scanner::find_gt_simd;
use crate::infra::xml::{
    parse_bool_attr_opt, parse_bytes_attr, parse_element_content, parse_string_attr,
};

impl DataValidation {
    /// Parse a single dataValidation element
    pub(crate) fn parse(xml: &[u8]) -> Option<Self> {
        let mut dv = DataValidation::default();

        // Find the opening tag end
        let tag_end = find_gt_simd(xml, 0)?;
        let tag = &xml[..tag_end];

        // Parse sqref (required) — typed at parse time via SqrefList::parse.
        // Malformed sqref (non-empty attribute that fails to parse) yields an
        // empty SqrefList; the rule is still emitted because downstream
        // consumers may still want the formula payload for diagnostics.
        if let Some(sqref) = parse_string_attr(tag, b"sqref=\"") {
            dv.sqref = SqrefList::parse(&sqref).unwrap_or_default();
        } else {
            // sqref is required
            return None;
        }

        // Parse type
        if let Some(value) = parse_bytes_attr(tag, b"type=\"") {
            dv.validation_type = DataValidationType::from_bytes(value);
        }

        // Parse operator
        if let Some(value) = parse_bytes_attr(tag, b"operator=\"") {
            dv.operator = DataValidationOperator::from_bytes(value);
        }

        // Parse allowBlank
        if let Some(value) = parse_bool_attr_opt(tag, b"allowBlank=\"") {
            dv.allow_blank = value;
        }

        // Parse showDropDown (note: confusingly named - false shows dropdown)
        if let Some(value) = parse_bool_attr_opt(tag, b"showDropDown=\"") {
            dv.show_drop_down = value;
        }

        // Parse showInputMessage
        if let Some(value) = parse_bool_attr_opt(tag, b"showInputMessage=\"") {
            dv.show_input_message = value;
        }

        // Parse showErrorMessage
        if let Some(value) = parse_bool_attr_opt(tag, b"showErrorMessage=\"") {
            dv.show_error_message = value;
        }

        // Parse errorStyle
        if let Some(value) = parse_bytes_attr(tag, b"errorStyle=\"") {
            dv.error_style = DataValidationErrorStyle::from_bytes(value);
        }

        // Parse errorTitle
        if let Some(value) = parse_string_attr(tag, b"errorTitle=\"") {
            dv.error_title = Some(value);
        }

        // Parse error
        if let Some(value) = parse_string_attr(tag, b"error=\"") {
            dv.error = Some(value);
        }

        // Parse promptTitle
        if let Some(value) = parse_string_attr(tag, b"promptTitle=\"") {
            dv.prompt_title = Some(value);
        }

        // Parse prompt
        if let Some(value) = parse_string_attr(tag, b"prompt=\"") {
            dv.prompt = Some(value);
        }

        // Parse imeMode
        if let Some(value) = parse_bytes_attr(tag, b"imeMode=\"") {
            dv.ime_mode = ImeMode::from_bytes(value);
        }

        // Parse xr:uid (revision tracking extension)
        dv.uid = parse_string_attr(tag, b"xr:uid=\"");

        // Parse formula1 (as child element) — typed at parse time via
        // ParsedExpr::classify. The classifier is total over UTF-8 and
        // dispatches: literals (`5`, `"abc"`) → Constant, formulas
        // (`=MAX($A:$A)`) → Formula, refs → Cell/Range/SqrefList,
        // `#REF!` → BrokenRef, empty → Empty.
        if let Some(formula) = parse_element_content(xml, b"formula1") {
            dv.formula1 = Some(ParsedExpr::classify(&formula));
            dv.formula1_raw = Some(formula);
        }

        // Parse formula2 (as child element)
        if let Some(formula) = parse_element_content(xml, b"formula2") {
            dv.formula2 = Some(ParsedExpr::classify(&formula));
            dv.formula2_raw = Some(formula);
        }

        Some(dv)
    }
}
