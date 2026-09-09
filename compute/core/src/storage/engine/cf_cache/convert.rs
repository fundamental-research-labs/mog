use std::collections::HashMap;

use super::ranges::resolve_format_ranges;
use super::rule_wire::domain_rule_to_wire;
use crate::cf::types::CFRule;
use cell_types::SheetId;
use domain_types::domain::conditional_format::ConditionalFormat;

/// Convert domain `ConditionalFormat` list to compute-cf `CFRule` list.
///
/// Attaches each format's native sheet ranges to its evaluation rules.
/// Conversion failures are reported and omitted from the cache.
pub(crate) fn convert_cf_formats_to_rules(
    formats: &[ConditionalFormat],
    fallback_sheet_id: Option<SheetId>,
    theme_palette: &HashMap<String, String>,
) -> Vec<CFRule> {
    let mut result = Vec::new();

    for format in formats {
        let Some(ranges) = resolve_format_ranges(format, fallback_sheet_id) else {
            continue;
        };

        for rule in &format.rules {
            let wire = domain_rule_to_wire(rule, ranges.clone(), theme_palette);
            match CFRule::try_from(wire) {
                Ok(cf_rule) => result.push(cf_rule),
                Err(e) => {
                    tracing::warn!(
                        "Failed to convert CF rule {} in format {}: {}",
                        rule.id(),
                        format.id,
                        e
                    );
                }
            }
        }
    }

    result
}
