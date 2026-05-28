//! Shared controls data contracts.
//!
//! These types are consumed by parsing, writing, output mapping, and tests.

use std::collections::HashMap;

use domain_types::domain::floating_object::FormControlWorksheetControlPr;
use ooxml_types::ole::{DvAspect, ObjectProperties, OleUpdate};

/// Indicates how a control anchor's offsets should be interpreted.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum AnchorSource {
    /// Modern (Office 2010+) anchor from `<controlPr><anchor>` -- offsets are EMU values.
    Modern,
    /// Legacy VML anchor from `<x:Anchor>` -- offsets are pixel values.
    Vml,
}

impl Default for AnchorSource {
    fn default() -> Self {
        AnchorSource::Vml
    }
}

/// Result of parsing a modern anchor element, including the positioning policy flags.
#[derive(Debug, Clone)]
pub struct ModernAnchorResult {
    /// The parsed anchor position.
    pub anchor: ControlAnchor,
    /// Whether the control moves with the cells it is anchored to.
    pub move_with_cells: bool,
    /// Whether the control resizes with the cells it is anchored to.
    pub size_with_cells: bool,
}

/// Form control from ctrlProp*.xml.
#[derive(Debug, Clone)]
pub struct FormControl {
    /// Type of form control.
    pub object_type: FormControlType,
    /// Anchor position in the worksheet.
    pub anchor: ControlAnchor,
    /// Control properties.
    pub properties: FormControlProperties,
    /// Original shapeId from the worksheet `<control>` element (for round-trip fidelity).
    /// When `Some`, the writer uses this exact value instead of a computed one.
    pub shape_id: Option<u32>,
    /// Raw attributes from the worksheet `<controlPr>` element for round-trip fidelity.
    /// Keys are attribute names (e.g. "print", "autoPict", "macro"), values are string values.
    pub control_pr_attrs: HashMap<String, String>,
    /// Typed worksheet `<controlPr>` element attributes.
    pub control_pr: Option<FormControlWorksheetControlPr>,
    /// Whether the control moves with the cells it is anchored to.
    pub move_with_cells: bool,
    /// Whether the control resizes with the cells it is anchored to.
    pub size_with_cells: bool,
    /// VML shape-level properties parsed from the `v:shape` element.
    /// These are visual properties that only exist in VML, not in ctrlProp XML.
    pub vml_shape: VmlShapeProps,
}

// `VmlShapeProps` has moved to `domain-types::domain::drawings::vml_shape`
// (typed OOXML preservation). It is re-exported here so parser call sites and
// `FormControlOutput` field types keep compiling unchanged.
pub use domain_types::domain::drawings::VmlShapeProps;

impl FormControl {
    /// Create a new form control.
    pub fn new(object_type: FormControlType) -> Self {
        Self {
            object_type,
            anchor: ControlAnchor::default(),
            properties: FormControlProperties::default(),
            shape_id: None,
            control_pr_attrs: HashMap::new(),
            control_pr: None,
            // Authored controls preserve the historical writer defaults; parsed
            // modern anchors overwrite these with the exact source attributes.
            move_with_cells: true,
            size_with_cells: true,
            vml_shape: VmlShapeProps::default(),
        }
    }

    /// Create with anchor.
    pub fn with_anchor(object_type: FormControlType, anchor: ControlAnchor) -> Self {
        Self {
            object_type,
            anchor,
            properties: FormControlProperties::default(),
            shape_id: None,
            control_pr_attrs: HashMap::new(),
            control_pr: None,
            // Authored controls preserve the historical writer defaults; parsed
            // modern anchors overwrite these with the exact source attributes.
            move_with_cells: true,
            size_with_cells: true,
            vml_shape: VmlShapeProps::default(),
        }
    }
}

/// Form control types.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum FormControlType {
    /// Push button.
    Button,
    /// Checkbox control.
    CheckBox,
    /// Combo box (dropdown).
    ComboBox,
    /// List box.
    ListBox,
    /// Radio button (option button).
    RadioButton,
    /// Group box container.
    GroupBox,
    /// Label text.
    Label,
    /// Scroll bar.
    ScrollBar,
    /// Spinner (up/down arrows).
    Spinner,
    /// Edit box (text input).
    EditBox,
    /// Dialog frame.
    Dialog,
    /// Unknown control type.
    Unknown(String),
}

impl FormControlType {
    /// Parse control type from string.
    pub fn from_str(s: &str) -> Self {
        super::mapping::parse_form_control_type(s)
    }
}

impl std::fmt::Display for FormControlType {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            FormControlType::Button => write!(f, "Button"),
            FormControlType::CheckBox => write!(f, "CheckBox"),
            FormControlType::ComboBox => write!(f, "ComboBox"),
            FormControlType::ListBox => write!(f, "ListBox"),
            FormControlType::RadioButton => write!(f, "RadioButton"),
            FormControlType::GroupBox => write!(f, "GroupBox"),
            FormControlType::Label => write!(f, "Label"),
            FormControlType::ScrollBar => write!(f, "ScrollBar"),
            FormControlType::Spinner => write!(f, "Spinner"),
            FormControlType::EditBox => write!(f, "EditBox"),
            FormControlType::Dialog => write!(f, "Dialog"),
            FormControlType::Unknown(s) => write!(f, "{}", s),
        }
    }
}

/// Form control properties from CT_FormControlPr.
#[derive(Debug, Clone, Default)]
pub struct FormControlProperties {
    /// Control name (from <control> element, not formControlPr).
    pub name: Option<String>,
    /// Alternative text for accessibility (altText).
    pub alt_text: Option<String>,
    /// Linked cell (cell link) (fmlaLink).
    pub linked_cell: Option<String>,
    /// Input range (list source for combo/list) (fmlaRange).
    pub input_range: Option<String>,
    /// Group formula (fmlaGroup).
    pub fmla_group: Option<String>,
    /// Text box formula (fmlaTxbx).
    pub fmla_txbx: Option<String>,
    /// Check state for checkboxes (checked).
    pub checked: Option<CheckState>,
    /// Current value for scroll/spin (val).
    pub val: Option<u32>,
    /// Selected index for list/combo (sel).
    pub sel: Option<u32>,
    /// Minimum value for scroll/spin (min).
    pub min_value: Option<i32>,
    /// Maximum value for scroll/spin (max).
    pub max_value: Option<i32>,
    /// Increment for scroll/spin (inc).
    pub increment: Option<i32>,
    /// Page increment for scroll bar (page).
    pub page_increment: Option<i32>,
    /// Number of drop lines for combo/list (dropLines).
    pub drop_lines: Option<u32>,
    /// Selection type for list box (seltype).
    pub sel_type: Option<String>,
    /// Drop style for combo box (dropStyle).
    pub drop_style: Option<String>,
    /// Assigned macro name (macro).
    pub macro_name: Option<String>,
    /// Whether the control uses colored appearance (colored).
    pub colored: bool,
    /// Scroll bar width in pixels (dx).
    pub dx: Option<u32>,
    /// Horizontal orientation for scroll/spin (horiz).
    pub horiz: bool,
    /// Whether this is the first button in a radio group (firstButton).
    pub first_button: bool,
    /// Flat appearance for control (noThreeD).
    pub no_three_d: bool,
    /// Flat appearance for text (noThreeD2).
    pub no_three_d2: bool,
    /// Prevents text editing on control (lockText).
    pub lock_text: bool,
    /// Multiple selection mode (multiSel).
    pub multi_sel: Option<String>,
    /// Text horizontal alignment (textHAlign).
    pub text_h_align: Option<String>,
    /// Text vertical alignment (textVAlign).
    pub text_v_align: Option<String>,
    /// Edit validation (editVal).
    pub edit_val: Option<String>,
    /// Multi-line text box (multiLine).
    pub multi_line: bool,
    /// Vertical scroll bar (verticalBar).
    pub vertical_bar: bool,
    /// Password edit mode (passwordEdit).
    pub password_edit: bool,
    /// Justify last line (justLastX).
    pub just_last_x: bool,
    /// Minimum width (widthMin).
    pub width_min: Option<u32>,
    /// List items from <itemLst> child element.
    pub items: Vec<String>,
    /// VML-only CT_ClientData children with no modern CT_FormControlPr equivalent.
    /// Stored as tag-name -> text-content pairs for lossless roundtrip.
    pub vml_extras: HashMap<String, String>,
}

impl FormControlProperties {
    /// Create new empty properties.
    pub fn new() -> Self {
        Self::default()
    }

    /// Set linked cell.
    pub fn with_linked_cell(mut self, cell: String) -> Self {
        self.linked_cell = Some(cell);
        self
    }

    /// Set input range.
    pub fn with_input_range(mut self, range: String) -> Self {
        self.input_range = Some(range);
        self
    }

    /// Set check state.
    pub fn with_checked(mut self, state: CheckState) -> Self {
        self.checked = Some(state);
        self
    }
}

/// Check state for checkboxes.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum CheckState {
    /// Unchecked state.
    Unchecked,
    /// Checked state.
    Checked,
    /// Mixed/indeterminate state.
    Mixed,
}

impl CheckState {
    /// Parse from string.
    pub fn from_str(s: &str) -> Self {
        super::mapping::parse_check_state(s)
    }
}

impl Default for CheckState {
    fn default() -> Self {
        CheckState::Unchecked
    }
}

/// Control anchor position.
#[derive(Debug, Clone, Default)]
pub struct ControlAnchor {
    /// Starting column (0-indexed).
    pub from_col: u32,
    /// Starting row (0-indexed).
    pub from_row: u32,
    /// Ending column (0-indexed).
    pub to_col: u32,
    /// Ending row (0-indexed).
    pub to_row: u32,
    /// X offset from column start (pixels for VML, EMUs for Modern).
    pub from_col_offset: i64,
    /// Y offset from row start (pixels for VML, EMUs for Modern).
    pub from_row_offset: i64,
    /// X offset at end column (pixels for VML, EMUs for Modern).
    pub to_col_offset: i64,
    /// Y offset at end row (pixels for VML, EMUs for Modern).
    pub to_row_offset: i64,
    /// Whether offsets are EMU (Modern) or pixel (VML) values.
    pub anchor_source: AnchorSource,
}

impl ControlAnchor {
    /// Create a new anchor.
    pub fn new(from_col: u32, from_row: u32, to_col: u32, to_row: u32) -> Self {
        Self {
            from_col,
            from_row,
            to_col,
            to_row,
            ..Default::default()
        }
    }

    /// Parse anchor from VML anchor string (8 comma-separated values).
    /// Format: fromCol, fromColOff, fromRow, fromRowOff, toCol, toColOff, toRow, toRowOff.
    pub fn from_vml_anchor(anchor: &str) -> Option<Self> {
        super::anchors::parse_vml_anchor(anchor)
    }

    /// Parse anchor from modern Office 2010+ XML format.
    ///
    /// Expected XML structure:
    /// ```xml
    /// <anchor moveWithCells="1" sizeWithCells="0">
    ///   <from><col>1</col><colOff>152400</colOff><row>2</row><rowOff>76200</rowOff></from>
    ///   <to><col>3</col><colOff>457200</colOff><row>4</row><rowOff>19050</rowOff></to>
    /// </anchor>
    /// ```
    ///
    /// Offsets are EMU values (`a:ST_Coordinate` = `xsd:long`).
    pub fn from_modern_anchor(xml: &[u8]) -> Option<ModernAnchorResult> {
        super::anchors::parse_modern_anchor(xml)
    }
}

/// ActiveX control.
#[derive(Debug, Clone)]
pub struct ActiveXControl {
    /// COM class ID (GUID).
    pub class_id: String,
    /// Persistence path (path to binary data).
    pub persistence: String,
    /// Control anchor position.
    pub anchor: ControlAnchor,
    /// Control name.
    pub name: Option<String>,
}

impl ActiveXControl {
    /// Create a new ActiveX control.
    pub fn new(class_id: String, persistence: String) -> Self {
        Self {
            class_id,
            persistence,
            anchor: ControlAnchor::default(),
            name: None,
        }
    }

    /// Check if this is a known control type by class ID.
    pub fn control_type(&self) -> &'static str {
        match self.class_id.to_uppercase().as_str() {
            id if id.contains("8BD21D10-EC42-11CE-9E0D-00AA006002F3") => "TextBox",
            id if id.contains("8BD21D20-EC42-11CE-9E0D-00AA006002F3") => "ListBox",
            id if id.contains("8BD21D30-EC42-11CE-9E0D-00AA006002F3") => "ComboBox",
            id if id.contains("8BD21D40-EC42-11CE-9E0D-00AA006002F3") => "CheckBox",
            id if id.contains("8BD21D50-EC42-11CE-9E0D-00AA006002F3") => "OptionButton",
            id if id.contains("8BD21D60-EC42-11CE-9E0D-00AA006002F3") => "ToggleButton",
            id if id.contains("D7053240-CE69-11CD-A777-00DD01143C57") => "CommandButton",
            _ => "Unknown",
        }
    }
}

/// OLE embedded object.
#[derive(Debug, Clone)]
pub struct OleObject {
    /// Program ID (e.g., "Excel.Sheet.12", "Word.Document.12").
    pub prog_id: String,
    /// Shape ID in the drawing.
    pub shape_id: u32,
    /// Path to embedded data (resolved from r:id relationship).
    pub data_path: Option<String>,
    /// Relationship/payload kind for the embedded data.
    pub embedding_kind: Option<String>,
    /// Content type inferred or read for the embedded data.
    pub embedding_content_type: Option<String>,
    /// Path to linked data (external file).
    pub link_path: Option<String>,
    /// Object name.
    pub name: Option<String>,
    /// Anchor position.
    pub anchor: ControlAnchor,
    /// Display aspect -- content or icon (ST_DvAspect).
    pub dv_aspect: DvAspect,
    /// Update policy for linked objects (ST_OleUpdate).
    pub ole_update: OleUpdate,
    /// Whether to automatically load the object when the workbook opens.
    pub auto_load: bool,
    /// Relationship ID (`r:id`) pointing to the embedded binary part.
    pub r_id: Option<String>,
    /// Object properties (from `<objectPr>` child element).
    pub object_pr: Option<ObjectProperties>,
    /// VML relationship ID for the preview image (from `<v:imagedata>`).
    pub preview_image_rel_id: Option<String>,
    /// Resolved path to the preview image (e.g., `xl/media/image1.png`).
    pub preview_image_path: Option<String>,
}

impl OleObject {
    /// Create a new OLE object.
    pub fn new(prog_id: String, shape_id: u32) -> Self {
        Self {
            prog_id,
            shape_id,
            data_path: None,
            embedding_kind: None,
            embedding_content_type: None,
            link_path: None,
            name: None,
            anchor: ControlAnchor::default(),
            dv_aspect: DvAspect::default(),
            ole_update: OleUpdate::default(),
            auto_load: false,
            r_id: None,
            object_pr: None,
            preview_image_rel_id: None,
            preview_image_path: None,
        }
    }

    /// Check if this is an embedded object.
    pub fn is_embedded(&self) -> bool {
        self.data_path.is_some()
    }

    /// Check if this is a linked object.
    pub fn is_linked(&self) -> bool {
        self.link_path.is_some()
    }
}

/// Collection of all controls in a worksheet.
#[derive(Debug, Default)]
pub struct WorksheetControls {
    /// Form controls.
    pub form_controls: Vec<FormControl>,
    /// ActiveX controls.
    pub activex_controls: Vec<ActiveXControl>,
    /// OLE embedded objects.
    pub ole_objects: Vec<OleObject>,
}

/// A control reference extracted from the worksheet XML's `<controls>` element.
///
/// In OOXML, the worksheet XML contains a `<controls>` block (inside
/// `mc:AlternateContent -> mc:Choice Requires="x14"`) that lists each control
/// with its shape ID, relationship ID, and optional name. This struct captures
/// that per-control metadata.
///
/// The relationship ID (`r_id`) links to a `ctrlProp*.xml` part that contains
/// the control's full properties.
#[derive(Debug, Clone)]
pub struct WorksheetControlRef {
    /// `CT_Control.shapeId` (required) -- VML shape identifier.
    pub shape_id: u32,
    /// `CT_Control.r:id` (required) -- Relationship ID to the `ctrlProp*.xml` part.
    pub r_id: String,
    /// `CT_Control.name` (optional) -- Human-readable control name.
    pub name: Option<String>,
}

/// Backwards-compatible alias for worksheet-level control references.
pub type WorksheetControl = WorksheetControlRef;
