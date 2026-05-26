//! XLSX Fidelity Testing System
//!
//! This module provides tools for comparing xlsx-parser output against Excel COM ground truth.
//! It enables high-fidelity testing to ensure our parser produces results that match Excel's behavior.
//!
//! # Overview
//!
//! The fidelity system consists of three main components:
//!
//! 1. **Ground Truth Types** (`ground_truth`): Rust types that deserialize COM-extracted JSON
//! 2. **Comparison Logic** (`compare`): Compares parser output against ground truth with tolerances
//! 3. **Report Generation** (`report`): Generates detailed fidelity reports with statistics
//!
//! # Usage
//!
//! ```rust,ignore
//! use xlsx_parser::fidelity::{GroundTruthWorkbook, compare_workbooks, FidelityReport};
//!
//! // Load ground truth from COM-extracted JSON
//! let ground_truth: GroundTruthWorkbook = serde_json::from_str(&json_content)?;
//!
//! // Parse with our parser
//! let parsed = parse_xlsx(&xlsx_bytes)?;
//!
//! // Compare and generate report
//! let report = compare_workbooks(&ground_truth, &parsed);
//! println!("Fidelity: {:.2}%", report.match_percentage);
//! ```

pub mod compare;
pub mod ground_truth;
pub mod report;

// Re-export commonly used types
pub use ground_truth::{
    Alignment, BorderEdge, Borders, CellSize, DisplayFormat, Font, GroundTruthCell,
    GroundTruthSheet, GroundTruthWorkbook, Interior, Protection,
};

pub use compare::{
    CellComparison, PropertyDifference, compare_color, compare_formula, compare_number,
    compare_text,
};

pub use report::{FidelityReport, PropertyStats};
