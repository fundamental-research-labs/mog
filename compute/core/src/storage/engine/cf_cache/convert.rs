use super::ranges::resolve_format_ranges;
use super::rule_wire::domain_rule_to_wire;
use crate::cf::types::CFRule;
use cell_types::SheetId;
use domain_types::domain::conditional_format::ConditionalFormat;

/// Convert domain `ConditionalFormat` list to compute-cf `CFRule` list.
///
/// For each `ConditionalFormat`:
///   - Primary: tries `range_identities` via the `resolve_cell_id` closure
///   - Fallback: converts position-based `ranges` field to `RangePos`
///   - For each rule in `format.rules`:
///     - Converts `domain::CFRule` -> `CFRuleWire` -> `CFRule`
///     - Attaches the resolved ranges
///   - Filters out conversion failures with warnings
///
/// The `resolve_cell_id` closure maps `(sheet_id_str, cell_id_str)` -> `(row, col)`.
/// Pass `|_, _| None` in contexts where CellMirror is unavailable.
pub(crate) fn convert_cf_formats_to_rules(
    formats: &[ConditionalFormat],
    resolve_cell_id: impl Fn(&str, &str) -> Option<(u32, u32)>,
    fallback_sheet_id: Option<SheetId>,
) -> Vec<CFRule> {
    let mut result = Vec::new();

    for format in formats {
        let Some(ranges) = resolve_format_ranges(format, &resolve_cell_id, fallback_sheet_id)
        else {
            continue;
        };

        for rule in &format.rules {
            let wire = domain_rule_to_wire(rule, ranges.clone());
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
