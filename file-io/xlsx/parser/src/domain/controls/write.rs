//! Form controls writer for XLSX export.
//!
//! This module writes form controls back to OOXML format during XLSX export,
//! producing two parallel representations:
//!
//! 1. **Modern path**: `xl/ctrlProps/ctrlProp{N}.xml` files + `<controls>` in worksheet
//!    XML wrapped in `mc:AlternateContent`
//! 2. **Legacy path**: VML shapes in `xl/drawings/vmlDrawing{N}.vml`
//!
//! # XLSX Form Controls Structure
//!
//! Form controls are stored in multiple files:
//! - `xl/ctrlProps/ctrlProp*.xml` — Individual control property files (CT_FormControlPr)
//! - `xl/drawings/vmlDrawing*.vml` — VML shapes for legacy rendering
//! - Worksheet XML contains `<controls>` inside `<mc:AlternateContent>`
//!
//! # Example Usage
//!
//! ```ignore
//! use xlsx_parser::read::controls::{FormControl, FormControlType, CheckState, ControlAnchor};
//! use xlsx_parser::write::controls_writer::ControlsWriter;
//!
//! let mut control = FormControl::new(FormControlType::CheckBox);
//! control.properties.linked_cell = Some("$A$1".to_string());
//! control.properties.checked = Some(CheckState::Checked);
//! control.properties.lock_text = true;
//! control.anchor = ControlAnchor::new(1, 2, 3, 4);
//!
//! let writer = ControlsWriter::new(vec![control]);
//! let ctrl_prop_xml = writer.write_ctrl_prop(0);
//! let worksheet_controls_xml = writer.write_worksheet_controls(1025);
//! let vml_xml = writer.write_vml_form_controls(1025);
//! ```

use crate::domain::controls::read::{
    AnchorSource, CheckState, ControlAnchor, FormControl, FormControlType, OleObject,
};
use crate::write::xml_writer::XmlWriter;

// =============================================================================
// Constants
// =============================================================================

/// Relationship type for control properties (ctrlProp*.xml)
pub const REL_CTRL_PROP: &str =
    "http://schemas.openxmlformats.org/officeDocument/2006/relationships/ctrlProp";

/// Content type for control properties
pub const CONTENT_TYPE_CTRL_PROP: &str = "application/vnd.ms-excel.controlproperties+xml";

/// Namespace for form control properties (Office 2010+)
const NS_X14: &str = "http://schemas.microsoft.com/office/spreadsheetml/2009/9/main";

/// Namespace for markup compatibility
const NS_MC: &str = "http://schemas.openxmlformats.org/markup-compatibility/2006";

/// Namespace for spreadsheetML drawing
const NS_XDR: &str = "http://schemas.openxmlformats.org/drawingml/2006/spreadsheetDrawing";

/// VML namespace
const VML_NS: &str = "urn:schemas-microsoft-com:vml";

/// Office namespace for VML
const OFFICE_NS: &str = "urn:schemas-microsoft-com:office:office";

/// Excel namespace for VML
const EXCEL_NS: &str = "urn:schemas-microsoft-com:office:excel";

// =============================================================================
// ControlsWriter
// =============================================================================

/// Writer for form controls in XLSX files.
///
/// Produces three types of output:
/// 1. `ctrlProp{N}.xml` — One per control, the modern CT_FormControlPr XML
/// 2. Worksheet `<controls>` block wrapped in `<mc:AlternateContent>`
/// 3. VML drawing with `<v:shape>` elements for legacy rendering
#[derive(Debug)]
pub struct ControlsWriter {
    controls: Vec<FormControl>,
}

impl ControlsWriter {
    /// Create a new controls writer with the given form controls.
    pub fn new(controls: Vec<FormControl>) -> Self {
        Self { controls }
    }

    /// Get a reference to the controls.
    pub fn controls(&self) -> &[FormControl] {
        &self.controls
    }

    /// Check if there are any controls.
    pub fn is_empty(&self) -> bool {
        self.controls.is_empty()
    }

    /// Get the number of controls.
    pub fn len(&self) -> usize {
        self.controls.len()
    }

    // =========================================================================
    // Modern path: ctrlProp{N}.xml
    // =========================================================================

    /// Write a single `ctrlProp{N}.xml` file for the control at the given index.
    ///
    /// Returns the XML content as bytes.
    ///
    /// # Arguments
    /// * `index` — Index into the controls vec (0-based).
    ///
    /// # Panics
    /// Panics if `index` is out of bounds.
    pub fn write_ctrl_prop(&self, index: usize) -> Vec<u8> {
        let control = &self.controls[index];
        write_ctrl_prop_xml(control)
    }

    // =========================================================================
    // Modern path: worksheet <controls> block
    // =========================================================================

    /// Write the worksheet `<controls>` block wrapped in `<mc:AlternateContent>`.
    ///
    /// # Arguments
    /// * `base_shape_id` — The starting shape ID for the first control (typically 1025).
    /// * `r_ids` — Relationship IDs for each control's ctrlProp file (e.g., `["rId3", "rId4"]`).
    ///
    /// Returns the XML fragment as bytes, suitable for insertion into the worksheet XML.
    pub fn write_worksheet_controls(&self, base_shape_id: u32, r_ids: &[String]) -> Vec<u8> {
        let mut w = XmlWriter::new();

        w.start_element("mc:AlternateContent")
            .attr("xmlns:mc", NS_MC)
            .attr("xmlns:x14", NS_X14)
            .attr("xmlns:xdr", NS_XDR)
            .end_attrs();

        w.start_element("mc:Choice")
            .attr("Requires", "x14")
            .end_attrs();

        w.start_element("controls").end_attrs();

        for (i, control) in self.controls.iter().enumerate() {
            let shape_id = control.shape_id.unwrap_or(base_shape_id + i as u32);
            let r_id = r_ids.get(i).map(String::as_str).unwrap_or("");
            let name = control.properties.name.as_deref().unwrap_or("");

            w.start_element("mc:AlternateContent")
                .attr("xmlns:mc", NS_MC)
                .end_attrs();

            w.start_element("mc:Choice")
                .attr("Requires", "x14")
                .end_attrs();

            // <control shapeId="1025" r:id="rId3" name="Check Box 1">
            w.start_element("control")
                .attr_num("shapeId", shape_id)
                .attr("r:id", r_id)
                .attr("name", name)
                .end_attrs();

            // <controlPr> with anchor
            write_control_pr(&mut w, control);

            w.end_element("control");
            w.end_element("mc:Choice");
            w.end_element("mc:AlternateContent");
        }

        w.end_element("controls");
        w.end_element("mc:Choice");

        // mc:Fallback — legacy controls without controlPr
        w.start_element("mc:Fallback").end_attrs();
        w.start_element("controls").end_attrs();
        for (i, control) in self.controls.iter().enumerate() {
            let shape_id = control.shape_id.unwrap_or(base_shape_id + i as u32);
            let r_id = r_ids.get(i).map(String::as_str).unwrap_or("");
            let name = control.properties.name.as_deref().unwrap_or("");

            w.start_element("control")
                .attr_num("shapeId", shape_id)
                .attr("r:id", r_id)
                .attr("name", name)
                .self_close();
        }
        w.end_element("controls");
        w.end_element("mc:Fallback");

        w.end_element("mc:AlternateContent");

        w.finish()
    }

    // =========================================================================
    // Legacy path: VML drawing
    // =========================================================================

    /// Write VML form control shapes.
    ///
    /// # Arguments
    /// * `base_shape_id` — The starting shape ID (typically 1025).
    ///
    /// Returns the complete VML drawing XML as bytes.
    pub fn write_vml_form_controls(&self, base_shape_id: u32) -> Vec<u8> {
        let mut w = XmlWriter::new();

        // VML root element with namespaces
        w.start_element("xml")
            .attr("xmlns:v", VML_NS)
            .attr("xmlns:o", OFFICE_NS)
            .attr("xmlns:x", EXCEL_NS)
            .end_attrs();

        // Shape layout — use preserved idmap data if available.
        let idmap_data = self
            .controls
            .first()
            .and_then(|c| c.vml_shape.idmap_data.as_deref())
            .unwrap_or("1");
        w.start_element_ns("o", "shapelayout")
            .attr("v:ext", "edit")
            .end_attrs();
        w.start_element_ns("o", "idmap")
            .attr("v:ext", "edit")
            .attr("data", idmap_data)
            .self_close();
        w.end_element_ns("o", "shapelayout");

        // Shape type for form controls (type 201)
        write_vml_shapetype_201(&mut w);

        // Write each control as a VML shape
        for (i, control) in self.controls.iter().enumerate() {
            let shape_id = control.shape_id.unwrap_or(base_shape_id + i as u32);
            write_vml_shape(&mut w, control, shape_id);
        }

        w.end_element("xml");

        w.finish()
    }

    // =========================================================================
    // Unified VML drawing with form controls + OLE objects
    // =========================================================================

    /// Write a unified VML drawing containing both form controls and OLE object shapes.
    ///
    /// This produces a single VML drawing file (`vmlDrawing*.vml`) that can
    /// contain heterogeneous shape types. OLE objects use shapetype 75 (the
    /// standard "PictureFrame" type used by Excel for OLE/embedded objects),
    /// while form controls use shapetype 201.
    ///
    /// # Arguments
    /// * `base_shape_id` — The starting shape ID (typically 1025).
    /// * `ole_objects` — OLE objects to include in the VML drawing.
    /// * `ole_preview_rel_ids` — Relationship IDs for preview images of each OLE object
    ///   (same order and length as `ole_objects`). Pass empty strings for objects
    ///   without preview images.
    ///
    /// # Returns
    /// The complete VML drawing XML as bytes, including both form control
    /// and OLE object shapes.
    pub fn write_vml_with_ole(
        &self,
        base_shape_id: u32,
        ole_objects: &[OleObject],
        ole_preview_rel_ids: &[String],
    ) -> Vec<u8> {
        let mut w = XmlWriter::new();

        // VML root element with namespaces
        w.start_element("xml")
            .attr("xmlns:v", VML_NS)
            .attr("xmlns:o", OFFICE_NS)
            .attr("xmlns:x", EXCEL_NS)
            .end_attrs();

        // Shape layout
        w.start_element_ns("o", "shapelayout")
            .attr("v:ext", "edit")
            .end_attrs();
        w.start_element_ns("o", "idmap")
            .attr("v:ext", "edit")
            .attr("data", "1")
            .self_close();
        w.end_element_ns("o", "shapelayout");

        // Shape type for form controls (type 201)
        if !self.controls.is_empty() {
            write_vml_shapetype_201(&mut w);
        }

        // Shape type for OLE objects / picture frames (type 75)
        if !ole_objects.is_empty() {
            write_vml_shapetype_75(&mut w);
        }

        // Write form control shapes
        for (i, control) in self.controls.iter().enumerate() {
            let shape_id = control.shape_id.unwrap_or(base_shape_id + i as u32);
            write_vml_shape(&mut w, control, shape_id);
        }

        // Write OLE object shapes (shape IDs continue after form controls)
        for (i, ole_obj) in ole_objects.iter().enumerate() {
            // OLE objects use their own shapeId from the oleObject element
            let shape_id = ole_obj.shape_id;
            let preview_rel_id = ole_preview_rel_ids.get(i).map(|s| s.as_str()).unwrap_or("");
            write_vml_ole_shape(&mut w, ole_obj, shape_id, preview_rel_id);
        }

        w.end_element("xml");

        w.finish()
    }
}

// =============================================================================
// VML shapetype definitions
// =============================================================================

/// Write the VML shapetype 201 definition (used by form controls).
fn write_vml_shapetype_201(w: &mut XmlWriter) {
    w.start_element_ns("v", "shapetype")
        .attr("id", "_x0000_t201")
        .attr("coordsize", "21600,21600")
        .attr("o:spt", "201")
        .attr("path", "m,l,21600r21600,l21600,xe")
        .end_attrs();
    w.start_element_ns("v", "stroke")
        .attr("joinstyle", "miter")
        .self_close();
    w.start_element_ns("v", "path")
        .attr("shadowok", "f")
        .attr("o:extrusionok", "f")
        .attr("strokeok", "f")
        .attr("fillok", "f")
        .attr("o:connecttype", "rect")
        .self_close();
    w.start_element_ns("o", "lock")
        .attr("v:ext", "edit")
        .attr("shapetype", "t")
        .self_close();
    w.end_element_ns("v", "shapetype");
}

/// Write the VML shapetype 75 definition (used by OLE objects / picture frames).
///
/// This is the standard "PictureFrame" shapetype that Excel uses for OLE embedded
/// objects in VML. It allows the shape to display an image (the OLE preview).
fn write_vml_shapetype_75(w: &mut XmlWriter) {
    w.start_element_ns("v", "shapetype")
        .attr("id", "_x0000_t75")
        .attr("coordsize", "21600,21600")
        .attr("o:spt", "75")
        .attr("o:preferrelative", "t")
        .attr("path", "m@4@5l@4@11@9@11@9@5xe")
        .attr("filled", "f")
        .attr("stroked", "f")
        .end_attrs();
    w.start_element_ns("v", "stroke")
        .attr("joinstyle", "miter")
        .self_close();
    w.start_element_ns("v", "formulas").end_attrs();
    w.start_element_ns("v", "f")
        .attr("eqn", "if lineDrawn pixelLineWidth 0")
        .self_close();
    w.start_element_ns("v", "f")
        .attr("eqn", "sum @0 1 0")
        .self_close();
    w.start_element_ns("v", "f")
        .attr("eqn", "sum 0 0 @1")
        .self_close();
    w.start_element_ns("v", "f")
        .attr("eqn", "prod @2 1 2")
        .self_close();
    w.start_element_ns("v", "f")
        .attr("eqn", "prod @3 21600 pixelWidth")
        .self_close();
    w.start_element_ns("v", "f")
        .attr("eqn", "prod @3 21600 pixelHeight")
        .self_close();
    w.start_element_ns("v", "f")
        .attr("eqn", "sum @0 0 1")
        .self_close();
    w.start_element_ns("v", "f")
        .attr("eqn", "prod @6 1 2")
        .self_close();
    w.start_element_ns("v", "f")
        .attr("eqn", "prod @7 21600 pixelWidth")
        .self_close();
    w.start_element_ns("v", "f")
        .attr("eqn", "sum @8 21600 0")
        .self_close();
    w.start_element_ns("v", "f")
        .attr("eqn", "prod @7 21600 pixelHeight")
        .self_close();
    w.start_element_ns("v", "f")
        .attr("eqn", "sum @10 21600 0")
        .self_close();
    w.end_element_ns("v", "formulas");
    w.start_element_ns("v", "path")
        .attr("o:extrusionok", "f")
        .attr("gradientshapeok", "t")
        .attr("o:connecttype", "rect")
        .self_close();
    w.start_element_ns("o", "lock")
        .attr("v:ext", "edit")
        .attr("aspectratio", "t")
        .self_close();
    w.end_element_ns("v", "shapetype");
}

// =============================================================================
// VML OLE shape generation
// =============================================================================

/// Write a VML `<v:shape>` element for an OLE embedded object.
///
/// OLE shapes in VML use shapetype 75 (PictureFrame) and include:
/// - `<v:imagedata>` pointing to the preview image relationship
/// - `<x:ClientData ObjectType="Pict">` with anchor and other properties
fn write_vml_ole_shape(w: &mut XmlWriter, ole: &OleObject, shape_id: u32, preview_rel_id: &str) {
    let shape_id_str = format!("_x0000_s{}", shape_id);
    let anchor = &ole.anchor;

    // Compute VML style string
    let style = format!(
        "position:absolute;margin-left:0;margin-top:0;width:{}pt;height:{}pt;z-index:{}",
        compute_ole_vml_width(anchor),
        compute_ole_vml_height(anchor),
        shape_id.saturating_sub(1024),
    );

    w.start_element_ns("v", "shape")
        .attr("id", &shape_id_str)
        .attr("type", "#_x0000_t75")
        .attr("style", &style)
        .attr("o:insetmode", "auto")
        .end_attrs();

    // <v:imagedata> pointing to the preview image
    if !preview_rel_id.is_empty() {
        w.start_element_ns("v", "imagedata")
            .attr("o:relid", preview_rel_id)
            .attr("o:title", "")
            .self_close();
    }

    // <o:lock> to prevent editing
    w.start_element_ns("o", "lock")
        .attr("v:ext", "edit")
        .attr("rotation", "t")
        .self_close();

    // <x:ClientData> with ObjectType="Pict" (standard for OLE objects)
    w.start_element_ns("x", "ClientData")
        .attr("ObjectType", "Pict")
        .end_attrs();

    // Anchor: fromCol, fromColOff, fromRow, fromRowOff, toCol, toColOff, toRow, toRowOff
    let vml_anchor = format!(
        "{}, {}, {}, {}, {}, {}, {}, {}",
        anchor.from_col,
        vml_offset(anchor.from_col_offset, &anchor.anchor_source),
        anchor.from_row,
        vml_offset(anchor.from_row_offset, &anchor.anchor_source),
        anchor.to_col,
        vml_offset(anchor.to_col_offset, &anchor.anchor_source),
        anchor.to_row,
        vml_offset(anchor.to_row_offset, &anchor.anchor_source),
    );
    w.element_with_text("x:Anchor", &vml_anchor);

    // Standard OLE object properties
    w.element_with_text("x:AutoFill", "False");
    w.element_with_text("x:AutoLine", "False");

    // SizeWithCells / MoveWithCells from object properties
    if let Some(ref object_pr) = ole.object_pr {
        if let Some(ref obj_anchor) = object_pr.anchor {
            if obj_anchor.size_with_cells {
                w.start_element_ns("x", "SizeWithCells").self_close();
            }
            if obj_anchor.move_with_cells {
                w.start_element_ns("x", "MoveWithCells").self_close();
            }
        }
    }

    w.end_element_ns("x", "ClientData");
    w.end_element_ns("v", "shape");
}

/// Compute an approximate VML width in points from the OLE anchor.
fn compute_ole_vml_width(anchor: &ControlAnchor) -> u32 {
    let col_diff = anchor.to_col.saturating_sub(anchor.from_col);
    col_diff * 64 + 48
}

/// Compute an approximate VML height in points from the OLE anchor.
fn compute_ole_vml_height(anchor: &ControlAnchor) -> u32 {
    let row_diff = anchor.to_row.saturating_sub(anchor.from_row);
    row_diff * 15 + 15
}

// =============================================================================
// ctrlProp XML generation
// =============================================================================

/// Write a single ctrlProp{N}.xml file content.
fn write_ctrl_prop_xml(control: &FormControl) -> Vec<u8> {
    let mut w = XmlWriter::new();
    w.write_declaration();

    // <formControlPr xmlns="..." objectType="CheckBox" .../>
    w.start_element("formControlPr")
        .attr("xmlns", NS_X14)
        .attr("objectType", &object_type_to_modern(&control.object_type));

    let props = &control.properties;

    // Formula attributes
    if let Some(ref v) = props.linked_cell {
        w.attr("fmlaLink", v);
    }
    if let Some(ref v) = props.input_range {
        w.attr("fmlaRange", v);
    }
    if let Some(ref v) = props.fmla_group {
        w.attr("fmlaGroup", v);
    }
    if let Some(ref v) = props.fmla_txbx {
        w.attr("fmlaTxbx", v);
    }

    // Check state
    if let Some(ref checked) = props.checked {
        w.attr("checked", check_state_to_modern(checked));
    }

    // Numeric properties
    if let Some(val) = props.val {
        w.attr_num("val", val);
    }
    if let Some(sel) = props.sel {
        w.attr_num("sel", sel);
    }
    if let Some(min) = props.min_value {
        w.attr_num("min", min);
    }
    if let Some(max) = props.max_value {
        w.attr_num("max", max);
    }
    if let Some(inc) = props.increment {
        w.attr_num("inc", inc);
    }
    if let Some(page) = props.page_increment {
        w.attr_num("page", page);
    }
    if let Some(dl) = props.drop_lines {
        w.attr_num("dropLines", dl);
    }
    if let Some(dx) = props.dx {
        w.attr_num("dx", dx);
    }
    if let Some(wm) = props.width_min {
        w.attr_num("widthMin", wm);
    }

    // String attributes
    if let Some(ref v) = props.sel_type {
        w.attr("seltype", v);
    }
    if let Some(ref v) = props.drop_style {
        w.attr("dropStyle", v);
    }
    if let Some(ref v) = props.multi_sel {
        w.attr("multiSel", v);
    }
    if let Some(ref v) = props.text_h_align {
        w.attr("textHAlign", v);
    }
    if let Some(ref v) = props.text_v_align {
        w.attr("textVAlign", v);
    }
    if let Some(ref v) = props.edit_val {
        w.attr("editVal", v);
    }
    if let Some(ref v) = props.alt_text {
        w.attr("altText", v);
    }
    if let Some(ref v) = props.macro_name {
        w.attr("macro", v);
    }

    // Boolean attributes (only write when true — "1")
    if props.lock_text {
        w.attr("lockText", "1");
    }
    if props.no_three_d2 {
        w.attr("noThreeD2", "1");
    }
    if props.no_three_d {
        w.attr("noThreeD", "1");
    }
    if props.colored {
        w.attr("colored", "1");
    }
    if props.horiz {
        w.attr("horiz", "1");
    }
    if props.first_button {
        w.attr("firstButton", "1");
    }
    if props.multi_line {
        w.attr("multiLine", "1");
    }
    if props.vertical_bar {
        w.attr("verticalBar", "1");
    }
    if props.password_edit {
        w.attr("passwordEdit", "1");
    }
    if props.just_last_x {
        w.attr("justLastX", "1");
    }

    // Check if we have items to write (requires a body, not self-closing)
    if props.items.is_empty() {
        w.self_close();
    } else {
        w.end_attrs();
        // <itemLst>
        w.start_element("itemLst").end_attrs();
        for item in &props.items {
            w.start_element("item").attr("val", item).self_close();
        }
        w.end_element("itemLst");
        w.end_element("formControlPr");
    }

    w.finish()
}

// =============================================================================
// controlPr element in worksheet XML
// =============================================================================

/// Write the `<controlPr>` element with anchor inside a `<control>` element.
fn write_control_pr(w: &mut XmlWriter, control: &FormControl) {
    w.start_element("controlPr");

    // Write controlPr attributes from round-trip preservation if available.
    // Attribute order matters for fidelity: use the canonical OOXML order.
    if !control.control_pr_attrs.is_empty() {
        let attrs = &control.control_pr_attrs;
        // Emit in canonical order
        for attr_name in &[
            "defaultSize",
            "print",
            "disabled",
            "locked",
            "autoFill",
            "autoPict",
            "autoLine",
            "macro",
            "altText",
        ] {
            if let Some(val) = attrs.get(*attr_name) {
                w.attr(attr_name, val);
            }
        }
    } else {
        // Fallback: emit minimal defaults for controls without round-trip data
        w.attr("defaultSize", "0")
            .attr("autoFill", "0")
            .attr("autoLine", "0");

        if let Some(ref macro_name) = control.properties.macro_name {
            w.attr("macro", macro_name);
        }

        if let Some(ref alt_text) = control.properties.alt_text {
            w.attr("altText", alt_text);
        }
    }

    w.end_attrs();

    write_modern_anchor(
        w,
        &control.anchor,
        control.move_with_cells,
        control.size_with_cells,
    );

    w.end_element("controlPr");
}

/// Write a modern anchor element with `<from>` and `<to>` children.
fn write_modern_anchor(
    w: &mut XmlWriter,
    anchor: &ControlAnchor,
    move_with_cells: bool,
    size_with_cells: bool,
) {
    w.start_element("anchor")
        .attr("moveWithCells", if move_with_cells { "1" } else { "0" })
        .attr("sizeWithCells", if size_with_cells { "1" } else { "0" })
        .end_attrs();

    // <from>
    w.start_element("from").end_attrs();
    w.element_with_text("xdr:col", &anchor.from_col.to_string());
    w.element_with_text("xdr:colOff", &anchor.from_col_offset.to_string());
    w.element_with_text("xdr:row", &anchor.from_row.to_string());
    w.element_with_text("xdr:rowOff", &anchor.from_row_offset.to_string());
    w.end_element("from");

    // <to>
    w.start_element("to").end_attrs();
    w.element_with_text("xdr:col", &anchor.to_col.to_string());
    w.element_with_text("xdr:colOff", &anchor.to_col_offset.to_string());
    w.element_with_text("xdr:row", &anchor.to_row.to_string());
    w.element_with_text("xdr:rowOff", &anchor.to_row_offset.to_string());
    w.end_element("to");

    w.end_element("anchor");
}

// =============================================================================
// VML shape generation
// =============================================================================

/// Write a single VML `<v:shape>` element for a form control.
fn write_vml_shape(w: &mut XmlWriter, control: &FormControl, shape_id: u32) {
    let shape_id_str = format!("_x0000_s{}", shape_id);
    let anchor = &control.anchor;
    let vml = &control.vml_shape;

    // Use the preserved VML style string if available, otherwise compute a fallback.
    let style = vml.style.clone().unwrap_or_else(|| {
        format!(
            "position:absolute;margin-left:0;margin-top:0;width:{}pt;height:{}pt;z-index:{};mso-wrap-style:tight",
            compute_vml_width(anchor),
            compute_vml_height(anchor),
            shape_id - 1024,
        )
    });

    let el = w
        .start_element_ns("v", "shape")
        .attr("id", &shape_id_str)
        .attr("type", "#_x0000_t201")
        .attr("style", &style);
    if vml.is_button {
        el.attr("o:button", "t");
    }
    if let Some(ref fc) = vml.fillcolor {
        el.attr("fillcolor", fc);
    }
    if let Some(ref sc) = vml.strokecolor {
        el.attr("strokecolor", sc);
    }
    el.attr("o:insetmode", "auto").end_attrs();

    // Write preserved VML child elements (v:fill, o:lock)
    if let Some(ref fill) = vml.fill_xml {
        w.raw_str(fill);
    }
    if let Some(ref lock) = vml.lock_xml {
        w.raw_str(lock);
    }

    // Textbox for controls that display text
    match control.object_type {
        FormControlType::CheckBox
        | FormControlType::RadioButton
        | FormControlType::GroupBox
        | FormControlType::Label
        | FormControlType::Button => {
            let tb = w.start_element_ns("v", "textbox");
            if let Some(ref style) = vml.textbox_style {
                tb.attr("style", style);
            }
            if let Some(ref sc) = vml.textbox_singleclick {
                tb.attr("o:singleclick", sc);
            }
            tb.end_attrs();

            // Use preserved VML textbox content if available, otherwise fall back to name.
            if let Some(ref content) = vml.textbox_content {
                w.raw_str(content);
            } else {
                let text = control.properties.name.as_deref().unwrap_or("");
                if !text.is_empty() {
                    w.raw_str(&format!(
                        "<div style=\"text-align:left\">{}</div>",
                        escape_xml_text(text)
                    ));
                }
            }
            w.end_element_ns("v", "textbox");
        }
        _ => {}
    }

    // Client data
    w.start_element_ns("x", "ClientData")
        .attr("ObjectType", &object_type_to_vml(&control.object_type))
        .end_attrs();

    // Anchor: fromCol, fromColOff, fromRow, fromRowOff, toCol, toColOff, toRow, toRowOff
    let vml_anchor = format!(
        "{}, {}, {}, {}, {}, {}, {}, {}",
        anchor.from_col,
        vml_offset(anchor.from_col_offset, &anchor.anchor_source),
        anchor.from_row,
        vml_offset(anchor.from_row_offset, &anchor.anchor_source),
        anchor.to_col,
        vml_offset(anchor.to_col_offset, &anchor.anchor_source),
        anchor.to_row,
        vml_offset(anchor.to_row_offset, &anchor.anchor_source),
    );
    w.element_with_text("x:Anchor", &vml_anchor);

    // PrintObject (before AutoFill to match Excel's order)
    if let Some(v) = control.properties.vml_extras.get("PrintObject") {
        w.element_with_text("x:PrintObject", v);
    }

    // AutoFill / AutoLine
    w.element_with_text("x:AutoFill", "False");

    // Control-specific VML properties
    write_vml_control_specific(w, control);

    // Write VML extras for roundtrip fidelity.
    // Skip tags already written by write_vml_control_specific or above.
    for (tag, value) in &control.properties.vml_extras {
        match tag.as_str() {
            "PrintObject" => continue, // already written above
            "FmlaMacro" if control.properties.macro_name.is_some() => continue,
            "TextHAlign" if control.properties.text_h_align.is_some() => continue,
            "TextVAlign" if control.properties.text_v_align.is_some() => continue,
            _ => {}
        }
        let full_tag = format!("x:{}", tag);
        w.element_with_text(&full_tag, value);
    }

    w.end_element_ns("x", "ClientData");
    w.end_element_ns("v", "shape");
}

/// Write control-type-specific VML ClientData children.
fn write_vml_control_specific(w: &mut XmlWriter, control: &FormControl) {
    let props = &control.properties;

    // FmlaLink
    if let Some(ref v) = props.linked_cell {
        w.element_with_text("x:FmlaLink", v);
    }

    // FmlaRange
    if let Some(ref v) = props.input_range {
        w.element_with_text("x:FmlaRange", v);
    }

    // FmlaGroup
    if let Some(ref v) = props.fmla_group {
        w.element_with_text("x:FmlaGroup", v);
    }

    // FmlaTxbx
    if let Some(ref v) = props.fmla_txbx {
        w.element_with_text("x:FmlaTxbx", v);
    }

    // Checked (VML uses integer: 0=unchecked, 1=checked, 2=mixed)
    if let Some(ref checked) = props.checked {
        w.element_with_text("x:Checked", check_state_to_vml(checked));
    }

    // Val
    if let Some(val) = props.val {
        w.element_with_text("x:Val", &val.to_string());
    }

    // Sel
    if let Some(sel) = props.sel {
        w.element_with_text("x:Sel", &sel.to_string());
    }

    // Min
    if let Some(min) = props.min_value {
        w.element_with_text("x:Min", &min.to_string());
    }

    // Max
    if let Some(max) = props.max_value {
        w.element_with_text("x:Max", &max.to_string());
    }

    // Inc
    if let Some(inc) = props.increment {
        w.element_with_text("x:Inc", &inc.to_string());
    }

    // Page
    if let Some(page) = props.page_increment {
        w.element_with_text("x:Page", &page.to_string());
    }

    // DropLines
    if let Some(dl) = props.drop_lines {
        w.element_with_text("x:DropLines", &dl.to_string());
    }

    // Dx
    if let Some(dx) = props.dx {
        w.element_with_text("x:Dx", &dx.to_string());
    }

    // SelType
    if let Some(ref v) = props.sel_type {
        w.element_with_text("x:SelType", v);
    }

    // DropStyle
    if let Some(ref v) = props.drop_style {
        w.element_with_text("x:DropStyle", v);
    }

    // MultiSel
    if let Some(ref v) = props.multi_sel {
        w.element_with_text("x:MultiSel", v);
    }

    // Boolean properties — VML uses empty elements for true
    if props.lock_text {
        w.element_with_text("x:LockText", "True");
    }
    if props.no_three_d {
        w.start_element_ns("x", "NoThreeD").self_close();
    }
    if props.no_three_d2 {
        w.start_element_ns("x", "NoThreeD2").self_close();
    }
    if props.colored {
        w.start_element_ns("x", "Colored").self_close();
    }
    if props.horiz {
        w.element_with_text("x:Horiz", "True");
    }
    if props.first_button {
        w.start_element_ns("x", "FirstButton").self_close();
    }
    if props.multi_line {
        w.start_element_ns("x", "MultiLine").self_close();
    }
    if props.vertical_bar {
        w.start_element_ns("x", "VScroll").self_close();
    }
    if props.password_edit {
        w.start_element_ns("x", "PasswordEdit").self_close();
    }

    // Macro
    if let Some(ref v) = props.macro_name {
        w.element_with_text("x:FmlaMacro", v);
    }

    // Text alignment (from VML ClientData)
    if let Some(ref v) = props.text_h_align {
        w.element_with_text("x:TextHAlign", v);
    }
    if let Some(ref v) = props.text_v_align {
        w.element_with_text("x:TextVAlign", v);
    }
}

// =============================================================================
// Relationship helper
// =============================================================================

/// Generate a relationship entry for a ctrlProp file.
///
/// # Arguments
/// * `index` — 1-based ctrlProp index (ctrlProp1.xml, ctrlProp2.xml, etc.)
///
/// # Returns
/// A tuple of `(rel_type, target)` suitable for adding to a `RelationshipManager`.
pub fn ctrl_prop_relationship_target(index: usize) -> String {
    format!("../ctrlProps/ctrlProp{}.xml", index)
}

// =============================================================================
// Type conversion helpers
// =============================================================================

/// Convert `FormControlType` to the modern OOXML `objectType` attribute string.
///
/// In the modern ctrlProp XML, the values are PascalCase: "CheckBox", "Drop", etc.
/// Note: `ComboBox` on import maps from "Drop", and must be reversed on export.
fn object_type_to_modern(fct: &FormControlType) -> String {
    match fct {
        FormControlType::Button => "Button".to_string(),
        FormControlType::CheckBox => "CheckBox".to_string(),
        FormControlType::ComboBox => "Drop".to_string(), // ComboBox → Drop in modern OOXML
        FormControlType::ListBox => "List".to_string(),  // ListBox → List in modern OOXML
        FormControlType::RadioButton => "Radio".to_string(),
        FormControlType::GroupBox => "GBox".to_string(),
        FormControlType::Label => "Label".to_string(),
        FormControlType::ScrollBar => "Scroll".to_string(),
        FormControlType::Spinner => "Spin".to_string(),
        FormControlType::EditBox => "EditBox".to_string(),
        FormControlType::Dialog => "Dialog".to_string(),
        FormControlType::Unknown(s) => s.clone(),
    }
}

/// Convert `FormControlType` to the VML `ObjectType` attribute string.
///
/// VML uses different casing: "Checkbox" not "CheckBox", "Button" not "Button", etc.
fn object_type_to_vml(fct: &FormControlType) -> String {
    match fct {
        FormControlType::Button => "Button".to_string(),
        FormControlType::CheckBox => "Checkbox".to_string(),
        FormControlType::ComboBox => "Drop".to_string(),
        FormControlType::ListBox => "List".to_string(),
        FormControlType::RadioButton => "Radio".to_string(),
        FormControlType::GroupBox => "GBox".to_string(),
        FormControlType::Label => "Label".to_string(),
        FormControlType::ScrollBar => "Scroll".to_string(),
        FormControlType::Spinner => "Spin".to_string(),
        FormControlType::EditBox => "Edit".to_string(),
        FormControlType::Dialog => "Dialog".to_string(),
        FormControlType::Unknown(s) => s.clone(),
    }
}

/// Convert `CheckState` to the modern OOXML `checked` attribute value.
fn check_state_to_modern(state: &CheckState) -> &'static str {
    match state {
        CheckState::Unchecked => "Unchecked",
        CheckState::Checked => "Checked",
        CheckState::Mixed => "Mixed",
    }
}

/// Convert `CheckState` to the VML `<x:Checked>` element value.
fn check_state_to_vml(state: &CheckState) -> &'static str {
    match state {
        CheckState::Unchecked => "0",
        CheckState::Checked => "1",
        CheckState::Mixed => "2",
    }
}

/// Convert an anchor offset to VML pixel value.
///
/// If the anchor source is Modern (EMU), convert to pixels (1 px = 9525 EMU).
/// If already VML, use the value directly.
fn vml_offset(offset: i64, source: &AnchorSource) -> i64 {
    match source {
        AnchorSource::Vml => offset,
        AnchorSource::Modern => offset / 9525, // EMU to pixels
    }
}

/// Compute an approximate VML width in points from the anchor.
fn compute_vml_width(anchor: &ControlAnchor) -> u32 {
    // Rough estimate: each column ~64pt, plus offset difference
    let col_diff = anchor.to_col.saturating_sub(anchor.from_col);
    col_diff * 64 + 48 // rough default
}

/// Compute an approximate VML height in points from the anchor.
fn compute_vml_height(anchor: &ControlAnchor) -> u32 {
    // Rough estimate: each row ~15pt, plus offset difference
    let row_diff = anchor.to_row.saturating_sub(anchor.from_row);
    row_diff * 15 + 15 // rough default
}

/// Escape XML text content (for VML div text).
fn escape_xml_text(s: &str) -> String {
    let mut result = String::with_capacity(s.len());
    for ch in s.chars() {
        match ch {
            '&' => result.push_str("&amp;"),
            '<' => result.push_str("&lt;"),
            '>' => result.push_str("&gt;"),
            '"' => result.push_str("&quot;"),
            '\'' => result.push_str("&apos;"),
            _ => result.push(ch),
        }
    }
    result
}

// =============================================================================
// Unit Tests
// =============================================================================

#[cfg(test)]
mod tests {
    use super::*;

    fn make_checkbox() -> FormControl {
        let mut control = FormControl::new(FormControlType::CheckBox);
        control.properties.linked_cell = Some("$A$1".to_string());
        control.properties.checked = Some(CheckState::Checked);
        control.properties.lock_text = true;
        control.properties.no_three_d2 = true;
        control.anchor = ControlAnchor {
            from_col: 1,
            from_col_offset: 152400,
            from_row: 2,
            from_row_offset: 76200,
            to_col: 3,
            to_col_offset: 457200,
            to_row: 4,
            to_row_offset: 19050,
            anchor_source: AnchorSource::Modern,
        };
        control
    }

    fn make_combobox() -> FormControl {
        let mut control = FormControl::new(FormControlType::ComboBox);
        control.properties.linked_cell = Some("$B$1".to_string());
        control.properties.input_range = Some("$D$1:$D$5".to_string());
        control.properties.drop_lines = Some(8);
        control.anchor = ControlAnchor::new(1, 5, 4, 6);
        control
    }

    fn make_scrollbar() -> FormControl {
        let mut control = FormControl::new(FormControlType::ScrollBar);
        control.properties.linked_cell = Some("$C$1".to_string());
        control.properties.val = Some(50);
        control.properties.min_value = Some(0);
        control.properties.max_value = Some(100);
        control.properties.increment = Some(1);
        control.properties.page_increment = Some(10);
        control.anchor = ControlAnchor::new(5, 0, 6, 10);
        control
    }

    // -------------------------------------------------------------------------
    // ctrlProp XML tests
    // -------------------------------------------------------------------------

    #[test]
    fn test_write_ctrl_prop_checkbox() {
        let control = make_checkbox();
        let writer = ControlsWriter::new(vec![control]);
        let xml = writer.write_ctrl_prop(0);
        let xml_str = String::from_utf8(xml).unwrap();

        assert!(xml_str.contains("<?xml version=\"1.0\" encoding=\"UTF-8\" standalone=\"yes\"?>"));
        assert!(
            xml_str.contains(
                "xmlns=\"http://schemas.microsoft.com/office/spreadsheetml/2009/9/main\""
            )
        );
        assert!(xml_str.contains("objectType=\"CheckBox\""));
        assert!(xml_str.contains("fmlaLink=\"$A$1\""));
        assert!(xml_str.contains("checked=\"Checked\""));
        assert!(xml_str.contains("lockText=\"1\""));
        assert!(xml_str.contains("noThreeD2=\"1\""));
    }

    #[test]
    fn test_write_ctrl_prop_combobox_maps_to_drop() {
        let control = make_combobox();
        let writer = ControlsWriter::new(vec![control]);
        let xml = writer.write_ctrl_prop(0);
        let xml_str = String::from_utf8(xml).unwrap();

        // ComboBox should be written as "Drop" in modern OOXML
        assert!(xml_str.contains("objectType=\"Drop\""));
        assert!(xml_str.contains("fmlaLink=\"$B$1\""));
        assert!(xml_str.contains("fmlaRange=\"$D$1:$D$5\""));
        assert!(xml_str.contains("dropLines=\"8\""));
    }

    #[test]
    fn test_write_ctrl_prop_scrollbar() {
        let control = make_scrollbar();
        let writer = ControlsWriter::new(vec![control]);
        let xml = writer.write_ctrl_prop(0);
        let xml_str = String::from_utf8(xml).unwrap();

        assert!(xml_str.contains("objectType=\"Scroll\""));
        assert!(xml_str.contains("val=\"50\""));
        assert!(xml_str.contains("min=\"0\""));
        assert!(xml_str.contains("max=\"100\""));
        assert!(xml_str.contains("inc=\"1\""));
        assert!(xml_str.contains("page=\"10\""));
    }

    #[test]
    fn test_write_ctrl_prop_with_items() {
        let mut control = FormControl::new(FormControlType::ListBox);
        control.properties.items = vec![
            "Item 1".to_string(),
            "Item 2".to_string(),
            "Item 3".to_string(),
        ];
        let writer = ControlsWriter::new(vec![control]);
        let xml = writer.write_ctrl_prop(0);
        let xml_str = String::from_utf8(xml).unwrap();

        assert!(xml_str.contains("<itemLst>"));
        assert!(xml_str.contains("val=\"Item 1\""));
        assert!(xml_str.contains("val=\"Item 2\""));
        assert!(xml_str.contains("val=\"Item 3\""));
        assert!(xml_str.contains("</itemLst>"));
        assert!(xml_str.contains("</formControlPr>"));
    }

    #[test]
    fn test_write_ctrl_prop_self_closing_no_items() {
        let control = FormControl::new(FormControlType::Button);
        let writer = ControlsWriter::new(vec![control]);
        let xml = writer.write_ctrl_prop(0);
        let xml_str = String::from_utf8(xml).unwrap();

        // Self-closing tag when no items
        assert!(xml_str.contains("/>"));
        assert!(!xml_str.contains("</formControlPr>"));
    }

    // -------------------------------------------------------------------------
    // Worksheet controls XML tests
    // -------------------------------------------------------------------------

    #[test]
    fn test_write_worksheet_controls() {
        let controls = vec![make_checkbox(), make_combobox()];
        let writer = ControlsWriter::new(controls);
        let r_ids = vec!["rId3".to_string(), "rId4".to_string()];
        let xml = writer.write_worksheet_controls(1025, &r_ids);
        let xml_str = String::from_utf8(xml).unwrap();

        assert!(xml_str.contains("mc:AlternateContent"));
        assert!(xml_str.contains("mc:Choice"));
        assert!(xml_str.contains("Requires=\"x14\""));
        assert!(xml_str.contains("<controls>"));
        assert!(xml_str.contains("shapeId=\"1025\""));
        assert!(xml_str.contains("shapeId=\"1026\""));
        assert!(xml_str.contains("r:id=\"rId3\""));
        assert!(xml_str.contains("r:id=\"rId4\""));
        assert!(xml_str.contains("<controlPr"));
        assert!(xml_str.contains("<anchor"));
        assert!(xml_str.contains("mc:Fallback"));
    }

    #[test]
    fn test_write_worksheet_controls_anchor_values() {
        let controls = vec![make_checkbox()];
        let writer = ControlsWriter::new(controls);
        let r_ids = vec!["rId3".to_string()];
        let xml = writer.write_worksheet_controls(1025, &r_ids);
        let xml_str = String::from_utf8(xml).unwrap();

        // Check anchor values
        assert!(xml_str.contains("<xdr:col>1</xdr:col>"));
        assert!(xml_str.contains("<xdr:colOff>152400</xdr:colOff>"));
        assert!(xml_str.contains("<xdr:row>2</xdr:row>"));
        assert!(xml_str.contains("<xdr:rowOff>76200</xdr:rowOff>"));
    }

    // -------------------------------------------------------------------------
    // VML drawing tests
    // -------------------------------------------------------------------------

    #[test]
    fn test_write_vml_form_controls_checkbox() {
        let controls = vec![make_checkbox()];
        let writer = ControlsWriter::new(controls);
        let xml = writer.write_vml_form_controls(1025);
        let xml_str = String::from_utf8(xml).unwrap();

        assert!(xml_str.contains("xmlns:v=\"urn:schemas-microsoft-com:vml\""));
        assert!(xml_str.contains("xmlns:o=\"urn:schemas-microsoft-com:office:office\""));
        assert!(xml_str.contains("xmlns:x=\"urn:schemas-microsoft-com:office:excel\""));
        assert!(xml_str.contains("id=\"_x0000_s1025\""));
        assert!(xml_str.contains("type=\"#_x0000_t201\""));
        assert!(xml_str.contains("ObjectType=\"Checkbox\"")); // VML casing
        assert!(xml_str.contains("<x:FmlaLink>$A$1</x:FmlaLink>"));
        assert!(xml_str.contains("<x:Checked>1</x:Checked>"));
        assert!(xml_str.contains("<x:LockText>True</x:LockText>"));
    }

    #[test]
    fn test_write_vml_form_controls_combobox() {
        let controls = vec![make_combobox()];
        let writer = ControlsWriter::new(controls);
        let xml = writer.write_vml_form_controls(1025);
        let xml_str = String::from_utf8(xml).unwrap();

        assert!(xml_str.contains("ObjectType=\"Drop\""));
        assert!(xml_str.contains("<x:FmlaLink>$B$1</x:FmlaLink>"));
        assert!(xml_str.contains("<x:FmlaRange>$D$1:$D$5</x:FmlaRange>"));
        assert!(xml_str.contains("<x:DropLines>8</x:DropLines>"));
    }

    #[test]
    fn test_write_vml_anchor_format() {
        let mut control = FormControl::new(FormControlType::CheckBox);
        control.anchor = ControlAnchor {
            from_col: 1,
            from_col_offset: 15,
            from_row: 2,
            from_row_offset: 10,
            to_col: 3,
            to_col_offset: 45,
            to_row: 4,
            to_row_offset: 2,
            anchor_source: AnchorSource::Vml,
        };
        let writer = ControlsWriter::new(vec![control]);
        let xml = writer.write_vml_form_controls(1025);
        let xml_str = String::from_utf8(xml).unwrap();

        assert!(xml_str.contains("<x:Anchor>1, 15, 2, 10, 3, 45, 4, 2</x:Anchor>"));
    }

    #[test]
    fn test_write_vml_emu_to_pixel_conversion() {
        let mut control = FormControl::new(FormControlType::CheckBox);
        control.anchor = ControlAnchor {
            from_col: 1,
            from_col_offset: 152400, // 16 pixels in EMU
            from_row: 2,
            from_row_offset: 76200, // 8 pixels in EMU
            to_col: 3,
            to_col_offset: 457200, // 48 pixels in EMU
            to_row: 4,
            to_row_offset: 19050, // 2 pixels in EMU
            anchor_source: AnchorSource::Modern,
        };
        let writer = ControlsWriter::new(vec![control]);
        let xml = writer.write_vml_form_controls(1025);
        let xml_str = String::from_utf8(xml).unwrap();

        // 152400 / 9525 = 16, 76200 / 9525 = 8, 457200 / 9525 = 48, 19050 / 9525 = 2
        assert!(xml_str.contains("<x:Anchor>1, 16, 2, 8, 3, 48, 4, 2</x:Anchor>"));
    }

    #[test]
    fn test_write_vml_shapetype() {
        let controls = vec![make_checkbox()];
        let writer = ControlsWriter::new(controls);
        let xml = writer.write_vml_form_controls(1025);
        let xml_str = String::from_utf8(xml).unwrap();

        // Form controls use shapetype 201, not 202 (which is for comments)
        assert!(xml_str.contains("id=\"_x0000_t201\""));
        assert!(xml_str.contains("o:spt=\"201\""));
    }

    #[test]
    fn test_write_vml_multiple_controls() {
        let controls = vec![make_checkbox(), make_combobox(), make_scrollbar()];
        let writer = ControlsWriter::new(controls);
        let xml = writer.write_vml_form_controls(1025);
        let xml_str = String::from_utf8(xml).unwrap();

        assert!(xml_str.contains("id=\"_x0000_s1025\""));
        assert!(xml_str.contains("id=\"_x0000_s1026\""));
        assert!(xml_str.contains("id=\"_x0000_s1027\""));
    }

    // -------------------------------------------------------------------------
    // Type conversion tests
    // -------------------------------------------------------------------------

    #[test]
    fn test_object_type_to_modern() {
        assert_eq!(
            object_type_to_modern(&FormControlType::CheckBox),
            "CheckBox"
        );
        assert_eq!(object_type_to_modern(&FormControlType::ComboBox), "Drop");
        assert_eq!(object_type_to_modern(&FormControlType::ListBox), "List");
        assert_eq!(
            object_type_to_modern(&FormControlType::RadioButton),
            "Radio"
        );
        assert_eq!(object_type_to_modern(&FormControlType::GroupBox), "GBox");
        assert_eq!(object_type_to_modern(&FormControlType::ScrollBar), "Scroll");
        assert_eq!(object_type_to_modern(&FormControlType::Spinner), "Spin");
    }

    #[test]
    fn test_object_type_to_vml() {
        assert_eq!(object_type_to_vml(&FormControlType::CheckBox), "Checkbox");
        assert_eq!(object_type_to_vml(&FormControlType::ComboBox), "Drop");
        assert_eq!(object_type_to_vml(&FormControlType::EditBox), "Edit");
    }

    #[test]
    fn test_check_state_to_modern() {
        assert_eq!(check_state_to_modern(&CheckState::Unchecked), "Unchecked");
        assert_eq!(check_state_to_modern(&CheckState::Checked), "Checked");
        assert_eq!(check_state_to_modern(&CheckState::Mixed), "Mixed");
    }

    #[test]
    fn test_check_state_to_vml() {
        assert_eq!(check_state_to_vml(&CheckState::Unchecked), "0");
        assert_eq!(check_state_to_vml(&CheckState::Checked), "1");
        assert_eq!(check_state_to_vml(&CheckState::Mixed), "2");
    }

    // -------------------------------------------------------------------------
    // Relationship helper tests
    // -------------------------------------------------------------------------

    #[test]
    fn test_ctrl_prop_relationship_target() {
        assert_eq!(
            ctrl_prop_relationship_target(1),
            "../ctrlProps/ctrlProp1.xml"
        );
        assert_eq!(
            ctrl_prop_relationship_target(5),
            "../ctrlProps/ctrlProp5.xml"
        );
    }

    // -------------------------------------------------------------------------
    // Constants tests
    // -------------------------------------------------------------------------

    #[test]
    fn test_constants() {
        assert!(REL_CTRL_PROP.contains("ctrlProp"));
        assert!(CONTENT_TYPE_CTRL_PROP.contains("controlproperties"));
    }

    // -------------------------------------------------------------------------
    // Writer utility tests
    // -------------------------------------------------------------------------

    #[test]
    fn test_writer_is_empty() {
        let writer = ControlsWriter::new(vec![]);
        assert!(writer.is_empty());
        assert_eq!(writer.len(), 0);

        let writer2 = ControlsWriter::new(vec![make_checkbox()]);
        assert!(!writer2.is_empty());
        assert_eq!(writer2.len(), 1);
    }

    #[test]
    fn test_escape_xml_text() {
        assert_eq!(escape_xml_text("hello"), "hello");
        assert_eq!(escape_xml_text("a & b"), "a &amp; b");
        assert_eq!(escape_xml_text("<tag>"), "&lt;tag&gt;");
    }

    // -------------------------------------------------------------------------
    // VML extras roundtrip test
    // -------------------------------------------------------------------------

    #[test]
    fn test_vml_extras_roundtrip() {
        let mut control = FormControl::new(FormControlType::CheckBox);
        control
            .properties
            .vml_extras
            .insert("PrintObject".to_string(), "True".to_string());
        let writer = ControlsWriter::new(vec![control]);
        let xml = writer.write_vml_form_controls(1025);
        let xml_str = String::from_utf8(xml).unwrap();

        assert!(xml_str.contains("<x:PrintObject>True</x:PrintObject>"));
    }

    // -------------------------------------------------------------------------
    // Unified VML with OLE objects
    // -------------------------------------------------------------------------

    fn make_ole_object() -> OleObject {
        let mut obj = OleObject::new("Word.Document.12".to_string(), 2049);
        obj.anchor = ControlAnchor {
            from_col: 1,
            from_col_offset: 0,
            from_row: 2,
            from_row_offset: 0,
            to_col: 5,
            to_col_offset: 0,
            to_row: 10,
            to_row_offset: 0,
            anchor_source: AnchorSource::Vml,
        };
        obj.preview_image_rel_id = Some("rId3".to_string());
        obj
    }

    #[test]
    fn test_write_vml_with_ole_only() {
        let writer = ControlsWriter::new(vec![]);
        let ole_objects = vec![make_ole_object()];
        let ole_rel_ids = vec!["rId3".to_string()];
        let xml = writer.write_vml_with_ole(1025, &ole_objects, &ole_rel_ids);
        let xml_str = String::from_utf8(xml).unwrap();

        // Should have shapetype 75 for OLE
        assert!(xml_str.contains("id=\"_x0000_t75\""));
        assert!(xml_str.contains("o:spt=\"75\""));
        // Should NOT have shapetype 201 (no form controls)
        assert!(!xml_str.contains("id=\"_x0000_t201\""));

        // Should have the OLE shape
        assert!(xml_str.contains("id=\"_x0000_s2049\""));
        assert!(xml_str.contains("type=\"#_x0000_t75\""));
        assert!(xml_str.contains("ObjectType=\"Pict\""));

        // Should have imagedata with preview rel
        assert!(xml_str.contains("o:relid=\"rId3\""));

        // Should have anchor
        assert!(xml_str.contains("<x:Anchor>"));
    }

    #[test]
    fn test_write_vml_with_controls_and_ole() {
        let controls = vec![make_checkbox()];
        let writer = ControlsWriter::new(controls);
        let ole_objects = vec![make_ole_object()];
        let ole_rel_ids = vec!["rId3".to_string()];
        let xml = writer.write_vml_with_ole(1025, &ole_objects, &ole_rel_ids);
        let xml_str = String::from_utf8(xml).unwrap();

        // Should have BOTH shapetypes
        assert!(xml_str.contains("id=\"_x0000_t201\""));
        assert!(xml_str.contains("id=\"_x0000_t75\""));

        // Should have form control shape (1025)
        assert!(xml_str.contains("id=\"_x0000_s1025\""));
        assert!(xml_str.contains("ObjectType=\"Checkbox\""));

        // Should have OLE shape (2049)
        assert!(xml_str.contains("id=\"_x0000_s2049\""));
        assert!(xml_str.contains("ObjectType=\"Pict\""));
    }

    #[test]
    fn test_write_vml_ole_without_preview() {
        let mut ole = make_ole_object();
        ole.preview_image_rel_id = None;
        let writer = ControlsWriter::new(vec![]);
        let ole_rel_ids = vec!["".to_string()];
        let xml = writer.write_vml_with_ole(1025, &[ole], &ole_rel_ids);
        let xml_str = String::from_utf8(xml).unwrap();

        // Should have the OLE shape but no imagedata (empty preview rel)
        assert!(xml_str.contains("ObjectType=\"Pict\""));
        assert!(!xml_str.contains("o:relid="));
    }

    #[test]
    fn test_write_vml_ole_anchor_values() {
        let writer = ControlsWriter::new(vec![]);
        let ole_objects = vec![make_ole_object()];
        let ole_rel_ids = vec!["rId3".to_string()];
        let xml = writer.write_vml_with_ole(1025, &ole_objects, &ole_rel_ids);
        let xml_str = String::from_utf8(xml).unwrap();

        // VML anchor format: fromCol, fromColOff, fromRow, fromRowOff, toCol, toColOff, toRow, toRowOff
        assert!(xml_str.contains("<x:Anchor>1, 0, 2, 0, 5, 0, 10, 0</x:Anchor>"));
    }
}
