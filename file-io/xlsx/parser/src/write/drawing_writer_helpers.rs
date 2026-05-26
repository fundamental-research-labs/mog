//! Helpers for converting domain-types floating objects into DrawingWriter anchors.
//!
//! This module bridges the gap between domain-types (`FloatingObject`) and the
//! write-side drawing types (`DrawingAnchor`, `DrawingObject`).
//!
//! It is designed to be called from `from_parse_output.rs` without modifying that file
//! directly, providing all the conversion logic needed to emit drawing XML.
//!
//! UTF-8 boundary guard: the single `&s[n..]` slice in this file splits a
//! drawing-object id string at an ASCII-only delimiter position.
//! Char-boundary by construction. File-scope allow documented here.

#![allow(clippy::string_slice)]

use domain_types::domain::chart::{AnchorPosition, ObjectSize};
use domain_types::domain::floating_object::{
    AnchorMode, ConnectorData as FobjConnectorData, DiagramData as FobjDiagramData, FloatingObject,
    FloatingObjectAnchor, FloatingObjectCommon, FloatingObjectData, ShapeOoxmlProps,
};

use crate::domain::drawings::write::{
    CellAnchor, ClientData, Connection, ConnectorProps, DrawingAnchor, DrawingLocking,
    DrawingObject, EditAs, Extent, GroupShapeProps, ImageProps, OneCellAnchor, PresetGeometry,
    ShapePreset, ShapeProps, SmartArtWriteData, TextBox, Transform2D, TwoCellAnchor,
};

// =============================================================================
// Constants
// =============================================================================

/// EMUs per pixel at 96 DPI (914400 EMUs/inch / 96 DPI).
const EMUS_PER_PIXEL: i64 = 9525; // 914400 / 96

// =============================================================================
// Top-Level Assembly
// =============================================================================

/// Result of assembling drawing data for a single sheet.
///
/// Contains the drawing anchors ready for `DrawingWriter`, plus any image blobs
/// that need to be written to the ZIP archive (keyed by their relationship target path).
pub struct SheetDrawingData {
    /// Drawing anchors to feed into `DrawingWriter::add_anchor`, paired with their
    /// original anchor index in the drawing XML (from `anchorIndex` in ooxml props).
    /// `None` means the anchor index is unknown.
    pub anchors: Vec<(Option<usize>, DrawingAnchor)>,
    /// Image blobs: `(relationship_target_path, image_bytes)`.
    /// The caller is responsible for writing these to the ZIP and creating rels.
    pub image_blobs: Vec<(String, Vec<u8>)>,
    /// Image relationship entries: `(original_r_id, target_path)`.
    /// The original rId is preserved for round-trip fidelity.
    /// Bytes are already handled by binary_blobs passthrough (no need to re-emit).
    pub image_rels: Vec<(String, String)>,
}

/// Assemble all floating objects for a sheet into drawing anchors suitable for `DrawingWriter`.
///
/// The unified `FloatingObject` type contains all object types (pictures, shapes,
/// connectors, SmartArt, etc.) in a single Vec. This function dispatches on the
/// `data` variant to produce the appropriate `DrawingAnchor`.
///
/// This is the main entry point for the `from_parse_output` writer.
pub fn build_sheet_drawing_data(floating_objects: &[FloatingObject]) -> SheetDrawingData {
    let mut anchors = Vec::new();
    let mut image_blobs: Vec<(String, Vec<u8>)> = Vec::new();
    let mut image_rels: Vec<(String, String)> = Vec::new();

    for obj in floating_objects {
        // Extract the original drawing anchor index from ooxml props for ordering.
        let anchor_index = get_anchor_index(&obj.data);

        match &obj.data {
            FloatingObjectData::Picture(_)
            | FloatingObjectData::Shape(_)
            | FloatingObjectData::Textbox(_) => {
                if let Some(anchor) =
                    convert_floating_object(obj, &mut image_blobs, &mut image_rels)
                {
                    anchors.push((anchor_index, anchor));
                }
            }
            // Drawing is a catch-all for unknown/unsupported drawing types.
            // These cannot be reconstructed into valid OOXML, so we skip them
            // on write. This is intentional — not a silent drop.
            FloatingObjectData::Drawing(_) => {}
            FloatingObjectData::Connector(conn_data) => {
                let anchor = convert_unified_connector_to_anchor(&obj.common, conn_data);
                anchors.push((anchor_index, anchor));
            }
            FloatingObjectData::Diagram(diagram_data) => {
                let anchor = convert_unified_smartart_to_anchor(&obj.common, diagram_data);
                anchors.push((anchor_index, anchor));
            }
            // Charts are handled separately via ChartSpec pipeline.
            // Form controls and slicers use VML or other mechanisms.
            //
            // TODO(OLE): OLE objects (FloatingObjectData::OleObject) are parsed and
            // their OOXML blob is preserved in the ooxml field, but no writer support
            // exists yet. To fix: deserialize the OLE object data from the ooxml blob,
            // produce an appropriate DrawingAnchor (likely a graphicFrame with
            // oleObject child + embedded/linked relationship), and add it to the
            // anchors list. Until then, OLE objects are silently dropped on write.
            _ => {}
        }
    }

    SheetDrawingData {
        anchors,
        image_blobs,
        image_rels,
    }
}

// =============================================================================
// Helpers: extract ooxml properties from unified FloatingObject
// =============================================================================

/// Extract the `anchor_index` from a `FloatingObjectData` variant's ooxml props.
fn get_anchor_index(data: &FloatingObjectData) -> Option<usize> {
    match data {
        FloatingObjectData::Picture(d) => d
            .ooxml
            .as_ref()
            .and_then(|p| p.anchor_index)
            .map(|i| i as usize),
        FloatingObjectData::Shape(d) => d
            .ooxml
            .as_ref()
            .and_then(|p| p.anchor_index)
            .map(|i| i as usize),
        FloatingObjectData::Textbox(d) => d
            .ooxml
            .as_ref()
            .and_then(|p| p.anchor_index)
            .map(|i| i as usize),
        FloatingObjectData::Connector(d) => d
            .ooxml
            .as_ref()
            .and_then(|p| p.anchor_index)
            .map(|i| i as usize),
        _ => None,
    }
}

/// Extract common anchor-level ooxml props needed for building a DrawingAnchor.
struct AnchorOoxmlProps {
    extent_emu: Option<(i64, i64)>,
    edit_as: Option<String>,
    mc_alternate_content_raw_xml: Option<String>,
    client_data_locks_with_sheet: Option<bool>,
    client_data_prints_with_sheet: Option<bool>,
}

fn get_shape_ooxml(data: &FloatingObjectData) -> Option<&ShapeOoxmlProps> {
    match data {
        FloatingObjectData::Shape(d) => d.ooxml.as_ref(),
        FloatingObjectData::Textbox(d) => d.ooxml.as_ref(),
        _ => None,
    }
}

fn get_anchor_ooxml_props(
    data: &FloatingObjectData,
    anchor: &FloatingObjectAnchor,
) -> AnchorOoxmlProps {
    // Extract from picture props
    if let FloatingObjectData::Picture(d) = data {
        if let Some(p) = d.ooxml.as_ref() {
            return AnchorOoxmlProps {
                extent_emu: p
                    .extent_emu_cx
                    .zip(p.extent_emu_cy)
                    .or_else(|| anchor.extent_cx.zip(anchor.extent_cy)),
                edit_as: p.edit_as.clone(),
                mc_alternate_content_raw_xml: p.mc_alternate_content_raw_xml.clone(),
                client_data_locks_with_sheet: p.client_data_locks_with_sheet,
                client_data_prints_with_sheet: p.client_data_prints_with_sheet,
            };
        }
    }
    // Extract from shape/textbox props
    if let Some(p) = get_shape_ooxml(data) {
        return AnchorOoxmlProps {
            extent_emu: p
                .extent_emu_cx
                .zip(p.extent_emu_cy)
                .or_else(|| anchor.extent_cx.zip(anchor.extent_cy)),
            edit_as: p.edit_as.clone(),
            mc_alternate_content_raw_xml: p.mc_alternate_content_raw_xml.clone(),
            client_data_locks_with_sheet: p.client_data_locks_with_sheet,
            client_data_prints_with_sheet: p.client_data_prints_with_sheet,
        };
    }
    // Extract from connector props
    if let FloatingObjectData::Connector(d) = data {
        if let Some(p) = d.ooxml.as_ref() {
            return AnchorOoxmlProps {
                extent_emu: p
                    .extent_emu_cx
                    .zip(p.extent_emu_cy)
                    .or_else(|| anchor.extent_cx.zip(anchor.extent_cy)),
                edit_as: p.edit_as.clone(),
                mc_alternate_content_raw_xml: p.mc_alternate_content_raw_xml.clone(),
                client_data_locks_with_sheet: p.client_data_locks_with_sheet,
                client_data_prints_with_sheet: p.client_data_prints_with_sheet,
            };
        }
    }
    // Default
    AnchorOoxmlProps {
        extent_emu: anchor.extent_cx.zip(anchor.extent_cy),
        edit_as: None,
        mc_alternate_content_raw_xml: None,
        client_data_locks_with_sheet: None,
        client_data_prints_with_sheet: None,
    }
}

/// Convert a `FloatingObjectAnchor` into a legacy `AnchorPosition` for compatibility
/// with existing writer helper functions.
fn anchor_to_legacy_position(anchor: &FloatingObjectAnchor) -> AnchorPosition {
    AnchorPosition {
        anchor_row: anchor.anchor_row,
        anchor_col: anchor.anchor_col,
        anchor_row_offset: anchor.anchor_row_offset,
        anchor_col_offset: anchor.anchor_col_offset,
        end_row: anchor.end_row,
        end_col: anchor.end_col,
        end_row_offset: anchor.end_row_offset,
        end_col_offset: anchor.end_col_offset,
        extent_cx: anchor.extent_cx,
        extent_cy: anchor.extent_cy,
    }
}

/// Get the editAs string from the anchor mode.
fn anchor_mode_to_edit_as(mode: &AnchorMode) -> Option<String> {
    match mode {
        AnchorMode::OneCell => Some("oneCell".to_string()),
        AnchorMode::TwoCell => None, // TwoCell is the OOXML default
        AnchorMode::Absolute => Some("absolute".to_string()),
    }
}

// =============================================================================
// AnchorPosition → TwoCellAnchor / OneCellAnchor
// =============================================================================

/// Convert an `AnchorPosition` into a write-side `TwoCellAnchor`.
///
/// If end row/col are present, produces a two-cell anchor. The `edit_as` field
/// defaults to `None` (OOXML default is "twoCell").
pub fn anchor_position_to_two_cell(pos: &AnchorPosition) -> TwoCellAnchor {
    let from = CellAnchor {
        col: pos.anchor_col,
        col_off: pos.anchor_col_offset,
        row: pos.anchor_row,
        row_off: pos.anchor_row_offset,
    };

    let to = CellAnchor {
        col: pos.end_col.unwrap_or(pos.anchor_col),
        col_off: pos.end_col_offset.unwrap_or(0),
        row: pos.end_row.unwrap_or(pos.anchor_row),
        row_off: pos.end_row_offset.unwrap_or(0),
    };

    TwoCellAnchor {
        from,
        to,
        edit_as: None,
        client_data: ClientData::default(),
        mc_alternate_content: None,
    }
}

/// Convert an `AnchorPosition` + `ObjectSize` into a one-cell anchor.
///
/// Used when the anchor position does not have end row/col (one-cell positioning).
/// When `extent_emu` is provided, uses those exact EMU values instead of computing
/// from pixel size (avoids precision loss from pixel→EMU round-trip).
pub fn anchor_position_to_one_cell(
    pos: &AnchorPosition,
    size: &ObjectSize,
    extent_emu: Option<(i64, i64)>,
) -> OneCellAnchor {
    let from = CellAnchor {
        col: pos.anchor_col,
        col_off: pos.anchor_col_offset,
        row: pos.anchor_row,
        row_off: pos.anchor_row_offset,
    };

    let (cx, cy) = extent_emu.unwrap_or_else(|| {
        (
            size.width as i64 * EMUS_PER_PIXEL,
            size.height as i64 * EMUS_PER_PIXEL,
        )
    });

    OneCellAnchor {
        from,
        extent: Extent { cx, cy },
        client_data: ClientData::default(),
        mc_alternate_content: None,
    }
}

/// Determine the best anchor type for the given position/size and wrap a
/// `DrawingObject` into a `DrawingAnchor`.
fn wrap_in_anchor(
    pos: &AnchorPosition,
    size: &ObjectSize,
    edit_as: Option<&str>,
    extent_emu: Option<(i64, i64)>,
    obj: DrawingObject,
) -> DrawingAnchor {
    if pos.end_row.is_some() && pos.end_col.is_some() {
        let mut anchor = anchor_position_to_two_cell(pos);
        if let Some(ea) = edit_as {
            anchor.edit_as = Some(EditAs::from_ooxml(ea));
        }
        DrawingAnchor::TwoCell(anchor, obj)
    } else {
        DrawingAnchor::OneCell(anchor_position_to_one_cell(pos, size, extent_emu), obj)
    }
}

// =============================================================================
// FloatingObject → DrawingAnchor
// =============================================================================

/// Convert a unified `FloatingObject` (Picture/Shape/Textbox/Drawing) into a `DrawingAnchor`.
///
/// Dispatches on `data` variant. Returns `None` if the object type cannot be converted.
fn convert_floating_object(
    obj: &FloatingObject,
    image_blobs: &mut Vec<(String, Vec<u8>)>,
    image_rels: &mut Vec<(String, String)>,
) -> Option<DrawingAnchor> {
    let drawing_obj = match &obj.data {
        FloatingObjectData::Picture(pic_data) => {
            // Use the typed SpreadsheetPicture directly from ooxml props (no JSON deserialization).
            if let Some(ref ooxml) = pic_data.ooxml {
                let image_props =
                    crate::domain::drawings::write::convert::picture_to_image_props(&ooxml.picture);
                // Register image relationship (bytes handled by binary_blobs passthrough)
                if let Some(ref image_path) = ooxml.image_path {
                    image_rels.push((image_props.r_id.clone(), image_path.clone()));
                }
                DrawingObject::Picture(image_props)
            } else {
                // Fallback for API-created pictures (no ooxml props)
                convert_image(&obj.common, &pic_data.src, image_blobs, image_rels)?
            }
        }
        FloatingObjectData::Shape(shape_data) => {
            if let Some(ref ooxml) = shape_data.ooxml {
                // Check if it's a group shape
                if shape_data.shape_type == "group" {
                    if let Some(ref grp) = ooxml.group_shape {
                        DrawingObject::GroupShape(convert_group_from_data(&obj.common, grp))
                    } else {
                        DrawingObject::GroupShape(convert_group_fallback(&obj.common))
                    }
                } else {
                    // High-fidelity path: use typed SpreadsheetShape directly
                    let text_box =
                        crate::domain::drawings::write::convert::shape_to_text_box(&ooxml.shape);
                    DrawingObject::TextBox(text_box)
                }
            } else if shape_data.shape_type == "group" {
                DrawingObject::GroupShape(convert_group_fallback(&obj.common))
            } else {
                // Fallback for API-created shapes
                DrawingObject::Shape(convert_shape(&obj.common))
            }
        }
        FloatingObjectData::Textbox(tb_data) => {
            if let Some(ref ooxml) = tb_data.ooxml {
                // High-fidelity path: use typed SpreadsheetShape directly
                let text_box =
                    crate::domain::drawings::write::convert::shape_to_text_box(&ooxml.shape);
                DrawingObject::TextBox(text_box)
            } else {
                // Fallback for API-created textboxes
                DrawingObject::TextBox(convert_text_box(&obj.common))
            }
        }
        _ => return None,
    };

    // Build legacy position and size for the anchor helper
    let position = anchor_to_legacy_position(&obj.common.anchor);
    let size = ObjectSize {
        width: obj.common.width,
        height: obj.common.height,
        ..Default::default()
    };

    // Extract preserved anchor-level ooxml props from the typed structs.
    let anchor_props = get_anchor_ooxml_props(&obj.data, &obj.common.anchor);

    let extent_emu = anchor_props.extent_emu;

    // Get editAs from ooxml props or from anchor mode
    let edit_as_str = anchor_props
        .edit_as
        .or_else(|| anchor_mode_to_edit_as(&obj.common.anchor.anchor_mode));

    let mut anchor = wrap_in_anchor(
        &position,
        &size,
        edit_as_str.as_deref(),
        extent_emu,
        drawing_obj,
    );

    // Restore mc:AlternateContent raw XML for form control shapes
    if let Some(ref raw_xml) = anchor_props.mc_alternate_content_raw_xml {
        let mc = crate::domain::drawings::McAlternateContent {
            raw_xml: raw_xml.clone(),
        };
        if let DrawingAnchor::TwoCell(tc, _) = &mut anchor {
            tc.mc_alternate_content = Some(mc)
        }
    }

    // Restore client data (fLocksWithSheet / fPrintsWithSheet) from ooxml props.
    let restored_client_data = ClientData {
        locks_with_sheet: anchor_props.client_data_locks_with_sheet.unwrap_or(true),
        prints_with_sheet: anchor_props.client_data_prints_with_sheet.unwrap_or(true),
    };
    match &mut anchor {
        DrawingAnchor::TwoCell(tc, _) => tc.client_data = restored_client_data,
        DrawingAnchor::OneCell(oc, _) => oc.client_data = restored_client_data,
        _ => {}
    }

    Some(anchor)
}

// =============================================================================
// Image conversion
// =============================================================================

/// Convert an API-created Picture into a `DrawingObject::Picture`.
///
/// This handles pictures created via the API (no OOXML props). It processes
/// data-URL images from `PictureData.src` and produces minimal valid OOXML.
fn convert_image(
    common: &FloatingObjectCommon,
    picture_src: &str,
    image_blobs: &mut Vec<(String, Vec<u8>)>,
    _image_rels: &mut Vec<(String, String)>,
) -> Option<DrawingObject> {
    // API-created pictures store image bytes as a data-URL in PictureData.src
    // (e.g. "data:image/png;base64,..."). Extract the bytes and write them to
    // xl/media/ so the XLSX archive is valid.
    if let Some((ext, decoded)) = parse_data_url(picture_src) {
        let image_idx = image_blobs.len() + 1;
        let image_path = format!("../media/image{}.{}", image_idx, ext);
        image_blobs.push((image_path, decoded));
    }

    let name = if common.name.is_empty() {
        "Image".to_string()
    } else {
        common.name.clone()
    };

    let rotation = if common.rotation != 0.0 {
        Some((common.rotation * 60_000.0) as i32)
    } else {
        None
    };

    let image_props = ImageProps {
        name,
        r_id: "rId1".to_string(),
        rotation,
        offset_x: 0,
        offset_y: 0,
        extent_cx: common.width as i64 * EMUS_PER_PIXEL,
        extent_cy: common.height as i64 * EMUS_PER_PIXEL,
        flip_h: common.flip_h,
        flip_v: common.flip_v,
        locks: DrawingLocking {
            no_change_aspect: true,
            no_move: common.locked,
            ..Default::default()
        },
        has_pic_locks: true,
        ..Default::default()
    };

    Some(DrawingObject::Picture(image_props))
}

/// Parse a `data:` URL into (file_extension, decoded_bytes).
///
/// Supports the format `data:<mime>;base64,<data>`.
/// Returns `None` if the URL is not a valid data-URL or decoding fails.
fn parse_data_url(url: &str) -> Option<(String, Vec<u8>)> {
    let rest = url.strip_prefix("data:")?;
    let (mime_and_params, data) = rest.split_once(',')?;
    if !mime_and_params.ends_with(";base64") {
        return None;
    }
    let mime = &mime_and_params[..mime_and_params.len() - ";base64".len()];
    let ext = match mime {
        "image/png" => "png",
        "image/jpeg" | "image/jpg" => "jpeg",
        "image/gif" => "gif",
        "image/bmp" => "bmp",
        "image/tiff" => "tiff",
        "image/webp" => "webp",
        "image/svg+xml" => "svg",
        "image/emf" | "image/x-emf" => "emf",
        "image/wmf" | "image/x-wmf" => "wmf",
        _ => "png", // Default to png for unknown MIME types
    };
    let decoded = base64_decode(data).ok()?;
    if decoded.is_empty() {
        return None;
    }
    Some((ext.to_string(), decoded))
}

/// Minimal base64 decoder (avoids external dependency).
/// Handles standard base64 alphabet (A-Z, a-z, 0-9, +, /) with = padding.
fn base64_decode(input: &str) -> Result<Vec<u8>, ()> {
    // Strip whitespace
    let clean: String = input.chars().filter(|c| !c.is_whitespace()).collect();
    if clean.is_empty() {
        return Ok(Vec::new());
    }

    let mut out = Vec::with_capacity(clean.len() * 3 / 4);
    let mut buf: u32 = 0;
    let mut bits: u32 = 0;

    for ch in clean.chars() {
        let val = match ch {
            'A'..='Z' => ch as u32 - b'A' as u32,
            'a'..='z' => ch as u32 - b'a' as u32 + 26,
            '0'..='9' => ch as u32 - b'0' as u32 + 52,
            '+' => 62,
            '/' => 63,
            '=' => break,
            _ => return Err(()),
        };
        buf = (buf << 6) | val;
        bits += 6;
        if bits >= 8 {
            bits -= 8;
            out.push((buf >> bits) as u8);
            buf &= (1 << bits) - 1;
        }
    }

    Ok(out)
}

// =============================================================================
// Shape conversion
// =============================================================================

/// Convert a shape-type floating object into `ShapeProps`.
/// Fallback for API-created shapes (no OOXML props). Produces minimal valid shape.
fn convert_shape(common: &FloatingObjectCommon) -> ShapeProps {
    let name = if common.name.is_empty() {
        "Shape".to_string()
    } else {
        common.name.clone()
    };

    ShapeProps {
        original_id: None,
        name,
        preset: ShapePreset::Rect,
        fill: None,
        outline: None,
        text: None,
        macro_name: None,
        textlink: None,
        nv_ext_lst: None,
        tx_box: false,
        xfrm: None,
        style: None,
    }
}

/// Parse a shape preset string to the enum. Falls back to `Rect`.
fn parse_shape_preset(s: &str) -> ShapePreset {
    // ShapePreset uses serde rename_all = "camelCase" matching OOXML preset names.
    // We attempt deserialization first; if that fails, use a manual match for common ones.
    match s {
        "rect" => ShapePreset::Rect,
        "ellipse" => ShapePreset::Ellipse,
        "roundRect" => ShapePreset::RoundRect,
        "triangle" => ShapePreset::Triangle,
        "rtTriangle" => ShapePreset::RightTriangle,
        "diamond" => ShapePreset::Diamond,
        "pentagon" => ShapePreset::Pentagon,
        "hexagon" => ShapePreset::Hexagon,
        "star5" => ShapePreset::Star5,
        "line" => ShapePreset::Line,
        "rightArrow" => ShapePreset::RightArrow,
        "leftArrow" => ShapePreset::LeftArrow,
        "upArrow" => ShapePreset::UpArrow,
        "downArrow" => ShapePreset::DownArrow,
        "cloud" => ShapePreset::Cloud,
        "heart" => ShapePreset::Heart,
        "can" => ShapePreset::Can,
        "cube" => ShapePreset::Cube,
        "flowChartProcess" => ShapePreset::FlowChartProcess,
        "flowChartDecision" => ShapePreset::FlowChartDecision,
        "flowChartTerminator" => ShapePreset::FlowChartTerminator,
        _ => ShapePreset::Rect,
    }
}

// =============================================================================
// TextBox conversion
// =============================================================================

/// Convert a textbox-type floating object into a `TextBox`.
/// Fallback for API-created textboxes (no OOXML props). Produces minimal valid textbox.
fn convert_text_box(common: &FloatingObjectCommon) -> TextBox {
    let name = if common.name.is_empty() {
        "TextBox".to_string()
    } else {
        common.name.clone()
    };
    TextBox::from_plain(&name, "")
}

// =============================================================================
// Group conversion
// =============================================================================

/// Convert a group shape from its typed CT_GroupShape payload.
fn convert_group_from_data(
    _common: &FloatingObjectCommon,
    group: &crate::domain::drawings::GroupShape,
) -> GroupShapeProps {
    crate::domain::drawings::write::convert::group_shape_to_props(group)
}

/// Fallback group construction when no GroupShape JSON is available (children are lost).
fn convert_group_fallback(common: &FloatingObjectCommon) -> GroupShapeProps {
    let name = if common.name.is_empty() {
        "Group".to_string()
    } else {
        common.name.clone()
    };

    GroupShapeProps {
        original_id: None,
        name,
        description: None,
        title: None,
        hidden: !common.visible,
        hlink_click: None,
        hlink_hover: None,
        group_locking: None,
        nv_ext_lst: None,
        transform: None,
        fill: None,
        effects: None,
        bw_mode: None,
        scene3d: None,
        ext_lst: None,
        children: Vec::new(),
    }
}

// =============================================================================
// Connector conversion
// =============================================================================

/// Convert a unified connector floating object into a `DrawingAnchor`.
fn convert_unified_connector_to_anchor(
    common: &FloatingObjectCommon,
    conn_data: &FobjConnectorData,
) -> DrawingAnchor {
    let connector_props = convert_unified_connector(common, conn_data);
    let obj = DrawingObject::Connector(connector_props);

    let position = anchor_to_legacy_position(&common.anchor);
    let anchor = anchor_position_to_two_cell(&position);
    DrawingAnchor::TwoCell(anchor, obj)
}

/// Convert a unified connector into write-side `ConnectorProps`.
fn convert_unified_connector(
    common: &FloatingObjectCommon,
    conn_data: &FobjConnectorData,
) -> ConnectorProps {
    // Use the typed SpreadsheetConnector directly from ooxml props.
    if let Some(ref ooxml) = conn_data.ooxml {
        return crate::domain::drawings::write::convert::connector_to_props(&ooxml.connector);
    }

    // Fallback: manual construction from typed fields
    let name = if common.name.is_empty() {
        "Connector".to_string()
    } else {
        common.name.clone()
    };

    let preset_geometry = Some(PresetGeometry {
        prst: parse_shape_preset(&conn_data.shape_type),
        av_list: Vec::new(),
    });

    let start_connection = conn_data.start_connection.as_ref().map(|ep| Connection {
        shape_id: ep.shape_id.parse::<u32>().unwrap_or(0),
        idx: ep.site_index as u32,
    });

    let end_connection = conn_data.end_connection.as_ref().map(|ep| Connection {
        shape_id: ep.shape_id.parse::<u32>().unwrap_or(0),
        idx: ep.site_index as u32,
    });

    ConnectorProps {
        original_id: None,
        name,
        description: None,
        title: None,
        hidden: false,
        hlink_click: None,
        hlink_hover: None,
        nv_ext_lst: None,
        start_connection,
        end_connection,
        locks: DrawingLocking::default(),
        transform: Transform2D::default(),
        preset_geometry,
        fill: None,
        outline: None,
        style: None,
        macro_name: None,
    }
}

// =============================================================================
// SmartArt conversion
// =============================================================================

/// Convert a unified SmartArt floating object into a `DrawingAnchor`.
fn convert_unified_smartart_to_anchor(
    common: &FloatingObjectCommon,
    sa_data: &FobjDiagramData,
) -> DrawingAnchor {
    let smartart_data = convert_unified_smartart(common, sa_data);
    let obj = DrawingObject::SmartArt(smartart_data);

    let position = anchor_to_legacy_position(&common.anchor);
    let anchor = anchor_position_to_two_cell(&position);
    DrawingAnchor::TwoCell(anchor, obj)
}

/// Convert unified SmartArt data into write-side `SmartArtWriteData`.
fn convert_unified_smartart(
    common: &FloatingObjectCommon,
    sa_data: &FobjDiagramData,
) -> SmartArtWriteData {
    let def = &sa_data.definition;

    SmartArtWriteData {
        original_id: def.original_id,
        name: sa_data
            .category
            .map(|c| format!("{:?}", c))
            .unwrap_or_else(|| {
                if common.name.is_empty() {
                    "SmartArt".to_string()
                } else {
                    common.name.clone()
                }
            }),
        dm_rel_id: def.dm_rel_id.clone().unwrap_or_else(|| "rId1".to_string()),
        lo_rel_id: def.lo_rel_id.clone().unwrap_or_else(|| "rId2".to_string()),
        qs_rel_id: def.qs_rel_id.clone().unwrap_or_else(|| "rId3".to_string()),
        cs_rel_id: def.cs_rel_id.clone().unwrap_or_else(|| "rId4".to_string()),
        data_xml: def.data_xml.clone(),
        layout_xml: def.layout_xml.clone(),
        colors_xml: def.colors_xml.clone(),
        style_xml: def.style_xml.clone(),
        drawing_xml: def.drawing_xml.clone(),
    }
}

// =============================================================================
// Tests
// =============================================================================

#[cfg(test)]
mod tests {
    use super::*;
    use domain_types::domain::chart::{AnchorPosition, ObjectSize};
    use domain_types::domain::floating_object::*;

    fn make_common(name: &str) -> FloatingObjectCommon {
        FloatingObjectCommon {
            id: "test".to_string(),
            sheet_id: String::new(),
            anchor: FloatingObjectAnchor {
                anchor_row: 0,
                anchor_col: 0,
                anchor_row_offset: 0,
                anchor_col_offset: 0,
                anchor_mode: AnchorMode::TwoCell,
                end_row: Some(5),
                end_col: Some(5),
                end_row_offset: Some(0),
                end_col_offset: Some(0),
                extent_cx: None,
                extent_cy: None,
            },
            width: 200.0,
            height: 100.0,
            z_index: 0,
            rotation: 0.0,
            flip_h: false,
            flip_v: false,
            locked: false,
            visible: true,
            printable: true,
            opacity: 1.0,
            name: name.to_string(),
            created_at: 0,
            updated_at: 0,
            group_id: None,
            anchor_cell_id: None,
            to_anchor_cell_id: None,
            lock_aspect_ratio: None,
            alt_text_title: None,
            display_name: None,
            import_status: None,
        }
    }

    #[test]
    fn test_anchor_position_to_two_cell() {
        let pos = AnchorPosition {
            anchor_row: 1,
            anchor_col: 2,
            anchor_row_offset: 100,
            anchor_col_offset: 200,
            end_row: Some(5),
            end_col: Some(6),
            end_row_offset: Some(300),
            end_col_offset: Some(400),
            extent_cx: None,
            extent_cy: None,
        };

        let anchor = anchor_position_to_two_cell(&pos);
        assert_eq!(anchor.from.row, 1);
        assert_eq!(anchor.from.col, 2);
        assert_eq!(anchor.from.row_off, 100);
        assert_eq!(anchor.from.col_off, 200);
        assert_eq!(anchor.to.row, 5);
        assert_eq!(anchor.to.col, 6);
        assert_eq!(anchor.to.row_off, 300);
        assert_eq!(anchor.to.col_off, 400);
    }

    #[test]
    fn test_anchor_position_to_one_cell() {
        let pos = AnchorPosition {
            anchor_row: 3,
            anchor_col: 4,
            anchor_row_offset: 0,
            anchor_col_offset: 0,
            end_row: None,
            end_col: None,
            end_row_offset: None,
            end_col_offset: None,
            extent_cx: None,
            extent_cy: None,
        };
        let size = ObjectSize {
            width: 100.0,
            height: 200.0,
            ..Default::default()
        };

        let anchor = anchor_position_to_one_cell(&pos, &size, None);
        assert_eq!(anchor.from.row, 3);
        assert_eq!(anchor.from.col, 4);
        assert_eq!(anchor.extent.cx, 100 * EMUS_PER_PIXEL);
        assert_eq!(anchor.extent.cy, 200 * EMUS_PER_PIXEL);
    }

    #[test]
    fn test_convert_shape_floating_object() {
        let common = make_common("Arrow");
        let shape = convert_shape(&common);
        assert_eq!(shape.name, "Arrow");
        assert_eq!(shape.preset, ShapePreset::Rect);
        assert_eq!(shape.text, None);
    }

    #[test]
    fn test_convert_text_box_floating_object() {
        let common = make_common("Note");
        let tb = convert_text_box(&common);
        assert_eq!(tb.name, "Note");
        assert!(tb.text_body.is_some());
    }

    #[test]
    fn test_convert_connector() {
        let common = make_common("Link");
        let conn_data = FobjConnectorData {
            shape_type: "straightConnector1".to_string(),
            fill: None,
            outline: None,
            start_connection: Some(ConnectorBinding {
                shape_id: "10".to_string(),
                site_index: 0,
            }),
            end_connection: Some(ConnectorBinding {
                shape_id: "20".to_string(),
                site_index: 2,
            }),
            adjustments: None,
            ooxml: None,
        };
        let cp = convert_unified_connector(&common, &conn_data);
        assert_eq!(cp.name, "Link");
        assert!(cp.start_connection.is_some());
        assert_eq!(cp.start_connection.unwrap().shape_id, 10);
        assert!(cp.end_connection.is_some());
        assert_eq!(cp.end_connection.unwrap().idx, 2);
    }

    #[test]
    fn test_convert_smartart() {
        let common = make_common("SmartArt");
        let sa_data = FobjDiagramData {
            definition: domain_types::domain::smartart::SmartArtDefinition {
                dm_rel_id: Some("rId10".to_string()),
                lo_rel_id: Some("rId11".to_string()),
                qs_rel_id: Some("rId12".to_string()),
                cs_rel_id: Some("rId13".to_string()),
                data_xml: Some("<dgm:dataModel/>".to_string()),
                ..Default::default()
            },
            category: Some(domain_types::domain::smartart::SmartArtCategory::Hierarchy),
        };
        let data = convert_unified_smartart(&common, &sa_data);
        assert_eq!(data.dm_rel_id, "rId10");
        assert_eq!(data.lo_rel_id, "rId11");
        assert_eq!(data.data_xml, Some("<dgm:dataModel/>".to_string()));
        assert_eq!(data.name, "Hierarchy");
    }

    #[test]
    fn test_build_sheet_drawing_data_empty() {
        let result = build_sheet_drawing_data(&[]);
        assert!(result.anchors.is_empty());
        assert!(result.image_blobs.is_empty());
    }

    #[test]
    fn test_build_sheet_drawing_data_mixed() {
        let shape = FloatingObject {
            common: make_common("Rect"),
            data: FloatingObjectData::Shape(ShapeData {
                shape_type: "rect".to_string(),
                fill: None,
                outline: None,
                text: None,
                shadow: None,
                adjustments: None,
                scene_3d: None,
                sp_3d: None,
                ooxml: Some(ShapeOoxmlProps::default()),
            }),
        };
        let conn = FloatingObject {
            common: make_common("Line"),
            data: FloatingObjectData::Connector(FobjConnectorData {
                shape_type: "line".to_string(),
                fill: None,
                outline: None,
                start_connection: None,
                end_connection: None,
                adjustments: None,
                ooxml: None,
            }),
        };
        let result = build_sheet_drawing_data(&[shape, conn]);
        assert_eq!(result.anchors.len(), 2);
    }

    #[test]
    fn test_base64_decode() {
        let result = base64_decode("SGVsbG8=").unwrap();
        assert_eq!(result, b"Hello");
    }

    #[test]
    fn test_ole_object_skipped() {
        let obj = FloatingObject {
            common: make_common("OLE"),
            data: FloatingObjectData::OleObject(OleObjectData {
                prog_id: "test".to_string(),
                dv_aspect: "DVASPECT_CONTENT".to_string(),
                is_linked: false,
                is_embedded: true,
                preview_image_src: None,
                alt_text: None,
                ooxml: None,
            }),
        };
        let result = build_sheet_drawing_data(&[obj]);
        assert!(result.anchors.is_empty());
    }

    #[test]
    fn test_parse_shape_preset_known() {
        assert_eq!(parse_shape_preset("ellipse"), ShapePreset::Ellipse);
        assert_eq!(parse_shape_preset("heart"), ShapePreset::Heart);
    }

    #[test]
    fn test_parse_shape_preset_unknown_fallback() {
        assert_eq!(parse_shape_preset("weirdShape"), ShapePreset::Rect);
    }
}
