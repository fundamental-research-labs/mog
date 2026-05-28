/// Print options (ECMA-376 CT_PrintOptions).
#[derive(Debug, Clone, PartialEq, serde::Serialize, serde::Deserialize)]
pub struct PrintOptions {
    /// Print gridlines
    pub grid_lines: bool,
    /// Print row and column headings (1, 2, 3... and A, B, C...)
    pub headings: bool,
    /// Center content horizontally on page
    pub horizontal_centered: bool,
    /// Center content vertically on page
    pub vertical_centered: bool,
    /// Grid lines setting was explicitly set
    pub grid_lines_set: bool,
}

impl Default for PrintOptions {
    fn default() -> Self {
        Self {
            grid_lines: false,
            headings: false,
            horizontal_centered: false,
            vertical_centered: false,
            grid_lines_set: true, // ECMA-376 §18.3.1.70 default
        }
    }
}
