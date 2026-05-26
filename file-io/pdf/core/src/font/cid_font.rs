//! CIDFont + Type0 composite font builder.
use super::subset::SubsetResult;
use super::tounicode::build_tounicode_cmap;
use crate::document::PdfDocument;
use crate::types::*;

#[derive(Debug, Clone)]
pub struct CidFontObjects {
    pub type0_ref: PdfRef,
    pub font_name: String,
}

pub fn build_cid_font(
    doc: &mut PdfDocument,
    subset: &SubsetResult,
    font_name: &str,
) -> CidFontObjects {
    let base = format!("{}+{}", subset.subset_tag, font_name);

    // ToUnicode CMap
    let cmap_data = build_tounicode_cmap(&subset.codepoint_to_new_gid);
    let cmap_ref = doc.add_object(PdfValue::Stream(PdfStream::new(cmap_data)));

    // FontFile2 stream
    let mut ff2_dict = PdfDict::new();
    ff2_dict.set("Length1", PdfValue::Integer(subset.font_data.len() as i64));
    let ff2 = PdfStream::with_dict(subset.font_data.clone(), ff2_dict);
    let ff2_ref = doc.add_object(PdfValue::Stream(ff2));

    // FontDescriptor
    let m = &subset.metrics;
    let mut fd = PdfDict::new();
    fd.set("Type", PdfValue::name("FontDescriptor"));
    fd.set("FontName", PdfValue::name(&base));
    fd.set("Flags", PdfValue::Integer(m.flags as i64));
    fd.set(
        "FontBBox",
        PdfValue::Array(vec![
            PdfValue::Integer(m.bbox[0] as i64),
            PdfValue::Integer(m.bbox[1] as i64),
            PdfValue::Integer(m.bbox[2] as i64),
            PdfValue::Integer(m.bbox[3] as i64),
        ]),
    );
    fd.set("ItalicAngle", PdfValue::Real(m.italic_angle));
    fd.set("Ascent", PdfValue::Integer(m.ascent as i64));
    fd.set("Descent", PdfValue::Integer(m.descent as i64));
    fd.set("CapHeight", PdfValue::Integer(m.cap_height as i64));
    fd.set("StemV", PdfValue::Integer(m.stem_v as i64));
    fd.set("FontFile2", PdfValue::Ref(ff2_ref));
    let fd_ref = doc.add_object(PdfValue::Dict(fd));

    // W array (per-CID widths)
    let w_array = build_w_array(subset);

    // CIDSystemInfo
    let mut csi = PdfDict::new();
    csi.set("Registry", PdfValue::Str(b"Adobe".to_vec()));
    csi.set("Ordering", PdfValue::Str(b"Identity".to_vec()));
    csi.set("Supplement", PdfValue::Integer(0));

    // CIDFontType2
    let mut cid = PdfDict::new();
    cid.set("Type", PdfValue::name("Font"));
    cid.set("Subtype", PdfValue::name("CIDFontType2"));
    cid.set("BaseFont", PdfValue::name(&base));
    cid.set("CIDSystemInfo", PdfValue::Dict(csi));
    cid.set("FontDescriptor", PdfValue::Ref(fd_ref));
    cid.set("W", PdfValue::Array(w_array));
    cid.set("CIDToGIDMap", PdfValue::name("Identity"));
    let cid_ref = doc.add_object(PdfValue::Dict(cid));

    // Type0 font
    let mut t0 = PdfDict::new();
    t0.set("Type", PdfValue::name("Font"));
    t0.set("Subtype", PdfValue::name("Type0"));
    t0.set("BaseFont", PdfValue::name(&base));
    t0.set("Encoding", PdfValue::name("Identity-H"));
    t0.set(
        "DescendantFonts",
        PdfValue::Array(vec![PdfValue::Ref(cid_ref)]),
    );
    t0.set("ToUnicode", PdfValue::Ref(cmap_ref));
    let t0_ref = doc.add_object(PdfValue::Dict(t0));

    CidFontObjects {
        type0_ref: t0_ref,
        font_name: base,
    }
}

fn build_w_array(subset: &SubsetResult) -> Vec<PdfValue> {
    let mut w: Vec<PdfValue> = Vec::new();
    let upem = subset.metrics.units_per_em as f64;
    // Parse hmtx from subset font to get advance widths
    if let Ok(face) = ttf_parser::Face::parse(&subset.font_data, 0) {
        for &new_gid in subset.new_gid_to_old_gid.keys() {
            let gid = ttf_parser::GlyphId(new_gid);
            let adv = face.glyph_hor_advance(gid).unwrap_or(0) as f64;
            let width = (adv * 1000.0 / upem).round() as i64;
            w.push(PdfValue::Integer(new_gid as i64));
            w.push(PdfValue::Array(vec![PdfValue::Integer(width)]));
        }
    }
    w
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::font::subset::FontMetrics;
    use std::collections::BTreeMap;

    fn mock_subset() -> SubsetResult {
        SubsetResult {
            font_data: Vec::new(),
            codepoint_to_new_gid: {
                let mut m = BTreeMap::new();
                m.insert(0x41, 1u16);
                m.insert(0x42, 2);
                m
            },
            new_gid_to_old_gid: {
                let mut m = BTreeMap::new();
                m.insert(0u16, 0u16);
                m.insert(1, 36);
                m.insert(2, 37);
                m
            },
            subset_tag: "ABCDEF".to_string(),
            metrics: FontMetrics {
                units_per_em: 1000,
                ascent: 800,
                descent: -200,
                cap_height: 700,
                bbox: [-100, -200, 1000, 900],
                italic_angle: 0.0,
                stem_v: 80,
                flags: 32,
            },
        }
    }

    #[test]
    fn test_build_cid_font_creates_objects() {
        let mut doc = PdfDocument::new();
        let subset = mock_subset();
        let result = build_cid_font(&mut doc, &subset, "TestFont");
        assert_eq!(result.font_name, "ABCDEF+TestFont");
        assert!(result.type0_ref.obj_num > 0);
    }

    #[test]
    fn test_build_cid_font_object_hierarchy() {
        let mut doc = PdfDocument::new();
        let subset = mock_subset();
        let _result = build_cid_font(&mut doc, &subset, "Calibri");
        // The Type0 font should have been allocated
        assert!(doc.object_count() > 2); // more than catalog + pages
    }

    #[test]
    fn test_build_w_array_empty_font() {
        let subset = mock_subset();
        let w = build_w_array(&subset);
        // Empty font_data means no widths extracted
        assert!(w.is_empty());
    }
}
