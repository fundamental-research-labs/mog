use serde::{Deserialize, Serialize};

use crate::domain::chart::{
    ChartAuxiliaryPart, ChartDefinition, ChartExReplayData, ChartRelationshipData,
    StandardChartExportAuthority, StandardChartProvenance,
};

// ===========================================================================
// OOXML Prop Wrappers — typed replacements for serde_json::Value blobs
// ===========================================================================

/// OOXML round-trip properties for a picture floating object.
///
/// Wraps the parsed `SpreadsheetPicture` plus parse-time bookkeeping fields
/// that are resolved from OPC relationships (not present on the OOXML struct).
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
#[serde(default)]
#[derive(Default)]
pub struct PictureOoxmlProps {
    /// The full parsed OOXML picture struct (CT_Picture).
    pub picture: ooxml_types::drawings::SpreadsheetPicture,
    /// Index of the anchor in the original drawing XML (for ordering).
    pub anchor_index: Option<i32>,
    /// Original EMU extent width (for lossless round-trip).
    pub extent_emu_cx: Option<i64>,
    /// Original EMU extent height (for lossless round-trip).
    pub extent_emu_cy: Option<i64>,
    /// editAs attribute from the anchor element.
    pub edit_as: Option<String>,
    /// Client data: locks with sheet (OOXML default is true).
    pub client_data_locks_with_sheet: Option<bool>,
    /// Client data: prints with sheet (OOXML default is true).
    pub client_data_prints_with_sheet: Option<bool>,
    /// Raw XML for mc:AlternateContent (form control shapes).
    pub mc_alternate_content_raw_xml: Option<String>,
    /// Image path resolved from OPC relationships (e.g., "../media/image1.png").
    pub image_path: Option<String>,
    /// Drawing relationships referenced by this picture's OOXML.
    ///
    /// `image_path` carries the current embedded image owner separately because
    /// Mog may regenerate image relationship ids from current media bytes.
    /// Other relationship-bearing picture state such as external `r:link`
    /// targets and non-visual hyperlinks must remain owner-scoped here so the
    /// drawing package graph can register and remap them consistently.
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub relationships: Vec<ooxml_types::shared::OpcRelationship>,
}

/// OOXML round-trip properties for a shape floating object.
///
/// Wraps the parsed `SpreadsheetShape` plus parse-time bookkeeping fields.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
#[serde(default)]
#[derive(Default)]
pub struct ShapeOoxmlProps {
    /// The full parsed OOXML shape struct (CT_Shape).
    pub shape: ooxml_types::drawings::SpreadsheetShape,
    /// Index of the anchor in the original drawing XML (for ordering).
    pub anchor_index: Option<i32>,
    /// Original EMU extent width (for lossless round-trip).
    pub extent_emu_cx: Option<i64>,
    /// Original EMU extent height (for lossless round-trip).
    pub extent_emu_cy: Option<i64>,
    /// editAs attribute from the anchor element.
    pub edit_as: Option<String>,
    /// Client data: locks with sheet (OOXML default is true).
    pub client_data_locks_with_sheet: Option<bool>,
    /// Client data: prints with sheet (OOXML default is true).
    pub client_data_prints_with_sheet: Option<bool>,
    /// Raw XML for mc:AlternateContent (form control shapes).
    pub mc_alternate_content_raw_xml: Option<String>,
    /// Full CT_GroupShape payload (only for shape_type="group").
    ///
    /// Typed-domain replacement for the former `group_json:
    /// Option<serde_json::Value>` blob (typed OOXML preservation); the
    /// `GroupShape` type used to live in `xlsx-parser`, forcing the field
    /// to carry free-form JSON. It now lives in `domain-types` as
    /// [`GroupShapeData`](crate::domain::drawings::GroupShapeData).
    #[serde(skip_serializing_if = "Option::is_none")]
    pub group_shape: Option<crate::domain::drawings::GroupShapeData>,
}

/// OOXML round-trip properties for a connector floating object.
///
/// Wraps the parsed `SpreadsheetConnector` directly.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
#[serde(default)]
#[derive(Default)]
pub struct ConnectorOoxmlProps {
    /// The full parsed OOXML connector struct (CT_Connector).
    pub connector: ooxml_types::drawings::SpreadsheetConnector,
    /// Index of the anchor in the original drawing XML (for ordering).
    pub anchor_index: Option<i32>,
    /// Original EMU extent width (for lossless round-trip).
    pub extent_emu_cx: Option<i64>,
    /// Original EMU extent height (for lossless round-trip).
    pub extent_emu_cy: Option<i64>,
    /// editAs attribute from the anchor element.
    pub edit_as: Option<String>,
    /// Client data: locks with sheet (OOXML default is true).
    pub client_data_locks_with_sheet: Option<bool>,
    /// Client data: prints with sheet (OOXML default is true).
    pub client_data_prints_with_sheet: Option<bool>,
    /// Raw XML for mc:AlternateContent.
    pub mc_alternate_content_raw_xml: Option<String>,
}

/// OOXML round-trip properties for drawing objects that are not projected into
/// Mog's editable picture/shape/chart models.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
#[serde(default)]
#[derive(Default)]
pub struct DrawingObjectOoxmlProps {
    /// The parsed drawing object.
    pub object: DrawingObjectOoxml,
    /// Index of the anchor in the original drawing XML (for ordering).
    pub anchor_index: Option<i32>,
    /// Original one-cell/absolute extent width in EMUs.
    pub extent_emu_cx: Option<i64>,
    /// Original one-cell/absolute extent height in EMUs.
    pub extent_emu_cy: Option<i64>,
    /// editAs attribute from a two-cell anchor.
    pub edit_as: Option<String>,
    /// Client data: locks with sheet (OOXML default is true).
    pub client_data_locks_with_sheet: Option<bool>,
    /// Client data: prints with sheet (OOXML default is true).
    pub client_data_prints_with_sheet: Option<bool>,
    /// Drawing-owned relationships required by this object.
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub relationships: Vec<ooxml_types::shared::OpcRelationship>,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(tag = "kind", rename_all = "camelCase")]
#[derive(Default)]
pub enum DrawingObjectOoxml {
    #[default]
    Unknown,
    ContentPart {
        content_part: ooxml_types::drawings::ContentPartRef,
    },
    GraphicFrame {
        graphic_frame: ooxml_types::drawings::SpreadsheetGraphicFrame,
    },
}

/// OOXML round-trip properties for a chart's drawing frame.
///
/// The chart part itself is owned by [`ChartDefinition`]. This sidecar owns the
/// spreadsheet drawing frame and parse-time anchor/relationship bookkeeping that
/// is not part of `SpreadsheetGraphicFrame`.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
#[serde(default)]
#[derive(Default)]
pub struct ChartDrawingFrameOoxmlProps {
    /// The full parsed OOXML graphic frame (`xdr:graphicFrame`).
    pub graphic_frame: ooxml_types::drawings::SpreadsheetGraphicFrame,
    /// Index of the anchor in the original drawing XML (for ordering).
    pub anchor_index: Option<i32>,
    /// Original one-cell anchor extent width in EMUs.
    pub extent_emu_cx: Option<i64>,
    /// Original one-cell anchor extent height in EMUs.
    pub extent_emu_cy: Option<i64>,
    /// editAs attribute from a two-cell anchor.
    pub edit_as: Option<String>,
    /// Client data: locks with sheet (OOXML default is true).
    pub client_data_locks_with_sheet: Option<bool>,
    /// Client data: prints with sheet (OOXML default is true).
    pub client_data_prints_with_sheet: Option<bool>,
    /// Original drawing relationship ID used by the chart reference.
    pub relationship_id: Option<String>,
    /// Original drawing relationship target for the chart part.
    pub relationship_target: Option<String>,
    #[serde(skip)]
    pub raw_alternate_content: Option<String>,
}

/// Typed OOXML preservation contract for chart floating objects.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
#[serde(default)]
#[derive(Default)]
pub struct ChartOoxmlProps {
    /// Typed chart or ChartEx part definition used by XLSX export.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub definition: Option<ChartDefinition>,
    /// Typed drawing-frame metadata and anchor/relationship bookkeeping.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub drawing_frame: Option<ChartDrawingFrameOoxmlProps>,
    /// Chart-owned package relationships imported with the chart part.
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub chart_relationships: Vec<ChartRelationshipData>,
    /// Chart-owned auxiliary part bytes imported with the chart part.
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub chart_auxiliary_files: Vec<(String, Vec<u8>)>,
    /// Typed chart-owned auxiliary parts imported with the chart part.
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub chart_auxiliary_parts: Vec<ChartAuxiliaryPart>,
    /// Durable standard `c:chartSpace` import provenance.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub standard_chart_provenance: Option<StandardChartProvenance>,
    /// Durable standard `c:chartSpace` export authority.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub standard_chart_export_authority: Option<StandardChartExportAuthority>,
    #[serde(skip)]
    pub chart_ex_replay: Option<ChartExReplayData>,
    /// Whether this chart uses ChartEx format.
    #[serde(default, skip_serializing_if = "std::ops::Not::not")]
    pub is_chart_ex: bool,
}

/// Owned embedded OLE package part.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
#[serde(default)]
#[derive(Default)]
pub struct OleObjectPackageIdentity {
    /// ZIP package path, e.g. `xl/embeddings/oleObject1.bin`.
    pub path: String,
    /// Relationship/payload kind, e.g. `oleObject` or `embeddedPackage`.
    #[serde(default, skip_serializing_if = "String::is_empty")]
    pub kind: String,
    /// Package content type if known.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub content_type: Option<String>,
    /// Imported worksheet relationship id, reused as a hint when valid.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub relationship_id: Option<String>,
    /// Raw embedded object bytes owned by this floating object.
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub bytes: Vec<u8>,
}

/// Owned OLE preview media part referenced by the VML shape.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
#[serde(default)]
#[derive(Default)]
pub struct OleObjectPreviewIdentity {
    /// ZIP package path, e.g. `xl/media/image1.emf`.
    pub path: String,
    /// Imported VML relationship id, reused as a hint when valid.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub relationship_id: Option<String>,
    /// Raw preview image bytes owned by this floating object.
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub bytes: Vec<u8>,
}

/// Typed worksheet `<controlPr>` properties for a form control.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
#[serde(default)]
pub struct FormControlWorksheetControlPr {
    pub default_size: bool,
    pub print: bool,
    pub disabled: bool,
    pub locked: bool,
    pub recalc_always: bool,
    pub ui_object: bool,
    pub auto_fill: bool,
    pub auto_line: bool,
    pub auto_pict: bool,
    pub macro_name: Option<String>,
    pub alt_text: Option<String>,
    pub linked_cell: Option<String>,
    pub list_fill_range: Option<String>,
    pub cf: Option<String>,
    pub r_id: Option<String>,
}

impl Default for FormControlWorksheetControlPr {
    fn default() -> Self {
        Self {
            default_size: true,
            print: true,
            disabled: false,
            locked: true,
            recalc_always: false,
            ui_object: false,
            auto_fill: true,
            auto_line: true,
            auto_pict: true,
            macro_name: None,
            alt_text: None,
            linked_cell: None,
            list_fill_range: None,
            cf: None,
            r_id: None,
        }
    }
}

/// OOXML round-trip properties for an OLE object.
///
/// Mirrors parser `OleObjectOutput` fields for lossless round-trip.
/// The domain-level `OleObjectData` carries prog_id/dv_aspect/flags;
/// this struct carries the remaining OOXML-specific data.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
#[serde(default)]
#[derive(Default)]
pub struct OleObjectOoxmlProps {
    /// VML shape identifier.
    pub shape_id: u32,
    /// Relationship ID for the embedded binary part.
    pub r_id: Option<String>,
    /// Resolved path to the embedded binary blob.
    pub data_path: Option<String>,
    /// Object name.
    pub name: Option<String>,
    /// Path to linked data (external file).
    pub link: Option<String>,
    /// Display aspect (duplicated from OleObjectData for JSON compat).
    pub dv_aspect: String,
    /// Program ID (duplicated from OleObjectData for JSON compat).
    pub prog_id: String,
    /// Update mode: "OLEUPDATE_ALWAYS" or "OLEUPDATE_ONCALL".
    pub ole_update: String,
    /// Whether to auto-load on workbook open.
    pub auto_load: bool,
    /// VML relationship ID for the preview image.
    pub preview_image_rel_id: Option<String>,
    /// Resolved path to the preview image.
    pub preview_image_path: Option<String>,
    /// Owned embedding package identity and bytes.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub embedding: Option<OleObjectPackageIdentity>,
    /// Owned preview media identity and bytes.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub preview: Option<OleObjectPreviewIdentity>,
    /// VML drawing path that owns the preview shape, when imported.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub vml_drawing_path: Option<String>,
    /// Worksheet relationship id for the VML drawing, when imported.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub vml_relationship_id: Option<String>,
    /// Object properties from `<objectPr>` child element.
    ///
    /// Typed-domain replacement for the former `Option<serde_json::Value>` blob
    /// (typed OOXML preservation); the `OleObjectPropertiesOutput` type used
    /// to live in `xlsx-parser`, forcing the field to carry free-form JSON. It
    /// now lives in `domain-types` as
    /// [`OleObjectProperties`](crate::domain::drawings::OleObjectProperties).
    pub object_pr: Option<crate::domain::drawings::OleObjectProperties>,
}

/// OOXML round-trip properties for a form control.
///
/// Form controls use VML (not DrawingML), so there is no OOXML typed struct.
/// This struct captures all VML/CT_ClientData fields for lossless round-trip.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
#[serde(default)]
pub struct FormControlOoxmlProps {
    pub shape_id: u32,
    pub alt_text: Option<String>,
    pub fmla_group: Option<String>,
    pub fmla_txbx: Option<String>,
    pub checked: Option<String>,
    pub val: Option<u32>,
    pub sel: Option<u32>,
    pub min: Option<i32>,
    pub max: Option<i32>,
    pub inc: Option<i32>,
    pub page: Option<i32>,
    pub drop_lines: Option<u32>,
    pub drop_style: Option<String>,
    pub dx: Option<u32>,
    pub horiz: bool,
    pub colored: bool,
    pub no_three_d: bool,
    pub no_three_d2: bool,
    pub first_button: bool,
    pub lock_text: bool,
    pub sel_type: Option<String>,
    pub multi_sel: Option<String>,
    pub text_h_align: Option<String>,
    pub text_v_align: Option<String>,
    pub edit_val: Option<String>,
    pub multi_line: bool,
    pub vertical_bar: bool,
    pub password_edit: bool,
    pub just_last_x: bool,
    pub width_min: Option<u32>,
    pub items: Vec<String>,
    pub macro_name: Option<String>,
    pub anchor_source: String,
    /// Whether the control moves with the cells it is anchored to.
    pub move_with_cells: bool,
    /// Whether the control resizes with the cells it is anchored to.
    pub size_with_cells: bool,
    /// VML-only CT_ClientData children (tag-name -> text-content).
    pub vml_extras: std::collections::HashMap<String, String>,
    /// Raw attributes from worksheet `<controlPr>` element.
    pub control_pr_attrs: std::collections::HashMap<String, String>,
    /// Typed worksheet `<controlPr>` element attributes.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub control_pr: Option<FormControlWorksheetControlPr>,
    /// VML shape visual properties.
    ///
    /// Typed-domain replacement for the former `Option<serde_json::Value>`
    /// blob (typed OOXML preservation); the `VmlShapeProps` type used to
    /// live in `xlsx-parser`, forcing the field to carry free-form JSON. It
    /// now lives in `domain-types` as
    /// [`VmlShapeProps`](crate::domain::drawings::VmlShapeProps).
    pub vml_shape: Option<crate::domain::drawings::VmlShapeProps>,
}

impl Default for FormControlOoxmlProps {
    fn default() -> Self {
        Self {
            shape_id: 0,
            alt_text: None,
            fmla_group: None,
            fmla_txbx: None,
            checked: None,
            val: None,
            sel: None,
            min: None,
            max: None,
            inc: None,
            page: None,
            drop_lines: None,
            drop_style: None,
            dx: None,
            horiz: false,
            colored: false,
            no_three_d: false,
            no_three_d2: false,
            first_button: false,
            lock_text: false,
            sel_type: None,
            multi_sel: None,
            text_h_align: None,
            text_v_align: None,
            edit_val: None,
            multi_line: false,
            vertical_bar: false,
            password_edit: false,
            just_last_x: false,
            width_min: None,
            items: Vec::new(),
            macro_name: None,
            anchor_source: String::new(),
            // Before these flags were modeled explicitly, authored form controls
            // were emitted with both anchor policy attributes set to true.
            move_with_cells: true,
            size_with_cells: true,
            vml_extras: std::collections::HashMap::new(),
            control_pr_attrs: std::collections::HashMap::new(),
            control_pr: None,
            vml_shape: None,
        }
    }
}
