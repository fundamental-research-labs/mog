//! Example: Load and display ground truth data from COM-extracted JSON
//!
//! Usage: cargo run --example load_ground_truth -- <ground-truth-json>

use std::fs;
use xlsx_parser::testing::fidelity::GroundTruthWorkbook;

fn main() {
    let json_path = std::env::args()
        .nth(1)
        .or_else(|| std::env::var("MOG_XLSX_GROUND_TRUTH_JSON").ok())
        .expect("pass a ground-truth JSON path or set MOG_XLSX_GROUND_TRUTH_JSON");

    println!("Loading ground truth from: {}", json_path);

    let json_content = fs::read_to_string(&json_path).expect("Failed to read ground truth file");

    println!("File size: {} bytes", json_content.len());

    // Strip UTF-8 BOM if present (PowerShell output may include BOM)
    let json_content = json_content.trim_start_matches('\u{feff}');

    let workbook: GroundTruthWorkbook =
        serde_json::from_str(json_content).expect("Failed to deserialize ground truth");

    println!("\n=== Ground Truth Workbook ===");
    println!("  File: {}", workbook.file);
    println!("  Extracted at: {}", workbook.extracted_at);
    println!("  Sheet count: {}", workbook.sheet_count);
    println!("  Sheets: {}", workbook.sheets.len());

    for sheet in &workbook.sheets {
        println!("\n=== Sheet: {} ===", sheet.name);
        println!("  Index: {}", sheet.index);
        println!("  Visible: {}", sheet.visible);
        println!("  Cells: {}", sheet.cells.len());

        // Show a few sample cells with their properties
        let mut count = 0;
        for (addr, cell) in &sheet.cells {
            if count >= 3 {
                println!("  ... and {} more cells", sheet.cells.len() - 3);
                break;
            }

            println!("\n  Cell {}:", addr);
            println!("    Text: '{}'", cell.text);
            println!("    Formula: {:?}", cell.formula);
            println!(
                "    Font: {} {}pt, bold={}, color=0x{:06X}",
                cell.font.name, cell.font.size, cell.font.bold, cell.font.color
            );
            println!(
                "    Interior: color=0x{:06X}, pattern={}",
                cell.interior.color, cell.interior.pattern
            );
            println!(
                "    Alignment: h={}, v={}, wrap={}",
                cell.alignment.horizontal_alignment,
                cell.alignment.vertical_alignment,
                cell.alignment.wrap_text
            );
            println!("    Number format: {}", cell.number_format);

            count += 1;
        }
    }

    println!("\n✓ Ground truth loaded successfully!");
}
