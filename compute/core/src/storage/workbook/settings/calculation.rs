use yrs::{Doc, MapRef};

use crate::snapshot::CalculationSettings;

use super::read::get_settings;
use super::write::set_setting;

pub fn get_calculation_settings(doc: &Doc, workbook: &MapRef) -> CalculationSettings {
    let settings = get_settings(doc, workbook);
    settings.calculation_settings.unwrap_or_default()
}

/// Check if iterative calculation is enabled.
pub fn is_iterative_calculation_enabled(doc: &Doc, workbook: &MapRef) -> bool {
    get_calculation_settings(doc, workbook).enable_iterative_calculation
}

/// Set calculation settings (merges with current values).
///
/// Serializes to a JSON object and stores via `json_to_any`, which converts to
/// a structured `Any::Map` instead of a JSON string.
pub fn set_calculation_settings(doc: &Doc, workbook: &MapRef, updates: &CalculationSettings) {
    let json_val =
        serde_json::to_value(updates).expect("CalculationSettings serialization should not fail");
    set_setting(doc, workbook, "calculationSettings", json_val);
}

/// Enable or disable iterative calculation.
pub fn set_iterative_calculation_enabled(doc: &Doc, workbook: &MapRef, enabled: bool) {
    let mut current = get_calculation_settings(doc, workbook);
    current.enable_iterative_calculation = enabled;
    set_calculation_settings(doc, workbook, &current);
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::storage::YrsStorage;

    #[test]
    fn test_calculation_settings() {
        let storage = YrsStorage::new();

        // Default: iterative calc disabled
        let calc = get_calculation_settings(storage.doc(), storage.workbook_map());
        assert!(!calc.enable_iterative_calculation);
        assert_eq!(calc.max_iterations, 100);
        assert!((calc.max_change.get() - 0.001).abs() < f64::EPSILON);

        assert!(!is_iterative_calculation_enabled(
            storage.doc(),
            storage.workbook_map()
        ));

        // Enable iterative calc
        set_iterative_calculation_enabled(storage.doc(), storage.workbook_map(), true);

        assert!(is_iterative_calculation_enabled(
            storage.doc(),
            storage.workbook_map()
        ));

        // Set full calculation settings
        let new_calc = CalculationSettings {
            enable_iterative_calculation: true,
            max_iterations: 500,
            max_change: value_types::FiniteF64::must(0.0001),
            ..Default::default()
        };
        set_calculation_settings(storage.doc(), storage.workbook_map(), &new_calc);

        let calc = get_calculation_settings(storage.doc(), storage.workbook_map());
        assert!(calc.enable_iterative_calculation);
        assert_eq!(calc.max_iterations, 500);
        assert!((calc.max_change.get() - 0.0001).abs() < f64::EPSILON);
    }

    // -------------------------------------------------------------------
    // Test 13: Default table style ID
    // -------------------------------------------------------------------
    #[test]
    fn test_calculation_settings_serde_roundtrip() {
        let calc = CalculationSettings {
            enable_iterative_calculation: true,
            max_iterations: 500,
            max_change: value_types::FiniteF64::must(0.0001),
            ..Default::default()
        };

        let json = serde_json::to_string(&calc).unwrap();
        let deserialized: CalculationSettings = serde_json::from_str(&json).unwrap();
        assert_eq!(calc, deserialized);
    }

    // -------------------------------------------------------------------
    // Test 21: CalculationSettings default serde
    // -------------------------------------------------------------------

    #[test]
    fn test_calculation_settings_default_serde() {
        let json = "{}";
        let calc: CalculationSettings = serde_json::from_str(json).unwrap();
        assert!(!calc.enable_iterative_calculation);
        assert_eq!(calc.max_iterations, 100);
        assert!((calc.max_change.get() - 0.001).abs() < f64::EPSILON);
    }

    // -------------------------------------------------------------------
    // Test 22: WorkbookProtectionOptions serde roundtrip
    // -------------------------------------------------------------------
}
