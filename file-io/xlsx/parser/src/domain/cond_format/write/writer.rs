//! Conditional Formatting Writer implementation.
//!
//! This module contains the main CfWriter struct that provides methods for
//! adding conditional formatting rules and writing them to XML.

use super::rules::{RuleWriter, RuleWriterImpl};
use super::types::*;
use crate::write::xml_writer::XmlWriter;

// =============================================================================
// CF Writer
// =============================================================================

/// Conditional Formatting Writer
///
/// Generates conditional formatting rules within worksheet XML.
#[derive(Debug, Clone, Default)]
pub struct CfWriter {
    blocks: Vec<ConditionalFormatting>,
    next_priority: i32,
}

impl CfWriter {
    /// Create a new conditional formatting writer
    pub fn new() -> Self {
        Self {
            blocks: Vec::new(),
            next_priority: 1,
        }
    }

    /// Add a conditional formatting block
    pub fn add(&mut self, cf: ConditionalFormatting) -> &mut Self {
        self.blocks.push(cf);
        self
    }

    /// Add cell value rule (convenience)
    pub fn add_cell_is(
        &mut self,
        range: &str,
        operator: CfOperator,
        value: &str,
        style: CfStyle,
    ) -> &mut Self {
        let priority = self.next_priority;
        self.next_priority += 1;

        let rule = CfRule {
            rule_kind: CfRuleKind::CellIs(CellIsRule {
                operator,
                value1: value.to_string(),
                value2: None,
                style,
            }),
            priority,
            stop_if_true: false,
        };

        // Find or create block for this range
        if let Some(block) = self.blocks.iter_mut().find(|b| b.sqref == range) {
            block.rules.push(rule);
        } else {
            let mut block = ConditionalFormatting::new(range);
            block.rules.push(rule);
            self.blocks.push(block);
        }

        self
    }

    /// Add cell value between rule (convenience)
    pub fn add_cell_is_between(
        &mut self,
        range: &str,
        value1: &str,
        value2: &str,
        style: CfStyle,
    ) -> &mut Self {
        let priority = self.next_priority;
        self.next_priority += 1;

        let rule = CfRule {
            rule_kind: CfRuleKind::CellIs(CellIsRule {
                operator: CfOperator::Between,
                value1: value1.to_string(),
                value2: Some(value2.to_string()),
                style,
            }),
            priority,
            stop_if_true: false,
        };

        if let Some(block) = self.blocks.iter_mut().find(|b| b.sqref == range) {
            block.rules.push(rule);
        } else {
            let mut block = ConditionalFormatting::new(range);
            block.rules.push(rule);
            self.blocks.push(block);
        }

        self
    }

    /// Add color scale (2-color)
    pub fn add_color_scale_2(
        &mut self,
        range: &str,
        min_color: &str,
        max_color: &str,
    ) -> &mut Self {
        let priority = self.next_priority;
        self.next_priority += 1;

        let rule = CfRule {
            rule_kind: CfRuleKind::ColorScale(ColorScaleRule {
                min: CfValueObject::min(min_color),
                mid: None,
                max: CfValueObject::max(max_color),
            }),
            priority,
            stop_if_true: false,
        };

        if let Some(block) = self.blocks.iter_mut().find(|b| b.sqref == range) {
            block.rules.push(rule);
        } else {
            let mut block = ConditionalFormatting::new(range);
            block.rules.push(rule);
            self.blocks.push(block);
        }

        self
    }

    /// Add color scale (3-color)
    pub fn add_color_scale_3(
        &mut self,
        range: &str,
        min_color: &str,
        mid_color: &str,
        max_color: &str,
    ) -> &mut Self {
        let priority = self.next_priority;
        self.next_priority += 1;

        let rule = CfRule {
            rule_kind: CfRuleKind::ColorScale(ColorScaleRule {
                min: CfValueObject::min(min_color),
                mid: Some(CfValueObject::percentile(50, mid_color)),
                max: CfValueObject::max(max_color),
            }),
            priority,
            stop_if_true: false,
        };

        if let Some(block) = self.blocks.iter_mut().find(|b| b.sqref == range) {
            block.rules.push(rule);
        } else {
            let mut block = ConditionalFormatting::new(range);
            block.rules.push(rule);
            self.blocks.push(block);
        }

        self
    }

    /// Add data bar
    pub fn add_data_bar(&mut self, range: &str, color: &str) -> &mut Self {
        let priority = self.next_priority;
        self.next_priority += 1;

        let rule = CfRule {
            rule_kind: CfRuleKind::DataBar(DataBarRule::simple(color)),
            priority,
            stop_if_true: false,
        };

        if let Some(block) = self.blocks.iter_mut().find(|b| b.sqref == range) {
            block.rules.push(rule);
        } else {
            let mut block = ConditionalFormatting::new(range);
            block.rules.push(rule);
            self.blocks.push(block);
        }

        self
    }

    /// Add icon set
    pub fn add_icon_set(&mut self, range: &str, icon_set: IconSetType) -> &mut Self {
        let priority = self.next_priority;
        self.next_priority += 1;

        let rule = CfRule {
            rule_kind: CfRuleKind::IconSet(IconSetRule::new(icon_set)),
            priority,
            stop_if_true: false,
        };

        if let Some(block) = self.blocks.iter_mut().find(|b| b.sqref == range) {
            block.rules.push(rule);
        } else {
            let mut block = ConditionalFormatting::new(range);
            block.rules.push(rule);
            self.blocks.push(block);
        }

        self
    }

    /// Add top N rule
    pub fn add_top_n(&mut self, range: &str, n: u32, style: CfStyle) -> &mut Self {
        let priority = self.next_priority;
        self.next_priority += 1;

        let rule = CfRule {
            rule_kind: CfRuleKind::Top10(Top10Rule {
                top: true,
                percent: false,
                rank: n,
                style,
            }),
            priority,
            stop_if_true: false,
        };

        if let Some(block) = self.blocks.iter_mut().find(|b| b.sqref == range) {
            block.rules.push(rule);
        } else {
            let mut block = ConditionalFormatting::new(range);
            block.rules.push(rule);
            self.blocks.push(block);
        }

        self
    }

    /// Add bottom N rule
    pub fn add_bottom_n(&mut self, range: &str, n: u32, style: CfStyle) -> &mut Self {
        let priority = self.next_priority;
        self.next_priority += 1;

        let rule = CfRule {
            rule_kind: CfRuleKind::Top10(Top10Rule {
                top: false,
                percent: false,
                rank: n,
                style,
            }),
            priority,
            stop_if_true: false,
        };

        if let Some(block) = self.blocks.iter_mut().find(|b| b.sqref == range) {
            block.rules.push(rule);
        } else {
            let mut block = ConditionalFormatting::new(range);
            block.rules.push(rule);
            self.blocks.push(block);
        }

        self
    }

    /// Add top N percent rule
    pub fn add_top_percent(&mut self, range: &str, percent: u32, style: CfStyle) -> &mut Self {
        let priority = self.next_priority;
        self.next_priority += 1;

        let rule = CfRule {
            rule_kind: CfRuleKind::Top10(Top10Rule {
                top: true,
                percent: true,
                rank: percent,
                style,
            }),
            priority,
            stop_if_true: false,
        };

        if let Some(block) = self.blocks.iter_mut().find(|b| b.sqref == range) {
            block.rules.push(rule);
        } else {
            let mut block = ConditionalFormatting::new(range);
            block.rules.push(rule);
            self.blocks.push(block);
        }

        self
    }

    /// Add bottom N percent rule
    pub fn add_bottom_percent(&mut self, range: &str, percent: u32, style: CfStyle) -> &mut Self {
        let priority = self.next_priority;
        self.next_priority += 1;

        let rule = CfRule {
            rule_kind: CfRuleKind::Top10(Top10Rule {
                top: false,
                percent: true,
                rank: percent,
                style,
            }),
            priority,
            stop_if_true: false,
        };

        if let Some(block) = self.blocks.iter_mut().find(|b| b.sqref == range) {
            block.rules.push(rule);
        } else {
            let mut block = ConditionalFormatting::new(range);
            block.rules.push(rule);
            self.blocks.push(block);
        }

        self
    }

    /// Add formula-based rule
    ///
    /// Note: The style parameter should contain a dxf_id referencing a
    /// differential format in styles.xml for proper styling.
    pub fn add_formula(&mut self, range: &str, formula: &str, style: CfStyle) -> &mut Self {
        let priority = self.next_priority;
        self.next_priority += 1;

        let rule = CfRule {
            rule_kind: CfRuleKind::Expression(formula.to_string()),
            priority,
            stop_if_true: false,
        };

        // Note: For expression rules, style is applied via dxf_id in styles.xml
        let _ = style; // Style should be registered separately in styles.xml

        if let Some(block) = self.blocks.iter_mut().find(|b| b.sqref == range) {
            block.rules.push(rule);
        } else {
            let mut block = ConditionalFormatting::new(range);
            block.rules.push(rule);
            self.blocks.push(block);
        }

        self
    }

    /// Add above average rule
    pub fn add_above_average(&mut self, range: &str, style: CfStyle) -> &mut Self {
        let priority = self.next_priority;
        self.next_priority += 1;

        let rule = CfRule {
            rule_kind: CfRuleKind::AboveAverage(AboveAverageRule {
                above_average: true,
                equal_average: false,
                std_dev: None,
                style,
            }),
            priority,
            stop_if_true: false,
        };

        if let Some(block) = self.blocks.iter_mut().find(|b| b.sqref == range) {
            block.rules.push(rule);
        } else {
            let mut block = ConditionalFormatting::new(range);
            block.rules.push(rule);
            self.blocks.push(block);
        }

        self
    }

    /// Add below average rule
    pub fn add_below_average(&mut self, range: &str, style: CfStyle) -> &mut Self {
        let priority = self.next_priority;
        self.next_priority += 1;

        let rule = CfRule {
            rule_kind: CfRuleKind::AboveAverage(AboveAverageRule {
                above_average: false,
                equal_average: false,
                std_dev: None,
                style,
            }),
            priority,
            stop_if_true: false,
        };

        if let Some(block) = self.blocks.iter_mut().find(|b| b.sqref == range) {
            block.rules.push(rule);
        } else {
            let mut block = ConditionalFormatting::new(range);
            block.rules.push(rule);
            self.blocks.push(block);
        }

        self
    }

    /// Add contains text rule
    pub fn add_contains_text(&mut self, range: &str, text: &str, style: CfStyle) -> &mut Self {
        let priority = self.next_priority;
        self.next_priority += 1;

        let rule = CfRule {
            rule_kind: CfRuleKind::ContainsText(TextRule {
                text: text.to_string(),
                style,
            }),
            priority,
            stop_if_true: false,
        };

        if let Some(block) = self.blocks.iter_mut().find(|b| b.sqref == range) {
            block.rules.push(rule);
        } else {
            let mut block = ConditionalFormatting::new(range);
            block.rules.push(rule);
            self.blocks.push(block);
        }

        self
    }

    /// Add begins with text rule
    pub fn add_begins_with(&mut self, range: &str, text: &str, style: CfStyle) -> &mut Self {
        let priority = self.next_priority;
        self.next_priority += 1;

        let rule = CfRule {
            rule_kind: CfRuleKind::BeginsWith(TextRule {
                text: text.to_string(),
                style,
            }),
            priority,
            stop_if_true: false,
        };

        if let Some(block) = self.blocks.iter_mut().find(|b| b.sqref == range) {
            block.rules.push(rule);
        } else {
            let mut block = ConditionalFormatting::new(range);
            block.rules.push(rule);
            self.blocks.push(block);
        }

        self
    }

    /// Add ends with text rule
    pub fn add_ends_with(&mut self, range: &str, text: &str, style: CfStyle) -> &mut Self {
        let priority = self.next_priority;
        self.next_priority += 1;

        let rule = CfRule {
            rule_kind: CfRuleKind::EndsWith(TextRule {
                text: text.to_string(),
                style,
            }),
            priority,
            stop_if_true: false,
        };

        if let Some(block) = self.blocks.iter_mut().find(|b| b.sqref == range) {
            block.rules.push(rule);
        } else {
            let mut block = ConditionalFormatting::new(range);
            block.rules.push(rule);
            self.blocks.push(block);
        }

        self
    }

    /// Add duplicate values rule
    pub fn add_duplicate_values(&mut self, range: &str, style: CfStyle) -> &mut Self {
        let priority = self.next_priority;
        self.next_priority += 1;

        let rule = CfRule {
            rule_kind: CfRuleKind::DuplicateValues,
            priority,
            stop_if_true: false,
        };

        let _ = style; // Style should be applied via dxf_id

        if let Some(block) = self.blocks.iter_mut().find(|b| b.sqref == range) {
            block.rules.push(rule);
        } else {
            let mut block = ConditionalFormatting::new(range);
            block.rules.push(rule);
            self.blocks.push(block);
        }

        self
    }

    /// Add unique values rule
    pub fn add_unique_values(&mut self, range: &str, style: CfStyle) -> &mut Self {
        let priority = self.next_priority;
        self.next_priority += 1;

        let rule = CfRule {
            rule_kind: CfRuleKind::UniqueValues,
            priority,
            stop_if_true: false,
        };

        let _ = style; // Style should be applied via dxf_id

        if let Some(block) = self.blocks.iter_mut().find(|b| b.sqref == range) {
            block.rules.push(rule);
        } else {
            let mut block = ConditionalFormatting::new(range);
            block.rules.push(rule);
            self.blocks.push(block);
        }

        self
    }

    /// Add time period rule
    pub fn add_time_period(
        &mut self,
        range: &str,
        period: CfTimePeriod,
        style: CfStyle,
    ) -> &mut Self {
        let priority = self.next_priority;
        self.next_priority += 1;

        let rule = CfRule {
            rule_kind: CfRuleKind::TimePeriod(period),
            priority,
            stop_if_true: false,
        };

        let _ = style; // Style should be applied via dxf_id

        if let Some(block) = self.blocks.iter_mut().find(|b| b.sqref == range) {
            block.rules.push(rule);
        } else {
            let mut block = ConditionalFormatting::new(range);
            block.rules.push(rule);
            self.blocks.push(block);
        }

        self
    }

    /// Add contains blanks rule
    pub fn add_contains_blanks(&mut self, range: &str, style: CfStyle) -> &mut Self {
        let priority = self.next_priority;
        self.next_priority += 1;

        let rule = CfRule {
            rule_kind: CfRuleKind::ContainsBlanks,
            priority,
            stop_if_true: false,
        };

        let _ = style; // Style should be applied via dxf_id

        if let Some(block) = self.blocks.iter_mut().find(|b| b.sqref == range) {
            block.rules.push(rule);
        } else {
            let mut block = ConditionalFormatting::new(range);
            block.rules.push(rule);
            self.blocks.push(block);
        }

        self
    }

    /// Add contains errors rule
    pub fn add_contains_errors(&mut self, range: &str, style: CfStyle) -> &mut Self {
        let priority = self.next_priority;
        self.next_priority += 1;

        let rule = CfRule {
            rule_kind: CfRuleKind::ContainsErrors,
            priority,
            stop_if_true: false,
        };

        let _ = style; // Style should be applied via dxf_id

        if let Some(block) = self.blocks.iter_mut().find(|b| b.sqref == range) {
            block.rules.push(rule);
        } else {
            let mut block = ConditionalFormatting::new(range);
            block.rules.push(rule);
            self.blocks.push(block);
        }

        self
    }

    /// Write CF elements to existing XmlWriter
    pub fn write_to(&self, writer: &mut XmlWriter) {
        for block in &self.blocks {
            self.write_block(writer, block);
        }
    }

    /// Write a single conditional formatting block
    fn write_block(&self, writer: &mut XmlWriter, block: &ConditionalFormatting) {
        writer
            .start_element("conditionalFormatting")
            .attr("sqref", &block.sqref)
            .end_attrs();

        for rule in &block.rules {
            self.write_rule(writer, rule);
        }

        writer.end_element("conditionalFormatting");
    }

    /// Write a single CF rule
    fn write_rule(&self, writer: &mut XmlWriter, rule: &CfRule) {
        let rule_writer = RuleWriterImpl;

        match &rule.rule_kind {
            CfRuleKind::CellIs(cell_is) => {
                rule_writer.write_cell_is_rule(writer, rule.priority, rule.stop_if_true, cell_is);
            }
            CfRuleKind::ColorScale(color_scale) => {
                rule_writer.write_color_scale_rule(writer, rule.priority, color_scale);
            }
            CfRuleKind::DataBar(data_bar) => {
                rule_writer.write_data_bar_rule(writer, rule.priority, data_bar);
            }
            CfRuleKind::IconSet(icon_set) => {
                rule_writer.write_icon_set_rule(writer, rule.priority, icon_set);
            }
            CfRuleKind::Top10(top10) => {
                rule_writer.write_top10_rule(writer, rule.priority, rule.stop_if_true, top10);
            }
            CfRuleKind::AboveAverage(above_avg) => {
                rule_writer.write_above_average_rule(
                    writer,
                    rule.priority,
                    rule.stop_if_true,
                    above_avg,
                );
            }
            CfRuleKind::Expression(formula) => {
                rule_writer.write_expression_rule(
                    writer,
                    rule.priority,
                    rule.stop_if_true,
                    formula,
                );
            }
            CfRuleKind::ContainsText(text_rule) => {
                rule_writer.write_text_rule(writer, "containsText", rule.priority, text_rule);
            }
            CfRuleKind::NotContainsText(text_rule) => {
                rule_writer.write_text_rule(writer, "notContainsText", rule.priority, text_rule);
            }
            CfRuleKind::BeginsWith(text_rule) => {
                rule_writer.write_text_rule(writer, "beginsWith", rule.priority, text_rule);
            }
            CfRuleKind::EndsWith(text_rule) => {
                rule_writer.write_text_rule(writer, "endsWith", rule.priority, text_rule);
            }
            CfRuleKind::ContainsBlanks => {
                rule_writer.write_simple_rule(writer, "containsBlanks", rule.priority);
            }
            CfRuleKind::NotContainsBlanks => {
                rule_writer.write_simple_rule(writer, "notContainsBlanks", rule.priority);
            }
            CfRuleKind::ContainsErrors => {
                rule_writer.write_simple_rule(writer, "containsErrors", rule.priority);
            }
            CfRuleKind::NotContainsErrors => {
                rule_writer.write_simple_rule(writer, "notContainsErrors", rule.priority);
            }
            CfRuleKind::TimePeriod(period) => {
                rule_writer.write_time_period_rule(writer, rule.priority, *period);
            }
            CfRuleKind::DuplicateValues => {
                rule_writer.write_simple_rule(writer, "duplicateValues", rule.priority);
            }
            CfRuleKind::UniqueValues => {
                rule_writer.write_simple_rule(writer, "uniqueValues", rule.priority);
            }
        }
    }

    /// Check if any rules exist
    pub fn is_empty(&self) -> bool {
        self.blocks.is_empty() || self.blocks.iter().all(|b| b.rules.is_empty())
    }

    /// Get the number of formatting blocks
    pub fn len(&self) -> usize {
        self.blocks.len()
    }

    /// Get total number of rules across all blocks
    pub fn rule_count(&self) -> usize {
        self.blocks.iter().map(|b| b.rules.len()).sum()
    }
}
