//! Fidelity report generation
//!
//! This module generates detailed reports comparing parser output against ground truth.
//! Reports include overall statistics, per-property statistics, and detailed differences.

use super::compare::CellComparison;
use std::collections::HashMap;

/// Complete fidelity report for a workbook
#[derive(Debug, Clone)]
pub struct FidelityReport {
    /// Original XLSX file path
    pub file: String,

    /// Ground truth JSON file path
    pub ground_truth_file: String,

    /// Total number of cells compared
    pub total_cells: u32,

    /// Number of cells that matched completely
    pub matched_cells: u32,

    /// Overall match percentage (0-100)
    pub match_percentage: f64,

    /// Per-property statistics
    pub by_property: HashMap<String, PropertyStats>,

    /// Detailed list of all cell differences
    pub differences: Vec<CellComparison>,
}

impl FidelityReport {
    /// Create a new empty report
    pub fn new(file: String, ground_truth_file: String) -> Self {
        Self {
            file,
            ground_truth_file,
            total_cells: 0,
            matched_cells: 0,
            match_percentage: 0.0,
            by_property: HashMap::new(),
            differences: Vec::new(),
        }
    }

    /// Add a cell comparison result
    pub fn add_comparison(&mut self, comparison: CellComparison) {
        self.total_cells += 1;

        if comparison.has_differences() {
            // Record differences
            for diff in &comparison.differences {
                let stats = self
                    .by_property
                    .entry(diff.property.clone())
                    .or_insert_with(|| PropertyStats::new(diff.property.clone()));
                stats.total += 1;
            }
            self.differences.push(comparison);
        } else {
            self.matched_cells += 1;
        }
    }

    /// Finalize the report by calculating percentages
    pub fn finalize(&mut self) {
        // Calculate overall match percentage
        if self.total_cells > 0 {
            self.match_percentage = (self.matched_cells as f64 / self.total_cells as f64) * 100.0;
        }

        // Calculate per-property match percentages
        for stats in self.by_property.values_mut() {
            if self.total_cells > 0 {
                stats.matched = self.total_cells - stats.total;
                stats.percentage = (stats.matched as f64 / self.total_cells as f64) * 100.0;
            }
        }
    }

    /// Generate a human-readable summary
    pub fn summary(&self) -> String {
        let mut lines = vec![
            "=== XLSX Fidelity Report ===".to_string(),
            format!("File: {}", self.file),
            format!("Ground Truth: {}", self.ground_truth_file),
            format!("Total Cells: {}", self.total_cells),
            format!("Matched Cells: {}", self.matched_cells),
            format!("Match Percentage: {:.2}%", self.match_percentage),
            "".to_string(),
        ];

        if !self.by_property.is_empty() {
            lines.push("=== Property Statistics ===".to_string());
            let mut sorted_props: Vec<_> = self.by_property.values().collect();
            sorted_props.sort_by(|a, b| b.total.cmp(&a.total)); // Sort by total failures descending

            for stats in sorted_props {
                lines.push(format!(
                    "  {}: {}/{} matched ({:.2}%)",
                    stats.property, stats.matched, self.total_cells, stats.percentage
                ));
            }
            lines.push("".to_string());
        }

        if !self.differences.is_empty() {
            lines.push(format!(
                "=== Cell Differences ({} cells) ===",
                self.differences.len()
            ));
            let preview_count = 10.min(self.differences.len());
            for diff in &self.differences[..preview_count] {
                lines.push(format!(
                    "Cell {}: {} differences",
                    diff.address,
                    diff.difference_count()
                ));
                for prop_diff in &diff.differences {
                    lines.push(format!(
                        "  - {}: expected='{}', actual='{}'",
                        prop_diff.property, prop_diff.expected, prop_diff.actual
                    ));
                }
            }
            if self.differences.len() > preview_count {
                lines.push(format!(
                    "... and {} more cells with differences",
                    self.differences.len() - preview_count
                ));
            }
        }

        lines.join("\n")
    }

    /// Generate a JSON report
    pub fn to_json(&self) -> serde_json::Value {
        serde_json::json!({
            "file": self.file,
            "groundTruthFile": self.ground_truth_file,
            "totalCells": self.total_cells,
            "matchedCells": self.matched_cells,
            "matchPercentage": self.match_percentage,
            "byProperty": self.by_property.iter().map(|(k, v)| {
                (k.clone(), serde_json::json!({
                    "total": v.total,
                    "matched": v.matched,
                    "percentage": v.percentage,
                }))
            }).collect::<HashMap<_, _>>(),
            "differences": self.differences.iter().map(|d| {
                serde_json::json!({
                    "address": d.address,
                    "differenceCount": d.difference_count(),
                    "differences": d.differences.iter().map(|pd| {
                        serde_json::json!({
                            "property": pd.property,
                            "expected": pd.expected,
                            "actual": pd.actual,
                        })
                    }).collect::<Vec<_>>(),
                })
            }).collect::<Vec<_>>(),
        })
    }
}

/// Statistics for a single property across all cells
#[derive(Debug, Clone)]
pub struct PropertyStats {
    /// Property name
    pub property: String,

    /// Total number of times this property failed to match
    pub total: u32,

    /// Number of times this property matched
    pub matched: u32,

    /// Match percentage (0-100)
    pub percentage: f64,
}

impl PropertyStats {
    /// Create new property stats
    pub fn new(property: String) -> Self {
        Self {
            property,
            total: 0,
            matched: 0,
            percentage: 0.0,
        }
    }
}

/// Builder for constructing fidelity reports
pub struct ReportBuilder {
    report: FidelityReport,
}

impl ReportBuilder {
    /// Create a new report builder
    pub fn new(file: String, ground_truth_file: String) -> Self {
        Self {
            report: FidelityReport::new(file, ground_truth_file),
        }
    }

    /// Add a cell comparison
    pub fn add_comparison(&mut self, comparison: CellComparison) -> &mut Self {
        self.report.add_comparison(comparison);
        self
    }

    /// Add multiple comparisons
    pub fn add_comparisons(&mut self, comparisons: Vec<CellComparison>) -> &mut Self {
        for comparison in comparisons {
            self.report.add_comparison(comparison);
        }
        self
    }

    /// Build the final report
    pub fn build(mut self) -> FidelityReport {
        self.report.finalize();
        self.report
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::testing::fidelity::compare::CellComparison;

    #[test]
    fn test_empty_report() {
        let mut report = FidelityReport::new("test.xlsx".to_string(), "test.json".to_string());
        report.finalize();

        assert_eq!(report.total_cells, 0);
        assert_eq!(report.matched_cells, 0);
        assert_eq!(report.match_percentage, 0.0);
        assert!(report.by_property.is_empty());
        assert!(report.differences.is_empty());
    }

    #[test]
    fn test_all_matching_cells() {
        let mut report = FidelityReport::new("test.xlsx".to_string(), "test.json".to_string());

        // Add 10 cells with no differences
        for i in 1..=10 {
            let comparison = CellComparison::new(format!("A{}", i));
            report.add_comparison(comparison);
        }

        report.finalize();

        assert_eq!(report.total_cells, 10);
        assert_eq!(report.matched_cells, 10);
        assert_eq!(report.match_percentage, 100.0);
        assert!(report.by_property.is_empty());
        assert!(report.differences.is_empty());
    }

    #[test]
    fn test_mixed_results() {
        let mut report = FidelityReport::new("test.xlsx".to_string(), "test.json".to_string());

        // 5 matching cells
        for i in 1..=5 {
            let comparison = CellComparison::new(format!("A{}", i));
            report.add_comparison(comparison);
        }

        // 5 cells with differences
        for i in 6..=10 {
            let mut comparison = CellComparison::new(format!("A{}", i));
            comparison.add_difference(
                "text".to_string(),
                "expected".to_string(),
                "actual".to_string(),
            );
            report.add_comparison(comparison);
        }

        report.finalize();

        assert_eq!(report.total_cells, 10);
        assert_eq!(report.matched_cells, 5);
        assert_eq!(report.match_percentage, 50.0);
        assert_eq!(report.differences.len(), 5);
        assert_eq!(report.by_property.len(), 1);

        let text_stats = report.by_property.get("text").unwrap();
        assert_eq!(text_stats.total, 5);
        assert_eq!(text_stats.matched, 5);
        assert_eq!(text_stats.percentage, 50.0);
    }

    #[test]
    fn test_report_builder() {
        let mut builder = ReportBuilder::new("test.xlsx".to_string(), "test.json".to_string());

        let mut comparison1 = CellComparison::new("A1".to_string());
        comparison1.add_difference(
            "text".to_string(),
            "expected".to_string(),
            "actual".to_string(),
        );

        let comparison2 = CellComparison::new("A2".to_string());

        builder.add_comparison(comparison1);
        builder.add_comparison(comparison2);

        let report = builder.build();

        assert_eq!(report.total_cells, 2);
        assert_eq!(report.matched_cells, 1);
        assert_eq!(report.match_percentage, 50.0);
    }

    #[test]
    fn test_summary_generation() {
        let mut report = FidelityReport::new("test.xlsx".to_string(), "test.json".to_string());

        let mut comparison = CellComparison::new("A1".to_string());
        comparison.add_difference("text".to_string(), "hello".to_string(), "world".to_string());
        report.add_comparison(comparison);

        report.finalize();

        let summary = report.summary();
        assert!(summary.contains("test.xlsx"));
        assert!(summary.contains("Total Cells: 1"));
        assert!(summary.contains("Matched Cells: 0"));
        assert!(summary.contains("Match Percentage: 0.00%"));
        assert!(summary.contains("Cell A1"));
        assert!(summary.contains("text"));
    }

    #[test]
    fn test_json_generation() {
        let mut report = FidelityReport::new("test.xlsx".to_string(), "test.json".to_string());

        let mut comparison = CellComparison::new("A1".to_string());
        comparison.add_difference("text".to_string(), "hello".to_string(), "world".to_string());
        report.add_comparison(comparison);

        report.finalize();

        let json = report.to_json();
        assert_eq!(json["file"], "test.xlsx");
        assert_eq!(json["totalCells"], 1);
        assert_eq!(json["matchedCells"], 0);
        assert_eq!(json["matchPercentage"], 0.0);
        assert_eq!(json["differences"][0]["address"], "A1");
    }
}
