//! OLE object contract.
//!
//! Owns worksheet `<oleObjects>` parsing, `objectPr`/anchor parsing, embedded
//! binary relationship resolution, VML preview-image enrichment, and binary
//! passthrough extraction.

use std::collections::HashMap;

use ooxml_types::ole::{CellAnchorPoint, DvAspect, ObjectAnchor, ObjectProperties, OleUpdate};

use super::anchors::{parse_child_element_i64, parse_child_element_u32};
use super::relationships;
use super::types::OleObject;
use super::vml;
use crate::infra::scanner::{find_closing_tag, find_gt_simd, find_tag_simd};
use crate::infra::xml::{
    MC_WORKSHEET_MARKUP_SUPPORTED_NAMESPACES, parse_bool_attr, parse_string_attr, parse_u32_attr,
    resolve_mc_alternate_content_with_namespace_context,
};
use crate::write::xml_writer::XmlWriter;

/// Namespace for markup compatibility.
const NS_MC: &str = "http://schemas.openxmlformats.org/markup-compatibility/2006";

/// Writer for OLE embedded objects in XLSX files.
#[derive(Debug)]
pub struct OleWriter {
    objects: Vec<OleObject>,
}

impl OleWriter {
    pub fn new(objects: Vec<OleObject>) -> Self {
        Self { objects }
    }

    pub fn objects(&self) -> &[OleObject] {
        &self.objects
    }

    pub fn is_empty(&self) -> bool {
        self.objects.is_empty()
    }

    pub fn len(&self) -> usize {
        self.objects.len()
    }

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

    pub fn register_content_types(
        ct: &mut crate::domain::content_types::write::ContentTypesManager,
        passthrough: &crate::infra::imported_parts::ImportedPackageParts,
    ) {
        use crate::infra::imported_parts::infer_content_type;
        use std::collections::HashSet;

        let mut registered_extensions: HashSet<String> = HashSet::new();

        for path in passthrough.paths() {
            let content_type = infer_content_type(path);
            ct.add_override(&format!("/{}", path), content_type);

            if let Some(ext_pos) = path.rfind('.') {
                let Some(ext) = path.get(ext_pos + 1..) else {
                    continue;
                };
                if !ext.is_empty() && registered_extensions.insert(ext.to_lowercase()) {
                    match ext.to_lowercase().as_str() {
                        "bin" => {
                            ct.add_default("bin", crate::infra::imported_parts::CT_OLE_OBJECT);
                        }
                        "emf" => {
                            ct.add_default("emf", "image/x-emf");
                        }
                        "wmf" => {
                            ct.add_default("wmf", "image/x-wmf");
                        }
                        _ => {}
                    }
                }
            }
        }
    }

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

pub fn ole_object_relationship_target(index: usize) -> String {
    format!("../embeddings/oleObject{}.bin", index)
}

pub fn ole_object_zip_path(index: usize) -> String {
    format!("xl/embeddings/oleObject{}.bin", index)
}

fn write_ole_object_entry(w: &mut XmlWriter, obj: &OleObject, r_id: &str) {
    w.start_element("mc:AlternateContent")
        .attr("xmlns:mc", NS_MC)
        .end_attrs();

    w.start_element("mc:Choice")
        .attr("Requires", "r")
        .end_attrs();

    w.start_element("oleObject");

    if !obj.prog_id.is_empty() {
        w.attr("progId", &obj.prog_id);
    }
    if obj.dv_aspect != DvAspect::Content {
        w.attr("dvAspect", obj.dv_aspect.to_ooxml());
    }
    if let Some(ref link) = obj.link_path {
        w.attr("link", link);
    }
    if obj.ole_update != OleUpdate::Always {
        w.attr("oleUpdate", obj.ole_update.to_ooxml());
    }
    if obj.auto_load {
        w.attr("autoLoad", "true");
    }

    w.attr_num("shapeId", obj.shape_id);
    w.attr("r:id", r_id);

    if let Some(ref object_pr) = obj.object_pr {
        w.end_attrs();
        write_object_pr(w, object_pr);
        w.end_element("oleObject");
    } else {
        w.self_close();
    }

    w.end_element("mc:Choice");
    w.start_element("mc:Fallback").end_attrs();
    w.end_element("mc:Fallback");
    w.end_element("mc:AlternateContent");
}

fn write_object_pr(w: &mut XmlWriter, props: &ObjectProperties) {
    w.start_element("objectPr");

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

    if let Some(ref anchor) = props.anchor {
        w.end_attrs();
        write_object_anchor(w, anchor);
        w.end_element("objectPr");
    } else {
        w.self_close();
    }
}

fn write_object_anchor(w: &mut XmlWriter, anchor: &ObjectAnchor) {
    w.start_element("anchor");
    if anchor.move_with_cells {
        w.attr("moveWithCells", "1");
    }
    if anchor.size_with_cells {
        w.attr("sizeWithCells", "1");
    }
    w.end_attrs();

    write_anchor_point(w, "from", &anchor.from);
    write_anchor_point(w, "to", &anchor.to);

    w.end_element("anchor");
}

fn write_anchor_point(w: &mut XmlWriter, tag: &str, point: &CellAnchorPoint) {
    w.start_element(tag).end_attrs();
    w.element_with_text("xdr:col", &point.col.to_string());
    w.element_with_text("xdr:colOff", &point.col_offset.to_string());
    w.element_with_text("xdr:row", &point.row.to_string());
    w.element_with_text("xdr:rowOff", &point.row_offset.to_string());
    w.end_element(tag);
}

// Slices use offsets from ASCII XML tag delimiters.
#[allow(clippy::string_slice)]
pub fn parse_ole_objects(xml: &[u8], objects: &mut Vec<OleObject>) {
    parse_ole_objects_with_context(xml, None, objects);
}

#[allow(clippy::string_slice)]
fn parse_ole_objects_with_context(
    xml: &[u8],
    containing_xml: Option<&[u8]>,
    objects: &mut Vec<OleObject>,
) {
    let resolved = resolve_mc_alternate_content_regions(xml, containing_xml);
    let mut pos = 0;

    while let Some(ole_start) = find_tag_simd(&resolved, b"oleObject", pos) {
        let element_tag_end = find_gt_simd(&resolved, ole_start)
            .map(|p| p + 1)
            .unwrap_or(resolved.len());
        let element = &resolved[ole_start..element_tag_end];

        let prog_id = parse_string_attr(element, b"progId=\"").unwrap_or_default();
        let shape_id = parse_u32_attr(element, b"shapeId=\"").unwrap_or(0);
        let mut ole_object = OleObject::new(prog_id, shape_id);

        ole_object.r_id = parse_string_attr(element, b"r:id=\"");
        ole_object.data_path = ole_object.r_id.clone();
        ole_object.link_path = parse_string_attr(element, b"link=\"");

        if let Some(dv) = parse_string_attr(element, b"dvAspect=\"") {
            ole_object.dv_aspect = DvAspect::from_ooxml(&dv);
        }
        if let Some(ou) = parse_string_attr(element, b"oleUpdate=\"") {
            ole_object.ole_update = OleUpdate::from_ooxml(&ou);
        }
        ole_object.auto_load = parse_bool_attr(element, b"autoLoad=\"");

        let is_self_closing = element_tag_end > 1 && resolved[element_tag_end - 2] == b'/';
        if !is_self_closing {
            let ole_close =
                find_closing_tag(&resolved, b"oleObject", ole_start).unwrap_or(element_tag_end);
            let ole_body = &resolved[element_tag_end..ole_close];
            ole_object.object_pr = parse_object_pr(ole_body);
            pos = ole_close + 1;
        } else {
            pos = element_tag_end;
        }

        objects.push(ole_object);
    }
}

// Slices use offsets from ASCII XML tag delimiters.
#[allow(clippy::string_slice)]
pub fn parse_ole_objects_for_sheet(
    archive: &crate::zip::XlsxArchive,
    sheet_num: usize,
    worksheet_xml: &[u8],
) -> Vec<crate::output::results::OleObjectOutput> {
    use crate::output::results::OleObjectOutput;

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

    let mut ole_objects: Vec<OleObject> = Vec::new();
    parse_ole_objects_with_context(ole_section, Some(worksheet_xml), &mut ole_objects);

    if ole_objects.is_empty() {
        return Vec::new();
    }

    let rels_path = format!("xl/worksheets/_rels/sheet{}.xml.rels", sheet_num);
    if let Ok(rels_xml) = archive.read_file(&rels_path) {
        enrich_ole_relationships(archive, sheet_num, &rels_xml, &mut ole_objects);
    }

    ole_objects
        .iter()
        .map(OleObjectOutput::from_ole_object)
        .collect()
}

pub fn extract_ole_binary_entries(
    archive: &crate::zip::XlsxArchive,
    ole_outputs: &[crate::output::results::OleObjectOutput],
    passthrough: &mut crate::infra::imported_parts::ImportedPackageParts,
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

fn enrich_ole_relationships(
    archive: &crate::zip::XlsxArchive,
    sheet_num: usize,
    rels_xml: &[u8],
    ole_objects: &mut [OleObject],
) {
    let relationships = relationships::parse_worksheet_relationships(sheet_num, rels_xml);

    for obj in ole_objects.iter_mut() {
        if let Some(r_id) = &obj.r_id {
            obj.data_path = None;
            if let Some((path, kind)) = relationships::ole_embedding_target(&relationships, r_id) {
                obj.data_path = Some(path.to_string());
                obj.embedding_kind = Some(kind.as_str().to_string());
                obj.embedding_content_type =
                    Some(crate::infra::imported_parts::infer_content_type(path).to_string());
            }
        }
    }

    for full_path in relationships::legacy_vml_drawing_targets(&relationships) {
        if let Ok(vml_xml) = archive.read_file(full_path) {
            let imagedata_map = vml::parse_vml_imagedata(&vml_xml);
            apply_vml_preview_rel_ids(&imagedata_map, ole_objects);
            resolve_vml_preview_paths(archive, full_path, ole_objects);
        }
    }
}

fn apply_vml_preview_rel_ids(
    imagedata_map: &HashMap<String, String>,
    ole_objects: &mut [OleObject],
) {
    for obj in ole_objects {
        for (vml_id, rel_id) in imagedata_map {
            if vml::extract_vml_shape_number(vml_id) == Some(obj.shape_id) {
                obj.preview_image_rel_id = Some(rel_id.clone());
            }
        }
    }
}

fn resolve_vml_preview_paths(
    archive: &crate::zip::XlsxArchive,
    vml_path: &str,
    ole_objects: &mut [OleObject],
) {
    let vml_rels_path = if let Some((dir, filename)) = vml_path.rsplit_once('/') {
        format!("{}/_rels/{}.rels", dir, filename)
    } else {
        format!("_rels/{}.rels", vml_path)
    };

    let Ok(vml_rels_xml) = archive.read_file(&vml_rels_path) else {
        return;
    };

    let relationships = relationships::parse_vml_drawing_relationships(vml_path, &vml_rels_xml);

    for obj in ole_objects {
        if let Some(rel_id) = &obj.preview_image_rel_id {
            obj.preview_image_path =
                relationships::vml_image_target(&relationships, rel_id).map(str::to_string);
        }
    }
}

// Slices use offsets from ASCII XML tag delimiters.
#[allow(clippy::string_slice)]
fn resolve_mc_alternate_content_regions(xml: &[u8], containing_xml: Option<&[u8]>) -> Vec<u8> {
    let mut result = Vec::with_capacity(xml.len());
    let mut pos = 0;

    while pos < xml.len() {
        if let Some(ac_start) = find_tag_simd(&xml[pos..], b"mc:AlternateContent", 0) {
            let abs_ac_start = pos + ac_start;
            result.extend_from_slice(&xml[pos..abs_ac_start]);

            let ac_close =
                find_closing_tag(xml, b"mc:AlternateContent", abs_ac_start).unwrap_or(xml.len());
            let ac_end = find_gt_simd(xml, ac_close)
                .map(|p| p + 1)
                .unwrap_or(ac_close);
            let ac_block = &xml[abs_ac_start..ac_end];

            if let Some(branch) = resolve_mc_alternate_content_with_namespace_context(
                ac_block,
                containing_xml,
                MC_WORKSHEET_MARKUP_SUPPORTED_NAMESPACES,
            ) {
                result.extend_from_slice(&ac_block[branch.start..branch.end]);
            }

            pos = ac_end;
        } else {
            result.extend_from_slice(&xml[pos..]);
            break;
        }
    }

    result
}

// Slices use offsets from ASCII XML tag delimiters.
#[allow(clippy::string_slice)]
fn parse_object_pr(ole_body: &[u8]) -> Option<ObjectProperties> {
    let pr_start = find_tag_simd(ole_body, b"objectPr", 0)?;
    let pr_tag_end = find_gt_simd(ole_body, pr_start)
        .map(|p| p + 1)
        .unwrap_or(ole_body.len());
    let pr_element = &ole_body[pr_start..pr_tag_end];

    let mut props = ObjectProperties::default();

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

    let is_self_closing = pr_tag_end > 1 && ole_body[pr_tag_end - 2] == b'/';
    if !is_self_closing {
        let pr_close = find_closing_tag(ole_body, b"objectPr", pr_start).unwrap_or(pr_tag_end);
        let pr_body = &ole_body[pr_tag_end..pr_close];
        props.anchor = parse_object_anchor(pr_body);
    }

    Some(props)
}

// Slices use offsets from ASCII XML tag delimiters.
#[allow(clippy::string_slice)]
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

    Some(ObjectAnchor {
        move_with_cells,
        size_with_cells,
        from: parse_anchor_point(anchor_body, b"from")?,
        to: parse_anchor_point(anchor_body, b"to")?,
    })
}

// Slices use offsets from ASCII XML tag delimiters.
#[allow(clippy::string_slice)]
fn parse_anchor_point(body: &[u8], tag: &[u8]) -> Option<CellAnchorPoint> {
    let start = find_tag_simd(body, tag, 0)?;
    let close = find_closing_tag(body, tag, start)?;
    let tag_end = find_gt_simd(body, start).map(|p| p + 1).unwrap_or(close);
    let inner = &body[tag_end..close];

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

#[cfg(test)]
mod tests {
    use super::*;
    use crate::write::zip_writer::{CompressionMethod, ZipWriter};
    use crate::zip::XlsxArchive;

    fn archive_with(entries: &[(&str, &[u8])]) -> Vec<u8> {
        let mut writer = ZipWriter::with_compression(CompressionMethod::Store);
        for (path, bytes) in entries {
            writer.add_file(path, bytes.to_vec());
        }
        writer.finish().expect("test zip should be valid")
    }

    #[test]
    fn sheet_ole_resolution_uses_typed_opc_relationships() {
        let worksheet_xml = br#"<worksheet xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">
            <oleObjects>
                <oleObject progId="Word.Document.12" shapeId="2049" r:id="rOle"/>
            </oleObjects>
        </worksheet>"#;
        let sheet_rels = br#"<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
            <Relationship Id="rOle" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/oleObject" Target="../embeddings/oleObject1.bin"/>
            <Relationship Id="rWrong" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/image" Target="../embeddings/wrong.bin"/>
        </Relationships>"#;
        let bytes = archive_with(&[
            ("xl/worksheets/_rels/sheet1.xml.rels", sheet_rels),
            ("xl/embeddings/oleObject1.bin", b"ole"),
        ]);
        let archive = XlsxArchive::new(&bytes).expect("archive");

        let outputs = parse_ole_objects_for_sheet(&archive, 1, worksheet_xml);

        assert_eq!(outputs.len(), 1);
        assert_eq!(
            outputs[0].data_path.as_deref(),
            Some("xl/embeddings/oleObject1.bin")
        );
    }

    #[test]
    fn sheet_ole_resolution_ignores_external_and_wrong_type_targets() {
        let worksheet_xml = br#"<worksheet xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">
            <oleObjects>
                <oleObject progId="Word.Document.12" shapeId="2049" r:id="rExternal"/>
                <oleObject progId="Word.Document.12" shapeId="2050" r:id="rImage"/>
            </oleObjects>
        </worksheet>"#;
        let sheet_rels = br#"<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
            <Relationship Id="rExternal" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/oleObject" TargetMode="External" Target="file:///tmp/oleObject1.bin"/>
            <Relationship Id="rImage" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/image" Target="../embeddings/notOle.bin"/>
        </Relationships>"#;
        let bytes = archive_with(&[("xl/worksheets/_rels/sheet1.xml.rels", sheet_rels)]);
        let archive = XlsxArchive::new(&bytes).expect("archive");

        let outputs = parse_ole_objects_for_sheet(&archive, 1, worksheet_xml);

        assert_eq!(outputs.len(), 2);
        assert!(outputs.iter().all(|obj| obj.data_path.is_none()));
    }

    #[test]
    fn vml_preview_resolution_uses_vml_relationship_owner() {
        let worksheet_xml = br#"<worksheet xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">
            <oleObjects>
                <oleObject progId="Word.Document.12" shapeId="2049" r:id="rOle"/>
            </oleObjects>
        </worksheet>"#;
        let sheet_rels = br#"<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
            <Relationship Id="rOle" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/oleObject" Target="../embeddings/oleObject1.bin"/>
            <Relationship Id="rVml" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/vmlDrawing" Target="../drawings/vmlDrawing1.vml"/>
        </Relationships>"#;
        let vml = br#"<xml xmlns:v="urn:schemas-microsoft-com:vml" xmlns:o="urn:schemas-microsoft-com:office:office">
            <v:shape id="_x0000_s2049"><v:imagedata o:relid="rPreview"/></v:shape>
        </xml>"#;
        let vml_rels = br#"<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
            <Relationship Id="rPreview" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/image" Target="../media/image1.emf"/>
        </Relationships>"#;
        let bytes = archive_with(&[
            ("xl/worksheets/_rels/sheet1.xml.rels", sheet_rels),
            ("xl/drawings/vmlDrawing1.vml", vml),
            ("xl/drawings/_rels/vmlDrawing1.vml.rels", vml_rels),
            ("xl/embeddings/oleObject1.bin", b"ole"),
            ("xl/media/image1.emf", b"image"),
        ]);
        let archive = XlsxArchive::new(&bytes).expect("archive");

        let outputs = parse_ole_objects_for_sheet(&archive, 1, worksheet_xml);

        assert_eq!(outputs.len(), 1);
        assert_eq!(outputs[0].preview_image_rel_id.as_deref(), Some("rPreview"));
        assert_eq!(
            outputs[0].preview_image_path.as_deref(),
            Some("xl/media/image1.emf")
        );
    }
}
