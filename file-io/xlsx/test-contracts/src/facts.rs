//! Canonical workbook fact schema used by corpus and L2 correctness oracles.

use serde::{Deserialize, Serialize};

pub const WORKBOOK_FACTS_SCHEMA_VERSION: u32 = 4;

#[derive(Debug, Clone, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub struct WorkbookFacts {
    pub schema_version: u32,
    pub workbook: WorkbookSummaryFacts,
    pub sheets: Vec<SheetFacts>,
    #[serde(default)]
    pub drawings: Vec<SheetDrawingFacts>,
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
        self.drawings.sort_by(|a, b| {
            a.sheet_index
                .cmp(&b.sheet_index)
                .then_with(|| a.sheet_name.cmp(&b.sheet_name))
        });
        for sheet in &mut self.sheets {
            sheet.name = sheet.name.trim().to_string();
        }
        for drawing in &mut self.drawings {
            drawing.sheet_name = drawing.sheet_name.trim().to_string();
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

#[derive(Debug, Clone, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub struct SheetDrawingFacts {
    pub sheet_index: u32,
    pub sheet_name: String,
    pub drawing: DrawingFacts,
}

#[derive(Debug, Clone, PartialEq, Eq, Default, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub struct DrawingFacts {
    pub anchors: Vec<AnchorFact>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub struct AnchorFact {
    pub kind: AnchorKindFact,
    pub geometry: AnchorGeometryFact,
    pub object: ObjectFact,
    pub client_data: ClientDataFact,
    pub raw_alternate_content: bool,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum AnchorKindFact {
    TwoCell,
    OneCell,
    Absolute,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum AnchorGeometryFact {
    TwoCell {
        from: CellAnchorFact,
        to: CellAnchorFact,
        edit_as: Option<String>,
    },
    OneCell {
        from: CellAnchorFact,
        extent: ExtentFact,
    },
    Absolute {
        position: PositionFact,
        extent: ExtentFact,
    },
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub struct CellAnchorFact {
    pub col: u32,
    pub row: u32,
    pub col_off: i64,
    pub row_off: i64,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub struct ExtentFact {
    pub cx: i64,
    pub cy: i64,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub struct PositionFact {
    pub x: i64,
    pub y: i64,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub struct ClientDataFact {
    pub locks_with_sheet: bool,
    pub prints_with_sheet: bool,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
#[allow(clippy::large_enum_variant)]
pub enum ObjectFact {
    Picture(PictureFact),
    Shape(ShapeFact),
    Connector(ConnectorFact),
    Group(GroupFact),
    GraphicFrame(GraphicFrameFact),
    SmartArt(SmartArtFact),
    Unknown,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub struct PictureFact {
    pub name: String,
    pub source_targets: Vec<String>,
    pub fill_mode: Option<String>,
    pub crop: Option<SourceRectFact>,
    pub blip_effect_count: usize,
    pub properties: ShapePropertiesFact,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub struct ShapeFact {
    pub name: String,
    pub preset: Option<String>,
    pub text: TextFact,
    pub properties: ShapePropertiesFact,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub struct ConnectorFact {
    pub name: String,
    pub preset: Option<String>,
    pub start_connection: Option<ConnectionFact>,
    pub end_connection: Option<ConnectionFact>,
    pub properties: ShapePropertiesFact,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub struct GroupFact {
    pub name: String,
    pub transform: Option<GroupTransformFact>,
    pub child_count: usize,
    pub children: Vec<ObjectFact>,
    pub has_fill: bool,
    pub has_effects: bool,
    pub has_3d: bool,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub struct GraphicFrameFact {
    pub name: String,
    pub classification: GraphicFrameKindFact,
    pub relationship_targets: Vec<String>,
    pub opaque_preserved: bool,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum GraphicFrameKindFact {
    Chart,
    ChartEx,
    SlicerLike,
    Opaque,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub struct SmartArtFact {
    pub relationship_targets: Vec<String>,
}

#[derive(Debug, Clone, PartialEq, Eq, Default, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub struct ShapePropertiesFact {
    pub transform: Option<TransformFact>,
    pub preset: Option<String>,
    pub fill: Option<String>,
    pub fill_detail: Option<String>,
    pub outline: bool,
    pub outline_detail: Option<String>,
    pub effects: bool,
    pub effect_detail: Option<String>,
    pub scene3d: bool,
    pub scene3d_detail: Option<String>,
    pub shape3d: bool,
    pub shape3d_detail: Option<String>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub struct TransformFact {
    pub offset: Option<(i64, i64)>,
    pub extent: Option<(u64, u64)>,
    pub rotation: Option<i32>,
    pub flip_h: Option<bool>,
    pub flip_v: Option<bool>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub struct GroupTransformFact {
    pub offset: Option<(i64, i64)>,
    pub extent: Option<(u64, u64)>,
    pub child_offset: Option<(i64, i64)>,
    pub child_extent: Option<(u64, u64)>,
    pub rotation: Option<i32>,
    pub flip_h: Option<bool>,
    pub flip_v: Option<bool>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub struct SourceRectFact {
    pub top: u32,
    pub bottom: u32,
    pub left: u32,
    pub right: u32,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub struct ConnectionFact {
    pub shape_id: u32,
    pub idx: u32,
}

#[derive(Debug, Clone, PartialEq, Eq, Default, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub struct TextFact {
    pub paragraph_count: usize,
    pub run_count: usize,
    pub field_count: usize,
    pub break_count: usize,
    pub text: String,
    #[serde(default)]
    pub body: TextBodyFact,
    #[serde(default)]
    pub paragraphs: Vec<ParagraphFact>,
    #[serde(default)]
    pub runs: Vec<TextRunFact>,
    #[serde(default)]
    pub fields: Vec<TextFieldFact>,
    #[serde(default)]
    pub breaks: Vec<TextBreakFact>,
    #[serde(default)]
    pub end_paragraph_runs: Vec<TextRunPropertiesFact>,
}

#[derive(Debug, Clone, PartialEq, Eq, Default, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub struct TextBodyFact {
    pub anchor: Option<String>,
    pub wrap: Option<String>,
    pub vertical: Option<String>,
    pub vertical_overflow: Option<String>,
    pub horizontal_overflow: Option<String>,
    pub rotation: Option<i32>,
    pub inset_left: Option<i64>,
    pub inset_top: Option<i64>,
    pub inset_right: Option<i64>,
    pub inset_bottom: Option<i64>,
    pub autofit: Option<String>,
    pub preset_warp: Option<String>,
}

#[derive(Debug, Clone, PartialEq, Eq, Default, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub struct ParagraphFact {
    pub index: usize,
    pub align: Option<String>,
    pub level: Option<u32>,
    pub margin_left: Option<i64>,
    pub margin_right: Option<i64>,
    pub indent: Option<i64>,
    pub rtl: Option<bool>,
    pub font_align: Option<String>,
    pub line_spacing: Option<String>,
    pub space_before: Option<String>,
    pub space_after: Option<String>,
    pub bullet: Option<BulletFact>,
    pub tab_count: usize,
    pub tabs: Vec<TextTabFact>,
    pub default_run: Option<TextRunPropertiesFact>,
}

#[derive(Debug, Clone, PartialEq, Eq, Default, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub struct TextRunFact {
    pub paragraph_index: usize,
    pub run_index: usize,
    pub text: String,
    pub properties: TextRunPropertiesFact,
}

#[derive(Debug, Clone, PartialEq, Eq, Default, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub struct TextFieldFact {
    pub paragraph_index: usize,
    pub run_index: usize,
    pub id: String,
    pub field_type: Option<String>,
    pub text: Option<String>,
    pub properties: Option<TextRunPropertiesFact>,
}

#[derive(Debug, Clone, PartialEq, Eq, Default, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub struct TextBreakFact {
    pub paragraph_index: usize,
    pub run_index: usize,
    pub properties: Option<TextRunPropertiesFact>,
}

#[derive(Debug, Clone, PartialEq, Eq, Default, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub struct TextRunPropertiesFact {
    pub size: Option<u32>,
    pub bold: Option<bool>,
    pub italic: Option<bool>,
    pub underline: Option<String>,
    pub strike: Option<String>,
    pub color: Option<String>,
    pub fill: Option<String>,
    pub highlight: Option<String>,
    pub latin_font: Option<String>,
    pub east_asian_font: Option<String>,
    pub complex_script_font: Option<String>,
    pub symbol_font: Option<String>,
    pub language: Option<String>,
    pub alternate_language: Option<String>,
    pub kerning: Option<u32>,
    pub caps: Option<String>,
    pub spacing: Option<i32>,
    pub baseline: Option<i32>,
    pub click_target: Option<String>,
    pub mouse_over_target: Option<String>,
    pub bookmark: Option<String>,
    pub rtl: Option<bool>,
    pub effects: bool,
    pub outline: bool,
    pub underline_line: Option<String>,
    pub underline_fill: Option<String>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub struct BulletFact {
    pub kind: String,
    pub color: Option<String>,
    pub size: Option<String>,
    pub font: Option<String>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub struct TextTabFact {
    pub position: Option<i64>,
    pub align: Option<String>,
}
