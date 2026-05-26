//! Comparison logic for fidelity testing
//!
//! This module provides functions to compare parsed XLSX data against Excel COM ground truth.
//! It includes tolerance handling for floating-point numbers and RGB colors.

use super::ground_truth::GroundTruthCell;

/// Result of comparing a single cell
#[derive(Debug, Clone)]
pub struct CellComparison {
    /// Cell address (e.g., "A1")
    pub address: String,

    /// List of property differences found
    pub differences: Vec<PropertyDifference>,
}

impl CellComparison {
    /// Create a new cell comparison
    pub fn new(address: String) -> Self {
        Self {
            address,
            differences: Vec::new(),
        }
    }

    /// Add a difference
    pub fn add_difference(&mut self, property: String, expected: String, actual: String) {
        self.differences.push(PropertyDifference {
            property,
            expected,
            actual,
        });
    }

    /// Check if this cell has any differences
    pub fn has_differences(&self) -> bool {
        !self.differences.is_empty()
    }

    /// Get number of differences
    pub fn difference_count(&self) -> usize {
        self.differences.len()
    }
}

/// A single property difference
#[derive(Debug, Clone)]
pub struct PropertyDifference {
    /// Property name (e.g., "font.bold", "text")
    pub property: String,

    /// Expected value from ground truth
    pub expected: String,

    /// Actual value from parser
    pub actual: String,
}

/// Compare text values (exact match)
///
/// # Arguments
/// * `expected` - Ground truth text
/// * `actual` - Parser output text
///
/// # Returns
/// `true` if texts match exactly
pub fn compare_text(expected: &str, actual: &str) -> bool {
    expected == actual
}

/// Compare formula strings with normalization
///
/// Formulas are compared case-insensitively and with whitespace normalized.
/// Both `None` values are considered equal.
///
/// # Arguments
/// * `expected` - Ground truth formula
/// * `actual` - Parser output formula
///
/// # Returns
/// `true` if formulas match after normalization
pub fn compare_formula(expected: Option<&str>, actual: Option<&str>) -> bool {
    match (expected, actual) {
        (None, None) => true,
        (Some(e), Some(a)) => normalize_formula(e) == normalize_formula(a),
        _ => false,
    }
}

/// Normalize formula for comparison
///
/// - Converts to uppercase
/// - Removes extra whitespace
/// - Trims leading/trailing whitespace
fn normalize_formula(formula: &str) -> String {
    formula
        .to_uppercase()
        .split_whitespace()
        .collect::<Vec<_>>()
        .join(" ")
}

/// Compare RGB color values with per-channel tolerance
///
/// Excel RGB colors are 24-bit integers (0xRRGGBB).
/// We allow ±1 difference per channel due to theme color rounding.
///
/// # Arguments
/// * `expected` - Ground truth color (0xRRGGBB)
/// * `actual` - Parser output color (0xRRGGBB)
///
/// # Returns
/// `true` if colors are within tolerance
pub fn compare_color(expected: i64, actual: i64) -> bool {
    const TOLERANCE: i64 = 1;

    // Extract RGB channels
    let expected_r = (expected >> 16) & 0xFF;
    let expected_g = (expected >> 8) & 0xFF;
    let expected_b = expected & 0xFF;

    let actual_r = (actual >> 16) & 0xFF;
    let actual_g = (actual >> 8) & 0xFF;
    let actual_b = actual & 0xFF;

    // Check each channel within tolerance
    (expected_r - actual_r).abs() <= TOLERANCE
        && (expected_g - actual_g).abs() <= TOLERANCE
        && (expected_b - actual_b).abs() <= TOLERANCE
}

/// Compare numeric values with tolerance
///
/// # Arguments
/// * `expected` - Ground truth number
/// * `actual` - Parser output number
/// * `tolerance` - Absolute tolerance for comparison
///
/// # Returns
/// `true` if numbers are within tolerance
pub fn compare_number(expected: f64, actual: f64, tolerance: f64) -> bool {
    (expected - actual).abs() <= tolerance
}

/// Compare integer values with tolerance
///
/// # Arguments
/// * `expected` - Ground truth integer
/// * `actual` - Parser output integer
/// * `tolerance` - Absolute tolerance for comparison
///
/// # Returns
/// `true` if integers are within tolerance
pub fn compare_integer(expected: i32, actual: i32, tolerance: i32) -> bool {
    (expected - actual).abs() <= tolerance
}

/// Compare boolean values
///
/// # Arguments
/// * `expected` - Ground truth boolean
/// * `actual` - Parser output boolean
///
/// # Returns
/// `true` if booleans match
pub fn compare_bool(expected: bool, actual: bool) -> bool {
    expected == actual
}

/// Compare optional values
///
/// # Arguments
/// * `expected` - Ground truth optional value
/// * `actual` - Parser output optional value
/// * `compare_fn` - Function to compare the inner values
///
/// # Returns
/// `true` if both are None or both are Some and inner values match
pub fn compare_option<T, F>(expected: Option<&T>, actual: Option<&T>, compare_fn: F) -> bool
where
    F: Fn(&T, &T) -> bool,
{
    match (expected, actual) {
        (None, None) => true,
        (Some(e), Some(a)) => compare_fn(e, a),
        _ => false,
    }
}

/// Placeholder for actual parser cell data
///
/// TODO: Replace with real parser output type when available
#[derive(Debug, Clone)]
pub struct ParsedCell {
    pub address: String,
    pub text: String,
    pub formula: Option<String>,
    // Add more fields as parser evolves
}

/// Compare a single cell between ground truth and parser output
///
/// This is a high-level comparison function that checks all relevant properties.
/// For now, it returns "NOT_IMPLEMENTED" for style properties since our parser
/// doesn't yet output resolved styles.
///
/// # Arguments
/// * `ground_truth` - Ground truth cell from COM extraction
/// * `parsed` - Parser output cell (or None if cell not found)
///
/// # Returns
/// `CellComparison` with list of differences
pub fn compare_cell(ground_truth: &GroundTruthCell, parsed: Option<&ParsedCell>) -> CellComparison {
    let mut comparison = CellComparison::new(ground_truth.address.clone());

    match parsed {
        None => {
            // Cell exists in ground truth but not in parser output
            comparison.add_difference(
                "cell_exists".to_string(),
                "true".to_string(),
                "false".to_string(),
            );
        }
        Some(parsed_cell) => {
            // Compare text
            if !compare_text(&ground_truth.text, &parsed_cell.text) {
                comparison.add_difference(
                    "text".to_string(),
                    ground_truth.text.clone(),
                    parsed_cell.text.clone(),
                );
            }

            // Compare formula
            let gt_formula = ground_truth.formula.as_deref();
            let parsed_formula = parsed_cell.formula.as_deref();
            if !compare_formula(gt_formula, parsed_formula) {
                comparison.add_difference(
                    "formula".to_string(),
                    gt_formula.unwrap_or("").to_string(),
                    parsed_formula.unwrap_or("").to_string(),
                );
            }

            // Style properties - mark as NOT_IMPLEMENTED for now
            // TODO: Implement style comparison when parser outputs resolved styles
            comparison.add_difference(
                "styles".to_string(),
                "RESOLVED_STYLES".to_string(),
                "NOT_IMPLEMENTED".to_string(),
            );
        }
    }

    comparison
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_compare_text() {
        assert!(compare_text("hello", "hello"));
        assert!(!compare_text("hello", "world"));
        assert!(!compare_text("Hello", "hello")); // Case sensitive
    }

    #[test]
    fn test_compare_formula() {
        // Both None
        assert!(compare_formula(None, None));

        // Exact match
        assert!(compare_formula(Some("=A1+B1"), Some("=A1+B1")));

        // Case insensitive
        assert!(compare_formula(Some("=SUM(A1:A10)"), Some("=sum(a1:a10)")));

        // Whitespace normalized (different amounts of whitespace)
        assert!(compare_formula(Some("=A1  +  B1"), Some("=A1 + B1")));

        // Same formula with/without spaces (these are different after normalization)
        assert!(!compare_formula(Some("=A1 + B1"), Some("=A1+B1")));
        assert!(compare_formula(Some("=A1+B1"), Some("=A1+B1")));

        // One None, one Some
        assert!(!compare_formula(None, Some("=A1")));
        assert!(!compare_formula(Some("=A1"), None));
    }

    #[test]
    fn test_compare_color() {
        // Exact match
        assert!(compare_color(0xFF0000, 0xFF0000)); // Red

        // Within tolerance (±1 per channel)
        assert!(compare_color(0xFF0000, 0xFE0000)); // R: 255 vs 254
        assert!(compare_color(0x00FF00, 0x00FE01)); // G: 255 vs 254, B: 0 vs 1

        // Outside tolerance
        assert!(!compare_color(0xFF0000, 0xFD0000)); // R: 255 vs 253 (diff = 2)

        // Black and white
        assert!(compare_color(0x000000, 0x000000)); // Black
        assert!(compare_color(0xFFFFFF, 0xFFFFFF)); // White
        assert!(compare_color(0xFFFFFF, 0xFEFEFE)); // Near white (within tolerance)
    }

    #[test]
    fn test_compare_number() {
        assert!(compare_number(1.0, 1.0, 0.01));
        assert!(compare_number(1.0, 1.005, 0.01));
        assert!(!compare_number(1.0, 1.02, 0.01));

        // Edge cases
        assert!(compare_number(0.0, 0.0, 0.0));
        assert!(compare_number(-1.0, -1.0, 0.01));
    }

    #[test]
    fn test_compare_integer() {
        assert!(compare_integer(10, 10, 1));
        assert!(compare_integer(10, 11, 1));
        assert!(compare_integer(10, 9, 1));
        assert!(!compare_integer(10, 12, 1));

        // Negative numbers
        assert!(compare_integer(-10, -11, 1));
        assert!(!compare_integer(-10, -12, 1));
    }

    #[test]
    fn test_compare_bool() {
        assert!(compare_bool(true, true));
        assert!(compare_bool(false, false));
        assert!(!compare_bool(true, false));
        assert!(!compare_bool(false, true));
    }

    #[test]
    fn test_compare_option() {
        // Both None
        assert!(compare_option(None, None, |a: &i32, b: &i32| a == b));

        // Both Some, equal
        assert!(compare_option(Some(&42), Some(&42), |a, b| a == b));

        // Both Some, not equal
        assert!(!compare_option(Some(&42), Some(&43), |a, b| a == b));

        // One None, one Some
        assert!(!compare_option(None, Some(&42), |a: &i32, b| a == b));
        assert!(!compare_option(Some(&42), None, |a, b| a == b));
    }

    #[test]
    fn test_cell_comparison() {
        let mut comparison = CellComparison::new("A1".to_string());
        assert!(!comparison.has_differences());
        assert_eq!(comparison.difference_count(), 0);

        comparison.add_difference(
            "text".to_string(),
            "expected".to_string(),
            "actual".to_string(),
        );
        assert!(comparison.has_differences());
        assert_eq!(comparison.difference_count(), 1);

        comparison.add_difference("formula".to_string(), "=A1".to_string(), "=B1".to_string());
        assert_eq!(comparison.difference_count(), 2);
    }
}
