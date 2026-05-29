//! Domain coordinator: parse conditional formats from worksheet XML.

use crate::domain::cond_format::{
    parse_conditional_formatting_element, parse_conditional_formatting_x14,
};
use crate::infra::scanner::{self, find_gt_simd, find_tag_simd};
use crate::output::results::CfSummary;
use ooxml_types::cond_format::{
    CfRule, CfRuleType, CfRuleX14, ConditionalFormatting, ConditionalFormattingX14,
};

/// Parse conditional formats from worksheet XML.
///
/// Finds all `<conditionalFormatting>` elements and returns a pair:
/// - `Vec<CfSummary>`: lightweight summaries (sqref, pivot flag, rules count) for JSON/WASM
/// - `Vec<ConditionalFormatting>`: full parsed rules for domain conversion
///
/// # Arguments
/// * `xml` - The worksheet XML bytes
pub fn parse_conditional_formats(xml: &[u8]) -> (Vec<CfSummary>, Vec<ConditionalFormatting>) {
    let mut summaries = Vec::new();
    let mut full = Vec::new();
    let mut pos = 0;

    while let Some(cf_start) = find_tag_simd(xml, b"conditionalFormatting", pos) {
        // Skip namespace-prefixed variants (e.g. <x14:conditionalFormatting>).
        // find_tag_simd returns the position of '<', so tag name starts at cf_start+1.
        let after_lt = cf_start + 1;
        let is_unprefixed = after_lt + b"conditionalFormatting".len() <= xml.len()
            && xml[after_lt..].starts_with(b"conditionalFormatting");

        let cf_end =
            scanner::find_closing_tag(xml, b"conditionalFormatting", cf_start).unwrap_or(xml.len());

        if !is_unprefixed {
            pos = find_gt_simd(xml, cf_end)
                .map(|gt| gt + 1)
                .unwrap_or(cf_end + 1);
            continue;
        }

        let cf_xml = &xml[cf_start..cf_end + 25]; // Include closing tag

        let cf = parse_conditional_formatting_element(cf_xml);
        summaries.push(CfSummary {
            sqref: cf.sqref.clone(),
            pivot: cf.pivot,
            rules_count: cf.rules.len(),
        });
        full.push(cf);

        pos = cf_end + 1;
    }

    merge_x14_conditional_formatting(&mut full, parse_conditional_formatting_x14(xml));
    summaries = full
        .iter()
        .map(|cf| CfSummary {
            sqref: cf.sqref.clone(),
            pivot: cf.pivot,
            rules_count: cf.rules.len(),
        })
        .collect();

    (summaries, full)
}

fn merge_x14_conditional_formatting(
    base: &mut Vec<ConditionalFormatting>,
    x14_blocks: Vec<ConditionalFormattingX14>,
) {
    for x14_block in x14_blocks {
        let mut standalone_rules = Vec::new();
        for x14_rule in x14_block.rules {
            if !apply_x14_rule_to_base(base, &x14_rule) {
                if standalone_x14_rule_has_classic_model(&x14_rule) {
                    standalone_rules.push(cf_rule_from_x14(x14_rule));
                }
            }
        }
        if !standalone_rules.is_empty() {
            base.push(ConditionalFormatting {
                sqref: x14_block.sqref,
                pivot: false,
                rules: standalone_rules,
            });
        }
    }
}

fn apply_x14_rule_to_base(base: &mut [ConditionalFormatting], x14_rule: &CfRuleX14) -> bool {
    if x14_rule.id.is_empty() {
        return false;
    }
    for cf in base {
        for rule in &mut cf.rules {
            if rule.ext_id.as_deref() == Some(x14_rule.id.as_str()) {
                overlay_x14_rule(rule, x14_rule);
                return true;
            }
        }
    }
    false
}

fn standalone_x14_rule_has_classic_model(x14_rule: &CfRuleX14) -> bool {
    match x14_rule.rule_type {
        CfRuleType::ColorScale => x14_rule.color_scale.is_some(),
        CfRuleType::DataBar => x14_rule.data_bar.is_some(),
        CfRuleType::IconSet => x14_rule.icon_set.is_some(),
        _ => false,
    }
}

fn overlay_x14_rule(rule: &mut CfRule, x14_rule: &CfRuleX14) {
    rule.rule_type = x14_rule.rule_type;
    if x14_rule.priority != 0 {
        rule.priority = x14_rule.priority;
    }
    if x14_rule.dxf_id.is_some() {
        rule.dxf_id = x14_rule.dxf_id;
    }
    if x14_rule.color_scale.is_some() {
        rule.color_scale = x14_rule.color_scale.clone();
    }
    if let Some(x14_data_bar) = &x14_rule.data_bar {
        if let Some(base_data_bar) = &mut rule.data_bar {
            overlay_x14_data_bar(base_data_bar, x14_data_bar);
        } else {
            rule.data_bar = Some(x14_data_bar.clone());
        }
    }
    if x14_rule.icon_set.is_some() {
        rule.icon_set = x14_rule.icon_set.clone();
    }
}

fn overlay_x14_data_bar(
    base: &mut ooxml_types::cond_format::DataBar,
    x14: &ooxml_types::cond_format::DataBar,
) {
    base.gradient = x14.gradient;
    base.gradient_attr_present = x14.gradient_attr_present;
    base.border = x14.border;
    base.border_attr_present = x14.border_attr_present;
    base.direction = x14.direction;
    base.direction_attr_present = x14.direction_attr_present;
    base.negative_bar_color_same_as_positive = x14.negative_bar_color_same_as_positive;
    base.negative_bar_color_same_as_positive_attr_present =
        x14.negative_bar_color_same_as_positive_attr_present;
    base.negative_bar_border_color_same_as_positive =
        x14.negative_bar_border_color_same_as_positive;
    base.negative_bar_border_color_same_as_positive_attr_present =
        x14.negative_bar_border_color_same_as_positive_attr_present;
    base.axis_position = x14.axis_position;
    base.axis_position_attr_present = x14.axis_position_attr_present;
    base.axis_color = x14.axis_color.clone();
    base.border_color = x14.border_color.clone();
    base.negative_fill_color = x14.negative_fill_color.clone();
    base.negative_border_color = x14.negative_border_color.clone();

    if !x14.cfvo.is_empty() {
        base.cfvo = x14.cfvo.clone();
    }
}

fn cf_rule_from_x14(x14_rule: CfRuleX14) -> CfRule {
    CfRule {
        rule_type: x14_rule.rule_type,
        priority: x14_rule.priority,
        dxf_id: x14_rule.dxf_id,
        color_scale: x14_rule.color_scale,
        data_bar: x14_rule.data_bar,
        icon_set: x14_rule.icon_set,
        ext_id: (!x14_rule.id.is_empty()).then_some(x14_rule.id),
        ..CfRule::default()
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_parse_conditional_formats() {
        let xml = br#"<worksheet><conditionalFormatting sqref="A1:B2"><cfRule type="cellIs"/></conditionalFormatting></worksheet>"#;
        let (summaries, full) = parse_conditional_formats(xml);
        assert_eq!(summaries.len(), 1);
        assert_eq!(summaries[0].sqref, "A1:B2");
        assert_eq!(summaries[0].rules_count, 1);
        assert_eq!(full.len(), 1);
        assert_eq!(full[0].sqref, "A1:B2");
        assert_eq!(full[0].rules.len(), 1);
    }

    #[test]
    fn standalone_x14_expression_is_not_promoted_to_blank_classic_cf() {
        let xml = br#"
        <worksheet xmlns:x14="http://schemas.microsoft.com/office/spreadsheetml/2009/9/main"
                   xmlns:xm="http://schemas.microsoft.com/office/excel/2006/main">
          <extLst>
            <ext uri="{CCE6A557-97BC-4B89-ADB6-D9C93CAAB3DF}">
              <x14:conditionalFormattings>
                <x14:conditionalFormatting>
                  <x14:cfRule type="expression" priority="91" id="{rule-1}">
                    <x14:dxf><fill><patternFill patternType="solid"/></fill></x14:dxf>
                    <xm:f>V2=Time_Capture!#REF!</xm:f>
                  </x14:cfRule>
                  <xm:sqref>V2 AF2</xm:sqref>
                </x14:conditionalFormatting>
              </x14:conditionalFormattings>
            </ext>
          </extLst>
        </worksheet>"#;

        let (summaries, full) = parse_conditional_formats(xml);

        assert!(
            summaries.is_empty(),
            "unsupported standalone x14 expression rules must remain extension-owned"
        );
        assert!(
            full.is_empty(),
            "parser must not synthesize a classic CF rule with blank formula/style"
        );
    }
}
