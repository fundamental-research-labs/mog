use super::read_support::{attr_parse, element_slice};
use super::types::SheetFormatPrParsed;
use crate::infra::scanner::{extract_quoted_value, find_attr_simd, find_gt_simd, find_tag_simd};
use crate::infra::xml::{parse_bool_attr_opt, parse_string_attr, parse_u32_attr};
use ooxml_types::styles::ColorDef;
use ooxml_types::worksheet::{
    OutlineProperties, PageSetupProperties, SheetCalcPr, SheetProperties,
};

/// Parse `<sheetPr><outlinePr .../></sheetPr>` from worksheet XML.
pub fn parse_outline_properties(xml: &[u8]) -> Option<OutlineProperties> {
    let element = element_slice(xml, b"outlinePr", 0)?;
    let mut props = OutlineProperties::default();
    if let Some(v) = parse_bool_attr_opt(element, b"applyStyles=\"") {
        props.apply_styles = v;
    }
    if let Some(v) = parse_bool_attr_opt(element, b"summaryBelow=\"") {
        props.summary_below = v;
    }
    if let Some(v) = parse_bool_attr_opt(element, b"summaryRight=\"") {
        props.summary_right = v;
    }
    if let Some(v) = parse_bool_attr_opt(element, b"showOutlineSymbols=\"") {
        props.show_outline_symbols = v;
    }
    Some(props)
}

/// Parse modeled worksheet properties from `<sheetPr>`.
pub fn parse_sheet_properties(xml: &[u8]) -> Option<SheetProperties> {
    let sheet_pr_start = find_tag_simd(xml, b"sheetPr", 0)?;
    let sheet_pr_tag_end = find_gt_simd(xml, sheet_pr_start)?;
    let sheet_pr_tag = &xml[sheet_pr_start..=sheet_pr_tag_end];
    let sheet_pr_end = crate::infra::scanner::find_closing_tag(xml, b"sheetPr", sheet_pr_start)
        .map(|p| p + b"</sheetPr>".len())
        .unwrap_or(sheet_pr_tag_end + 1);
    let sheet_pr = &xml[sheet_pr_start..sheet_pr_end.min(xml.len())];

    let mut props = SheetProperties::default();
    if let Some(v) = parse_bool_attr_opt(sheet_pr_tag, b"syncHorizontal=\"") {
        props.sync_horizontal = v;
    }
    if let Some(v) = parse_bool_attr_opt(sheet_pr_tag, b"syncVertical=\"") {
        props.sync_vertical = v;
    }
    props.sync_ref = parse_string_attr(sheet_pr_tag, b"syncRef=\"");
    if let Some(v) = parse_bool_attr_opt(sheet_pr_tag, b"transitionEvaluation=\"") {
        props.transition_evaluation = v;
    }
    if let Some(v) = parse_bool_attr_opt(sheet_pr_tag, b"transitionEntry=\"") {
        props.transition_entry = v;
    }
    if let Some(v) = parse_bool_attr_opt(sheet_pr_tag, b"published=\"") {
        props.published = v;
    }
    props.code_name = parse_string_attr(sheet_pr_tag, b"codeName=\"");
    if let Some(v) = parse_bool_attr_opt(sheet_pr_tag, b"filterMode=\"") {
        props.filter_mode = v;
    }
    if let Some(v) = parse_bool_attr_opt(sheet_pr_tag, b"enableFormatConditionsCalculation=\"") {
        props.enable_format_conditions_calculation = v;
    }

    props.tab_color = parse_sheet_pr_color(sheet_pr, b"tabColor");
    props.outline_pr = parse_outline_properties(sheet_pr);
    props.page_set_up_pr = parse_page_setup_properties(sheet_pr);
    Some(props)
}

pub fn parse_page_setup_properties(xml: &[u8]) -> Option<PageSetupProperties> {
    let element = element_slice(xml, b"pageSetUpPr", 0)?;
    let mut props = PageSetupProperties::default();
    if let Some(v) = parse_bool_attr_opt(element, b"autoPageBreaks=\"") {
        props.auto_page_breaks = v;
    }
    if let Some(v) = parse_bool_attr_opt(element, b"fitToPage=\"") {
        props.fit_to_page = v;
    }
    Some(props)
}

fn parse_sheet_pr_color(xml: &[u8], tag: &[u8]) -> Option<ColorDef> {
    let element = element_slice(xml, tag, 0)?;
    let tint = parse_string_attr(element, b"tint=\"");
    if let Some(theme_id) = parse_u32_attr(element, b"theme=\"") {
        return Some(ColorDef::Theme { id: theme_id, tint });
    }
    if let Some(rgb) = parse_string_attr(element, b"rgb=\"") {
        return Some(ColorDef::Rgb { val: rgb, tint });
    }
    if let Some(idx) = parse_u32_attr(element, b"indexed=\"") {
        return Some(ColorDef::Indexed { id: idx, tint });
    }
    if parse_bool_attr_opt(element, b"auto=\"").unwrap_or(false) {
        return Some(ColorDef::Auto { tint });
    }
    None
}

/// Parse the `<dimension ref="..."/>` element from the pre-sheetData region.
pub fn parse_dimension_ref(xml: &[u8]) -> Option<(u32, u32, u32, u32)> {
    parse_dimension_ref_with_text(xml)?.parsed_range
}

/// Imported worksheet dimension with lexical `ref` preservation.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct SheetDimensionImport {
    pub ref_range: String,
    pub parsed_range: Option<(u32, u32, u32, u32)>,
}

/// Parse the `<dimension ref="..."/>` element and preserve its exact `ref` text.
pub fn parse_dimension_ref_with_text(xml: &[u8]) -> Option<SheetDimensionImport> {
    let elem = element_slice(xml, b"dimension", 0)?;
    let attr_pos = find_attr_simd(elem, b"ref=\"", 0)?;
    let value_start = attr_pos + b"ref=\"".len();
    let (s, e) = extract_quoted_value(elem, value_start)?;
    let ref_str = std::str::from_utf8(&elem[s..e]).ok()?;
    Some(SheetDimensionImport {
        ref_range: ref_str.to_owned(),
        parsed_range: parse_dimension_ref_value(ref_str),
    })
}

/// Parse worksheet `<dimension ref>` as advisory used-range metadata.
///
/// XLSX dimensions allow either a single A1 cell (`A1`) or a rectangular range
/// (`A1:C3`). The imported lexical string is export provenance only; callers
/// must validate this parsed extent against the live cells they will emit
/// before reusing the authored text.
pub fn parse_dimension_ref_value(ref_str: &str) -> Option<(u32, u32, u32, u32)> {
    if ref_str.contains(',') || ref_str.split(':').count() > 2 {
        return None;
    }
    if let Some((row, col)) = crate::infra::a1::parse_a1_cell(ref_str) {
        return Some((row, col, row, col));
    }
    let (start_row, start_col, end_row, end_col) = crate::infra::a1::parse_a1_range(ref_str)?;
    if start_row <= end_row && start_col <= end_col {
        Some((start_row, start_col, end_row, end_col))
    } else {
        None
    }
}

/// Parse typed worksheet calculation properties from `<sheetCalcPr>`.
pub fn parse_sheet_calc_pr(xml: &[u8]) -> Option<SheetCalcPr> {
    let elem = element_slice(xml, b"sheetCalcPr", 0)?;
    Some(SheetCalcPr {
        full_calc_on_load: parse_bool_attr_opt(elem, b"fullCalcOnLoad=\"").unwrap_or(false),
    })
}

pub fn parse_sheet_format_pr(xml: &[u8]) -> SheetFormatPrParsed {
    let Some(elem) = element_slice(xml, b"sheetFormatPr", 0) else {
        return SheetFormatPrParsed {
            default_row_height: None,
            default_col_width: None,
            base_col_width: None,
            default_row_descent: None,
            outline_level_row: None,
            outline_level_col: None,
            custom_height: false,
            zero_height: false,
            thick_top: false,
            thick_bottom: false,
        };
    };

    SheetFormatPrParsed {
        default_row_height: attr_parse(elem, b"defaultRowHeight=\""),
        default_col_width: attr_parse(elem, b"defaultColWidth=\""),
        base_col_width: attr_parse(elem, b"baseColWidth=\""),
        default_row_descent: attr_parse(elem, b"x14ac:dyDescent=\"")
            .or_else(|| attr_parse(elem, b"dyDescent=\"")),
        outline_level_row: attr_parse(elem, b"outlineLevelRow=\""),
        outline_level_col: attr_parse(elem, b"outlineLevelCol=\""),
        custom_height: find_attr_simd(elem, b"customHeight=\"1\"", 0).is_some()
            || find_attr_simd(elem, b"customHeight=\"true\"", 0).is_some(),
        zero_height: find_attr_simd(elem, b"zeroHeight=\"1\"", 0).is_some()
            || find_attr_simd(elem, b"zeroHeight=\"true\"", 0).is_some(),
        thick_top: find_attr_simd(elem, b"thickTop=\"1\"", 0).is_some()
            || find_attr_simd(elem, b"thickTop=\"true\"", 0).is_some(),
        thick_bottom: find_attr_simd(elem, b"thickBottom=\"1\"", 0).is_some()
            || find_attr_simd(elem, b"thickBottom=\"true\"", 0).is_some(),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn worksheet_dimension_ref_accepts_single_cell_and_range() {
        assert_eq!(parse_dimension_ref_value("A1"), Some((0, 0, 0, 0)));
        assert_eq!(parse_dimension_ref_value("$B$2:$D$5"), Some((1, 1, 4, 3)));
    }

    #[test]
    fn worksheet_dimension_ref_rejects_malformed_multi_and_reversed_ranges() {
        assert_eq!(parse_dimension_ref_value("A1,C3"), None);
        assert_eq!(parse_dimension_ref_value("not-a-ref"), None);
        assert_eq!(parse_dimension_ref_value("D5:B2"), None);
    }
}
