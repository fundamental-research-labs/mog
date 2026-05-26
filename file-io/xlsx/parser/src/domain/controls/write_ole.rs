//! OLE objects writer for XLSX export.
//!
//! This module writes OLE embedded objects back to OOXML format during XLSX export,
//! producing:
//!
//! 1. **`<oleObjects>` block** in the worksheet XML — containing `<oleObject>` elements
//!    with full attributes (`progId`, `dvAspect`, `oleUpdate`, `autoLoad`, `shapeId`, `r:id`)
//!    and `<objectPr>` child elements with anchor positioning
//! 2. **Relationship entries** for the embedded binary parts
//! 3. **VML `<v:shape>` elements** for legacy rendering (legacy rendering)
//!
//! # OOXML OLE Object Structure
//!
//! OLE objects appear inside `<oleObjects>` in the worksheet part:
//! ```xml
//! <oleObjects>
//!   <mc:AlternateContent xmlns:mc="...">
//!     <mc:Choice Requires="r">
//!       <oleObject progId="Word.Document.12" dvAspect="DVASPECT_CONTENT"
//!                  oleUpdate="OLEUPDATE_ALWAYS" shapeId="1025" r:id="rId1">
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
//!     <mc:Fallback/>
//!   </mc:AlternateContent>
//! </oleObjects>
//! ```
//!
//! UTF-8 boundary guard: the single `&s[n..]` slice in this file splits an
//! OLE-object progId string at an ASCII-only delimiter. Char-boundary
//! by construction. File-scope allow documented here.

#![allow(clippy::string_slice)]

use crate::domain::controls::read::OleObject;
use crate::write::xml_writer::XmlWriter;
use ooxml_types::ole::{CellAnchorPoint, DvAspect, ObjectAnchor, ObjectProperties, OleUpdate};

// =============================================================================
// Constants
// =============================================================================

/// Namespace for markup compatibility
const NS_MC: &str = "http://schemas.openxmlformats.org/markup-compatibility/2006";

// =============================================================================
// OleWriter
// =============================================================================

/// Writer for OLE embedded objects in XLSX files.
///
/// Produces the `<oleObjects>` block for inclusion in the worksheet XML,
/// with each OLE object wrapped in `mc:AlternateContent` for compatibility.
#[derive(Debug)]
pub struct OleWriter {
    objects: Vec<OleObject>,
}

impl OleWriter {
    /// Create a new OLE writer with the given objects.
    pub fn new(objects: Vec<OleObject>) -> Self {
        Self { objects }
    }

    /// Get a reference to the OLE objects.
    pub fn objects(&self) -> &[OleObject] {
        &self.objects
    }

    /// Check if there are any OLE objects.
    pub fn is_empty(&self) -> bool {
        self.objects.is_empty()
    }

    /// Get the number of OLE objects.
    pub fn len(&self) -> usize {
        self.objects.len()
    }

    // =========================================================================
    // Worksheet XML: <oleObjects> block
    // =========================================================================

    /// Write the `<oleObjects>` block for the worksheet XML.
    ///
    /// Each OLE object is wrapped in `mc:AlternateContent` with the modern
    /// representation in `mc:Choice` and an empty `mc:Fallback`.
    ///
    /// # Arguments
    /// * `r_ids` - Relationship IDs for each OLE object's embedded binary part
    ///   (e.g., `["rId5", "rId6"]`). Must have the same length as `objects`.
    ///
    /// # Returns
    /// The XML fragment as bytes, suitable for insertion into the worksheet XML.
    pub fn write_ole_objects(&self, r_ids: &[String]) -> Vec<u8> {
        let mut w = XmlWriter::new();

        w.start_element("oleObjects").end_attrs();

        for (i, obj) in self.objects.iter().enumerate() {
            let r_id = &r_ids[i];
            write_ole_object_entry(&mut w, obj, r_id);
        }

        w.end_element("oleObjects");

        w.finish()
    }
}

// =============================================================================
// Individual oleObject XML generation
// =============================================================================

/// Write a single `<oleObject>` wrapped in `mc:AlternateContent`.
fn write_ole_object_entry(w: &mut XmlWriter, obj: &OleObject, r_id: &str) {
    // Outer mc:AlternateContent wrapper
    w.start_element("mc:AlternateContent")
        .attr("xmlns:mc", NS_MC)
        .end_attrs();

    w.start_element("mc:Choice")
        .attr("Requires", "r")
        .end_attrs();

    // <oleObject> with all attributes
    w.start_element("oleObject");

    // progId (optional but typical)
    if !obj.prog_id.is_empty() {
        w.attr("progId", &obj.prog_id);
    }

    // dvAspect — only write if non-default (Content)
    if obj.dv_aspect != DvAspect::Content {
        w.attr("dvAspect", obj.dv_aspect.to_ooxml());
    }

    // link (for linked objects)
    if let Some(ref link) = obj.link_path {
        w.attr("link", link);
    }

    // oleUpdate — only write if non-default (Always)
    if obj.ole_update != OleUpdate::Always {
        w.attr("oleUpdate", obj.ole_update.to_ooxml());
    }

    // autoLoad — only write if true
    if obj.auto_load {
        w.attr("autoLoad", "true");
    }

    // shapeId (required)
    w.attr_num("shapeId", obj.shape_id);

    // r:id (required for embedded objects)
    w.attr("r:id", r_id);

    // Check if we have objectPr to write
    if let Some(ref object_pr) = obj.object_pr {
        w.end_attrs();
        write_object_pr(w, object_pr);
        w.end_element("oleObject");
    } else {
        w.self_close();
    }

    w.end_element("mc:Choice");

    // Empty fallback for compatibility
    w.start_element("mc:Fallback").end_attrs();
    w.end_element("mc:Fallback");

    w.end_element("mc:AlternateContent");
}

/// Write the `<objectPr>` child element with all properties and anchor.
fn write_object_pr(w: &mut XmlWriter, props: &ObjectProperties) {
    w.start_element("objectPr");

    // Boolean attributes — write non-default values
    if !props.default_size {
        w.attr("defaultSize", "0");
    }
    if !props.print {
        w.attr("print", "0");
    }
    if props.disabled {
        w.attr("disabled", "1");
    }
    if !props.locked {
        w.attr("locked", "0");
    }
    if !props.auto_fill {
        w.attr("autoFill", "0");
    }
    if !props.auto_line {
        w.attr("autoLine", "0");
    }
    if !props.auto_pict {
        w.attr("autoPict", "0");
    }
    if let Some(ref macro_name) = props.r#macro {
        w.attr("macro", macro_name);
    }
    if let Some(ref alt_text) = props.alt_text {
        w.attr("altText", alt_text);
    }
    if props.dde {
        w.attr("dde", "1");
    }
    if props.ui_object {
        w.attr("uiObject", "1");
    }
    if let Some(ref r_id) = props.r_id {
        w.attr("r:id", r_id);
    }

    // Write anchor if present
    if let Some(ref anchor) = props.anchor {
        w.end_attrs();
        write_object_anchor(w, anchor);
        w.end_element("objectPr");
    } else {
        w.self_close();
    }
}

/// Write the `<anchor>` element with `<from>` and `<to>` children.
fn write_object_anchor(w: &mut XmlWriter, anchor: &ObjectAnchor) {
    w.start_element("anchor");
    if anchor.move_with_cells {
        w.attr("moveWithCells", "1");
    }
    if anchor.size_with_cells {
        w.attr("sizeWithCells", "1");
    }
    w.end_attrs();

    // <from>
    write_anchor_point(w, "from", &anchor.from);

    // <to>
    write_anchor_point(w, "to", &anchor.to);

    w.end_element("anchor");
}

/// Write a `<from>` or `<to>` anchor point element.
fn write_anchor_point(w: &mut XmlWriter, tag: &str, point: &CellAnchorPoint) {
    w.start_element(tag).end_attrs();
    w.element_with_text("xdr:col", &point.col.to_string());
    w.element_with_text("xdr:colOff", &point.col_offset.to_string());
    w.element_with_text("xdr:row", &point.row.to_string());
    w.element_with_text("xdr:rowOff", &point.row_offset.to_string());
    w.end_element(tag);
}

// =============================================================================
// Relationship Helpers
// =============================================================================

/// Generate a relationship target path for an OLE object binary part.
///
/// # Arguments
/// * `index` — 1-based OLE object index (oleObject1.bin, oleObject2.bin, etc.)
///
/// # Returns
/// The relative target path from the worksheet location, e.g., `"../embeddings/oleObject1.bin"`.
pub fn ole_object_relationship_target(index: usize) -> String {
    format!("../embeddings/oleObject{}.bin", index)
}

/// Generate the ZIP path for an OLE object binary part.
///
/// # Arguments
/// * `index` — 1-based OLE object index
///
/// # Returns
/// The full ZIP path, e.g., `"xl/embeddings/oleObject1.bin"`.
pub fn ole_object_zip_path(index: usize) -> String {
    format!("xl/embeddings/oleObject{}.bin", index)
}

// =============================================================================
// Content Types & Relationships Registration
// =============================================================================

impl OleWriter {
    /// Register content types for OLE binary parts and associated images.
    ///
    /// Adds override entries to `[Content_Types].xml` for each OLE binary
    /// part and also adds default extension mappings for common binary types.
    ///
    /// # Arguments
    /// * `ct` - The content types manager to register with
    /// * `passthrough` - The binary passthrough store containing the paths to register
    pub fn register_content_types(
        ct: &mut crate::domain::content_types::write::ContentTypesManager,
        passthrough: &crate::roundtrip::binary_passthrough::BinaryPassthrough,
    ) {
        use crate::roundtrip::binary_passthrough::infer_content_type;
        use std::collections::HashSet;

        let mut registered_extensions: HashSet<String> = HashSet::new();

        for path in passthrough.paths() {
            // Register the content type as an override for the specific path
            let content_type = infer_content_type(path);
            ct.add_override(&format!("/{}", path), content_type);

            // Also ensure the extension default is registered
            if let Some(ext_pos) = path.rfind('.') {
                let ext = &path[ext_pos + 1..];
                if !ext.is_empty() && registered_extensions.insert(ext.to_lowercase()) {
                    // Common binary extensions that need explicit defaults
                    match ext.to_lowercase().as_str() {
                        "bin" => {
                            ct.add_default(
                                "bin",
                                crate::roundtrip::binary_passthrough::CT_OLE_OBJECT,
                            );
                        }
                        "emf" => {
                            ct.add_default("emf", "image/x-emf");
                        }
                        "wmf" => {
                            ct.add_default("wmf", "image/x-wmf");
                        }
                        _ => {} // png, jpeg, gif usually already registered
                    }
                }
            }
        }
    }

    /// Add OLE object relationships to a sheet's RelationshipManager.
    ///
    /// For each OLE object, adds a relationship of type `REL_OLE_OBJECT`
    /// pointing to the embedded binary part.
    ///
    /// # Arguments
    /// * `rels` - The sheet's relationship manager
    /// * `ole_objects` - The OLE objects to register relationships for
    ///
    /// # Returns
    /// A vector of relationship IDs (one per OLE object), in the same order
    /// as the input objects.
    pub fn add_ole_relationships(
        rels: &mut crate::write::relationships::RelationshipManager,
        ole_objects: &[OleObject],
    ) -> Vec<String> {
        use crate::write::relationships::REL_OLE_OBJECT;

        ole_objects
            .iter()
            .enumerate()
            .map(|(i, _obj)| {
                let target = ole_object_relationship_target(i + 1);
                rels.add(REL_OLE_OBJECT, &target)
            })
            .collect()
    }
}

// =============================================================================
// Unit Tests
// =============================================================================

#[cfg(test)]
mod tests {
    use super::*;
    use crate::domain::controls::read::OleObject as ParserOleObject;

    fn make_basic_ole() -> ParserOleObject {
        let mut obj = ParserOleObject::new("Word.Document.12".to_string(), 1025);
        obj.r_id = Some("rId1".to_string());
        obj
    }

    fn make_full_ole() -> ParserOleObject {
        let mut obj = ParserOleObject::new("Excel.Sheet.12".to_string(), 1026);
        obj.r_id = Some("rId2".to_string());
        obj.dv_aspect = DvAspect::Icon;
        obj.ole_update = OleUpdate::OnCall;
        obj.auto_load = true;
        obj.object_pr = Some(ObjectProperties {
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
        });
        obj
    }

    // -------------------------------------------------------------------------
    // oleObjects XML tests
    // -------------------------------------------------------------------------

    #[test]
    fn test_write_basic_ole_object() {
        let writer = OleWriter::new(vec![make_basic_ole()]);
        let r_ids = vec!["rId5".to_string()];
        let xml = writer.write_ole_objects(&r_ids);
        let xml_str = String::from_utf8(xml).unwrap();

        assert!(xml_str.contains("<oleObjects>"));
        assert!(xml_str.contains("</oleObjects>"));
        assert!(xml_str.contains("mc:AlternateContent"));
        assert!(xml_str.contains("mc:Choice"));
        assert!(xml_str.contains("mc:Fallback"));
        assert!(xml_str.contains("progId=\"Word.Document.12\""));
        assert!(xml_str.contains("shapeId=\"1025\""));
        assert!(xml_str.contains("r:id=\"rId5\""));
        // Default dvAspect and oleUpdate should not be written
        assert!(!xml_str.contains("dvAspect="));
        assert!(!xml_str.contains("oleUpdate="));
        assert!(!xml_str.contains("autoLoad="));
    }

    #[test]
    fn test_write_full_ole_object() {
        let writer = OleWriter::new(vec![make_full_ole()]);
        let r_ids = vec!["rId6".to_string()];
        let xml = writer.write_ole_objects(&r_ids);
        let xml_str = String::from_utf8(xml).unwrap();

        assert!(xml_str.contains("progId=\"Excel.Sheet.12\""));
        assert!(xml_str.contains("dvAspect=\"DVASPECT_ICON\""));
        assert!(xml_str.contains("oleUpdate=\"OLEUPDATE_ONCALL\""));
        assert!(xml_str.contains("autoLoad=\"true\""));
        assert!(xml_str.contains("shapeId=\"1026\""));
        assert!(xml_str.contains("r:id=\"rId6\""));
    }

    #[test]
    fn test_write_object_pr() {
        let writer = OleWriter::new(vec![make_full_ole()]);
        let r_ids = vec!["rId6".to_string()];
        let xml = writer.write_ole_objects(&r_ids);
        let xml_str = String::from_utf8(xml).unwrap();

        assert!(xml_str.contains("<objectPr"));
        assert!(xml_str.contains("defaultSize=\"0\""));
        assert!(xml_str.contains("autoPict=\"0\""));
        assert!(xml_str.contains("<anchor"));
        assert!(xml_str.contains("moveWithCells=\"1\""));
        assert!(xml_str.contains("<xdr:col>1</xdr:col>"));
        assert!(xml_str.contains("<xdr:row>2</xdr:row>"));
        assert!(xml_str.contains("<xdr:col>5</xdr:col>"));
        assert!(xml_str.contains("<xdr:row>10</xdr:row>"));
    }

    #[test]
    fn test_write_multiple_ole_objects() {
        let writer = OleWriter::new(vec![make_basic_ole(), make_full_ole()]);
        let r_ids = vec!["rId5".to_string(), "rId6".to_string()];
        let xml = writer.write_ole_objects(&r_ids);
        let xml_str = String::from_utf8(xml).unwrap();

        assert!(xml_str.contains("Word.Document.12"));
        assert!(xml_str.contains("Excel.Sheet.12"));
        assert!(xml_str.contains("r:id=\"rId5\""));
        assert!(xml_str.contains("r:id=\"rId6\""));
    }

    #[test]
    fn test_write_empty_ole_objects() {
        let writer = OleWriter::new(vec![]);
        let r_ids: Vec<String> = vec![];
        let xml = writer.write_ole_objects(&r_ids);
        let xml_str = String::from_utf8(xml).unwrap();

        assert!(xml_str.contains("<oleObjects>"));
        assert!(xml_str.contains("</oleObjects>"));
        // No mc:AlternateContent when empty
        assert!(!xml_str.contains("mc:AlternateContent"));
    }

    // -------------------------------------------------------------------------
    // Writer utility tests
    // -------------------------------------------------------------------------

    #[test]
    fn test_writer_is_empty() {
        let writer = OleWriter::new(vec![]);
        assert!(writer.is_empty());
        assert_eq!(writer.len(), 0);

        let writer2 = OleWriter::new(vec![make_basic_ole()]);
        assert!(!writer2.is_empty());
        assert_eq!(writer2.len(), 1);
    }

    // -------------------------------------------------------------------------
    // Relationship helper tests
    // -------------------------------------------------------------------------

    #[test]
    fn test_ole_object_relationship_target() {
        assert_eq!(
            ole_object_relationship_target(1),
            "../embeddings/oleObject1.bin"
        );
        assert_eq!(
            ole_object_relationship_target(3),
            "../embeddings/oleObject3.bin"
        );
    }

    #[test]
    fn test_ole_object_zip_path() {
        assert_eq!(ole_object_zip_path(1), "xl/embeddings/oleObject1.bin");
        assert_eq!(ole_object_zip_path(5), "xl/embeddings/oleObject5.bin");
    }

    // -------------------------------------------------------------------------
    // Object properties edge cases
    // -------------------------------------------------------------------------

    #[test]
    fn test_write_ole_without_object_pr() {
        // OLE object with no objectPr should self-close
        let writer = OleWriter::new(vec![make_basic_ole()]);
        let r_ids = vec!["rId1".to_string()];
        let xml = writer.write_ole_objects(&r_ids);
        let xml_str = String::from_utf8(xml).unwrap();

        // Should not contain <objectPr
        assert!(!xml_str.contains("<objectPr"));
        assert!(!xml_str.contains("</objectPr>"));
    }

    #[test]
    fn test_write_object_pr_without_anchor() {
        let mut obj = make_basic_ole();
        obj.object_pr = Some(ObjectProperties {
            default_size: false,
            ..ObjectProperties::default()
        });

        let writer = OleWriter::new(vec![obj]);
        let r_ids = vec!["rId1".to_string()];
        let xml = writer.write_ole_objects(&r_ids);
        let xml_str = String::from_utf8(xml).unwrap();

        // objectPr should be present but self-closing (no anchor)
        assert!(xml_str.contains("objectPr"));
        assert!(xml_str.contains("defaultSize=\"0\""));
        assert!(!xml_str.contains("<anchor"));
    }

    #[test]
    fn test_write_ole_with_link() {
        let mut obj = make_basic_ole();
        obj.link_path = Some("file:///C:/Documents/test.docx".to_string());

        let writer = OleWriter::new(vec![obj]);
        let r_ids = vec!["rId1".to_string()];
        let xml = writer.write_ole_objects(&r_ids);
        let xml_str = String::from_utf8(xml).unwrap();

        assert!(xml_str.contains("link=\"file:///C:/Documents/test.docx\""));
    }

    // -------------------------------------------------------------------------
    // Content type registration tests
    // -------------------------------------------------------------------------

    #[test]
    fn test_register_content_types() {
        use crate::domain::content_types::write::ContentTypesManager;
        use crate::roundtrip::binary_passthrough::BinaryPassthrough;

        let mut pt = BinaryPassthrough::new();
        pt.record("xl/embeddings/oleObject1.bin".to_string(), vec![1, 2, 3]);
        pt.record("xl/media/image1.emf".to_string(), vec![4, 5, 6]);

        let mut ct = ContentTypesManager::with_xlsx_defaults();
        OleWriter::register_content_types(&mut ct, &pt);

        let xml = ct.to_xml();
        let xml_str = String::from_utf8(xml).unwrap();

        // Should have overrides for the specific paths
        assert!(xml_str.contains("/xl/embeddings/oleObject1.bin"));
        assert!(xml_str.contains("/xl/media/image1.emf"));
        // Should have extension defaults
        assert!(xml_str.contains("Extension=\"bin\""));
        assert!(xml_str.contains("Extension=\"emf\""));
    }

    // -------------------------------------------------------------------------
    // Relationship registration tests
    // -------------------------------------------------------------------------

    #[test]
    fn test_add_ole_relationships() {
        use crate::write::relationships::RelationshipManager;

        let mut rels = RelationshipManager::new();
        let objects = vec![make_basic_ole(), make_full_ole()];
        let r_ids = OleWriter::add_ole_relationships(&mut rels, &objects);

        assert_eq!(r_ids.len(), 2);
        assert_eq!(r_ids[0], "rId1");
        assert_eq!(r_ids[1], "rId2");
        assert_eq!(rels.len(), 2);

        let xml = rels.to_xml();
        let xml_str = String::from_utf8(xml).unwrap();
        assert!(xml_str.contains("oleObject1.bin"));
        assert!(xml_str.contains("oleObject2.bin"));
        assert!(xml_str.contains("oleObject"));
    }
}
