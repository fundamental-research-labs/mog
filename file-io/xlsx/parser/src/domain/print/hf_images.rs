//! Header/footer image VML parsing and writing.
//!
//! Excel uses legacy VML (Vector Markup Language) to embed images in headers and footers.
//! Each image is a `v:shape` element with:
//! - `id`: position code (LH, CH, RH, LF, CF, RF)
//! - `o:relid`: relationship ID pointing to the image file
//! - `style`: dimensions (width/height in pt)
//! - `o:title`: descriptive title
//!
//! The VML file also contains boilerplate: a `shapelayout` with `idmap`, and
//! a `shapetype` definition (`_x0000_t75`) for image shapes.
//!
//! UTF-8 boundary guard: every `&s[n..]` / `&s[..n]` in this file slices VML
//! attribute content at byte offsets produced by ASCII-only XML
//! syntax (`<`, `>`, `"`, `=`, CSS `pt`/`;` delimiters). Char-boundary
//! by construction. File-scope allow documented here.

#![allow(clippy::string_slice)]

use crate::infra::scanner::find_attr_simd;

// ============================================================================
// Types
// ============================================================================

/// Position of a header/footer image in the page layout.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum HfImagePosition {
    LeftHeader,
    CenterHeader,
    RightHeader,
    LeftFooter,
    CenterFooter,
    RightFooter,
}

impl HfImagePosition {
    /// Parse from VML shape id attribute (e.g., "LF", "CH").
    pub fn from_vml_id(id: &str) -> Option<Self> {
        match id {
            "LH" => Some(Self::LeftHeader),
            "CH" => Some(Self::CenterHeader),
            "RH" => Some(Self::RightHeader),
            "LF" => Some(Self::LeftFooter),
            "CF" => Some(Self::CenterFooter),
            "RF" => Some(Self::RightFooter),
            _ => None,
        }
    }

    /// Convert to VML shape id string.
    pub fn to_vml_id(self) -> &'static str {
        match self {
            Self::LeftHeader => "LH",
            Self::CenterHeader => "CH",
            Self::RightHeader => "RH",
            Self::LeftFooter => "LF",
            Self::CenterFooter => "CF",
            Self::RightFooter => "RF",
        }
    }
}

/// A header/footer image parsed from a VML drawing.
#[derive(Debug, Clone)]
pub struct HeaderFooterImage {
    pub position: HfImagePosition,
    /// Relationship ID referencing the image file (e.g., "rId1").
    pub image_rel_id: String,
    /// Descriptive title (usually same as position code).
    pub title: String,
    /// Width in points.
    pub width_pt: f64,
    /// Height in points.
    pub height_pt: f64,
}

// ============================================================================
// Parsing
// ============================================================================

/// Parse header/footer images from VML XML bytes.
///
/// Extracts all `v:shape` elements that have a position-code `id` (LF, CH, etc.)
/// and an `o:relid` image reference.
pub fn parse_hf_images_from_vml(xml: &[u8]) -> Vec<HeaderFooterImage> {
    let mut images = Vec::new();
    let mut pos = 0;

    while pos < xml.len() {
        // Find next <v:shape
        let Some(shape_start) = memchr::memmem::find(&xml[pos..], b"<v:shape ") else {
            break;
        };
        let shape_start = pos + shape_start;

        // Find the end of the shape element (self-closing or </v:shape>)
        let shape_end = memchr::memmem::find(&xml[shape_start..], b"</v:shape>")
            .map(|p| shape_start + p + b"</v:shape>".len())
            .or_else(|| {
                // Self-closing <v:shape ... />
                memchr::memchr(b'>', &xml[shape_start..]).map(|p| shape_start + p + 1)
            })
            .unwrap_or(xml.len());

        let shape = &xml[shape_start..shape_end];

        // Extract id attribute
        if let Some(id) = extract_attr(shape, b"id=\"") {
            if let Some(position) = HfImagePosition::from_vml_id(id) {
                // Extract o:relid
                let rel_id = extract_attr(shape, b"o:relid=\"")
                    .unwrap_or("rId1")
                    .to_string();

                // Extract o:title
                let title = extract_attr(shape, b"o:title=\"")
                    .unwrap_or(position.to_vml_id())
                    .to_string();

                // Extract dimensions from style attribute
                let (width_pt, height_pt) = extract_dimensions(shape);

                images.push(HeaderFooterImage {
                    position,
                    image_rel_id: rel_id,
                    title,
                    width_pt,
                    height_pt,
                });
            }
        }

        pos = shape_end;
    }

    images
}

/// Extract a quoted attribute value from XML bytes.
fn extract_attr<'a>(xml: &'a [u8], attr_prefix: &[u8]) -> Option<&'a str> {
    let attr_pos = find_attr_simd(xml, attr_prefix, 0)?;
    let value_start = attr_pos + attr_prefix.len();
    let quote_end = memchr::memchr(b'"', &xml[value_start..])?;
    std::str::from_utf8(&xml[value_start..value_start + quote_end]).ok()
}

/// Extract width/height from VML style attribute (e.g., "...width:46pt;height:46pt;...").
fn extract_dimensions(shape: &[u8]) -> (f64, f64) {
    let style = extract_attr(shape, b"style=\"").unwrap_or("");
    let mut width = 46.0;
    let mut height = 46.0;

    for part in style.split(';') {
        let part = part.trim();
        if let Some(val) = part.strip_prefix("width:") {
            if let Some(pt_val) = val.strip_suffix("pt") {
                width = pt_val.parse().unwrap_or(46.0);
            }
        } else if let Some(val) = part.strip_prefix("height:") {
            if let Some(pt_val) = val.strip_suffix("pt") {
                height = pt_val.parse().unwrap_or(46.0);
            }
        }
    }

    (width, height)
}

// ============================================================================
// Writing
// ============================================================================

/// Generate VML XML for header/footer images.
///
/// Produces a complete VML document with the standard shapetype boilerplate
/// and one `v:shape` per image. The `idmap_data` controls the `o:idmap data`
/// attribute (Excel uses sheet-based numbering, typically `data="1"`).
/// The `spid_base` is the starting shape ID (e.g., 13313 for `_x0000_s13313`).
pub fn write_hf_images_vml(
    images: &[HeaderFooterImage],
    idmap_data: &str,
    spid_base: u32,
) -> Vec<u8> {
    let mut w = String::with_capacity(1200);

    w.push_str("<xml xmlns:v=\"urn:schemas-microsoft-com:vml\" xmlns:o=\"urn:schemas-microsoft-com:office:office\" xmlns:x=\"urn:schemas-microsoft-com:office:excel\">");

    // Shape layout
    w.push_str("<o:shapelayout v:ext=\"edit\">");
    w.push_str(&format!(
        "<o:idmap v:ext=\"edit\" data=\"{}\"/>",
        idmap_data
    ));
    w.push_str("</o:shapelayout>");

    // Standard image shapetype (_x0000_t75)
    w.push_str("<v:shapetype id=\"_x0000_t75\" coordsize=\"21600,21600\" o:spt=\"75\" o:preferrelative=\"t\" path=\"m@4@5l@4@11@9@11@9@5xe\" filled=\"f\" stroked=\"f\">");
    w.push_str("<v:stroke joinstyle=\"miter\"/>");
    w.push_str("<v:formulas>");
    w.push_str("<v:f eqn=\"if lineDrawn pixelLineWidth 0\"/>");
    w.push_str("<v:f eqn=\"sum @0 1 0\"/>");
    w.push_str("<v:f eqn=\"sum 0 0 @1\"/>");
    w.push_str("<v:f eqn=\"prod @2 1 2\"/>");
    w.push_str("<v:f eqn=\"prod @3 21600 pixelWidth\"/>");
    w.push_str("<v:f eqn=\"prod @3 21600 pixelHeight\"/>");
    w.push_str("<v:f eqn=\"sum @0 0 1\"/>");
    w.push_str("<v:f eqn=\"prod @6 1 2\"/>");
    w.push_str("<v:f eqn=\"prod @7 21600 pixelWidth\"/>");
    w.push_str("<v:f eqn=\"sum @8 21600 0\"/>");
    w.push_str("<v:f eqn=\"prod @7 21600 pixelHeight\"/>");
    w.push_str("<v:f eqn=\"sum @10 21600 0\"/>");
    w.push_str("</v:formulas>");
    w.push_str("<v:path o:extrusionok=\"f\" gradientshapeok=\"t\" o:connecttype=\"rect\"/>");
    w.push_str("<o:lock v:ext=\"edit\" aspectratio=\"t\"/>");
    w.push_str("</v:shapetype>");

    // Image shapes
    for (i, img) in images.iter().enumerate() {
        let spid = spid_base + i as u32;
        let vml_id = img.position.to_vml_id();
        w.push_str(&format!(
            "<v:shape id=\"{}\" o:spid=\"_x0000_s{}\" type=\"#_x0000_t75\" \
             style=\"position:absolute;margin-left:0;margin-top:0;width:{}pt;height:{}pt;z-index:{}\">",
            vml_id, spid, img.width_pt as u32, img.height_pt as u32, spid
        ));
        w.push_str(&format!(
            "<v:imagedata o:relid=\"{}\" o:title=\"{}\"/>",
            img.image_rel_id, img.title
        ));
        w.push_str("<o:lock v:ext=\"edit\" rotation=\"t\"/>");
        w.push_str("</v:shape>");
    }

    w.push_str("</xml>");
    w.into_bytes()
}

/// Generate VML .rels XML for header/footer images.
///
/// Each image needs a relationship mapping its `relid` to an image file path.
pub fn write_hf_images_vml_rels(
    _images: &[HeaderFooterImage],
    image_targets: &[(&str, &str)],
) -> Vec<u8> {
    let mut w = String::with_capacity(400);
    w.push_str("<?xml version=\"1.0\" encoding=\"UTF-8\" standalone=\"yes\"?>\n");
    w.push_str(
        "<Relationships xmlns=\"http://schemas.openxmlformats.org/package/2006/relationships\">",
    );

    for (rel_id, target) in image_targets {
        w.push_str(&format!(
            "<Relationship Id=\"{}\" Type=\"http://schemas.openxmlformats.org/officeDocument/2006/relationships/image\" Target=\"{}\"/>",
            rel_id, target
        ));
    }

    w.push_str("</Relationships>");
    w.into_bytes()
}

/// Parse image relationship targets from a VML .rels file.
///
/// Returns pairs of (relationship_id, target_path), e.g. `("rId1", "../media/image0.png")`.
pub fn parse_vml_rels_image_targets(rels_xml: &[u8]) -> Vec<(String, String)> {
    let mut targets = Vec::new();
    let xml = std::str::from_utf8(rels_xml).unwrap_or("");
    let mut pos = 0;
    while let Some(rel_start) = xml[pos..].find("<Relationship ") {
        let rel_start = pos + rel_start;
        let rel_end = xml[rel_start..].find("/>").unwrap_or(xml.len() - rel_start);
        let elem = &xml[rel_start..rel_start + rel_end + 2];

        let id = extract_xml_attr(elem, "Id=\"");
        let target = extract_xml_attr(elem, "Target=\"");

        if let (Some(id), Some(target)) = (id, target) {
            targets.push((id.to_string(), target.to_string()));
        }
        pos = rel_start + rel_end + 2;
    }
    targets
}

/// Extract a quoted attribute value from an XML string.
fn extract_xml_attr<'a>(xml: &'a str, attr_prefix: &str) -> Option<&'a str> {
    let start = xml.find(attr_prefix)? + attr_prefix.len();
    let end = start + xml[start..].find('"')?;
    Some(&xml[start..end])
}

/// Parsed header/footer VML data for a single sheet — ready for writing.
#[derive(Debug, Clone)]
pub struct ParsedHfVml {
    /// Parsed image shapes.
    pub images: Vec<HeaderFooterImage>,
    /// Image relationship targets from the .rels file: (rel_id, target_path).
    pub image_targets: Vec<(String, String)>,
    /// Original `o:idmap data` value for round-trip fidelity.
    pub idmap_data: String,
    /// Original spid base for round-trip fidelity.
    pub spid_base: u32,
    /// Original ZIP path for the VML file.
    pub vml_path: String,
    /// Original ZIP path for the .rels file (if any).
    pub rels_path: Option<String>,
}

/// Parse a full HF VML context from raw VML bytes and optional .rels bytes.
pub fn parse_hf_vml_context(
    vml_path: &str,
    vml_data: &[u8],
    rels_path: Option<&str>,
    rels_data: Option<&[u8]>,
) -> Option<ParsedHfVml> {
    let images = parse_hf_images_from_vml(vml_data);
    if images.is_empty() {
        return None;
    }

    // Extract idmap data
    let vml_str = std::str::from_utf8(vml_data).unwrap_or("");
    let idmap_data = extract_xml_attr(vml_str, "data=\"")
        .unwrap_or("1")
        .to_string();

    // Extract spid base from first shape
    let spid_base = extract_xml_attr(vml_str, "o:spid=\"_x0000_s")
        .and_then(|s| s.strip_suffix('"').unwrap_or(s).parse::<u32>().ok())
        .unwrap_or(1025);

    let image_targets = rels_data
        .map(|d| parse_vml_rels_image_targets(d))
        .unwrap_or_default();

    Some(ParsedHfVml {
        images,
        image_targets,
        idmap_data,
        spid_base,
        vml_path: vml_path.to_string(),
        rels_path: rels_path.map(|s| s.to_string()),
    })
}

// ============================================================================
// Tests
// ============================================================================

#[cfg(test)]
mod tests {
    use super::*;

    fn sample_vml() -> Vec<u8> {
        let mut s = String::new();
        s.push_str(r#"<xml xmlns:v="urn:schemas-microsoft-com:vml" xmlns:o="urn:schemas-microsoft-com:office:office" xmlns:x="urn:schemas-microsoft-com:office:excel">"#);
        s.push_str(
            r#"<o:shapelayout v:ext="edit"><o:idmap v:ext="edit" data="1"/></o:shapelayout>"#,
        );
        s.push_str(r#"<v:shapetype id="_x0000_t75" coordsize="21600,21600" o:spt="75" o:preferrelative="t" path="m@4@5l@4@11@9@11@9@5xe" filled="f" stroked="f">"#);
        s.push_str(r#"<v:stroke joinstyle="miter"/><v:formulas><v:f eqn="if lineDrawn pixelLineWidth 0"/></v:formulas>"#);
        s.push_str(r#"<v:path o:extrusionok="f" gradientshapeok="t" o:connecttype="rect"/><o:lock v:ext="edit" aspectratio="t"/></v:shapetype>"#);
        s.push_str(r##"<v:shape id="LF" o:spid="_x0000_s13313" type="#_x0000_t75" style="position:absolute;margin-left:0;margin-top:0;width:46pt;height:46pt;z-index:13313">"##);
        s.push_str(r#"<v:imagedata o:relid="rId1" o:title="LF"/><o:lock v:ext="edit" rotation="t"/></v:shape></xml>"#);
        s.into_bytes()
    }

    #[test]
    fn test_parse_single_lf_image() {
        let images = parse_hf_images_from_vml(&sample_vml());
        assert_eq!(images.len(), 1);
        assert_eq!(images[0].position, HfImagePosition::LeftFooter);
        assert_eq!(images[0].image_rel_id, "rId1");
        assert_eq!(images[0].title, "LF");
        assert_eq!(images[0].width_pt, 46.0);
        assert_eq!(images[0].height_pt, 46.0);
    }

    #[test]
    fn test_parse_no_hf_shapes() {
        // Comment VML — no HF position codes
        let vml = b"<xml><v:shape id=\"_x0000_s1\" type=\"#_x0000_t202\"><x:ClientData ObjectType=\"Note\"/></v:shape></xml>";
        let images = parse_hf_images_from_vml(vml);
        assert!(images.is_empty());
    }

    #[test]
    fn test_roundtrip_write_then_parse() {
        let images = vec![HeaderFooterImage {
            position: HfImagePosition::LeftFooter,
            image_rel_id: "rId1".to_string(),
            title: "LF".to_string(),
            width_pt: 46.0,
            height_pt: 46.0,
        }];
        let vml = write_hf_images_vml(&images, "1", 13313);
        let parsed = parse_hf_images_from_vml(&vml);
        assert_eq!(parsed.len(), 1);
        assert_eq!(parsed[0].position, HfImagePosition::LeftFooter);
        assert_eq!(parsed[0].image_rel_id, "rId1");
        assert_eq!(parsed[0].width_pt, 46.0);
    }

    #[test]
    fn test_write_rels() {
        let images = vec![HeaderFooterImage {
            position: HfImagePosition::LeftFooter,
            image_rel_id: "rId1".to_string(),
            title: "LF".to_string(),
            width_pt: 46.0,
            height_pt: 46.0,
        }];
        let targets = vec![("rId1", "../media/image0.png")];
        let rels = write_hf_images_vml_rels(&images, &targets);
        let rels_str = std::str::from_utf8(&rels).unwrap();
        assert!(rels_str.contains("rId1"));
        assert!(rels_str.contains("../media/image0.png"));
        assert!(rels_str.contains("/image\""));
    }

    #[test]
    fn test_position_roundtrip() {
        for pos in [
            HfImagePosition::LeftHeader,
            HfImagePosition::CenterHeader,
            HfImagePosition::RightHeader,
            HfImagePosition::LeftFooter,
            HfImagePosition::CenterFooter,
            HfImagePosition::RightFooter,
        ] {
            let id = pos.to_vml_id();
            assert_eq!(HfImagePosition::from_vml_id(id), Some(pos));
        }
    }
}
