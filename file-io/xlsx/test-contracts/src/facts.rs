//! Canonical workbook fact schema used by corpus and L2 correctness oracles.

use serde::{Deserialize, Serialize};

pub const WORKBOOK_FACTS_SCHEMA_VERSION: u32 = 1;

#[derive(Debug, Clone, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub struct WorkbookFacts {
    pub schema_version: u32,
    pub workbook: WorkbookSummaryFacts,
    pub sheets: Vec<SheetFacts>,
    pub styles: StyleFacts,
    pub shared_strings: SharedStringFacts,
    pub formulas: FormulaFacts,
    pub package: PackageFacts,
}

impl WorkbookFacts {
    pub fn new() -> Self {
        Self {
            schema_version: WORKBOOK_FACTS_SCHEMA_VERSION,
            ..Self::default()
        }
    }

    pub fn normalize(&mut self) {
        self.schema_version = WORKBOOK_FACTS_SCHEMA_VERSION;
        self.sheets
            .sort_by(|a, b| a.index.cmp(&b.index).then_with(|| a.name.cmp(&b.name)));
        for sheet in &mut self.sheets {
            sheet.name = sheet.name.trim().to_string();
        }
    }

    pub fn normalized(mut self) -> Self {
        self.normalize();
        self
    }
}

#[derive(Debug, Clone, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub struct WorkbookSummaryFacts {
    pub sheet_count: u32,
    pub total_cell_count: u64,
    pub defined_name_count: u32,
    pub has_workbook_protection: bool,
    pub has_core_properties: bool,
    pub has_app_properties: bool,
    pub has_custom_properties: bool,
    pub has_theme: bool,
}

#[derive(Debug, Clone, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub struct SheetFacts {
    pub index: u32,
    pub name: String,
    pub visible_state: String,
    pub cell_count: u64,
    pub non_empty_cell_count: u64,
    pub formula_cell_count: u32,
    pub number_cell_count: u32,
    pub string_cell_count: u32,
    pub bool_cell_count: u32,
    pub error_cell_count: u32,
    pub merge_count: u32,
    pub table_count: u32,
    pub chart_count: u32,
    pub comment_count: u32,
    pub hyperlink_count: u32,
    pub data_validation_count: u32,
    pub conditional_format_count: u32,
    pub sparkline_group_count: u32,
    pub slicer_count: u32,
    pub form_control_count: u32,
    pub ole_object_count: u32,
    pub used_range: Option<UsedRangeFacts>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub struct UsedRangeFacts {
    pub min_row: u32,
    pub min_col: u32,
    pub max_row: u32,
    pub max_col: u32,
}

#[derive(Debug, Clone, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub struct StyleFacts {
    pub number_format_count: u32,
    pub cell_format_count: u32,
    pub cell_style_count: u32,
}

#[derive(Debug, Clone, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub struct SharedStringFacts {
    pub count: u32,
    pub rich_text_count: u32,
}

#[derive(Debug, Clone, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub struct FormulaFacts {
    pub total_formula_cells: u32,
    pub array_formula_cells: u32,
    pub force_recalc_formula_cells: u32,
}

#[derive(Debug, Clone, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub struct PackageFacts {
    pub has_calc_pr: bool,
    pub part_count: Option<u32>,
    pub relationship_part_count: Option<u32>,
}
