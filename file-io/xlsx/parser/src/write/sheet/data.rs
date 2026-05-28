use domain_types::AuthoredStyleRun;
use std::collections::BTreeMap;

// ============================================================================
// Sheet Format Properties
// ============================================================================

/// Sheet format properties (`<sheetFormatPr>`).
///
/// Controls default row height, column width, and outline settings.
#[derive(Debug, Clone)]
pub struct SheetFormatPr {
    /// Default row height in points.
    pub default_row_height: f64,
    /// Default column width in character units.
    pub default_col_width: Option<f64>,
    /// Base column width in character units (baseColWidth attribute).
    pub base_col_width: Option<u32>,
    /// Whether the default row height is a custom value (customHeight="1").
    pub custom_height: bool,
    /// Whether zero-height rows are the default (zeroHeight="1").
    pub zero_height: bool,
    /// Whether default rows use thick top borders (thickTop="1").
    pub thick_top: bool,
    /// Whether default rows use thick bottom borders (thickBottom="1").
    pub thick_bottom: bool,
    /// Outline level for rows.
    pub outline_level_row: Option<u8>,
    /// Outline level for columns.
    pub outline_level_col: Option<u8>,
    /// x14ac:dyDescent — default text baseline descent in points.
    pub default_row_descent: Option<f64>,
}

impl Default for SheetFormatPr {
    fn default() -> Self {
        Self {
            default_row_height: 15.0,
            default_col_width: None,
            base_col_width: None,
            custom_height: false,
            zero_height: false,
            thick_top: false,
            thick_bottom: false,
            outline_level_row: None,
            outline_level_col: None,
            default_row_descent: None,
        }
    }
}

// ============================================================================
// Cell Value Types
// ============================================================================

/// Cell value types for writing.
#[derive(Debug, Clone)]
pub enum CellValue {
    /// Empty cell (no value)
    Empty,
    /// Numeric value
    Number(f64),
    /// Shared string index
    String(usize),
    /// Inline string (not in shared strings table) — writes t="inlineStr" with <is><t>
    InlineString(String),
    /// Formula-result string — writes t="str" with plain <v>
    FormulaString(String),
    /// Boolean value
    Boolean(bool),
    /// Error value (e.g., #VALUE!, #REF!, #DIV/0!)
    Error(String),
    /// Formula with optional cached value
    Formula {
        formula: String,
        cached_value: Option<Box<CellValue>>,
        /// OOXML formula metadata for round-trip. When present, controls how
        /// the `<f>` element is emitted (shared, array, etc.).
        cell_formula: Option<ooxml_types::worksheet::CellFormula>,
    },
}

impl Default for CellValue {
    fn default() -> Self {
        CellValue::Empty
    }
}

// ============================================================================
// Cell Data
// ============================================================================

/// Cell data for writing.
#[derive(Debug, Clone)]
pub struct CellData {
    /// Row index (0-indexed)
    pub row: u32,
    /// Column index (0-indexed)
    pub col: u32,
    /// Cell value
    pub value: CellValue,
    /// Style index (references styles.xml cellXfs)
    pub style_index: Option<u32>,
    /// Original string representation of a numeric value from the source file.
    /// When present, the writer uses this verbatim instead of re-formatting the
    /// f64, avoiding precision loss during round-trip (e.g. `4.9400000000000004`
    /// staying as-is rather than being shortened to `4.94`).
    pub original_value: Option<String>,
    /// Whether the formula has `ca="1"` (calculate always / volatile).
    /// When true, the writer emits `ca="1"` on the `<f>` element.
    pub force_recalc: bool,
    /// Cell metadata index from the `cm` attribute on the `<c>` element.
    /// When present, the writer emits `cm="N"`.
    pub cell_metadata_index: Option<u32>,
    /// Value metadata index from the `vm` attribute on the `<c>` element.
    /// When present, the writer emits `vm="N"` on the `<c>` element.
    pub vm: Option<u32>,
    /// Whether the `<f>` element had `xml:space="preserve"` in the original XML.
    /// When true, the writer emits `xml:space="preserve"` on the `<f>` element.
    pub preserve_space_formula: bool,
    /// Whether the `<v>` element had `xml:space="preserve"` in the original XML.
    /// When true, the writer emits `xml:space="preserve"` on the `<v>` element.
    pub preserve_space_value: bool,
    /// Explicit type attribute for empty cells that had a type in the original XML
    /// (e.g., `t="s"` on an empty cell). When set, the writer emits this type even
    /// though the value is `CellValue::Empty`.
    pub explicit_type: Option<String>,
    /// Explicit type override for formula cells with no cached value.
    /// When the original XML had `t="str"` (or `t="e"`, `t="b"`) on a formula cell
    /// but no `<v>` element, this field preserves that type hint.
    pub formula_type_hint: Option<String>,
    /// Whether to emit the cell-level phonetic display flag (`ph="1"`).
    pub phonetic: bool,
    /// OOXML `t="d"` lexical date value to emit as a plain `<v>` value.
    pub date_lexical_value: Option<String>,
}

impl CellData {
    /// Create a new cell with a value.
    pub fn new(row: u32, col: u32, value: CellValue) -> Self {
        Self {
            row,
            col,
            value,
            style_index: None,
            original_value: None,
            force_recalc: false,
            cell_metadata_index: None,
            vm: None,
            preserve_space_formula: false,
            preserve_space_value: false,
            explicit_type: None,
            formula_type_hint: None,
            phonetic: false,
            date_lexical_value: None,
        }
    }

    /// Create a new cell with a value and style.
    pub fn with_style(row: u32, col: u32, value: CellValue, style: u32) -> Self {
        Self {
            row,
            col,
            value,
            style_index: Some(style),
            original_value: None,
            force_recalc: false,
            cell_metadata_index: None,
            vm: None,
            preserve_space_formula: false,
            preserve_space_value: false,
            explicit_type: None,
            formula_type_hint: None,
            phonetic: false,
            date_lexical_value: None,
        }
    }
}

// ============================================================================
// Row Definition
// ============================================================================

/// Row definition with optional height and styling.
#[derive(Debug, Clone, Default)]
pub struct RowDef {
    /// Row height in points
    pub height: Option<f64>,
    /// Original string representation of the height attribute for round-trip fidelity.
    pub height_str: Option<String>,
    /// Whether this is a custom height
    pub custom_height: bool,
    /// Whether the row is hidden.
    /// `None` = not present, `Some(false)` = explicitly "0", `Some(true)` = "1".
    pub hidden: Option<bool>,
    /// Style index for the row
    pub style: Option<u32>,
    /// Whether the row has a custom format applied (customFormat="1").
    /// Can be true even when style is None (implies s="0").
    pub custom_format: bool,
    /// Outline level for grouping
    pub outline_level: Option<u8>,
    /// Whether the outline is collapsed.
    /// `None` = not present, `Some(false)` = explicitly "0", `Some(true)` = "1".
    pub collapsed: Option<bool>,
    /// Whether a thick top border should be drawn
    pub thick_top: bool,
    /// Whether a thick bottom border should be drawn
    pub thick_bot: bool,
    /// x14ac:dyDescent — text baseline descent in points
    pub descent: Option<f64>,
    /// Original spans attribute value for roundtrip fidelity (e.g. "1:55")
    pub spans: Option<String>,
    /// Whether this is a bare empty row (`<row r="N"/>`) that must survive round-trip
    pub bare_empty: bool,
    /// Whether this row has phonetic display enabled (`ph="1"`).
    pub phonetic: bool,
}

impl RowDef {
    /// Create a new row definition with height.
    pub fn with_height(height: f64) -> Self {
        Self {
            height: Some(height),
            custom_height: true,
            ..Default::default()
        }
    }

    /// Set the hidden flag.
    pub fn hidden(mut self, hidden: bool) -> Self {
        self.hidden = Some(hidden);
        self
    }

    /// Set the style index.
    pub fn style(mut self, style: u32) -> Self {
        self.style = Some(style);
        self
    }

    /// Set the outline level.
    pub fn outline_level(mut self, level: u8) -> Self {
        self.outline_level = Some(level);
        self
    }

    /// Set the collapsed flag.
    pub fn collapsed(mut self, collapsed: bool) -> Self {
        self.collapsed = Some(collapsed);
        self
    }
}

pub(super) fn authored_style_cells_for_row(
    row_idx: u32,
    cells: &[CellData],
    authored_style_runs: &[&AuthoredStyleRun],
) -> Vec<CellData> {
    if authored_style_runs.is_empty() {
        return Vec::new();
    }

    let occupied: std::collections::HashSet<u32> = cells.iter().map(|cell| cell.col).collect();
    let mut by_col: BTreeMap<u32, u32> = BTreeMap::new();
    for run in authored_style_runs {
        if row_idx < run.start_row || row_idx > run.end_row {
            continue;
        }
        for col in run.start_col..=run.end_col {
            if !occupied.contains(&col) {
                by_col.insert(col, run.style_id);
            }
        }
    }

    by_col
        .into_iter()
        .map(|(col, style_id)| CellData::with_style(row_idx, col, CellValue::Empty, style_id))
        .collect()
}
