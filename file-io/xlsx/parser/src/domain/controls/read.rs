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
use std::collections::HashMap;

use super::active_x;
use super::form_control_props;
use super::ole;
pub use super::types::{
    ActiveXControl, AnchorSource, CheckState, ControlAnchor, FormControl, FormControlProperties,
    FormControlType, ModernAnchorResult, OleObject, VmlShapeProps, WorksheetControl,
    WorksheetControlRef, WorksheetControls,
};
use super::vml;
use super::worksheet;

impl WorksheetControls {
    /// Create a new empty collection
    pub fn new() -> Self {
        Self::default()
    }

    /// Parse control properties from ctrlProp*.xml
    pub fn parse_ctrl_prop(xml: &[u8]) -> Option<FormControl> {
        form_control_props::parse_ctrl_prop(xml)
    }

    /// Parse VML drawing to extract control anchors
    pub fn parse_vml_drawing(xml: &[u8], controls: &mut Vec<FormControl>) {
        vml::parse_vml_drawing(xml, controls);
    }

    /// Parse ActiveX control from activeX*.xml
    pub fn parse_activex(xml: &[u8]) -> Option<ActiveXControl> {
        active_x::parse_activex(xml)
    }

    /// Parse OLE objects from worksheet XML `<oleObjects>` section.
    ///
    /// Handles both bare `<oleObject>` elements and those wrapped in
    /// `<mc:AlternateContent>`. Parses all CT_OleObject attributes and
    /// the `<objectPr>` child element if present.
    pub fn parse_ole_objects(xml: &[u8], objects: &mut Vec<OleObject>) {
        ole::parse_ole_objects(xml, objects);
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
    vml::parse_vml_imagedata(xml)
}

/// Extract the numeric shape ID from a VML shape `id` attribute.
///
/// VML shape IDs typically look like `_x0000_s1025`. The numeric part
/// (1025) corresponds to the `shapeId` in the worksheet's `<oleObject>`.
pub fn extract_vml_shape_number(vml_id: &str) -> Option<u32> {
    vml::extract_vml_shape_number(vml_id)
}

// ============================================================================
// Worksheet-Level Control References (from worksheet XML <controls> element)
// ============================================================================

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
    worksheet::parse_worksheet_controls(xml)
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
    worksheet::parse_worksheet_controls_from_xml(worksheet_xml)
}

// ============================================================================
// Compatibility facades for sheet-level controls parse functions
// ============================================================================

/// Parse form controls for a given sheet.
///
/// This function implements the full modern + legacy merge pipeline:
///
/// 1. Parse `<controls>` from worksheet XML to get `WorksheetControlRef`s (shapeId, rId, name).
/// 2. Resolve typed `ctrlProp` relationships through the controls relationship contract.
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
    crate::domain::controls::worksheet::parse_form_controls_for_sheet(
        archive,
        sheet_num,
        worksheet_xml,
    )
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
    ole::parse_ole_objects_for_sheet(archive, sheet_num, worksheet_xml)
}

/// Extract OLE binary entries from the archive into a `ImportedPackageParts` store.
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
    passthrough: &mut crate::infra::imported_parts::ImportedPackageParts,
) {
    ole::extract_ole_binary_entries(archive, ole_outputs, passthrough);
}
