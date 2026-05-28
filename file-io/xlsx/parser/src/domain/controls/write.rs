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
//! use xlsx_parser::write::ControlsWriter;
//!
//! let mut control = FormControl::new(FormControlType::CheckBox);
//! control.properties.linked_cell = Some("$A$1".to_string());
//! control.properties.checked = Some(CheckState::Checked);
//! control.properties.lock_text = true;
//! control.anchor = ControlAnchor::new(1, 2, 3, 4);
//!
//! let writer = ControlsWriter::new(vec![control]);
//! let ctrl_prop_xml = writer.write_ctrl_prop(0);
//! let r_ids = vec!["rId3".to_string()];
//! let worksheet_controls_xml = writer.write_worksheet_controls(1025, &r_ids);
//! let vml_xml = writer.write_vml_form_controls(1025);
//! ```

use crate::domain::controls::form_control_props::write_ctrl_prop_xml;
use crate::domain::controls::types::{FormControl, OleObject};
use crate::domain::controls::vml;
use crate::domain::controls::worksheet;

// =============================================================================
// Constants
// =============================================================================

/// Relationship type for control properties (ctrlProp*.xml)
pub const REL_CTRL_PROP: &str =
    "http://schemas.openxmlformats.org/officeDocument/2006/relationships/ctrlProp";

/// Content type for control properties
pub const CONTENT_TYPE_CTRL_PROP: &str = "application/vnd.ms-excel.controlproperties+xml";

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
        worksheet::write_worksheet_controls(&self.controls, base_shape_id, r_ids)
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
        vml::write_vml_form_controls(&self.controls, base_shape_id)
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
        vml::write_vml_with_ole(
            &self.controls,
            base_shape_id,
            ole_objects,
            ole_preview_rel_ids,
        )
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
