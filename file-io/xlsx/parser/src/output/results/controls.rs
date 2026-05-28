use super::*;

// FormControlOutput
// =============================================================================

/// Serializable form control output for WASM consumers.
///
/// Mirrors all CT_FormControlPr attributes plus anchor and VML data
/// for lossless roundtrip and rendering on the TypeScript side.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct FormControlOutput {
    /// ST_ObjectType value (e.g. "CheckBox", "ComboBox", "Button")
    pub object_type: String,
    /// VML shape identifier
    pub shape_id: u32,
    /// Human-readable control name
    pub name: Option<String>,
    /// Alternative text for accessibility
    pub alt_text: Option<String>,

    // --- Formula references ---
    /// Linked cell formula (fmlaLink)
    pub fmla_link: Option<String>,
    /// Input range formula (fmlaRange)
    pub fmla_range: Option<String>,
    /// Group formula (fmlaGroup)
    pub fmla_group: Option<String>,
    /// Text box formula (fmlaTxbx)
    pub fmla_txbx: Option<String>,

    // --- State fields ---
    /// Check state: "Unchecked", "Checked", or "Mixed"
    pub checked: Option<String>,
    /// Current value for scroll/spin
    pub val: Option<u32>,
    /// Selected index for list/combo
    pub sel: Option<u32>,
    /// Minimum value for scroll/spin
    pub min: Option<i32>,
    /// Maximum value for scroll/spin
    pub max: Option<i32>,
    /// Increment for scroll/spin
    pub inc: Option<i32>,
    /// Page increment for scroll bar
    pub page: Option<i32>,

    // --- Appearance fields ---
    /// Number of visible drop lines for combo/list
    pub drop_lines: Option<u32>,
    /// Drop style for combo box
    pub drop_style: Option<String>,
    /// Scroll bar width in pixels
    pub dx: Option<u32>,
    /// Horizontal orientation for scroll/spin
    pub horiz: bool,
    /// Whether the control uses colored appearance
    pub colored: bool,
    /// Flat appearance for control border
    pub no_three_d: bool,
    /// Flat appearance for control text
    pub no_three_d2: bool,

    // --- Behavior fields ---
    /// Whether this is the first button in a radio group
    pub first_button: bool,
    /// Prevents text editing on control
    pub lock_text: bool,
    /// Selection type for list box
    pub sel_type: Option<String>,
    /// Multiple selection mode
    pub multi_sel: Option<String>,
    /// Text horizontal alignment
    pub text_h_align: Option<String>,
    /// Text vertical alignment
    pub text_v_align: Option<String>,
    /// Edit validation type
    pub edit_val: Option<String>,
    /// Multi-line text box
    pub multi_line: bool,
    /// Vertical scroll bar
    pub vertical_bar: bool,
    /// Password edit mode
    pub password_edit: bool,
    /// Justify last line
    pub just_last_x: bool,
    /// Minimum width
    pub width_min: Option<u32>,

    // --- List items ---
    /// Items from <itemLst> child element
    pub items: Vec<String>,

    // --- Macro ---
    /// Assigned macro name
    pub macro_name: Option<String>,

    // --- Anchor data ---
    /// Starting column (0-indexed)
    pub from_col: u32,
    /// X offset from column start
    pub from_col_offset: i64,
    /// Starting row (0-indexed)
    pub from_row: u32,
    /// Y offset from row start
    pub from_row_offset: i64,
    /// Ending column (0-indexed)
    pub to_col: u32,
    /// X offset at end column
    pub to_col_offset: i64,
    /// Ending row (0-indexed)
    pub to_row: u32,
    /// Y offset at end row
    pub to_row_offset: i64,
    /// "Modern" (EMU offsets) or "Vml" (pixel offsets)
    pub anchor_source: String,

    // --- VML extras ---
    /// VML-only CT_ClientData children with no modern equivalent (tag-name -> text-content)
    pub vml_extras: std::collections::HashMap<String, String>,

    // --- Worksheet-level controlPr attributes ---
    /// Raw attributes from the worksheet `<controlPr>` element for round-trip fidelity.
    pub control_pr_attrs: std::collections::HashMap<String, String>,
    /// Typed worksheet `<controlPr>` element attributes.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub control_pr: Option<domain_types::domain::floating_object::FormControlWorksheetControlPr>,

    // --- Anchor positioning policy ---
    /// Whether the control moves with the cells it is anchored to.
    #[serde(default)]
    pub move_with_cells: bool,
    /// Whether the control resizes with the cells it is anchored to.
    #[serde(default)]
    pub size_with_cells: bool,

    // --- VML shape-level visual properties ---
    /// VML shape visual properties for round-trip fidelity.
    #[serde(default)]
    pub vml_shape: crate::domain::controls::types::VmlShapeProps,
}

impl FormControlOutput {
    /// Convert a `FormControlOutput` (WASM-serializable) back into a `FormControl` (parser-internal).
    ///
    /// This is the reverse of `from_form_control()` and enables semantic round-trip:
    /// parse → FormControlOutput → FormControl → ControlsWriter → ctrlProp XML.
    pub fn to_form_control(&self) -> crate::domain::controls::types::FormControl {
        use crate::domain::controls::types::{
            AnchorSource, CheckState, ControlAnchor, FormControl, FormControlProperties,
            FormControlType,
        };

        let object_type = FormControlType::from_str(&self.object_type);
        let checked = self.checked.as_deref().map(CheckState::from_str);

        let anchor_source = match self.anchor_source.as_str() {
            "Modern" => AnchorSource::Modern,
            _ => AnchorSource::Vml,
        };

        let anchor = ControlAnchor {
            from_col: self.from_col,
            from_col_offset: self.from_col_offset,
            from_row: self.from_row,
            from_row_offset: self.from_row_offset,
            to_col: self.to_col,
            to_col_offset: self.to_col_offset,
            to_row: self.to_row,
            to_row_offset: self.to_row_offset,
            anchor_source,
        };

        let properties = FormControlProperties {
            name: self.name.clone(),
            alt_text: self.alt_text.clone(),
            linked_cell: self.fmla_link.clone(),
            input_range: self.fmla_range.clone(),
            fmla_group: self.fmla_group.clone(),
            fmla_txbx: self.fmla_txbx.clone(),
            checked,
            val: self.val,
            sel: self.sel,
            min_value: self.min,
            max_value: self.max,
            increment: self.inc,
            page_increment: self.page,
            drop_lines: self.drop_lines,
            sel_type: self.sel_type.clone(),
            drop_style: self.drop_style.clone(),
            macro_name: self.macro_name.clone(),
            colored: self.colored,
            dx: self.dx,
            horiz: self.horiz,
            first_button: self.first_button,
            no_three_d: self.no_three_d,
            no_three_d2: self.no_three_d2,
            lock_text: self.lock_text,
            multi_sel: self.multi_sel.clone(),
            text_h_align: self.text_h_align.clone(),
            text_v_align: self.text_v_align.clone(),
            edit_val: self.edit_val.clone(),
            multi_line: self.multi_line,
            vertical_bar: self.vertical_bar,
            password_edit: self.password_edit,
            just_last_x: self.just_last_x,
            width_min: self.width_min,
            items: self.items.clone(),
            vml_extras: self.vml_extras.clone(),
        };

        FormControl {
            object_type,
            anchor,
            properties,
            shape_id: Some(self.shape_id),
            control_pr_attrs: self.control_pr_attrs.clone(),
            control_pr: self.control_pr.clone(),
            move_with_cells: self.move_with_cells,
            size_with_cells: self.size_with_cells,
            vml_shape: self.vml_shape.clone(),
        }
    }

    /// Convert a `FormControl` (parser-internal) into a `FormControlOutput` (WASM-serializable).
    ///
    /// `shape_id` is provided externally because it comes from the worksheet-level
    /// `<control shapeId="...">` element, not from the ctrlProp XML.
    pub fn from_form_control(
        fc: &crate::domain::controls::types::FormControl,
        shape_id: u32,
    ) -> Self {
        use crate::domain::controls::types::{AnchorSource, CheckState};

        let checked = fc.properties.checked.map(|c| match c {
            CheckState::Unchecked => "Unchecked".to_string(),
            CheckState::Checked => "Checked".to_string(),
            CheckState::Mixed => "Mixed".to_string(),
        });

        let anchor_source = match fc.anchor.anchor_source {
            AnchorSource::Modern => "Modern".to_string(),
            AnchorSource::Vml => "Vml".to_string(),
        };

        Self {
            object_type: fc.object_type.to_string(),
            shape_id,
            name: fc.properties.name.clone(),
            alt_text: fc.properties.alt_text.clone(),
            fmla_link: fc.properties.linked_cell.clone(),
            fmla_range: fc.properties.input_range.clone(),
            fmla_group: fc.properties.fmla_group.clone(),
            fmla_txbx: fc.properties.fmla_txbx.clone(),
            checked,
            val: fc.properties.val,
            sel: fc.properties.sel,
            min: fc.properties.min_value,
            max: fc.properties.max_value,
            inc: fc.properties.increment,
            page: fc.properties.page_increment,
            drop_lines: fc.properties.drop_lines,
            drop_style: fc.properties.drop_style.clone(),
            dx: fc.properties.dx,
            horiz: fc.properties.horiz,
            colored: fc.properties.colored,
            no_three_d: fc.properties.no_three_d,
            no_three_d2: fc.properties.no_three_d2,
            first_button: fc.properties.first_button,
            lock_text: fc.properties.lock_text,
            sel_type: fc.properties.sel_type.clone(),
            multi_sel: fc.properties.multi_sel.clone(),
            text_h_align: fc.properties.text_h_align.clone(),
            text_v_align: fc.properties.text_v_align.clone(),
            edit_val: fc.properties.edit_val.clone(),
            multi_line: fc.properties.multi_line,
            vertical_bar: fc.properties.vertical_bar,
            password_edit: fc.properties.password_edit,
            just_last_x: fc.properties.just_last_x,
            width_min: fc.properties.width_min,
            items: fc.properties.items.clone(),
            macro_name: fc.properties.macro_name.clone(),
            from_col: fc.anchor.from_col,
            from_col_offset: fc.anchor.from_col_offset,
            from_row: fc.anchor.from_row,
            from_row_offset: fc.anchor.from_row_offset,
            to_col: fc.anchor.to_col,
            to_col_offset: fc.anchor.to_col_offset,
            to_row: fc.anchor.to_row,
            to_row_offset: fc.anchor.to_row_offset,
            anchor_source,
            vml_extras: fc.properties.vml_extras.clone(),
            control_pr_attrs: fc.control_pr_attrs.clone(),
            control_pr: fc.control_pr.clone(),
            move_with_cells: fc.move_with_cells,
            size_with_cells: fc.size_with_cells,
            vml_shape: fc.vml_shape.clone(),
        }
    }
}
