use crate::snapshot::CalculationSettings;
use crate::storage::workbook::WorkbookMetadata;

pub fn get_calculation_settings(metadata: &WorkbookMetadata) -> CalculationSettings {
    metadata
        .settings
        .calculation_settings
        .clone()
        .unwrap_or_default()
}

pub fn is_iterative_calculation_enabled(metadata: &WorkbookMetadata) -> bool {
    metadata
        .settings
        .calculation_settings
        .as_ref()
        .is_some_and(|s| s.enable_iterative_calculation)
}

pub fn set_calculation_settings(metadata: &mut WorkbookMetadata, settings: &CalculationSettings) {
    metadata.settings.calculation_settings = Some(settings.clone());
}

pub fn set_iterative_calculation_enabled(metadata: &mut WorkbookMetadata, enabled: bool) {
    metadata
        .settings
        .calculation_settings
        .get_or_insert_with(Default::default)
        .enable_iterative_calculation = enabled;
}
#[cfg(test)]
mod tests {
    use super::*;
    use crate::storage::workbook::WorkbookMetadata;

    #[test]
    fn test_calculation_settings() {
        let mut metadata = WorkbookMetadata::default();

        // Default: iterative calc disabled
        let calc = get_calculation_settings(&metadata);
        assert!(!calc.enable_iterative_calculation);
        assert_eq!(calc.max_iterations, 100);
        assert!((calc.max_change.get() - 0.001).abs() < f64::EPSILON);

        assert!(!is_iterative_calculation_enabled(&metadata));

        // Enable iterative calc
        set_iterative_calculation_enabled(&mut metadata, true);

        assert!(is_iterative_calculation_enabled(&metadata));

        // Set full calculation settings
        let new_calc = CalculationSettings {
            enable_iterative_calculation: true,
            max_iterations: 500,
            max_change: value_types::FiniteF64::must(0.0001),
            ..Default::default()
        };
        set_calculation_settings(&mut metadata, &new_calc);

        let calc = get_calculation_settings(&metadata);
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
