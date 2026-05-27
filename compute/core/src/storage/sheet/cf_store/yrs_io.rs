use compute_document::schema::KEY_CONDITIONAL_FORMAT;
use domain_types::domain::conditional_format::ConditionalFormat;
use domain_types::yrs_schema::conditional_format as cf_yrs;
use yrs::{Array, Map, MapPrelim, MapRef, Out};

/// Key for the rules Y.Array within a CF Y.Map entry.
pub(super) const KEY_CF_ENTRY_RULES: &str = "rules";

// =============================================================================
// Internal Helpers
// =============================================================================

pub(super) fn get_cf_map<T: yrs::ReadTxn>(
    txn: &T,
    sheets_root: &MapRef,
    sheet_hex: &str,
) -> Option<MapRef> {
    let sheet_map = match sheets_root.get(txn, sheet_hex) {
        Some(Out::YMap(m)) => m,
        _ => return None,
    };
    match sheet_map.get(txn, KEY_CONDITIONAL_FORMAT) {
        Some(Out::YMap(m)) => Some(m),
        _ => None,
    }
}

// =============================================================================
// Structured Y.Map Read: ConditionalFormat (delegates to unified yrs_schema)
// =============================================================================

/// Read a ConditionalFormat from a Y.Map entry in the CF map.
pub(super) fn read_cf_from_yrs_map<T: yrs::ReadTxn>(
    map: &MapRef,
    txn: &T,
) -> Option<ConditionalFormat> {
    let mut cf = cf_yrs::cf_from_yrs_map(map, txn)?;

    // Read rules from Y.Array
    if let Some(Out::YArray(rules_arr)) = map.get(txn, KEY_CF_ENTRY_RULES) {
        for out in rules_arr.iter(txn) {
            if let Out::YMap(rule_map) = out
                && let Some(rule) = cf_yrs::rule_from_yrs_map(&rule_map, txn)
            {
                cf.rules.push(rule);
            }
        }
    }

    Some(cf)
}

// =============================================================================
// Structured Y.Map Write (delegates to unified yrs_schema)
// =============================================================================

/// Write a ConditionalFormat as a structured Y.Map into the CF map.
pub(super) fn write_cf_to_yrs(
    txn: &mut yrs::TransactionMut,
    cf_map: &MapRef,
    format: &ConditionalFormat,
) {
    let entries = cf_yrs::cf_to_yrs_prelim(format);
    let cf_prelim: MapPrelim = entries.into_iter().collect();
    let cf_entry: MapRef = cf_map.insert(txn, &*format.id, cf_prelim);

    // Write rules as a Y.Array of Y.Maps
    let rules_arr = cf_entry.insert(txn, KEY_CF_ENTRY_RULES, yrs::ArrayPrelim::default());
    for rule in &format.rules {
        let rule_entries = cf_yrs::rule_to_yrs_prelim(rule);
        let rule_prelim: MapPrelim = rule_entries.into_iter().collect();
        rules_arr.push_back(txn, rule_prelim);
    }
}
