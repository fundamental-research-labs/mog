use super::*;

/// Serializable OLE object output for WASM consumers.
///
/// Mirrors the enriched CT_OleObject attributes plus objectPr child data
/// and preview image paths for rendering on the TypeScript side.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct OleObjectOutput {
    /// Program ID (e.g., "Excel.Sheet.12", "Word.Document.12")
    pub prog_id: String,
    /// Shape ID in the VML drawing
    pub shape_id: u32,
    /// Relationship ID for the embedded binary part
    pub r_id: Option<String>,
    /// Resolved path to the embedded binary blob (e.g., "xl/embeddings/oleObject1.bin")
    pub data_path: Option<String>,
    /// Relationship/payload kind: "oleObject" or "embeddedPackage".
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub embedding_kind: Option<String>,
    /// Content type inferred or read for the embedded payload.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub embedding_content_type: Option<String>,
    /// Object name
    pub name: Option<String>,
    /// Path to linked data (external file)
    pub link: Option<String>,
    /// Display aspect: "DVASPECT_CONTENT" or "DVASPECT_ICON"
    pub dv_aspect: String,
    /// Update mode: "OLEUPDATE_ALWAYS" or "OLEUPDATE_ONCALL"
    pub ole_update: String,
    /// Whether to auto-load on workbook open
    pub auto_load: bool,
    /// VML relationship ID for the preview image
    pub preview_image_rel_id: Option<String>,
    /// Resolved path to the preview image (e.g., "xl/media/image1.png")
    pub preview_image_path: Option<String>,
    /// Object properties from `<objectPr>` child element
    pub object_pr: Option<OleObjectPropertiesOutput>,
}

// `OleObjectPropertiesOutput` / `OleObjectAnchorOutput` / `OleAnchorPointOutput`
// have moved to `domain-types::domain::drawings::ole_object` (typed OOXML preservation
// inventory row 1.7) under their plain domain names (`OleObjectProperties`,
// `OleObjectAnchor`, `OleAnchorPoint`). Alias the historical `*Output` names
// here so the `OleObjectOutput` struct and WASM JSON consumers compile
// unchanged.
pub use domain_types::domain::drawings::{
    OleAnchorPoint as OleAnchorPointOutput, OleObjectAnchor as OleObjectAnchorOutput,
    OleObjectProperties as OleObjectPropertiesOutput,
};

impl OleObjectOutput {
    /// Convert an `OleObject` (parser-internal) into an `OleObjectOutput` (WASM-serializable).
    pub fn from_ole_object(obj: &crate::domain::controls::types::OleObject) -> Self {
        let object_pr = obj.object_pr.as_ref().map(|pr| {
            let anchor = pr.anchor.as_ref().map(|a| OleObjectAnchorOutput {
                move_with_cells: a.move_with_cells,
                size_with_cells: a.size_with_cells,
                from: OleAnchorPointOutput {
                    col: a.from.col,
                    col_off: a.from.col_offset,
                    row: a.from.row,
                    row_off: a.from.row_offset,
                },
                to: OleAnchorPointOutput {
                    col: a.to.col,
                    col_off: a.to.col_offset,
                    row: a.to.row,
                    row_off: a.to.row_offset,
                },
            });

            OleObjectPropertiesOutput {
                default_size: pr.default_size,
                print: pr.print,
                disabled: pr.disabled,
                locked: pr.locked,
                auto_fill: pr.auto_fill,
                auto_line: pr.auto_line,
                auto_pict: pr.auto_pict,
                r#macro: pr.r#macro.clone(),
                alt_text: pr.alt_text.clone(),
                dde: pr.dde,
                ui_object: pr.ui_object,
                r_id: pr.r_id.clone(),
                anchor,
            }
        });

        Self {
            prog_id: obj.prog_id.clone(),
            shape_id: obj.shape_id,
            r_id: obj.r_id.clone(),
            data_path: obj.data_path.clone(),
            embedding_kind: obj.embedding_kind.clone(),
            embedding_content_type: obj.embedding_content_type.clone(),
            name: obj.name.clone(),
            link: obj.link_path.clone(),
            dv_aspect: obj.dv_aspect.to_ooxml().to_string(),
            ole_update: obj.ole_update.to_ooxml().to_string(),
            auto_load: obj.auto_load,
            preview_image_rel_id: obj.preview_image_rel_id.clone(),
            preview_image_path: obj.preview_image_path.clone(),
            object_pr,
        }
    }
}
