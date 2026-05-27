//! Form controls and embedded objects parser for XLSX files
//!
//! This module parses form controls (checkbox, dropdown, button, etc.),
//! ActiveX controls, and OLE embedded objects from XLSX archives.
//!
//! # XLSX Controls Structure
//!
//! Form controls are defined in:
//! - `xl/ctrlProps/ctrlProp*.xml` - Control properties
//! - `xl/drawings/vmlDrawing*.vml` - VML shapes for control positioning
//!
//! ## Example: Form Control (Checkbox)
//! ```xml
//! <formControlPr xmlns="http://schemas.microsoft.com/office/spreadsheetml/2009/9/main"
//!                objectType="CheckBox"
//!                checked="Checked"
//!                fmlaLink="$A$1"
//!                lockText="1"/>
//! ```
//!
//! ## Example: VML Shape
//! ```xml
//! <v:shape type="#_x0000_t201" style="position:absolute;left:48pt;top:15pt;width:72pt;height:21pt">
//!   <v:textbox>
//!     <div>Checkbox 1</div>
//!   </v:textbox>
//!   <x:ClientData ObjectType="Checkbox">
//!     <x:Anchor>1,15,0,10,3,22,1,4</x:Anchor>
//!     <x:FmlaLink>$A$1</x:FmlaLink>
//!   </x:ClientData>
//! </v:shape>
//! ```
//!
//! UTF-8 boundary guard: every `&s[n..]` / `&s[..n]` in this file slices
//! form-control XML / VML content at byte offsets produced by
//! ASCII-only XML/VML syntax (`<`, `>`, `"`, `=`, `,`). Char-boundary
//! by construction. File-scope allow documented here.

#![allow(clippy::string_slice)]

use std::collections::HashMap;

use ooxml_types::ole::{CellAnchorPoint, DvAspect, ObjectAnchor, ObjectProperties, OleUpdate};

use crate::infra::scanner::{
    extract_quoted_value, find_attr_simd, find_closing_tag, find_gt_simd, find_tag_simd,
};
use crate::infra::xml::{
    parse_bool_attr, parse_string_attr, parse_string_attr_verbatim, parse_u32_attr,
    resolve_mc_alternate_content,
};

/// Indicates how a control anchor's offsets should be interpreted.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum AnchorSource {
    /// Modern (Office 2010+) anchor from `<controlPr><anchor>` — offsets are EMU values.
    Modern,
    /// Legacy VML anchor from `<x:Anchor>` — offsets are pixel values.
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
    /// The parsed anchor position
    pub anchor: ControlAnchor,
    /// Whether the control moves with the cells it is anchored to
    pub move_with_cells: bool,
    /// Whether the control resizes with the cells it is anchored to
    pub size_with_cells: bool,
}

/// Form control from ctrlProp*.xml
#[derive(Debug, Clone)]
pub struct FormControl {
    /// Type of form control
    pub object_type: FormControlType,
    /// Anchor position in the worksheet
    pub anchor: ControlAnchor,
    /// Control properties
    pub properties: FormControlProperties,
    /// Original shapeId from the worksheet `<control>` element (for round-trip fidelity).
    /// When `Some`, the writer uses this exact value instead of a computed one.
    pub shape_id: Option<u32>,
    /// Raw attributes from the worksheet `<controlPr>` element for round-trip fidelity.
    /// Keys are attribute names (e.g. "print", "autoPict", "macro"), values are string values.
    pub control_pr_attrs: std::collections::HashMap<String, String>,
    /// Whether the control moves with the cells it is anchored to.
    pub move_with_cells: bool,
    /// Whether the control resizes with the cells it is anchored to.
    pub size_with_cells: bool,
    /// VML shape-level properties parsed from the `v:shape` element.
    /// These are visual properties that only exist in VML, not in ctrlProp XML.
    pub vml_shape: VmlShapeProps,
}

// `VmlShapeProps` has moved to `domain-types::domain::drawings::vml_shape`
// (typed OOXML preservation). It is re-exported here so the ~half-dozen
// parser call sites and `FormControlOutput` field type keep compiling
// unchanged.
pub use domain_types::domain::drawings::VmlShapeProps;

impl FormControl {
    /// Create a new form control
    pub fn new(object_type: FormControlType) -> Self {
        Self {
            object_type,
            anchor: ControlAnchor::default(),
            properties: FormControlProperties::default(),
            shape_id: None,
            control_pr_attrs: std::collections::HashMap::new(),
            // Authored controls preserve the historical writer defaults; parsed
            // modern anchors overwrite these with the exact source attributes.
            move_with_cells: true,
            size_with_cells: true,
            vml_shape: VmlShapeProps::default(),
        }
    }

    /// Create with anchor
    pub fn with_anchor(object_type: FormControlType, anchor: ControlAnchor) -> Self {
        Self {
            object_type,
            anchor,
            properties: FormControlProperties::default(),
            shape_id: None,
            control_pr_attrs: std::collections::HashMap::new(),
            // Authored controls preserve the historical writer defaults; parsed
            // modern anchors overwrite these with the exact source attributes.
            move_with_cells: true,
            size_with_cells: true,
            vml_shape: VmlShapeProps::default(),
        }
    }
}

/// Form control types
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum FormControlType {
    /// Push button
    Button,
    /// Checkbox control
    CheckBox,
    /// Combo box (dropdown)
    ComboBox,
    /// List box
    ListBox,
    /// Radio button (option button)
    RadioButton,
    /// Group box container
    GroupBox,
    /// Label text
    Label,
    /// Scroll bar
    ScrollBar,
    /// Spinner (up/down arrows)
    Spinner,
    /// Edit box (text input)
    EditBox,
    /// Dialog frame
    Dialog,
    /// Unknown control type
    Unknown(String),
}

impl FormControlType {
    /// Parse control type from string
    pub fn from_str(s: &str) -> Self {
        match s.to_lowercase().as_str() {
            "button" => FormControlType::Button,
            "checkbox" => FormControlType::CheckBox,
            "drop" | "combobox" => FormControlType::ComboBox,
            "list" | "listbox" => FormControlType::ListBox,
            "radio" | "radiobutton" | "optionbutton" => FormControlType::RadioButton,
            "groupbox" | "group" | "gbox" => FormControlType::GroupBox,
            "label" => FormControlType::Label,
            "scrollbar" | "scroll" => FormControlType::ScrollBar,
            "spinner" | "spin" => FormControlType::Spinner,
            "editbox" | "edit" => FormControlType::EditBox,
            "dialog" => FormControlType::Dialog,
            _ => FormControlType::Unknown(s.to_string()),
        }
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

/// Form control properties from CT_FormControlPr
#[derive(Debug, Clone, Default)]
pub struct FormControlProperties {
    /// Control name (from <control> element, not formControlPr)
    pub name: Option<String>,
    /// Alternative text for accessibility (altText)
    pub alt_text: Option<String>,
    /// Linked cell (cell link) (fmlaLink)
    pub linked_cell: Option<String>,
    /// Input range (list source for combo/list) (fmlaRange)
    pub input_range: Option<String>,
    /// Group formula (fmlaGroup)
    pub fmla_group: Option<String>,
    /// Text box formula (fmlaTxbx)
    pub fmla_txbx: Option<String>,
    /// Check state for checkboxes (checked)
    pub checked: Option<CheckState>,
    /// Current value for scroll/spin (val)
    pub val: Option<u32>,
    /// Selected index for list/combo (sel)
    pub sel: Option<u32>,
    /// Minimum value for scroll/spin (min)
    pub min_value: Option<i32>,
    /// Maximum value for scroll/spin (max)
    pub max_value: Option<i32>,
    /// Increment for scroll/spin (inc)
    pub increment: Option<i32>,
    /// Page increment for scroll bar (page)
    pub page_increment: Option<i32>,
    /// Number of drop lines for combo/list (dropLines)
    pub drop_lines: Option<u32>,
    /// Selection type for list box (seltype)
    pub sel_type: Option<String>,
    /// Drop style for combo box (dropStyle)
    pub drop_style: Option<String>,
    /// Assigned macro name (macro)
    pub macro_name: Option<String>,
    /// Whether the control uses colored appearance (colored)
    pub colored: bool,
    /// Scroll bar width in pixels (dx)
    pub dx: Option<u32>,
    /// Horizontal orientation for scroll/spin (horiz)
    pub horiz: bool,
    /// Whether this is the first button in a radio group (firstButton)
    pub first_button: bool,
    /// Flat appearance for control (noThreeD)
    pub no_three_d: bool,
    /// Flat appearance for text (noThreeD2)
    pub no_three_d2: bool,
    /// Prevents text editing on control (lockText)
    pub lock_text: bool,
    /// Multiple selection mode (multiSel)
    pub multi_sel: Option<String>,
    /// Text horizontal alignment (textHAlign)
    pub text_h_align: Option<String>,
    /// Text vertical alignment (textVAlign)
    pub text_v_align: Option<String>,
    /// Edit validation (editVal)
    pub edit_val: Option<String>,
    /// Multi-line text box (multiLine)
    pub multi_line: bool,
    /// Vertical scroll bar (verticalBar)
    pub vertical_bar: bool,
    /// Password edit mode (passwordEdit)
    pub password_edit: bool,
    /// Justify last line (justLastX)
    pub just_last_x: bool,
    /// Minimum width (widthMin)
    pub width_min: Option<u32>,
    /// List items from <itemLst> child element
    pub items: Vec<String>,
    /// VML-only CT_ClientData children with no modern CT_FormControlPr equivalent.
    /// Stored as tag-name -> text-content pairs for lossless roundtrip.
    pub vml_extras: HashMap<String, String>,
}

impl FormControlProperties {
    /// Create new empty properties
    pub fn new() -> Self {
        Self::default()
    }

    /// Set linked cell
    pub fn with_linked_cell(mut self, cell: String) -> Self {
        self.linked_cell = Some(cell);
        self
    }

    /// Set input range
    pub fn with_input_range(mut self, range: String) -> Self {
        self.input_range = Some(range);
        self
    }

    /// Set check state
    pub fn with_checked(mut self, state: CheckState) -> Self {
        self.checked = Some(state);
        self
    }
}

/// Check state for checkboxes
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum CheckState {
    /// Unchecked state
    Unchecked,
    /// Checked state
    Checked,
    /// Mixed/indeterminate state
    Mixed,
}

impl CheckState {
    /// Parse from string
    pub fn from_str(s: &str) -> Self {
        match s.to_lowercase().as_str() {
            "checked" | "1" | "true" => CheckState::Checked,
            "mixed" | "2" => CheckState::Mixed,
            _ => CheckState::Unchecked,
        }
    }
}

impl Default for CheckState {
    fn default() -> Self {
        CheckState::Unchecked
    }
}

/// Control anchor position
#[derive(Debug, Clone, Default)]
pub struct ControlAnchor {
    /// Starting column (0-indexed)
    pub from_col: u32,
    /// Starting row (0-indexed)
    pub from_row: u32,
    /// Ending column (0-indexed)
    pub to_col: u32,
    /// Ending row (0-indexed)
    pub to_row: u32,
    /// X offset from column start (pixels for VML, EMUs for Modern)
    pub from_col_offset: i64,
    /// Y offset from row start (pixels for VML, EMUs for Modern)
    pub from_row_offset: i64,
    /// X offset at end column (pixels for VML, EMUs for Modern)
    pub to_col_offset: i64,
    /// Y offset at end row (pixels for VML, EMUs for Modern)
    pub to_row_offset: i64,
    /// Whether offsets are EMU (Modern) or pixel (VML) values
    pub anchor_source: AnchorSource,
}

impl ControlAnchor {
    /// Create a new anchor
    pub fn new(from_col: u32, from_row: u32, to_col: u32, to_row: u32) -> Self {
        Self {
            from_col,
            from_row,
            to_col,
            to_row,
            ..Default::default()
        }
    }

    /// Parse anchor from VML anchor string (8 comma-separated values)
    /// Format: fromCol, fromColOff, fromRow, fromRowOff, toCol, toColOff, toRow, toRowOff
    pub fn from_vml_anchor(anchor: &str) -> Option<Self> {
        let parts: Vec<&str> = anchor.split(',').collect();
        if parts.len() >= 8 {
            Some(Self {
                from_col: parts[0].trim().parse().unwrap_or(0),
                from_col_offset: parts[1].trim().parse().unwrap_or(0),
                from_row: parts[2].trim().parse().unwrap_or(0),
                from_row_offset: parts[3].trim().parse().unwrap_or(0),
                to_col: parts[4].trim().parse().unwrap_or(0),
                to_col_offset: parts[5].trim().parse().unwrap_or(0),
                to_row: parts[6].trim().parse().unwrap_or(0),
                to_row_offset: parts[7].trim().parse().unwrap_or(0),
                anchor_source: AnchorSource::Vml,
            })
        } else {
            None
        }
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
        let anchor_start = find_tag_simd(xml, b"anchor", 0)?;
        let anchor_end = find_closing_tag(xml, b"anchor", anchor_start)?;
        let anchor_xml = &xml[anchor_start..anchor_end];

        // Parse moveWithCells / sizeWithCells attributes from the <anchor> element
        let element_end = find_gt_simd(anchor_xml, 0)
            .map(|p| p + 1)
            .unwrap_or(anchor_xml.len());
        let element = &anchor_xml[..element_end];
        let move_with_cells = parse_bool_attr(element, b"moveWithCells=\"");
        let size_with_cells = parse_bool_attr(element, b"sizeWithCells=\"");

        // Parse <from> child
        let from_start = find_tag_simd(anchor_xml, b"from", 0)?;
        let from_end = find_closing_tag(anchor_xml, b"from", from_start)?;
        let from_xml = &anchor_xml[from_start..from_end];

        let from_col = parse_child_element_u32(from_xml, b"col").unwrap_or(0);
        let from_col_offset = parse_child_element_i64(from_xml, b"colOff").unwrap_or(0);
        let from_row = parse_child_element_u32(from_xml, b"row").unwrap_or(0);
        let from_row_offset = parse_child_element_i64(from_xml, b"rowOff").unwrap_or(0);

        // Parse <to> child
        let to_start = find_tag_simd(anchor_xml, b"to", 0)?;
        let to_end = find_closing_tag(anchor_xml, b"to", to_start)?;
        let to_xml = &anchor_xml[to_start..to_end];

        let to_col = parse_child_element_u32(to_xml, b"col").unwrap_or(0);
        let to_col_offset = parse_child_element_i64(to_xml, b"colOff").unwrap_or(0);
        let to_row = parse_child_element_u32(to_xml, b"row").unwrap_or(0);
        let to_row_offset = parse_child_element_i64(to_xml, b"rowOff").unwrap_or(0);

        Some(ModernAnchorResult {
            anchor: ControlAnchor {
                from_col,
                from_col_offset,
                from_row,
                from_row_offset,
                to_col,
                to_col_offset,
                to_row,
                to_row_offset,
                anchor_source: AnchorSource::Modern,
            },
            move_with_cells,
            size_with_cells,
        })
    }
}

/// ActiveX control
#[derive(Debug, Clone)]
pub struct ActiveXControl {
    /// COM class ID (GUID)
    pub class_id: String,
    /// Persistence path (path to binary data)
    pub persistence: String,
    /// Control anchor position
    pub anchor: ControlAnchor,
    /// Control name
    pub name: Option<String>,
}

impl ActiveXControl {
    /// Create a new ActiveX control
    pub fn new(class_id: String, persistence: String) -> Self {
        Self {
            class_id,
            persistence,
            anchor: ControlAnchor::default(),
            name: None,
        }
    }

    /// Check if this is a known control type by class ID
    pub fn control_type(&self) -> &'static str {
        match self.class_id.to_uppercase().as_str() {
            // Common ActiveX class IDs
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

/// OLE embedded object
#[derive(Debug, Clone)]
pub struct OleObject {
    /// Program ID (e.g., "Excel.Sheet.12", "Word.Document.12")
    pub prog_id: String,
    /// Shape ID in the drawing
    pub shape_id: u32,
    /// Path to embedded data (resolved from r:id relationship)
    pub data_path: Option<String>,
    /// Path to linked data (external file)
    pub link_path: Option<String>,
    /// Object name
    pub name: Option<String>,
    /// Anchor position
    pub anchor: ControlAnchor,
    /// Display aspect — content or icon (ST_DvAspect)
    pub dv_aspect: DvAspect,
    /// Update policy for linked objects (ST_OleUpdate)
    pub ole_update: OleUpdate,
    /// Whether to automatically load the object when the workbook opens
    pub auto_load: bool,
    /// Relationship ID (`r:id`) pointing to the embedded binary part
    pub r_id: Option<String>,
    /// Object properties (from `<objectPr>` child element)
    pub object_pr: Option<ObjectProperties>,
    /// VML relationship ID for the preview image (from `<v:imagedata>`)
    pub preview_image_rel_id: Option<String>,
    /// Resolved path to the preview image (e.g., `xl/media/image1.png`)
    pub preview_image_path: Option<String>,
}

impl OleObject {
    /// Create a new OLE object
    pub fn new(prog_id: String, shape_id: u32) -> Self {
        Self {
            prog_id,
            shape_id,
            data_path: None,
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

    /// Check if this is an embedded object
    pub fn is_embedded(&self) -> bool {
        self.data_path.is_some()
    }

    /// Check if this is a linked object
    pub fn is_linked(&self) -> bool {
        self.link_path.is_some()
    }
}

/// Collection of all controls in a worksheet
#[derive(Debug, Default)]
pub struct WorksheetControls {
    /// Form controls
    pub form_controls: Vec<FormControl>,
    /// ActiveX controls
    pub activex_controls: Vec<ActiveXControl>,
    /// OLE embedded objects
    pub ole_objects: Vec<OleObject>,
}

impl WorksheetControls {
    /// Create a new empty collection
    pub fn new() -> Self {
        Self::default()
    }

    /// Parse control properties from ctrlProp*.xml
    pub fn parse_ctrl_prop(xml: &[u8]) -> Option<FormControl> {
        // Find formControlPr element
        let start = find_tag_simd(xml, b"formControlPr", 0)?;
        let element_end = find_gt_simd(xml, start).map(|p| p + 1).unwrap_or(xml.len());
        let element = &xml[start..element_end];

        // Parse object type
        let object_type = parse_string_attr(element, b"objectType=\"")
            .map(|s| FormControlType::from_str(&s))
            .unwrap_or(FormControlType::Unknown("Unknown".to_string()));

        let mut control = FormControl::new(object_type);

        // Parse common properties
        control.properties.linked_cell = parse_string_attr(element, b"fmlaLink=\"");
        control.properties.input_range = parse_string_attr(element, b"fmlaRange=\"");
        control.properties.fmla_group = parse_string_attr(element, b"fmlaGroup=\"");
        control.properties.fmla_txbx = parse_string_attr(element, b"fmlaTxbx=\"");
        control.properties.alt_text = parse_string_attr(element, b"altText=\"");
        control.properties.macro_name = parse_string_attr(element, b"macro=\"");

        // Parse check state
        if let Some(checked) = parse_string_attr(element, b"checked=\"") {
            control.properties.checked = Some(CheckState::from_str(&checked));
        }

        // Parse numeric properties
        control.properties.val = parse_u32_attr(element, b"val=\"");
        control.properties.sel = parse_u32_attr(element, b"sel=\"");
        control.properties.min_value = parse_i32_attr(element, b"min=\"");
        control.properties.max_value = parse_i32_attr(element, b"max=\"");
        control.properties.increment = parse_i32_attr(element, b"inc=\"");
        control.properties.page_increment = parse_i32_attr(element, b"page=\"");
        control.properties.drop_lines = parse_u32_attr(element, b"dropLines=\"");
        control.properties.dx = parse_u32_attr(element, b"dx=\"");
        control.properties.width_min = parse_u32_attr(element, b"widthMin=\"");

        // Parse string attributes
        control.properties.sel_type = parse_string_attr(element, b"seltype=\"");
        control.properties.drop_style = parse_string_attr(element, b"dropStyle=\"");
        control.properties.multi_sel = parse_string_attr(element, b"multiSel=\"");
        control.properties.text_h_align = parse_string_attr(element, b"textHAlign=\"");
        control.properties.text_v_align = parse_string_attr(element, b"textVAlign=\"");
        control.properties.edit_val = parse_string_attr(element, b"editVal=\"");

        // Parse boolean attributes
        control.properties.lock_text = parse_bool_attr(element, b"lockText=\"");
        control.properties.no_three_d2 = parse_bool_attr(element, b"noThreeD2=\"");
        control.properties.no_three_d = parse_bool_attr(element, b"noThreeD=\"");
        control.properties.colored = parse_bool_attr(element, b"colored=\"");
        control.properties.horiz = parse_bool_attr(element, b"horiz=\"");
        control.properties.first_button = parse_bool_attr(element, b"firstButton=\"");
        control.properties.multi_line = parse_bool_attr(element, b"multiLine=\"");
        control.properties.vertical_bar = parse_bool_attr(element, b"verticalBar=\"");
        control.properties.password_edit = parse_bool_attr(element, b"passwordEdit=\"");
        control.properties.just_last_x = parse_bool_attr(element, b"justLastX=\"");

        // Parse <itemLst> child element if present
        let body_end = find_closing_tag(xml, b"formControlPr", start).unwrap_or(element_end);
        if let Some(item_lst_start) = find_tag_simd(xml, b"itemLst", start) {
            if item_lst_start < body_end {
                let item_lst_end =
                    find_closing_tag(xml, b"itemLst", item_lst_start).unwrap_or(body_end);
                let mut item_pos = item_lst_start;
                while let Some(item_start) = find_tag_simd(xml, b"item", item_pos) {
                    if item_start >= item_lst_end {
                        break;
                    }
                    let item_end = find_gt_simd(xml, item_start)
                        .map(|p| p + 1)
                        .unwrap_or(item_lst_end);
                    let item_element = &xml[item_start..item_end];
                    if let Some(val) = parse_string_attr(item_element, b"val=\"") {
                        control.properties.items.push(val);
                    }
                    item_pos = item_end;
                }
            }
        }

        Some(control)
    }

    /// Parse VML drawing to extract control anchors
    pub fn parse_vml_drawing(xml: &[u8], controls: &mut Vec<FormControl>) {
        let mut pos = 0;

        while let Some(shape_start) = find_tag_simd(xml, b"v:shape", pos) {
            let shape_end = find_closing_tag(xml, b"v:shape", shape_start).unwrap_or(xml.len());

            // Work with a bounded slice for the shape body to avoid O(n*m) scans
            let shape_slice = &xml[shape_start..shape_end];

            // Look for ClientData which contains control info
            if let Some(client_rel) = find_tag_simd(shape_slice, b"x:ClientData", 0) {
                let client_end_rel = find_closing_tag(shape_slice, b"x:ClientData", client_rel)
                    .unwrap_or(shape_slice.len());

                // Slice just the ClientData region for all child searches
                let cd = &shape_slice[client_rel..client_end_rel];

                // Get object type
                let element_end = find_gt_simd(cd, 0).map(|p| p + 1).unwrap_or(cd.len());
                let element = &cd[..element_end];
                let object_type_str = parse_string_attr(element, b"ObjectType=\"");

                // Skip "Note" shapes — these are VML comment boxes, not form controls.
                // They are handled by the comments system separately.
                if object_type_str.as_deref() == Some("Note") {
                    pos = shape_end;
                    continue;
                }

                let object_type = object_type_str
                    .map(|s| FormControlType::from_str(&s))
                    .unwrap_or(FormControlType::Unknown("Unknown".to_string()));

                let mut control = FormControl::new(object_type);

                // ── Parse VML shape-level properties from the v:shape element ──
                // These are visual attributes that only exist in VML.
                {
                    // The v:shape opening tag spans from shape_slice start to the first '>'.
                    let shape_tag_end = find_gt_simd(shape_slice, 0).unwrap_or(shape_slice.len());
                    let shape_tag = &shape_slice[..shape_tag_end];

                    control.vml_shape.style = parse_vml_attr(shape_tag, b"style=");
                    control.vml_shape.is_button =
                        parse_string_attr(shape_tag, b"o:button=\"").map_or(false, |v| v == "t");
                    control.vml_shape.fillcolor = parse_string_attr(shape_tag, b"fillcolor=\"");
                    control.vml_shape.strokecolor = parse_string_attr(shape_tag, b"strokecolor=\"");

                    // Parse <v:fill .../> child element (raw XML for round-trip)
                    if let Some(fill_start) = find_tag_simd(shape_slice, b"v:fill", 0) {
                        if fill_start < client_rel {
                            let fill_gt = find_gt_simd(shape_slice, fill_start)
                                .map(|g| g + 1)
                                .unwrap_or(shape_slice.len());
                            if let Ok(s) = std::str::from_utf8(&shape_slice[fill_start..fill_gt]) {
                                control.vml_shape.fill_xml = Some(s.to_string());
                            }
                        }
                    }
                    // Parse <o:lock .../> child element (raw XML for round-trip)
                    if let Some(lock_start) = find_tag_simd(shape_slice, b"o:lock", 0) {
                        if lock_start < client_rel {
                            let lock_gt = find_gt_simd(shape_slice, lock_start)
                                .map(|g| g + 1)
                                .unwrap_or(shape_slice.len());
                            if let Ok(s) = std::str::from_utf8(&shape_slice[lock_start..lock_gt]) {
                                control.vml_shape.lock_xml = Some(s.to_string());
                            }
                        }
                    }
                    // Parse <v:textbox> with attributes and content
                    if let Some(tb_start) = find_tag_simd(shape_slice, b"v:textbox", 0) {
                        if tb_start < client_rel {
                            let tb_tag_end =
                                find_gt_simd(shape_slice, tb_start).unwrap_or(shape_slice.len());
                            let tb_tag = &shape_slice[tb_start..tb_tag_end];
                            control.vml_shape.textbox_style = parse_vml_attr(tb_tag, b"style=");
                            control.vml_shape.textbox_singleclick =
                                parse_string_attr(tb_tag, b"o:singleclick=\"");

                            // Extract raw content between <v:textbox ...> and </v:textbox>
                            let content_start = tb_tag_end + 1;
                            if let Some(tb_close) =
                                find_closing_tag(shape_slice, b"v:textbox", tb_start)
                            {
                                if let Ok(s) =
                                    std::str::from_utf8(&shape_slice[content_start..tb_close])
                                {
                                    let trimmed = s.trim();
                                    if !trimmed.is_empty() {
                                        control.vml_shape.textbox_content =
                                            Some(trimmed.to_string());
                                    }
                                }
                            }
                        }
                    }
                }

                // ── Parse VML ClientData tags that map to existing properties ──
                // These tags are also parsed from ctrlProp XML, but may only exist in VML
                // for older files. Parse them here so the writer can emit them.
                {
                    // FmlaMacro → macro_name
                    if control.properties.macro_name.is_none() {
                        if let Some(tag_start) = find_tag_simd(cd, b"x:FmlaMacro", 0) {
                            let content_start = find_gt_simd(cd, tag_start)
                                .map(|p| p + 1)
                                .unwrap_or(cd.len());
                            let tag_end =
                                find_closing_tag(cd, b"x:FmlaMacro", tag_start).unwrap_or(cd.len());
                            let text = String::from_utf8_lossy(&cd[content_start..tag_end])
                                .trim()
                                .to_string();
                            if !text.is_empty() {
                                control.properties.macro_name = Some(text);
                            }
                        }
                    }
                    // TextHAlign → text_h_align
                    if control.properties.text_h_align.is_none() {
                        if let Some(tag_start) = find_tag_simd(cd, b"x:TextHAlign", 0) {
                            let content_start = find_gt_simd(cd, tag_start)
                                .map(|p| p + 1)
                                .unwrap_or(cd.len());
                            let tag_end = find_closing_tag(cd, b"x:TextHAlign", tag_start)
                                .unwrap_or(cd.len());
                            let text = String::from_utf8_lossy(&cd[content_start..tag_end])
                                .trim()
                                .to_string();
                            if !text.is_empty() {
                                control.properties.text_h_align = Some(text);
                            }
                        }
                    }
                    // TextVAlign → text_v_align
                    if control.properties.text_v_align.is_none() {
                        if let Some(tag_start) = find_tag_simd(cd, b"x:TextVAlign", 0) {
                            let content_start = find_gt_simd(cd, tag_start)
                                .map(|p| p + 1)
                                .unwrap_or(cd.len());
                            let tag_end = find_closing_tag(cd, b"x:TextVAlign", tag_start)
                                .unwrap_or(cd.len());
                            let text = String::from_utf8_lossy(&cd[content_start..tag_end])
                                .trim()
                                .to_string();
                            if !text.is_empty() {
                                control.properties.text_v_align = Some(text);
                            }
                        }
                    }
                    // PrintObject
                    if let Some(tag_start) = find_tag_simd(cd, b"x:PrintObject", 0) {
                        let content_start = find_gt_simd(cd, tag_start)
                            .map(|p| p + 1)
                            .unwrap_or(cd.len());
                        let tag_end =
                            find_closing_tag(cd, b"x:PrintObject", tag_start).unwrap_or(cd.len());
                        let text = String::from_utf8_lossy(&cd[content_start..tag_end])
                            .trim()
                            .to_string();
                        if !text.is_empty() {
                            control
                                .properties
                                .vml_extras
                                .insert("PrintObject".to_string(), text);
                        }
                    }
                }

                // Parse idmap data from the shapelayout preceding this shape
                {
                    // Look for <o:idmap ... data="N" /> before the shape
                    let pre_shape = &xml[..shape_start];
                    if let Some(idmap_start) = pre_shape.windows(8).rposition(|w| w == b"o:idmap") {
                        let idmap_slice = &xml[idmap_start..shape_start];
                        control.vml_shape.idmap_data = parse_string_attr(idmap_slice, b"data=\"");
                    }
                }

                // Parse anchor
                if let Some(anchor_start) = find_tag_simd(cd, b"x:Anchor", 0) {
                    let anchor_end =
                        find_closing_tag(cd, b"x:Anchor", anchor_start).unwrap_or(cd.len());
                    let content_start = find_gt_simd(cd, anchor_start)
                        .map(|p| p + 1)
                        .unwrap_or(anchor_end);
                    let anchor_text = &cd[content_start..anchor_end];
                    let anchor_str = String::from_utf8_lossy(anchor_text);
                    if let Some(anchor) = ControlAnchor::from_vml_anchor(&anchor_str) {
                        control.anchor = anchor;
                    }
                }

                // Parse linked cell
                if let Some(link_start) = find_tag_simd(cd, b"x:FmlaLink", 0) {
                    let link_end =
                        find_closing_tag(cd, b"x:FmlaLink", link_start).unwrap_or(cd.len());
                    let content_start = find_gt_simd(cd, link_start)
                        .map(|p| p + 1)
                        .unwrap_or(link_end);
                    let link_text = String::from_utf8_lossy(&cd[content_start..link_end]);
                    control.properties.linked_cell = Some(link_text.into_owned());
                }

                // Parse input range
                if let Some(range_start) = find_tag_simd(cd, b"x:FmlaRange", 0) {
                    let range_end =
                        find_closing_tag(cd, b"x:FmlaRange", range_start).unwrap_or(cd.len());
                    let content_start = find_gt_simd(cd, range_start)
                        .map(|p| p + 1)
                        .unwrap_or(range_end);
                    let range_text = String::from_utf8_lossy(&cd[content_start..range_end]);
                    control.properties.input_range = Some(range_text.into_owned());
                }

                // Collect VML-only CT_ClientData children for lossless roundtrip.
                // These tags have no modern CT_FormControlPr equivalent.
                // Search within the bounded cd slice (NOT full xml) to avoid O(shapes×tags×filesize).
                const VML_ONLY_TAGS: &[&str] = &[
                    "FmlaPict",
                    "Accel",
                    "Accel2",
                    "Row",
                    "Column",
                    "Visible",
                    "RowHidden",
                    "ColHidden",
                    "Default",
                    "Help",
                    "Cancel",
                    "Dismiss",
                    "ValidIds",
                    "MapOCX",
                    "Camera",
                    "AutoScale",
                    "DDE",
                    "ScriptText",
                    "ScriptExtended",
                    "ScriptLanguage",
                    "ScriptLocation",
                    "LCT",
                ];
                for tag_name in VML_ONLY_TAGS {
                    let prefixed = format!("x:{}", tag_name);
                    if let Some(tag_start) = find_tag_simd(cd, prefixed.as_bytes(), 0) {
                        // Find the end of the opening tag
                        let gt_pos = find_gt_simd(cd, tag_start).unwrap_or(cd.len());

                        // Check for self-closing tag (e.g. <x:Camera/>)
                        let is_self_closing = gt_pos > 0 && cd[gt_pos - 1] == b'/';

                        if is_self_closing {
                            // Self-closing element: presence-only, store empty value
                            control
                                .properties
                                .vml_extras
                                .insert(tag_name.to_string(), String::new());
                        } else {
                            // Element with closing tag: extract text content
                            let content_start = gt_pos + 1;
                            let tag_end = find_closing_tag(cd, prefixed.as_bytes(), tag_start)
                                .unwrap_or(cd.len());
                            let text = String::from_utf8_lossy(&cd[content_start..tag_end]);
                            let trimmed = text.trim();
                            control
                                .properties
                                .vml_extras
                                .insert(tag_name.to_string(), trimmed.to_string());
                        }
                    }
                }

                controls.push(control);
            }

            pos = shape_end + 1;
        }
    }

    /// Parse ActiveX control from activeX*.xml
    pub fn parse_activex(xml: &[u8]) -> Option<ActiveXControl> {
        let start = find_tag_simd(xml, b"ax:ocx", 0).or_else(|| find_tag_simd(xml, b"ocx", 0))?;

        let element_end = find_gt_simd(xml, start).map(|p| p + 1).unwrap_or(xml.len());
        let element = &xml[start..element_end];

        let class_id = parse_string_attr(element, b"ax:classid=\"")
            .or_else(|| parse_string_attr(element, b"classid=\""))
            .unwrap_or_default();

        let persistence = parse_string_attr(element, b"r:id=\"").unwrap_or_default();

        Some(ActiveXControl::new(class_id, persistence))
    }

    /// Parse OLE objects from worksheet XML `<oleObjects>` section.
    ///
    /// Handles both bare `<oleObject>` elements and those wrapped in
    /// `<mc:AlternateContent>`. Parses all CT_OleObject attributes and
    /// the `<objectPr>` child element if present.
    pub fn parse_ole_objects(xml: &[u8], objects: &mut Vec<OleObject>) {
        // First, resolve any mc:AlternateContent blocks
        let resolved = resolve_mc_alternate_content_regions(xml);

        let mut pos = 0;

        while let Some(ole_start) = find_tag_simd(&resolved, b"oleObject", pos) {
            // Find the closing tag or self-closing end for the full element body
            let element_tag_end = find_gt_simd(&resolved, ole_start)
                .map(|p| p + 1)
                .unwrap_or(resolved.len());
            let element = &resolved[ole_start..element_tag_end];

            let prog_id = parse_string_attr(element, b"progId=\"").unwrap_or_default();
            let shape_id = parse_u32_attr(element, b"shapeId=\"").unwrap_or(0);

            let mut ole_object = OleObject::new(prog_id, shape_id);

            // Parse r:id for embedded binary reference
            ole_object.r_id = parse_string_attr(element, b"r:id=\"");
            ole_object.data_path = ole_object.r_id.clone();
            // Parse link attribute for linked objects
            ole_object.link_path = parse_string_attr(element, b"link=\"");

            // Parse dvAspect (ST_DvAspect: DVASPECT_CONTENT or DVASPECT_ICON)
            if let Some(dv) = parse_string_attr(element, b"dvAspect=\"") {
                ole_object.dv_aspect = DvAspect::from_ooxml(&dv);
            }

            // Parse oleUpdate (ST_OleUpdate: OLEUPDATE_ALWAYS or OLEUPDATE_ONCALL)
            if let Some(ou) = parse_string_attr(element, b"oleUpdate=\"") {
                ole_object.ole_update = OleUpdate::from_ooxml(&ou);
            }

            // Parse autoLoad
            ole_object.auto_load = parse_bool_attr(element, b"autoLoad=\"");

            // Check if this is a self-closing tag
            let is_self_closing = element_tag_end > 1 && resolved[element_tag_end - 2] == b'/';

            if !is_self_closing {
                // Find closing </oleObject> tag for child element parsing
                let ole_close =
                    find_closing_tag(&resolved, b"oleObject", ole_start).unwrap_or(element_tag_end);
                let ole_body = &resolved[element_tag_end..ole_close];

                // Parse <objectPr> child element
                ole_object.object_pr = parse_object_pr(ole_body);

                pos = ole_close + 1;
            } else {
                pos = element_tag_end;
            }

            objects.push(ole_object);
        }
    }

    /// Get total number of controls
    pub fn len(&self) -> usize {
        self.form_controls.len() + self.activex_controls.len() + self.ole_objects.len()
    }

    /// Check if there are no controls
    pub fn is_empty(&self) -> bool {
        self.form_controls.is_empty()
            && self.activex_controls.is_empty()
            && self.ole_objects.is_empty()
    }
}

// ============================================================================
// Helper Functions
// ============================================================================

/// Parse an i32 attribute value
fn parse_i32_attr(xml: &[u8], attr: &[u8]) -> Option<i32> {
    let attr_pos = find_attr_simd(xml, attr, 0)?;
    let value_start = attr_pos + attr.len();
    let (start, end) = extract_quoted_value(xml, value_start)?;

    let value_str = String::from_utf8_lossy(&xml[start..end]);
    value_str.trim().parse().ok()
}

/// Parse a child XML element's text content as u32.
///
/// Given `<col>3</col>`, extracts `3` as `u32`.
fn parse_child_element_u32(xml: &[u8], tag: &[u8]) -> Option<u32> {
    let start = find_tag_simd(xml, tag, 0)?;
    let end = find_closing_tag(xml, tag, start)?;

    // Skip past the '>' of the opening tag to reach text content
    let mut content_start = start;
    while content_start < end && xml[content_start] != b'>' {
        content_start += 1;
    }
    content_start += 1;

    if content_start >= end {
        return None;
    }

    let text = String::from_utf8_lossy(&xml[content_start..end]);
    text.trim().parse().ok()
}

/// Parse a child XML element's text content as i64.
///
/// Given `<colOff>152400</colOff>`, extracts `152400` as `i64`.
/// Handles negative values for the full EMU range.
fn parse_child_element_i64(xml: &[u8], tag: &[u8]) -> Option<i64> {
    let start = find_tag_simd(xml, tag, 0)?;
    let end = find_closing_tag(xml, tag, start)?;

    let mut content_start = start;
    while content_start < end && xml[content_start] != b'>' {
        content_start += 1;
    }
    content_start += 1;

    if content_start >= end {
        return None;
    }

    let text = String::from_utf8_lossy(&xml[content_start..end]);
    text.trim().parse().ok()
}

// ============================================================================
// OLE Object Helpers
// ============================================================================

/// Resolve `mc:AlternateContent` blocks in `<oleObjects>` XML.
///
/// OLE objects in worksheet XML are often wrapped in `mc:AlternateContent`.
/// This function resolves each AC block to its preferred branch, producing
/// a flattened XML fragment that can be scanned for `<oleObject>` elements.
fn resolve_mc_alternate_content_regions(xml: &[u8]) -> Vec<u8> {
    let mut result = Vec::with_capacity(xml.len());
    let mut pos = 0;

    while pos < xml.len() {
        if let Some(ac_start) = find_tag_simd(&xml[pos..], b"mc:AlternateContent", 0) {
            let abs_ac_start = pos + ac_start;

            // Copy everything before this AC block
            result.extend_from_slice(&xml[pos..abs_ac_start]);

            let ac_close =
                find_closing_tag(xml, b"mc:AlternateContent", abs_ac_start).unwrap_or(xml.len());
            let ac_end = find_gt_simd(xml, ac_close)
                .map(|p| p + 1)
                .unwrap_or(ac_close);
            let ac_block = &xml[abs_ac_start..ac_end];

            // Resolve the MC block to preferred branch
            if let Some(branch) = resolve_mc_alternate_content(ac_block, None) {
                result.extend_from_slice(&ac_block[branch.start..branch.end]);
            }

            pos = ac_end;
        } else {
            // No more AC blocks, copy the rest
            result.extend_from_slice(&xml[pos..]);
            break;
        }
    }

    result
}

/// Parse the `<objectPr>` child element of an `<oleObject>`.
///
/// Extracts attributes: `defaultSize`, `print`, `disabled`, `locked`, `autoFill`,
/// `autoLine`, `autoPict`, `macro`, `altText`, `dde`.
/// Also parses the inner `<anchor>` element (CT_ObjectAnchor) if present.
fn parse_object_pr(ole_body: &[u8]) -> Option<ObjectProperties> {
    let pr_start = find_tag_simd(ole_body, b"objectPr", 0)?;
    let pr_tag_end = find_gt_simd(ole_body, pr_start)
        .map(|p| p + 1)
        .unwrap_or(ole_body.len());
    let pr_element = &ole_body[pr_start..pr_tag_end];

    let mut props = ObjectProperties::default();

    // Parse boolean attributes (with OOXML defaults)
    // defaultSize defaults to true, but if present and "0" or "false", set to false
    if let Some(val) = parse_string_attr(pr_element, b"defaultSize=\"") {
        props.default_size = val != "0" && val != "false";
    }
    if let Some(val) = parse_string_attr(pr_element, b"print=\"") {
        props.print = val != "0" && val != "false";
    }
    props.disabled = parse_bool_attr(pr_element, b"disabled=\"");
    if let Some(val) = parse_string_attr(pr_element, b"locked=\"") {
        props.locked = val != "0" && val != "false";
    }
    if let Some(val) = parse_string_attr(pr_element, b"autoFill=\"") {
        props.auto_fill = val != "0" && val != "false";
    }
    if let Some(val) = parse_string_attr(pr_element, b"autoLine=\"") {
        props.auto_line = val != "0" && val != "false";
    }
    if let Some(val) = parse_string_attr(pr_element, b"autoPict=\"") {
        props.auto_pict = val != "0" && val != "false";
    }
    props.r#macro = parse_string_attr(pr_element, b"macro=\"");
    props.alt_text = parse_string_attr(pr_element, b"altText=\"");
    props.dde = parse_bool_attr(pr_element, b"dde=\"");
    props.ui_object = parse_bool_attr(pr_element, b"uiObject=\"");
    props.r_id = parse_string_attr(pr_element, b"r:id=\"");

    // Check for self-closing <objectPr/>
    let is_self_closing = pr_tag_end > 1 && ole_body[pr_tag_end - 2] == b'/';
    if !is_self_closing {
        let pr_close = find_closing_tag(ole_body, b"objectPr", pr_start).unwrap_or(pr_tag_end);
        let pr_body = &ole_body[pr_tag_end..pr_close];

        // Parse <anchor> child element
        props.anchor = parse_object_anchor(pr_body);
    }

    Some(props)
}

/// Parse a `CT_ObjectAnchor` element from within `<objectPr>`.
///
/// The anchor element contains `moveWithCells` and `sizeWithCells` attributes,
/// plus `<from>` and `<to>` children with `<xdr:col>`, `<xdr:colOff>`,
/// `<xdr:row>`, `<xdr:rowOff>` sub-elements.
fn parse_object_anchor(pr_body: &[u8]) -> Option<ObjectAnchor> {
    let anchor_start = find_tag_simd(pr_body, b"anchor", 0)?;
    let anchor_tag_end = find_gt_simd(pr_body, anchor_start)
        .map(|p| p + 1)
        .unwrap_or(pr_body.len());
    let anchor_element = &pr_body[anchor_start..anchor_tag_end];

    let move_with_cells = parse_bool_attr(anchor_element, b"moveWithCells=\"");
    let size_with_cells = parse_bool_attr(anchor_element, b"sizeWithCells=\"");

    let anchor_close = find_closing_tag(pr_body, b"anchor", anchor_start).unwrap_or(anchor_tag_end);
    let anchor_body = &pr_body[anchor_tag_end..anchor_close];

    // Parse <from> element
    let from = parse_anchor_point(anchor_body, b"from")?;
    // Parse <to> element
    let to = parse_anchor_point(anchor_body, b"to")?;

    Some(ObjectAnchor {
        move_with_cells,
        size_with_cells,
        from,
        to,
    })
}

/// Parse a `<from>` or `<to>` anchor point element containing
/// `<xdr:col>`, `<xdr:colOff>`, `<xdr:row>`, `<xdr:rowOff>` children.
///
/// Also handles the non-prefixed variants (`<col>`, `<colOff>`, etc.)
/// as some files may omit the namespace prefix.
fn parse_anchor_point(body: &[u8], tag: &[u8]) -> Option<CellAnchorPoint> {
    let start = find_tag_simd(body, tag, 0)?;
    let close = find_closing_tag(body, tag, start)?;
    let tag_end = find_gt_simd(body, start).map(|p| p + 1).unwrap_or(close);
    let inner = &body[tag_end..close];

    // Try both prefixed (xdr:col) and non-prefixed (col) variants
    let col = parse_child_element_u32(inner, b"xdr:col")
        .or_else(|| parse_child_element_u32(inner, b"col"))?;
    let col_off = parse_child_element_i64(inner, b"xdr:colOff")
        .or_else(|| parse_child_element_i64(inner, b"colOff"))
        .unwrap_or(0);
    let row = parse_child_element_u32(inner, b"xdr:row")
        .or_else(|| parse_child_element_u32(inner, b"row"))?;
    let row_off = parse_child_element_i64(inner, b"xdr:rowOff")
        .or_else(|| parse_child_element_i64(inner, b"rowOff"))
        .unwrap_or(0);

    Some(CellAnchorPoint {
        col,
        col_offset: col_off,
        row,
        row_offset: row_off,
    })
}

// ============================================================================
// VML OLE Shape Helpers
// ============================================================================

/// Parse VML shapes to extract preview image relationship IDs for OLE objects.
///
/// Scans `<v:shape>` elements in VML XML for `<v:imagedata>` children,
/// matching shapes by their `o:spid` attribute (or `id` attribute containing
/// the shape ID) to OLE object shape IDs.
///
/// Returns a map of shape_id (from the `id` attribute, typically `_x0000_sNNNN`)
/// to the `o:relid` or `r:id` value from `<v:imagedata>`.
pub fn parse_vml_imagedata(xml: &[u8]) -> HashMap<String, String> {
    let mut result = HashMap::new();
    let mut pos = 0;

    while let Some(shape_start) = find_tag_simd(xml, b"v:shape", pos) {
        let shape_end = find_closing_tag(xml, b"v:shape", shape_start).unwrap_or(xml.len());
        let shape_tag_end = find_gt_simd(xml, shape_start)
            .map(|p| p + 1)
            .unwrap_or(shape_end);
        let shape_element = &xml[shape_start..shape_tag_end];

        // Extract shape id attribute (e.g., id="_x0000_s1025")
        // Use verbatim parsing so _x0000_ is kept as literal text, not decoded.
        let shape_id_str = parse_string_attr_verbatim(shape_element, b"id=\"");

        // Look for <v:imagedata> child
        if let Some(imgdata_start) = find_tag_simd(xml, b"v:imagedata", shape_start) {
            if imgdata_start < shape_end {
                let imgdata_end = find_gt_simd(xml, imgdata_start)
                    .map(|p| p + 1)
                    .unwrap_or(shape_end);
                let imgdata_element = &xml[imgdata_start..imgdata_end];

                // Extract o:relid or r:id attribute
                let rel_id = parse_string_attr(imgdata_element, b"o:relid=\"")
                    .or_else(|| parse_string_attr(imgdata_element, b"r:id=\""));

                if let (Some(sid), Some(rid)) = (shape_id_str.as_ref(), rel_id) {
                    result.insert(sid.clone(), rid);
                }
            }
        }

        pos = shape_end + 1;
    }

    result
}

/// Extract the numeric shape ID from a VML shape `id` attribute.
///
/// VML shape IDs typically look like `_x0000_s1025`. The numeric part
/// (1025) corresponds to the `shapeId` in the worksheet's `<oleObject>`.
pub fn extract_vml_shape_number(vml_id: &str) -> Option<u32> {
    // Find the last 's' and parse everything after it
    if let Some(idx) = vml_id.rfind('s') {
        vml_id[idx + 1..].parse().ok()
    } else {
        // Try parsing the whole string as a number
        vml_id.parse().ok()
    }
}

// ============================================================================
// Worksheet-Level Control References (from worksheet XML <controls> element)
// ============================================================================

/// A control reference extracted from the worksheet XML's `<controls>` element.
///
/// In OOXML, the worksheet XML contains a `<controls>` block (inside
/// `mc:AlternateContent → mc:Choice Requires="x14"`) that lists each control
/// with its shape ID, relationship ID, and optional name. This struct captures
/// that per-control metadata.
///
/// The relationship ID (`r_id`) links to a `ctrlProp*.xml` part that contains
/// the control's full properties (see [`WorksheetControls::parse_ctrl_prop`]).
///
/// # Example XML
/// ```xml
/// <control shapeId="1025" r:id="rId3" name="Check Box 1">
///   <controlPr .../>
/// </control>
/// ```
#[derive(Debug, Clone)]
pub struct WorksheetControl {
    /// `CT_Control.shapeId` (required) — VML shape identifier.
    pub shape_id: u32,
    /// `CT_Control.r:id` (required) — Relationship ID to the `ctrlProp*.xml` part.
    pub r_id: String,
    /// `CT_Control.name` (optional) — Human-readable control name.
    pub name: Option<String>,
}

/// Parse `<control>` elements from a `<controls>` block.
///
/// This extracts the control references that appear inside the worksheet XML's
/// `<controls>` element. The input should be the inner content of a `<controls>`
/// tag (or the full `<controls>...</controls>` element).
///
/// # Arguments
/// * `xml` — Bytes of the `<controls>` block.
///
/// # Returns
/// A `Vec<WorksheetControl>` with one entry per `<control>` element found.
pub fn parse_worksheet_controls(xml: &[u8]) -> Vec<WorksheetControl> {
    let mut controls = Vec::new();
    let mut pos = 0;

    while let Some(ctrl_start) = find_tag_simd(xml, b"control", pos) {
        // find_tag_simd already ensures exact tag boundary match (control != controls/controlPr)
        let element_end = find_gt_simd(xml, ctrl_start)
            .map(|p| p + 1)
            .unwrap_or(xml.len());
        let element = &xml[ctrl_start..element_end];

        // shapeId is required
        if let Some(shape_id) = parse_u32_attr(element, b"shapeId=\"") {
            let r_id = parse_string_attr(element, b"r:id=\"").unwrap_or_default();
            let name = parse_string_attr(element, b"name=\"");

            controls.push(WorksheetControl {
                shape_id,
                r_id,
                name,
            });
        }

        pos = element_end;
    }

    controls
}

/// Parse worksheet-level controls from worksheet XML that may be wrapped in
/// `mc:AlternateContent`.
///
/// This is the top-level entry point for extracting control references from a
/// worksheet XML part. It handles two cases:
///
/// 1. Controls inside `mc:AlternateContent → mc:Choice Requires="x14"` (common).
/// 2. A bare `<controls>` element (rare, but valid).
///
/// # Arguments
/// * `worksheet_xml` — The full worksheet XML bytes.
///
/// # Returns
/// A `Vec<WorksheetControl>` with all controls found, or an empty vec if none.
pub fn parse_worksheet_controls_from_xml(worksheet_xml: &[u8]) -> Vec<WorksheetControl> {
    let has_supported_controls_choice = worksheet_xml
        .windows(b"Requires=\"x14\"".len())
        .any(|w| w == b"Requires=\"x14\"");
    let all_controls = parse_worksheet_controls(worksheet_xml);
    if has_supported_controls_choice && !all_controls.is_empty() {
        let mut seen = std::collections::HashSet::new();
        let mut deduped = Vec::with_capacity(all_controls.len());
        for control in all_controls {
            if seen.insert(control.shape_id) {
                deduped.push(control);
            }
        }
        return deduped;
    }

    // Strategy:
    // 1. If the controls are inside an mc:AlternateContent block, resolve it
    //    (pick a supported mc:Choice or fall back to mc:Fallback).
    // 2. Within the resolved content, find <controls>...</controls> and parse.
    // 3. If no mc:AlternateContent wraps the controls, find <controls> directly.

    // Check if there's an mc:AlternateContent that wraps a <controls> block.
    if let Some(ac_start) = find_tag_simd(worksheet_xml, b"mc:AlternateContent", 0) {
        let ac_end = find_closing_tag(worksheet_xml, b"mc:AlternateContent", ac_start)
            .unwrap_or(worksheet_xml.len());
        let ac_close_tag_end = find_gt_simd(worksheet_xml, ac_end)
            .map(|p| p + 1)
            .unwrap_or(worksheet_xml.len());
        let ac_block = &worksheet_xml[ac_start..ac_close_tag_end];

        // Check if this AC block contains <controls> (it might be for something else)
        if find_tag_simd(ac_block, b"controls", 0).is_some() {
            // Resolve the AC block to pick the right branch
            if let Some(branch) = resolve_mc_alternate_content(ac_block, None) {
                let resolved = &ac_block[branch.start..branch.end];
                if let Some(controls_start) = find_tag_simd(resolved, b"controls", 0) {
                    let controls_end = find_closing_tag(resolved, b"controls", controls_start)
                        .unwrap_or(resolved.len());
                    let controls_block = &resolved[controls_start..controls_end];
                    let parsed = parse_worksheet_controls(controls_block);
                    if !parsed.is_empty() {
                        return parsed;
                    }
                }
            }
        }
    }

    // Fallback: find <controls> directly (bare, not wrapped in AC).
    if let Some(controls_start) = find_tag_simd(worksheet_xml, b"controls", 0) {
        let controls_end = find_closing_tag(worksheet_xml, b"controls", controls_start)
            .unwrap_or(worksheet_xml.len());
        let controls_block = &worksheet_xml[controls_start..controls_end];
        let parsed = parse_worksheet_controls(controls_block);
        if !parsed.is_empty() {
            return parsed;
        }
    }

    Vec::new()
}

// ============================================================================
// Unit Tests
// ============================================================================

#[cfg(test)]
mod tests;

// ============================================================================
// Sheet-level controls parse functions (extracted from parse_helpers.rs)
// ============================================================================

/// Build a mapping from relationship Id (e.g. "rId3") to Target path from a .rels XML.
fn build_rel_id_map(rels_xml: &[u8]) -> HashMap<String, String> {
    let mut map = HashMap::new();
    let mut pos = 0;

    while let Some(rel_start) = find_tag_simd(rels_xml, b"Relationship", pos) {
        let rel_end = find_gt_simd(rels_xml, rel_start)
            .map(|p| p + 1)
            .unwrap_or(rels_xml.len());
        let rel_elem = &rels_xml[rel_start..rel_end];

        // Extract Id attribute
        if let Some(id_pos) = find_attr_simd(rel_elem, b"Id=\"", 0) {
            if let Some((is, ie)) = extract_quoted_value(rel_elem, id_pos + 4) {
                if let Ok(id) = std::str::from_utf8(&rel_elem[is..ie]) {
                    // Extract Target attribute
                    if let Some(target_pos) = find_attr_simd(rel_elem, b"Target=\"", 0) {
                        if let Some((ts, te)) = extract_quoted_value(rel_elem, target_pos + 8) {
                            if let Ok(target) = std::str::from_utf8(&rel_elem[ts..te]) {
                                map.insert(id.to_string(), target.to_string());
                            }
                        }
                    }
                }
            }
        }

        pos = rel_end;
    }

    map
}

fn ph_resolve_relative_path(base_dir: &str, relative: &str) -> String {
    if !relative.starts_with("..") {
        if let Some(stripped) = relative.strip_prefix('/') {
            return stripped.to_string();
        }
        return format!("{}/{}", base_dir, relative);
    }

    let mut parts: Vec<&str> = base_dir.split('/').collect();
    for segment in relative.split('/') {
        if segment == ".." {
            parts.pop();
        } else {
            parts.push(segment);
        }
    }
    parts.join("/")
}

/// Parse form controls for a given sheet.
///
/// This function implements the full modern + legacy merge pipeline:
///
/// 1. Parse `<controls>` from worksheet XML to get `WorksheetControl` refs (shapeId, rId, name).
/// 2. Read sheet .rels to build rId→target mapping, resolve each rId to a `ctrlProp*.xml` part.
/// 3. Parse each `ctrlProp*.xml` with `parse_ctrl_prop()` to get properties.
/// 4. Parse VML drawing for legacy anchor/property data (fallback).
/// 5. Merge modern (ctrlProp) and VML data by shapeId:
///    - Properties come from ctrlProp (modern) when available.
///    - Modern anchor from `<controlPr>` in worksheet XML is preferred.
///    - VML anchor is used as fallback.
///
/// Returns `Vec<FormControlOutput>` ready for WASM serialization.
pub fn parse_form_controls_for_sheet(
    archive: &crate::zip::XlsxArchive,
    sheet_num: usize,
    worksheet_xml: &[u8],
) -> Vec<crate::output::results::FormControlOutput> {
    use crate::output::results::FormControlOutput;

    // Step 1: Parse <controls> from worksheet XML to get control references
    let ws_controls = parse_worksheet_controls_from_xml(worksheet_xml);
    if ws_controls.is_empty() {
        // No modern controls found — try VML-only path as fallback
        return parse_vml_only_controls(archive, sheet_num);
    }

    // Step 2: Read sheet .rels to resolve rId→target
    let rels_path = format!("xl/worksheets/_rels/sheet{}.xml.rels", sheet_num);
    let rels_xml = match archive.read_file(&rels_path) {
        Ok(xml) => xml,
        Err(_) => return Vec::new(),
    };
    let rel_map = build_rel_id_map(&rels_xml);

    // Step 3: Parse modern anchor and controlPr attributes from worksheet XML.
    // The <controlPr> appears as a child of <control> and may contain an <anchor>.
    let mut modern_anchors: HashMap<u32, ModernAnchorResult> = HashMap::new();
    let mut control_pr_attrs_map: HashMap<u32, HashMap<String, String>> = HashMap::new();
    for wsc in &ws_controls {
        if let Some((anchor_result, attrs)) =
            extract_modern_anchor_and_attrs(worksheet_xml, wsc.shape_id)
        {
            modern_anchors.insert(wsc.shape_id, anchor_result);
            if !attrs.is_empty() {
                control_pr_attrs_map.insert(wsc.shape_id, attrs);
            }
        }
    }

    // Step 4: Parse each ctrlProp*.xml
    let mut controls: Vec<(u32, FormControl)> = Vec::new();
    for wsc in &ws_controls {
        if let Some(target) = rel_map.get(&wsc.r_id) {
            let full_path = ph_resolve_relative_path("xl/worksheets", target);
            if let Ok(ctrl_xml) = archive.read_file(&full_path) {
                if let Some(mut fc) = WorksheetControls::parse_ctrl_prop(&ctrl_xml) {
                    // Set name from worksheet-level <control name="..."> if not in ctrlProp
                    if fc.properties.name.is_none() {
                        fc.properties.name = wsc.name.clone();
                    }
                    // Apply modern anchor if available
                    if let Some(anchor_result) = modern_anchors.get(&wsc.shape_id) {
                        fc.anchor = anchor_result.anchor.clone();
                        fc.move_with_cells = anchor_result.move_with_cells;
                        fc.size_with_cells = anchor_result.size_with_cells;
                    }
                    // Apply controlPr attributes for round-trip fidelity
                    if let Some(attrs) = control_pr_attrs_map.get(&wsc.shape_id) {
                        fc.control_pr_attrs = attrs.clone();
                    }
                    controls.push((wsc.shape_id, fc));
                }
            }
        }
    }

    // Step 5: Parse VML drawing for legacy anchors (fallback)
    let vml_controls = parse_vml_drawing_for_sheet(archive, sheet_num, &rels_xml);

    // Step 6: Merge VML data into modern controls by shapeId. VML drawings can
    // contain skipped/non-control shapes, so index-order merging corrupts
    // anchors and shape properties on real workbooks.
    if !vml_controls.is_empty() {
        let vml_by_shape_id: HashMap<u32, &FormControl> = vml_controls
            .iter()
            .filter_map(|fc| fc.shape_id.map(|shape_id| (shape_id, fc)))
            .collect();
        for (i, (shape_id, fc)) in controls.iter_mut().enumerate() {
            if let Some(vml_fc) = vml_by_shape_id
                .get(shape_id)
                .copied()
                .or_else(|| vml_controls.get(i))
            {
                // If no modern anchor was applied, use VML anchor as fallback
                if !modern_anchors.contains_key(shape_id) {
                    fc.anchor = vml_fc.anchor.clone();
                }
                // Merge VML extras
                for (k, v) in &vml_fc.properties.vml_extras {
                    fc.properties
                        .vml_extras
                        .entry(k.clone())
                        .or_insert_with(|| v.clone());
                }
                // Merge VML-only ClientData tags as vml_extras.
                // These are written to VML but NOT to ctrlProp XML, so they must stay
                // in vml_extras rather than going into the main properties fields
                // (which would leak into ctrlProp output).
                if let Some(ref m) = vml_fc.properties.macro_name {
                    fc.properties
                        .vml_extras
                        .entry("FmlaMacro".to_string())
                        .or_insert_with(|| m.clone());
                }
                if let Some(ref v) = vml_fc.properties.text_h_align {
                    fc.properties
                        .vml_extras
                        .entry("TextHAlign".to_string())
                        .or_insert_with(|| v.clone());
                }
                if let Some(ref v) = vml_fc.properties.text_v_align {
                    fc.properties
                        .vml_extras
                        .entry("TextVAlign".to_string())
                        .or_insert_with(|| v.clone());
                }
                // Always preserve VML shape-level visual properties for round-trip
                fc.vml_shape = vml_fc.vml_shape.clone();
            }
        }
    }

    // Convert to output
    controls
        .into_iter()
        .map(|(shape_id, fc)| FormControlOutput::from_form_control(&fc, shape_id))
        .collect()
}

/// Extract a modern anchor and controlPr attributes for a specific shapeId.
///
/// Looks for `<control shapeId="N">` then finds its child `<controlPr>` which
/// may contain an `<anchor>` element with EMU-based positioning, plus attributes
/// like `print`, `autoPict`, `macro` etc. for round-trip fidelity.
fn extract_modern_anchor_and_attrs(
    worksheet_xml: &[u8],
    target_shape_id: u32,
) -> Option<(ModernAnchorResult, HashMap<String, String>)> {
    let shape_id_attr = format!("shapeId=\"{}\"", target_shape_id);
    let shape_id_bytes = shape_id_attr.as_bytes();

    let mut pos = 0;
    while let Some(ctrl_start) = find_tag_simd(worksheet_xml, b"control", pos) {
        let ctrl_gt = find_gt_simd(worksheet_xml, ctrl_start)
            .map(|p| p + 1)
            .unwrap_or(worksheet_xml.len());
        let ctrl_elem = &worksheet_xml[ctrl_start..ctrl_gt];

        // Check if this <control> has the target shapeId
        if find_attr_simd(ctrl_elem, shape_id_bytes, 0).is_some() {
            let is_self_closing = ctrl_gt > 1 && worksheet_xml[ctrl_gt - 2] == b'/';
            if !is_self_closing {
                let ctrl_close = find_closing_tag(worksheet_xml, b"control", ctrl_start)
                    .unwrap_or(worksheet_xml.len());
                let ctrl_body = &worksheet_xml[ctrl_gt..ctrl_close];

                if let Some(cpr_start) = find_tag_simd(ctrl_body, b"controlPr", 0) {
                    let cpr_tag_end = find_gt_simd(ctrl_body, cpr_start)
                        .map(|p| p + 1)
                        .unwrap_or(ctrl_body.len());
                    let cpr_element = &ctrl_body[cpr_start..cpr_tag_end];

                    // Extract controlPr attributes for round-trip
                    let mut attrs = HashMap::new();
                    for attr_name in &[
                        "defaultSize",
                        "print",
                        "autoFill",
                        "autoPict",
                        "autoLine",
                        "macro",
                        "altText",
                        "disabled",
                        "locked",
                    ] {
                        let needle = format!("{}=\"", attr_name);
                        if let Some(val) = parse_string_attr(cpr_element, needle.as_bytes()) {
                            attrs.insert(attr_name.to_string(), val);
                        }
                    }

                    let cpr_close = find_closing_tag(ctrl_body, b"controlPr", cpr_start)
                        .unwrap_or(ctrl_body.len());
                    let cpr_body = &ctrl_body[cpr_start..cpr_close];

                    if let Some(result) = ControlAnchor::from_modern_anchor(cpr_body) {
                        return Some((result, attrs));
                    }
                }
            }
        }

        pos = ctrl_gt;
    }

    None
}

/// Parse a VML attribute value, handling both single and double quotes.
/// VML often uses single quotes for style attributes.
fn parse_vml_attr(xml: &[u8], attr_name: &[u8]) -> Option<String> {
    let attr_pos = find_attr_simd(xml, attr_name, 0)?;
    let value_start = attr_pos + attr_name.len();
    if value_start >= xml.len() {
        return None;
    }
    let quote_char = xml[value_start];
    if quote_char != b'\'' && quote_char != b'"' {
        return None;
    }
    let content_start = value_start + 1;
    // Find the matching closing quote
    for i in content_start..xml.len() {
        if xml[i] == quote_char {
            return std::str::from_utf8(&xml[content_start..i])
                .ok()
                .map(|s| s.to_string());
        }
    }
    None
}

/// Parse VML drawing controls for a sheet (from the VML drawing file referenced in .rels).
fn parse_vml_drawing_for_sheet(
    archive: &crate::zip::XlsxArchive,
    sheet_num: usize,
    rels_xml: &[u8],
) -> Vec<FormControl> {
    let relationships = crate::infra::opc::parse_owned_relationships(
        crate::infra::opc::PackageOwner::Worksheet {
            sheet_index: sheet_num,
            path: format!("xl/worksheets/sheet{}.xml", sheet_num),
        },
        rels_xml,
    );
    let worksheet_relationships = crate::infra::opc::WorksheetRelationships::new(&relationships);

    let mut all_vml_controls = Vec::new();

    for rel in worksheet_relationships.legacy_vml_drawings() {
        let Some(full_path) = rel.target.path() else {
            continue;
        };
        if let Ok(vml_xml) = archive.read_file(full_path) {
            WorksheetControls::parse_vml_drawing(&vml_xml, &mut all_vml_controls);
        }
    }

    all_vml_controls
}

/// Fallback: parse form controls from VML drawings when no modern `<controls>` block exists.
///
/// Some older XLSX files only have VML-based form controls without the modern
/// `mc:AlternateContent` block. In this case we parse VML directly.
fn parse_vml_only_controls(
    archive: &crate::zip::XlsxArchive,
    sheet_num: usize,
) -> Vec<crate::output::results::FormControlOutput> {
    use crate::output::results::FormControlOutput;

    let rels_path = format!("xl/worksheets/_rels/sheet{}.xml.rels", sheet_num);
    let rels_xml = match archive.read_file(&rels_path) {
        Ok(xml) => xml,
        Err(_) => return Vec::new(),
    };

    let vml_controls = parse_vml_drawing_for_sheet(archive, sheet_num, &rels_xml);

    // For VML-only controls, there's no shapeId from the worksheet XML.
    // Use index as a placeholder shapeId.
    vml_controls
        .iter()
        .enumerate()
        .map(|(i, fc)| FormControlOutput::from_form_control(fc, i as u32))
        .collect()
}

/// Parse OLE objects for a sheet.
///
/// Extracts `<oleObject>` elements from the worksheet XML (inside `<oleObjects>`
/// or `mc:AlternateContent`), parses their attributes and `<objectPr>` children,
/// and optionally enriches with VML preview image references.
///
/// Returns `Vec<OleObjectOutput>` ready for WASM serialization.
pub fn parse_ole_objects_for_sheet(
    archive: &crate::zip::XlsxArchive,
    sheet_num: usize,
    worksheet_xml: &[u8],
) -> Vec<crate::output::results::OleObjectOutput> {
    use crate::output::results::OleObjectOutput;

    // Step 1: Find the <oleObjects> section in the worksheet XML
    let ole_section = if let Some(start) = find_tag_simd(worksheet_xml, b"oleObjects", 0) {
        let end =
            find_closing_tag(worksheet_xml, b"oleObjects", start).unwrap_or(worksheet_xml.len());
        let gt = find_gt_simd(worksheet_xml, end)
            .map(|p| p + 1)
            .unwrap_or(end);
        &worksheet_xml[start..gt]
    } else {
        return Vec::new();
    };

    // Step 2: Parse OLE objects from the section
    let mut ole_objects: Vec<OleObject> = Vec::new();
    WorksheetControls::parse_ole_objects(ole_section, &mut ole_objects);

    if ole_objects.is_empty() {
        return Vec::new();
    }

    // Step 3: Read sheet .rels to resolve r:id → target paths for embedded binaries
    let rels_path = format!("xl/worksheets/_rels/sheet{}.xml.rels", sheet_num);
    if let Ok(rels_xml) = archive.read_file(&rels_path) {
        let rel_map = build_rel_id_map(&rels_xml);

        // Resolve data_path from r:id for each OLE object
        for obj in &mut ole_objects {
            if let Some(r_id) = &obj.r_id {
                if let Some(target) = rel_map.get(r_id) {
                    obj.data_path = Some(ph_resolve_relative_path("xl/worksheets", target));
                }
            }
        }

        // Step 4: Try to enrich with VML preview image data
        let relationships = crate::infra::opc::parse_owned_relationships(
            crate::infra::opc::PackageOwner::Worksheet {
                sheet_index: sheet_num,
                path: format!("xl/worksheets/sheet{}.xml", sheet_num),
            },
            &rels_xml,
        );
        let worksheet_relationships =
            crate::infra::opc::WorksheetRelationships::new(&relationships);

        for rel in worksheet_relationships.legacy_vml_drawings() {
            let Some(full_path) = rel.target.path() else {
                continue;
            };
            if let Ok(vml_xml) = archive.read_file(full_path) {
                let imagedata_map = parse_vml_imagedata(&vml_xml);

                // Match VML shape IDs to OLE object shape IDs
                for obj in &mut ole_objects {
                    for (vml_id, rel_id) in &imagedata_map {
                        if let Some(num) = extract_vml_shape_number(vml_id) {
                            if num == obj.shape_id {
                                obj.preview_image_rel_id = Some(rel_id.clone());
                            }
                        }
                    }
                }

                // Step 5: Resolve preview image rel_ids through VML .rels
                // VML .rels file path is based on the VML file path
                let vml_rels_path = {
                    // e.g., target = "../drawings/vmlDrawing1.vml"
                    // full_path = "xl/drawings/vmlDrawing1.vml"
                    // rels = "xl/drawings/_rels/vmlDrawing1.vml.rels"
                    if let Some(slash_pos) = full_path.rfind('/') {
                        let dir = &full_path[..slash_pos];
                        let filename = &full_path[slash_pos + 1..];
                        format!("{}/_rels/{}.rels", dir, filename)
                    } else {
                        format!("_rels/{}.rels", full_path)
                    }
                };

                if let Ok(vml_rels_xml) = archive.read_file(&vml_rels_path) {
                    let vml_rel_map = build_rel_id_map(&vml_rels_xml);
                    let vml_dir = full_path.rfind('/').map(|p| &full_path[..p]).unwrap_or("");

                    for obj in &mut ole_objects {
                        if let Some(rel_id) = &obj.preview_image_rel_id {
                            if let Some(img_target) = vml_rel_map.get(rel_id) {
                                obj.preview_image_path =
                                    Some(ph_resolve_relative_path(vml_dir, img_target));
                            }
                        }
                    }
                }
            }
        }
    }

    // Convert to output
    ole_objects
        .iter()
        .map(|obj| OleObjectOutput::from_ole_object(obj))
        .collect()
}

/// Extract OLE binary entries from the archive into a `BinaryPassthrough` store.
///
/// This should be called during import after `parse_ole_objects_for_sheet()` to
/// eagerly extract OLE binary blobs and preview images for roundtrip preservation.
///
/// # Arguments
/// * `archive` - The source XLSX archive
/// * `ole_outputs` - Parsed OLE object outputs (with resolved `data_path` and `preview_image_path`)
/// * `passthrough` - The binary passthrough store to populate
pub fn extract_ole_binary_entries(
    archive: &crate::zip::XlsxArchive,
    ole_outputs: &[crate::output::results::OleObjectOutput],
    passthrough: &mut crate::roundtrip::binary_passthrough::BinaryPassthrough,
) {
    for ole in ole_outputs {
        if let Some(data_path) = &ole.data_path {
            passthrough.record_from_archive(archive, data_path);
        }
        if let Some(preview_path) = &ole.preview_image_path {
            passthrough.record_from_archive(archive, preview_path);
        }
    }
}
