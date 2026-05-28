//! Ground truth types for Excel COM-extracted data
//!
//! These types match the JSON structure produced by the PowerShell script that extracts
//! cell properties using Excel's COM API. They represent the "source of truth" for what
//! Excel actually does with XLSX files.

use serde::{Deserialize, Serialize};
use std::collections::HashMap;

/// Top-level workbook structure from COM extraction
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct GroundTruthWorkbook {
    /// Original file path
    pub file: String,

    /// ISO 8601 timestamp when data was extracted
    #[serde(rename = "extractedAt")]
    pub extracted_at: String,

    /// Number of sheets in workbook
    #[serde(rename = "sheetCount")]
    pub sheet_count: u32,

    /// Array of sheets with their cells
    pub sheets: Vec<GroundTruthSheet>,
}

/// Sheet with all cell properties
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct GroundTruthSheet {
    /// Sheet name
    pub name: String,

    /// 1-based sheet index
    pub index: u32,

    /// Visibility (-1 = visible, 0 = hidden, 2 = very hidden)
    pub visible: i32,

    /// Map of cell address (e.g., "A1") to cell properties
    pub cells: HashMap<String, GroundTruthCell>,
}

/// Complete cell properties extracted from Excel COM
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct GroundTruthCell {
    /// Cell address (e.g., "B2")
    pub address: String,

    /// 1-based row number
    pub row: u32,

    /// 1-based column number
    pub column: u32,

    /// Cell value (can be various types: string, number, bool, null)
    pub value: Option<serde_json::Value>,

    /// Alternative value property (Value2 in Excel VBA)
    pub value2: Option<serde_json::Value>,

    /// Formatted text display
    pub text: String,

    /// Whether cell contains a formula
    #[serde(rename = "hasFormula")]
    pub has_formula: bool,

    /// Formula in A1 notation
    pub formula: Option<String>,

    /// Formula in local language
    #[serde(rename = "formulaLocal")]
    pub formula_local: Option<String>,

    /// Formula in R1C1 notation
    #[serde(rename = "formulaR1C1")]
    pub formula_r1c1: Option<String>,

    /// Formula in R1C1 local language
    #[serde(rename = "formulaR1C1Local")]
    pub formula_r1c1_local: Option<String>,

    /// Whether cell is part of an array formula
    #[serde(rename = "hasArray")]
    pub has_array: bool,

    /// Array formula (if applicable)
    #[serde(rename = "formulaArray")]
    pub formula_array: Option<String>,

    /// Number format code
    #[serde(rename = "numberFormat")]
    pub number_format: String,

    /// Number format in local language
    #[serde(rename = "numberFormatLocal")]
    pub number_format_local: String,

    /// Font properties
    pub font: Font,

    /// Interior (fill) properties
    pub interior: Interior,

    /// Alignment properties
    pub alignment: Alignment,

    /// Whether cell is merged
    #[serde(rename = "mergeCells")]
    pub merge_cells: bool,

    /// Merge area address (if merged)
    #[serde(rename = "mergeArea")]
    pub merge_area: Option<String>,

    /// Border properties for all edges
    pub borders: Borders,

    /// Cell size and position
    pub size: CellSize,

    /// Protection properties
    pub protection: Protection,

    /// Style name
    pub style: String,

    /// Display format (resolved/computed styles)
    #[serde(rename = "displayFormat")]
    pub display_format: DisplayFormat,
}

/// Font properties
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Font {
    /// Font name (e.g., "Calibri")
    pub name: String,

    /// Font size in points
    pub size: f64,

    /// Bold
    pub bold: bool,

    /// Italic
    pub italic: bool,

    /// Underline style (-4142 = none, 2 = single, etc.)
    pub underline: i32,

    /// Strikethrough
    pub strikethrough: bool,

    /// Subscript
    pub subscript: bool,

    /// Superscript
    pub superscript: bool,

    /// RGB color value
    pub color: i64,

    /// Color index in palette
    #[serde(rename = "colorIndex")]
    pub color_index: i32,

    /// Theme color index (nullable)
    #[serde(rename = "themeColor")]
    pub theme_color: Option<i32>,

    /// Tint and shade (-1.0 to 1.0, nullable)
    #[serde(rename = "tintAndShade")]
    pub tint_and_shade: Option<f64>,

    /// Theme font (1 = major, 2 = minor, nullable)
    #[serde(rename = "themeFont")]
    pub theme_font: Option<i32>,
}

/// Interior (fill) properties
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Interior {
    /// RGB color value
    pub color: i64,

    /// Color index in palette
    #[serde(rename = "colorIndex")]
    pub color_index: i32,

    /// Pattern style (-4142 = none, 1 = solid, etc.)
    pub pattern: i32,

    /// Pattern color RGB
    #[serde(rename = "patternColor")]
    pub pattern_color: i64,

    /// Pattern color index
    #[serde(rename = "patternColorIndex")]
    pub pattern_color_index: i32,

    /// Theme color index (nullable)
    #[serde(rename = "themeColor")]
    pub theme_color: Option<i32>,

    /// Tint and shade (nullable)
    #[serde(rename = "tintAndShade")]
    pub tint_and_shade: Option<f64>,

    /// Pattern tint and shade (nullable)
    #[serde(rename = "patternTintAndShade")]
    pub pattern_tint_and_shade: Option<f64>,
}

/// Alignment properties
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Alignment {
    /// Horizontal alignment (-4108 = center, 1 = left, etc.)
    #[serde(rename = "horizontalAlignment")]
    pub horizontal_alignment: i32,

    /// Vertical alignment (-4107 = bottom, -4108 = center, etc.)
    #[serde(rename = "verticalAlignment")]
    pub vertical_alignment: i32,

    /// Wrap text
    #[serde(rename = "wrapText")]
    pub wrap_text: bool,

    /// Text orientation (0 = horizontal, 90 = vertical, etc.)
    pub orientation: i32,

    /// Indent level
    #[serde(rename = "indentLevel")]
    pub indent_level: u32,

    /// Shrink to fit
    #[serde(rename = "shrinkToFit")]
    pub shrink_to_fit: bool,

    /// Reading order (-5002 = context, 1 = LTR, 2 = RTL)
    #[serde(rename = "readingOrder")]
    pub reading_order: i32,

    /// Add indent
    #[serde(rename = "addIndent")]
    pub add_indent: bool,
}

/// All border edges
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Borders {
    /// Diagonal down border
    #[serde(rename = "diagonalDown")]
    pub diagonal_down: BorderEdge,

    /// Diagonal up border
    #[serde(rename = "diagonalUp")]
    pub diagonal_up: BorderEdge,

    /// Left edge border
    #[serde(rename = "edgeLeft")]
    pub edge_left: BorderEdge,

    /// Top edge border
    #[serde(rename = "edgeTop")]
    pub edge_top: BorderEdge,

    /// Bottom edge border
    #[serde(rename = "edgeBottom")]
    pub edge_bottom: BorderEdge,

    /// Right edge border
    #[serde(rename = "edgeRight")]
    pub edge_right: BorderEdge,

    /// Inside vertical border (for ranges)
    #[serde(rename = "insideVertical")]
    pub inside_vertical: BorderEdge,

    /// Inside horizontal border (for ranges)
    #[serde(rename = "insideHorizontal")]
    pub inside_horizontal: BorderEdge,
}

/// Single border edge properties
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct BorderEdge {
    /// Line style (-4142 = none, 1 = continuous, 2 = dash, etc.)
    #[serde(rename = "lineStyle")]
    pub line_style: i32,

    /// Line weight (1 = hairline, 2 = thin, 3 = medium, 4 = thick)
    pub weight: i32,

    /// RGB color value
    pub color: i64,

    /// Color index in palette
    #[serde(rename = "colorIndex")]
    pub color_index: i32,

    /// Theme color index (nullable)
    #[serde(rename = "themeColor")]
    pub theme_color: Option<i32>,

    /// Tint and shade (nullable)
    #[serde(rename = "tintAndShade")]
    pub tint_and_shade: Option<f64>,
}

/// Cell size and position
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CellSize {
    /// Column width in characters
    #[serde(rename = "columnWidth")]
    pub column_width: f64,

    /// Row height in points
    #[serde(rename = "rowHeight")]
    pub row_height: f64,

    /// Cell width in points
    pub width: f64,

    /// Cell height in points
    pub height: f64,

    /// Left position in points
    pub left: f64,

    /// Top position in points
    pub top: f64,
}

/// Cell protection properties
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Protection {
    /// Cell is locked
    pub locked: bool,

    /// Formula is hidden
    #[serde(rename = "formulaHidden")]
    pub formula_hidden: bool,
}

/// Display format (resolved/computed styles)
///
/// This represents what Excel actually displays after resolving themes,
/// inheritance, and defaults. It's the "final" style that the user sees.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct DisplayFormat {
    // Interior properties
    #[serde(rename = "interiorColor")]
    pub interior_color: i64,

    #[serde(rename = "interiorColorIndex")]
    pub interior_color_index: i32,

    #[serde(rename = "interiorPattern")]
    pub interior_pattern: i32,

    #[serde(rename = "interiorThemeColor")]
    pub interior_theme_color: Option<i32>,

    #[serde(rename = "interiorTintAndShade")]
    pub interior_tint_and_shade: Option<f64>,

    // Font properties
    #[serde(rename = "fontName")]
    pub font_name: String,

    #[serde(rename = "fontSize")]
    pub font_size: f64,

    #[serde(rename = "fontBold")]
    pub font_bold: bool,

    #[serde(rename = "fontItalic")]
    pub font_italic: bool,

    #[serde(rename = "fontColor")]
    pub font_color: i64,

    #[serde(rename = "fontColorIndex")]
    pub font_color_index: i32,

    #[serde(rename = "fontThemeColor")]
    pub font_theme_color: Option<i32>,

    #[serde(rename = "fontTintAndShade")]
    pub font_tint_and_shade: Option<f64>,

    #[serde(rename = "fontUnderline")]
    pub font_underline: i32,

    #[serde(rename = "fontStrikethrough")]
    pub font_strikethrough: bool,

    // Number format
    #[serde(rename = "numberFormat")]
    pub number_format: String,

    #[serde(rename = "numberFormatLocal")]
    pub number_format_local: String,

    // Alignment
    #[serde(rename = "horizontalAlignment")]
    pub horizontal_alignment: i32,

    #[serde(rename = "verticalAlignment")]
    pub vertical_alignment: i32,

    #[serde(rename = "wrapText")]
    pub wrap_text: bool,

    #[serde(rename = "indentLevel")]
    pub indent_level: u32,

    #[serde(rename = "shrinkToFit")]
    pub shrink_to_fit: bool,

    // Protection
    pub locked: bool,

    #[serde(rename = "formulaHidden")]
    pub formula_hidden: bool,

    // Borders (same structure as Borders type)
    pub borders: Borders,
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_deserialize_ground_truth() {
        let json = r#"{
            "file": "test.xlsx",
            "extractedAt": "2026-02-06T12:00:00",
            "sheetCount": 1,
            "sheets": [{
                "name": "Sheet1",
                "index": 1,
                "visible": -1,
                "cells": {
                    "A1": {
                        "address": "A1",
                        "row": 1,
                        "column": 1,
                        "value": "test",
                        "value2": "test",
                        "text": "test",
                        "hasFormula": false,
                        "formula": null,
                        "formulaLocal": null,
                        "formulaR1C1": null,
                        "formulaR1C1Local": null,
                        "hasArray": false,
                        "formulaArray": null,
                        "numberFormat": "General",
                        "numberFormatLocal": "General",
                        "font": {
                            "name": "Calibri",
                            "size": 11.0,
                            "bold": false,
                            "italic": false,
                            "underline": -4142,
                            "strikethrough": false,
                            "subscript": false,
                            "superscript": false,
                            "color": 0,
                            "colorIndex": 1,
                            "themeColor": 2,
                            "tintAndShade": 0.0,
                            "themeFont": 2
                        },
                        "interior": {
                            "color": 16777215,
                            "colorIndex": -4142,
                            "pattern": -4142,
                            "patternColor": 0,
                            "patternColorIndex": -4142,
                            "themeColor": -4142,
                            "tintAndShade": 0.0,
                            "patternTintAndShade": 0.0
                        },
                        "alignment": {
                            "horizontalAlignment": 1,
                            "verticalAlignment": -4107,
                            "wrapText": false,
                            "orientation": -4128,
                            "indentLevel": 0,
                            "shrinkToFit": false,
                            "readingOrder": -5002,
                            "addIndent": false
                        },
                        "mergeCells": false,
                        "mergeArea": null,
                        "borders": {
                            "diagonalDown": {"lineStyle": -4142, "weight": 2, "color": 0, "colorIndex": -4142, "themeColor": null, "tintAndShade": null},
                            "diagonalUp": {"lineStyle": -4142, "weight": 2, "color": 0, "colorIndex": -4142, "themeColor": null, "tintAndShade": null},
                            "edgeLeft": {"lineStyle": -4142, "weight": 2, "color": 0, "colorIndex": -4142, "themeColor": null, "tintAndShade": null},
                            "edgeTop": {"lineStyle": -4142, "weight": 2, "color": 0, "colorIndex": -4142, "themeColor": null, "tintAndShade": null},
                            "edgeBottom": {"lineStyle": -4142, "weight": 2, "color": 0, "colorIndex": -4142, "themeColor": null, "tintAndShade": null},
                            "edgeRight": {"lineStyle": -4142, "weight": 2, "color": 0, "colorIndex": -4142, "themeColor": null, "tintAndShade": null},
                            "insideVertical": {"lineStyle": -4142, "weight": 2, "color": 0, "colorIndex": -4142, "themeColor": null, "tintAndShade": null},
                            "insideHorizontal": {"lineStyle": -4142, "weight": 2, "color": 0, "colorIndex": -4142, "themeColor": null, "tintAndShade": null}
                        },
                        "size": {
                            "columnWidth": 8.43,
                            "rowHeight": 15.0,
                            "width": 64.0,
                            "height": 15.0,
                            "left": 0.0,
                            "top": 0.0
                        },
                        "protection": {
                            "locked": true,
                            "formulaHidden": false
                        },
                        "style": "Normal",
                        "displayFormat": {
                            "interiorColor": 16777215,
                            "interiorColorIndex": -4142,
                            "interiorPattern": -4142,
                            "interiorThemeColor": -4142,
                            "interiorTintAndShade": 0.0,
                            "fontName": "Calibri",
                            "fontSize": 11.0,
                            "fontBold": false,
                            "fontItalic": false,
                            "fontColor": 0,
                            "fontColorIndex": 1,
                            "fontThemeColor": 2,
                            "fontTintAndShade": 0.0,
                            "fontUnderline": -4142,
                            "fontStrikethrough": false,
                            "numberFormat": "General",
                            "numberFormatLocal": "General",
                            "horizontalAlignment": 1,
                            "verticalAlignment": -4107,
                            "wrapText": false,
                            "indentLevel": 0,
                            "shrinkToFit": false,
                            "locked": true,
                            "formulaHidden": false,
                            "borders": {
                                "diagonalDown": {"lineStyle": -4142, "weight": 2, "color": 0, "colorIndex": -4142, "themeColor": null, "tintAndShade": null},
                                "diagonalUp": {"lineStyle": -4142, "weight": 2, "color": 0, "colorIndex": -4142, "themeColor": null, "tintAndShade": null},
                                "edgeLeft": {"lineStyle": -4142, "weight": 2, "color": 0, "colorIndex": -4142, "themeColor": null, "tintAndShade": null},
                                "edgeTop": {"lineStyle": -4142, "weight": 2, "color": 0, "colorIndex": -4142, "themeColor": null, "tintAndShade": null},
                                "edgeBottom": {"lineStyle": -4142, "weight": 2, "color": 0, "colorIndex": -4142, "themeColor": null, "tintAndShade": null},
                                "edgeRight": {"lineStyle": -4142, "weight": 2, "color": 0, "colorIndex": -4142, "themeColor": null, "tintAndShade": null},
                                "insideVertical": {"lineStyle": -4142, "weight": 2, "color": 0, "colorIndex": -4142, "themeColor": null, "tintAndShade": null},
                                "insideHorizontal": {"lineStyle": -4142, "weight": 2, "color": 0, "colorIndex": -4142, "themeColor": null, "tintAndShade": null}
                            }
                        }
                    }
                }
            }]
        }"#;

        let result: Result<GroundTruthWorkbook, _> = serde_json::from_str(json);
        assert!(result.is_ok(), "Failed to deserialize: {:?}", result.err());

        let workbook = result.unwrap();
        assert_eq!(workbook.sheet_count, 1);
        assert_eq!(workbook.sheets[0].name, "Sheet1");
        assert_eq!(workbook.sheets[0].cells.len(), 1);

        let cell = &workbook.sheets[0].cells["A1"];
        assert_eq!(cell.address, "A1");
        assert_eq!(cell.text, "test");
        assert_eq!(cell.font.name, "Calibri");
    }
}
