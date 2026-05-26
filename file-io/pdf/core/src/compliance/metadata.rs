//! Document metadata: XMP, bookmarks, and named destinations.
use crate::document::PdfDocument;
use crate::types::*;

/// Information for XMP metadata generation.
#[derive(Debug, Clone, Default)]
pub struct XmpInfo {
    pub title: Option<String>,
    pub author: Option<String>,
    pub subject: Option<String>,
    pub creator: Option<String>,
    pub producer: Option<String>,
    pub create_date: Option<String>,
    pub modify_date: Option<String>,
    pub pdfa_part: u32,
    pub pdfa_conformance: String,
}

/// A bookmark entry for the PDF outline tree.
#[derive(Debug, Clone)]
pub struct BookmarkEntry {
    pub title: String,
    pub page_index: usize,
    pub children: Vec<BookmarkEntry>,
}

impl BookmarkEntry {
    pub fn new(title: &str, page_index: usize) -> Self {
        Self {
            title: title.to_string(),
            page_index,
            children: Vec::new(),
        }
    }

    pub fn add_child(&mut self, child: BookmarkEntry) {
        self.children.push(child);
    }
}

fn xml_escape(s: &str) -> String {
    s.replace('&', "&amp;")
        .replace('<', "&lt;")
        .replace('>', "&gt;")
}

/// Build XMP metadata as a PDF stream object.
pub fn build_xmp_metadata(doc: &mut PdfDocument, info: &XmpInfo) -> PdfRef {
    let mut xmp = String::new();
    xmp.push_str("<?xpacket begin=\"\u{FEFF}\" id=\"W5M0MpCehiHzreSzNTczkc9d\"?>\n");
    xmp.push_str("<x:xmpmeta xmlns:x=\"adobe:ns:meta/\">\n");
    xmp.push_str("<rdf:RDF xmlns:rdf=\"http://www.w3.org/1999/02/22-rdf-syntax-ns#\">\n");
    xmp.push_str("<rdf:Description rdf:about=\"\"\n");
    xmp.push_str("  xmlns:dc=\"http://purl.org/dc/elements/1.1/\"\n");
    xmp.push_str("  xmlns:xmp=\"http://ns.adobe.com/xap/1.0/\"\n");
    xmp.push_str("  xmlns:pdf=\"http://ns.adobe.com/pdf/1.3/\"\n");
    xmp.push_str("  xmlns:pdfaid=\"http://www.aiim.org/pdfa/ns/id/\">\n");

    xmp.push_str("<pdfaid:part>");
    xmp.push_str(&info.pdfa_part.to_string());
    xmp.push_str("</pdfaid:part>\n");
    xmp.push_str("<pdfaid:conformance>");
    xmp.push_str(&xml_escape(&info.pdfa_conformance));
    xmp.push_str("</pdfaid:conformance>\n");

    if let Some(ref title) = info.title {
        xmp.push_str("<dc:title><rdf:Alt><rdf:li xml:lang=\"x-default\">");
        xmp.push_str(&xml_escape(title));
        xmp.push_str("</rdf:li></rdf:Alt></dc:title>\n");
    }
    if let Some(ref author) = info.author {
        xmp.push_str("<dc:creator><rdf:Seq><rdf:li>");
        xmp.push_str(&xml_escape(author));
        xmp.push_str("</rdf:li></rdf:Seq></dc:creator>\n");
    }
    if let Some(ref subject) = info.subject {
        xmp.push_str("<dc:description><rdf:Alt><rdf:li xml:lang=\"x-default\">");
        xmp.push_str(&xml_escape(subject));
        xmp.push_str("</rdf:li></rdf:Alt></dc:description>\n");
    }
    if let Some(ref creator) = info.creator {
        xmp.push_str("<xmp:CreatorTool>");
        xmp.push_str(&xml_escape(creator));
        xmp.push_str("</xmp:CreatorTool>\n");
    }
    if let Some(ref producer) = info.producer {
        xmp.push_str("<pdf:Producer>");
        xmp.push_str(&xml_escape(producer));
        xmp.push_str("</pdf:Producer>\n");
    }
    if let Some(ref cd) = info.create_date {
        xmp.push_str("<xmp:CreateDate>");
        xmp.push_str(cd);
        xmp.push_str("</xmp:CreateDate>\n");
    }
    if let Some(ref md) = info.modify_date {
        xmp.push_str("<xmp:ModifyDate>");
        xmp.push_str(md);
        xmp.push_str("</xmp:ModifyDate>\n");
    }
    xmp.push_str("</rdf:Description>\n");
    xmp.push_str("</rdf:RDF>\n");
    xmp.push_str("</x:xmpmeta>\n");
    xmp.push_str("<?xpacket end=\"w\"?>");

    let xmp_bytes = xmp.into_bytes();
    let mut stream_dict = PdfDict::new();
    stream_dict.set("Type", PdfValue::name("Metadata"));
    stream_dict.set("Subtype", PdfValue::name("XML"));
    stream_dict.set("Length", PdfValue::Integer(xmp_bytes.len() as i64));
    let stream = PdfStream::with_dict(xmp_bytes, stream_dict);
    doc.add_object(PdfValue::Stream(stream))
}

/// Build PDF bookmarks (outlines) from a list of entries.
pub fn build_bookmarks(
    doc: &mut PdfDocument,
    entries: &[BookmarkEntry],
    page_refs: &[PdfRef],
) -> PdfRef {
    let outlines_ref = doc.alloc_ref();
    if entries.is_empty() {
        let mut d = PdfDict::new();
        d.set("Type", PdfValue::name("Outlines"));
        d.set("Count", PdfValue::Integer(0));
        doc.set_object(outlines_ref, PdfValue::Dict(d));
        return outlines_ref;
    }

    let mut item_refs: Vec<PdfRef> = Vec::new();
    for _ in entries {
        item_refs.push(doc.alloc_ref());
    }

    let count = entries.len() as i64;
    for (i, entry) in entries.iter().enumerate() {
        let mut d = PdfDict::new();
        d.set("Title", PdfValue::text_string(&entry.title));
        d.set("Parent", PdfValue::Ref(outlines_ref));

        let page_ref = if entry.page_index < page_refs.len() {
            page_refs[entry.page_index]
        } else {
            page_refs[0]
        };
        d.set(
            "Dest",
            PdfValue::Array(vec![PdfValue::Ref(page_ref), PdfValue::name("Fit")]),
        );

        if i > 0 {
            d.set("Prev", PdfValue::Ref(item_refs[i - 1]));
        }
        if i + 1 < entries.len() {
            d.set("Next", PdfValue::Ref(item_refs[i + 1]));
        }

        doc.set_object(item_refs[i], PdfValue::Dict(d));
    }

    let mut outlines_dict = PdfDict::new();
    outlines_dict.set("Type", PdfValue::name("Outlines"));
    outlines_dict.set("First", PdfValue::Ref(item_refs[0]));
    outlines_dict.set("Last", PdfValue::Ref(*item_refs.last().unwrap()));
    outlines_dict.set("Count", PdfValue::Integer(count));
    doc.set_object(outlines_ref, PdfValue::Dict(outlines_dict));

    outlines_ref
}

/// Build named destinations dictionary.
pub fn build_named_destinations(
    doc: &mut PdfDocument,
    destinations: &[(String, PdfRef)],
) -> PdfRef {
    let mut names_array = Vec::new();
    let mut sorted: Vec<_> = destinations.to_vec();
    sorted.sort_by(|a, b| a.0.cmp(&b.0));
    for (name, page_ref) in &sorted {
        names_array.push(PdfValue::text_string(name));
        names_array.push(PdfValue::Array(vec![
            PdfValue::Ref(*page_ref),
            PdfValue::name("Fit"),
        ]));
    }

    let mut names_dict = PdfDict::new();
    names_dict.set("Names", PdfValue::Array(names_array));

    let mut dests_dict = PdfDict::new();
    dests_dict.set("Dests", PdfValue::Dict(names_dict));

    doc.add_object(PdfValue::Dict(dests_dict))
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::document::PdfDocument;

    #[test]
    fn test_xmp_info_default() {
        let info = XmpInfo::default();
        assert!(info.title.is_none());
        assert_eq!(info.pdfa_part, 0);
    }

    #[test]
    fn test_build_xmp_metadata() {
        let mut doc = PdfDocument::new();
        let info = XmpInfo {
            title: Some("Test".to_string()),
            author: Some("Author".to_string()),
            subject: Some("Subject".to_string()),
            creator: Some("Creator".to_string()),
            producer: Some("Producer".to_string()),
            create_date: Some("2024-01-01".to_string()),
            modify_date: Some("2024-01-01".to_string()),
            pdfa_part: 2,
            pdfa_conformance: "B".to_string(),
        };
        let xmp_ref = build_xmp_metadata(&mut doc, &info);
        let built = doc.build();
        let obj = built.objects.iter().find(|o| o.obj_ref == xmp_ref).unwrap();
        if let PdfValue::Stream(ref s) = obj.value {
            assert_eq!(s.dict.get_name("Type"), Some("Metadata"));
            assert_eq!(s.dict.get_name("Subtype"), Some("XML"));
            let text = String::from_utf8_lossy(&s.data);
            assert!(text.contains("pdfaid"));
            assert!(text.contains("Test"));
            assert!(text.contains("xpacket"));
        } else {
            panic!("Expected stream");
        }
    }

    #[test]
    fn test_build_xmp_metadata_minimal() {
        let mut doc = PdfDocument::new();
        let info = XmpInfo {
            pdfa_part: 2,
            pdfa_conformance: "B".to_string(),
            ..Default::default()
        };
        let xmp_ref = build_xmp_metadata(&mut doc, &info);
        let built = doc.build();
        let obj = built.objects.iter().find(|o| o.obj_ref == xmp_ref).unwrap();
        assert!(matches!(obj.value, PdfValue::Stream(_)));
    }

    #[test]
    fn test_bookmark_entry() {
        let mut parent = BookmarkEntry::new("Chapter 1", 0);
        parent.add_child(BookmarkEntry::new("Section 1.1", 1));
        assert_eq!(parent.children.len(), 1);
        assert_eq!(parent.title, "Chapter 1");
    }

    #[test]
    fn test_build_bookmarks_empty() {
        let mut doc = PdfDocument::new();
        let bm_ref = build_bookmarks(&mut doc, &[], &[]);
        let built = doc.build();
        let obj = built.objects.iter().find(|o| o.obj_ref == bm_ref).unwrap();
        if let PdfValue::Dict(ref d) = obj.value {
            assert_eq!(d.get_name("Type"), Some("Outlines"));
            assert_eq!(d.get_integer("Count"), Some(0));
        } else {
            panic!("Expected dict");
        }
    }

    #[test]
    fn test_build_bookmarks_with_entries() {
        let mut doc = PdfDocument::new();
        let p1 = doc.add_page(612.0, 792.0);
        let p1_ref = p1.page_ref;
        doc.finalize_page(p1, false);
        let p2 = doc.add_page(612.0, 792.0);
        let p2_ref = p2.page_ref;
        doc.finalize_page(p2, false);

        let entries = vec![
            BookmarkEntry::new("Page 1", 0),
            BookmarkEntry::new("Page 2", 1),
        ];
        let page_refs = vec![p1_ref, p2_ref];
        let bm_ref = build_bookmarks(&mut doc, &entries, &page_refs);
        let built = doc.build();

        let obj = built.objects.iter().find(|o| o.obj_ref == bm_ref).unwrap();
        if let PdfValue::Dict(ref d) = obj.value {
            assert_eq!(d.get_name("Type"), Some("Outlines"));
            assert_eq!(d.get_integer("Count"), Some(2));
            assert!(d.get_ref("First").is_some());
            assert!(d.get_ref("Last").is_some());
        } else {
            panic!("Expected dict");
        }
    }

    #[test]
    fn test_build_named_destinations() {
        let mut doc = PdfDocument::new();
        let p1 = doc.add_page(612.0, 792.0);
        let p1_ref = p1.page_ref;
        doc.finalize_page(p1, false);

        let dests = vec![
            ("sheet1".to_string(), p1_ref),
            ("alpha".to_string(), p1_ref),
        ];
        let nd_ref = build_named_destinations(&mut doc, &dests);
        let built = doc.build();
        let obj = built.objects.iter().find(|o| o.obj_ref == nd_ref).unwrap();
        if let PdfValue::Dict(ref d) = obj.value {
            let dests_dict = d.get_dict("Dests").unwrap();
            let names = dests_dict.get_array("Names").unwrap();
            assert_eq!(names.len(), 4);
            assert_eq!(names[0], PdfValue::text_string("alpha"));
            assert_eq!(names[2], PdfValue::text_string("sheet1"));
        } else {
            panic!("Expected dict");
        }
    }

    #[test]
    fn test_build_named_destinations_empty() {
        let mut doc = PdfDocument::new();
        let nd_ref = build_named_destinations(&mut doc, &[]);
        let built = doc.build();
        let obj = built.objects.iter().find(|o| o.obj_ref == nd_ref).unwrap();
        if let PdfValue::Dict(ref d) = obj.value {
            let dests_dict = d.get_dict("Dests").unwrap();
            let names = dests_dict.get_array("Names").unwrap();
            assert!(names.is_empty());
        } else {
            panic!("Expected dict");
        }
    }

    #[test]
    fn test_xml_escape() {
        assert_eq!(xml_escape("hello"), "hello");
        assert_eq!(xml_escape("a&b"), "a&amp;b");
    }
}
