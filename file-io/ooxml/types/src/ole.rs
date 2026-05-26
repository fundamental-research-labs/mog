//! OLE Object types (ECMA-376 §18.3.1.55–59).
//!
//! Defines canonical types for OLE (Object Linking and Embedding) objects
//! embedded in spreadsheets. These types cover the `<mc:AlternateContent>` /
//! `<oleObject>` elements found in worksheet XML.
//!
//! # OOXML OLE Object Structure
//!
//! OLE objects appear inside `<oleObjects>` in the worksheet part:
//! ```xml
//! <oleObjects>
//!   <mc:AlternateContent>
//!     <mc:Choice Requires="r">
//!       <oleObject progId="Word.Document.12" shapeId="1025" r:id="rId1">
//!         <objectPr defaultSize="0" autoPict="0">
//!           <anchor moveWithCells="1">
//!             <from><xdr:col>1</xdr:col><xdr:colOff>0</xdr:colOff>
//!                   <xdr:row>2</xdr:row><xdr:rowOff>0</xdr:rowOff></from>
//!             <to><xdr:col>5</xdr:col><xdr:colOff>0</xdr:colOff>
//!                 <xdr:row>10</xdr:row><xdr:rowOff>0</xdr:rowOff></to>
//!           </anchor>
//!         </objectPr>
//!       </oleObject>
//!     </mc:Choice>
//!   </mc:AlternateContent>
//! </oleObjects>
//! ```

// =============================================================================
// DvAspect
// =============================================================================

/// Display aspect for an OLE object (ECMA-376 ST_DvAspect, §18.18.23).
///
/// Determines whether the embedded object is displayed as its content or as an icon.
#[derive(
    Debug, Clone, Copy, Default, PartialEq, Eq, Hash, serde::Serialize, serde::Deserialize,
)]
pub enum DvAspect {
    /// Display the object's content.
    #[default]
    Content,
    /// Display the object as an icon.
    Icon,
}

impl DvAspect {
    /// Parse from an OOXML attribute value.
    #[must_use]
    pub fn from_ooxml(s: &str) -> Self {
        match s {
            "DVASPECT_ICON" => Self::Icon,
            _ => Self::Content,
        }
    }

    /// Serialize to the OOXML attribute value.
    #[must_use]
    pub fn to_ooxml(&self) -> &'static str {
        match self {
            Self::Content => "DVASPECT_CONTENT",
            Self::Icon => "DVASPECT_ICON",
        }
    }
}

// =============================================================================
// OleUpdate
// =============================================================================

/// Update mode for an OLE object (ECMA-376 ST_OleUpdate, §18.18.51).
///
/// Controls whether the linked object is updated automatically or on demand.
#[derive(
    Debug, Clone, Copy, Default, PartialEq, Eq, Hash, serde::Serialize, serde::Deserialize,
)]
pub enum OleUpdate {
    /// Automatically update the object.
    #[default]
    Always,
    /// Update the object only when requested.
    OnCall,
}

impl OleUpdate {
    /// Parse from an OOXML attribute value.
    #[must_use]
    pub fn from_ooxml(s: &str) -> Self {
        match s {
            "OLEUPDATE_ONCALL" => Self::OnCall,
            _ => Self::Always,
        }
    }

    /// Serialize to the OOXML attribute value.
    #[must_use]
    pub fn to_ooxml(&self) -> &'static str {
        match self {
            Self::Always => "OLEUPDATE_ALWAYS",
            Self::OnCall => "OLEUPDATE_ONCALL",
        }
    }
}

// =============================================================================
// CellAnchorPoint
// =============================================================================

/// A cell-based anchor point with sub-cell EMU offsets (used by CT_ObjectAnchor).
///
/// Represents the `<from>` or `<to>` element within an object anchor, specifying
/// a cell reference plus an EMU offset within that cell.
#[derive(
    Debug, Clone, Copy, Default, PartialEq, Eq, Hash, serde::Serialize, serde::Deserialize,
)]
pub struct CellAnchorPoint {
    /// Zero-based column index.
    pub col: u32,
    /// Column offset in EMUs from the left edge of the column.
    pub col_offset: i64,
    /// Zero-based row index.
    pub row: u32,
    /// Row offset in EMUs from the top edge of the row.
    pub row_offset: i64,
}

// =============================================================================
// ObjectAnchor
// =============================================================================

/// Anchor positioning for an OLE object (ECMA-376 CT_ObjectAnchor, §18.3.1.55).
///
/// Defines how the object is positioned relative to cells, using a two-cell
/// anchor (from/to) approach similar to drawing anchors.
#[derive(
    Debug, Clone, Copy, Default, PartialEq, Eq, Hash, serde::Serialize, serde::Deserialize,
)]
pub struct ObjectAnchor {
    /// Whether the object moves when cells are inserted/deleted. Default: `false`.
    pub move_with_cells: bool,
    /// Whether the object resizes when cells resize. Default: `false`.
    pub size_with_cells: bool,
    /// Top-left anchor cell and offset.
    pub from: CellAnchorPoint,
    /// Bottom-right anchor cell and offset.
    pub to: CellAnchorPoint,
}

// =============================================================================
// ObjectProperties
// =============================================================================

/// Properties for an embedded OLE object (ECMA-376 CT_ObjectPr, §18.3.1.56).
///
/// Controls visual and behavioral properties of the object within the worksheet.
#[derive(Debug, Clone, PartialEq, Eq, Hash, serde::Serialize, serde::Deserialize)]
pub struct ObjectProperties {
    /// Use default size for the object. Default: `true`.
    pub default_size: bool,
    /// Whether the object is printed. Default: `true`.
    pub print: bool,
    /// Whether the object is disabled (cannot be activated). Default: `false`.
    pub disabled: bool,
    /// Whether the object is locked when the sheet is protected. Default: `true`.
    pub locked: bool,
    /// Automatically fill the object area. Default: `true` (ECMA-376 §18.3.1.56).
    pub auto_fill: bool,
    /// Automatically set line formatting. Default: `true` (ECMA-376 §18.3.1.56).
    pub auto_line: bool,
    /// Automatically set picture formatting. Default: `true`.
    pub auto_pict: bool,
    /// Associated macro name, if any.
    pub r#macro: Option<String>,
    /// Alternative text for accessibility.
    pub alt_text: Option<String>,
    /// Whether this is a DDE (Dynamic Data Exchange) link. Default: `false`.
    pub dde: bool,
    /// Whether the object is shown only in the user interface (not printed/exported).
    /// Default: `false` (ECMA-376 §18.3.1.56).
    pub ui_object: bool,
    /// Relationship ID pointing to the image representation of the object.
    pub r_id: Option<String>,
    /// Anchor positioning for the object.
    pub anchor: Option<ObjectAnchor>,
}

impl Default for ObjectProperties {
    fn default() -> Self {
        Self {
            default_size: true,
            print: true,
            disabled: false,
            locked: true,
            auto_fill: true,
            auto_line: true,
            auto_pict: true,
            r#macro: None,
            alt_text: None,
            dde: false,
            ui_object: false,
            r_id: None,
            anchor: None,
        }
    }
}

// =============================================================================
// OleObject
// =============================================================================

/// An embedded OLE object (ECMA-376 CT_OleObject, §18.3.1.59).
///
/// Represents a single `<oleObject>` element within the worksheet's
/// `<oleObjects>` collection. The actual binary data is stored in a separate
/// part and referenced via `r_id`.
#[derive(Debug, Clone, PartialEq, Eq, Hash, serde::Serialize, serde::Deserialize, Default)]
pub struct OleObject {
    /// ProgID of the OLE server (e.g., `"Word.Document.12"`, `"Excel.Sheet.12"`).
    pub prog_id: Option<String>,
    /// Display aspect — content or icon.
    pub dv_aspect: DvAspect,
    /// Moniker for a linked (not embedded) object.
    pub link: Option<String>,
    /// Update policy for linked objects.
    pub ole_update: OleUpdate,
    /// Whether to automatically load the object when the workbook opens. Default: `false`.
    pub auto_load: bool,
    /// Shape ID linking this OLE object to its VML or DrawingML shape.
    pub shape_id: u32,
    /// Relationship ID (`r:id`) pointing to the embedded binary part.
    pub r_id: Option<String>,
    /// Optional extended object properties.
    pub object_pr: Option<ObjectProperties>,
}

// =============================================================================
// OleItem
// =============================================================================

/// A single OLE item within an OLE link (ECMA-376 CT_OleItem, §18.14.16).
///
/// Represents a named item (topic) exposed by an OLE/DDE server.
#[derive(Debug, Clone, PartialEq, Eq, Hash, serde::Serialize, serde::Deserialize, Default)]
pub struct OleItem {
    /// Name of the OLE item.
    pub name: String,
    /// Whether the item is displayed as an icon. Default: `false`.
    pub icon: bool,
    /// Whether DDE advise is active. Default: `false`.
    pub advise: bool,
    /// Prefer picture representation. Default: `false`.
    pub prefer_pic: bool,
}

// =============================================================================
// OleItems
// =============================================================================

/// Collection of OLE items (ECMA-376 CT_OleItems, §18.14.17).
///
/// Contains zero or more `OleItem` elements belonging to an OLE link.
#[derive(Debug, Clone, PartialEq, Eq, Hash, serde::Serialize, serde::Deserialize, Default)]
pub struct OleItems {
    /// The OLE items in this collection.
    pub ole_item: Vec<OleItem>,
}

// =============================================================================
// OleLink
// =============================================================================

/// An OLE link to an external object (ECMA-376 CT_OleLink, §18.14.18).
///
/// Represents a link to an external OLE server, identified by a relationship
/// ID and the ProgID of the server application.
#[derive(Debug, Clone, PartialEq, Eq, Hash, serde::Serialize, serde::Deserialize, Default)]
pub struct OleLink {
    /// Relationship ID for the OLE link target.
    pub r_id: String,
    /// ProgID of the OLE server (e.g., `"Word.Document.12"`).
    pub prog_id: String,
    /// OLE items in this link.
    pub ole_items: Option<OleItems>,
}

// =============================================================================
// Unit Tests
// =============================================================================

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_dv_aspect_from_ooxml() {
        assert_eq!(DvAspect::from_ooxml("DVASPECT_CONTENT"), DvAspect::Content);
        assert_eq!(DvAspect::from_ooxml("DVASPECT_ICON"), DvAspect::Icon);
        // Unknown values fall back to default
        assert_eq!(DvAspect::from_ooxml("unknown"), DvAspect::Content);
    }

    #[test]
    fn test_dv_aspect_to_ooxml() {
        assert_eq!(DvAspect::Content.to_ooxml(), "DVASPECT_CONTENT");
        assert_eq!(DvAspect::Icon.to_ooxml(), "DVASPECT_ICON");
    }

    #[test]
    fn test_dv_aspect_default() {
        assert_eq!(DvAspect::default(), DvAspect::Content);
    }

    #[test]
    fn test_ole_update_from_ooxml() {
        assert_eq!(OleUpdate::from_ooxml("OLEUPDATE_ALWAYS"), OleUpdate::Always);
        assert_eq!(OleUpdate::from_ooxml("OLEUPDATE_ONCALL"), OleUpdate::OnCall);
        // Unknown values fall back to default
        assert_eq!(OleUpdate::from_ooxml("unknown"), OleUpdate::Always);
    }

    #[test]
    fn test_ole_update_to_ooxml() {
        assert_eq!(OleUpdate::Always.to_ooxml(), "OLEUPDATE_ALWAYS");
        assert_eq!(OleUpdate::OnCall.to_ooxml(), "OLEUPDATE_ONCALL");
    }

    #[test]
    fn test_ole_update_default() {
        assert_eq!(OleUpdate::default(), OleUpdate::Always);
    }

    #[test]
    fn test_object_properties_default() {
        let props = ObjectProperties::default();
        assert!(props.default_size);
        assert!(props.print);
        assert!(!props.disabled);
        assert!(props.locked);
        assert!(props.auto_fill);
        assert!(props.auto_line);
        assert!(props.auto_pict);
        assert!(props.r#macro.is_none());
        assert!(props.alt_text.is_none());
        assert!(!props.dde);
        assert!(!props.ui_object);
        assert!(props.r_id.is_none());
        assert!(props.anchor.is_none());
    }

    #[test]
    fn test_ole_object_default() {
        let obj = OleObject::default();
        assert!(obj.prog_id.is_none());
        assert_eq!(obj.dv_aspect, DvAspect::Content);
        assert!(obj.link.is_none());
        assert_eq!(obj.ole_update, OleUpdate::Always);
        assert!(!obj.auto_load);
        assert_eq!(obj.shape_id, 0);
        assert!(obj.r_id.is_none());
        assert!(obj.object_pr.is_none());
    }

    #[test]
    fn test_ole_object_roundtrip() {
        let obj = OleObject {
            prog_id: Some("Word.Document.12".to_string()),
            dv_aspect: DvAspect::Icon,
            link: None,
            ole_update: OleUpdate::OnCall,
            auto_load: true,
            shape_id: 1025,
            r_id: Some("rId1".to_string()),
            object_pr: Some(ObjectProperties {
                default_size: false,
                auto_pict: false,
                anchor: Some(ObjectAnchor {
                    move_with_cells: true,
                    size_with_cells: false,
                    from: CellAnchorPoint {
                        col: 1,
                        col_offset: 0,
                        row: 2,
                        row_offset: 0,
                    },
                    to: CellAnchorPoint {
                        col: 5,
                        col_offset: 0,
                        row: 10,
                        row_offset: 0,
                    },
                }),
                ..ObjectProperties::default()
            }),
        };

        assert_eq!(obj.prog_id.as_deref(), Some("Word.Document.12"));
        assert_eq!(obj.dv_aspect, DvAspect::Icon);
        assert_eq!(obj.ole_update, OleUpdate::OnCall);
        assert!(obj.auto_load);
        assert_eq!(obj.shape_id, 1025);

        let anchor = obj.object_pr.as_ref().unwrap().anchor.as_ref().unwrap();
        assert!(anchor.move_with_cells);
        assert_eq!(anchor.from.col, 1);
        assert_eq!(anchor.to.row, 10);
    }

    #[test]
    fn test_dv_aspect_serde_roundtrip() {
        let original = DvAspect::Icon;
        let json = serde_json::to_string(&original).unwrap();
        let deserialized: DvAspect = serde_json::from_str(&json).unwrap();
        assert_eq!(original, deserialized);
    }

    #[test]
    fn test_ole_object_serde_roundtrip() {
        let original = OleObject {
            prog_id: Some("Excel.Sheet.12".to_string()),
            shape_id: 2048,
            r_id: Some("rId3".to_string()),
            ..OleObject::default()
        };
        let json = serde_json::to_string(&original).unwrap();
        let deserialized: OleObject = serde_json::from_str(&json).unwrap();
        assert_eq!(original, deserialized);
    }
}
