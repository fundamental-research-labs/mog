//! PDF document builder — manages object allocation, page tree, catalog, and info dict.
//!
//! The `PdfDocument` is the top-level container. It allocates indirect object numbers,
//! maintains the page tree, and produces the catalog and trailer needed for serialization.

use crate::content::ContentStreamBuilder;
use crate::resources::PageResources;
use crate::types::*;

/// A stored indirect object in the document.
#[derive(Debug, Clone)]
pub struct IndirectObject {
    pub obj_ref: PdfRef,
    pub value: PdfValue,
}

/// Metadata for a PDF page before it is finalized.
#[derive(Debug)]
pub struct PageBuilder {
    /// The indirect reference for this page object.
    pub page_ref: PdfRef,
    /// Page width in points (1 point = 1/72 inch).
    pub width: f64,
    /// Page height in points.
    pub height: f64,
    /// Content operations for this page.
    pub content_ops: Vec<crate::content::ContentOp>,
    /// Resource tracking for this page.
    pub resources: PageResources,
}

/// The main PDF document builder.
#[derive(Debug)]
pub struct PdfDocument {
    /// All indirect objects, keyed by object number.
    objects: Vec<Option<PdfValue>>,
    /// Next available object number (starts at 1; 0 is reserved for the free list head).
    next_obj_num: u32,
    /// Page references in order.
    page_refs: Vec<PdfRef>,
    /// Page data (width, height, content ref, resources).
    pages: Vec<PageData>,
    /// The catalog object reference.
    catalog_ref: PdfRef,
    /// The pages tree root reference.
    pages_root_ref: PdfRef,
    /// Optional info dictionary reference.
    info_ref: Option<PdfRef>,
    /// Document metadata.
    info: DocumentInfo,
}

/// Finalized page data.
#[derive(Debug, Clone)]
struct PageData {
    page_ref: PdfRef,
    width: f64,
    height: f64,
    content_ref: Option<PdfRef>,
    resources: PdfDict,
}

/// Document metadata (for the /Info dictionary).
#[derive(Debug, Clone, Default)]
pub struct DocumentInfo {
    pub title: Option<String>,
    pub author: Option<String>,
    pub subject: Option<String>,
    pub keywords: Option<String>,
    pub creator: Option<String>,
    pub producer: Option<String>,
}

/// Maximum children per /Pages node for balanced page trees.
const MAX_PAGES_PER_NODE: usize = 40;

impl PdfDocument {
    /// Create a new empty PDF document.
    pub fn new() -> Self {
        // Reserve object 0 (free list head) by skipping it.
        // Object numbering starts at 1.
        let mut doc = Self {
            objects: Vec::new(),
            next_obj_num: 1,
            page_refs: Vec::new(),
            pages: Vec::new(),
            catalog_ref: PdfRef::new(0, 0),    // placeholder
            pages_root_ref: PdfRef::new(0, 0), // placeholder
            info_ref: None,
            info: DocumentInfo::default(),
        };

        // Pre-allocate catalog and pages root.
        doc.catalog_ref = doc.alloc_ref();
        doc.pages_root_ref = doc.alloc_ref();

        doc
    }

    /// Allocate a new indirect object reference. The object value can be set later.
    pub fn alloc_ref(&mut self) -> PdfRef {
        let obj_num = self.next_obj_num;
        self.next_obj_num += 1;
        // Ensure the objects vec is large enough.
        while self.objects.len() < obj_num as usize {
            self.objects.push(None);
        }
        PdfRef::new(obj_num, 0)
    }

    /// Store a value for a previously allocated reference.
    pub fn set_object(&mut self, obj_ref: PdfRef, value: PdfValue) {
        let idx = obj_ref.obj_num as usize - 1;
        if idx >= self.objects.len() {
            self.objects.resize_with(idx + 1, || None);
        }
        self.objects[idx] = Some(value);
    }

    /// Allocate a new indirect object and store its value. Returns the reference.
    pub fn add_object(&mut self, value: PdfValue) -> PdfRef {
        let r = self.alloc_ref();
        self.set_object(r, value);
        r
    }

    /// Set document metadata.
    pub fn set_info(&mut self, info: DocumentInfo) {
        self.info = info;
    }

    /// Add a page and return a PageBuilder for configuring it.
    /// The page is not finalized until `finalize_page` is called.
    pub fn add_page(&mut self, width: f64, height: f64) -> PageBuilder {
        let page_ref = self.alloc_ref();
        PageBuilder {
            page_ref,
            width,
            height,
            content_ops: Vec::new(),
            resources: PageResources::new(),
        }
    }

    /// Finalize a page: serialize content ops into a stream, build resource dict,
    /// and register the page in the document.
    pub fn finalize_page(&mut self, page: PageBuilder, compress: bool) {
        let content_ref = if page.content_ops.is_empty() {
            None
        } else {
            let stream_bytes = ContentStreamBuilder::new(&page.content_ops).build();
            let stream = if compress {
                match crate::compression::compress(&stream_bytes, 6) {
                    Ok(compressed) => {
                        let mut dict = PdfDict::new();
                        dict.set("Filter", PdfValue::name("FlateDecode"));
                        PdfStream::with_dict(compressed, dict)
                    }
                    Err(_) => {
                        // Compression failed; fall back to uncompressed stream.
                        PdfStream::new(stream_bytes)
                    }
                }
            } else {
                PdfStream::new(stream_bytes)
            };
            Some(self.add_object(PdfValue::Stream(stream)))
        };

        let resources_dict = page.resources.to_pdf_dict();

        let page_data = PageData {
            page_ref: page.page_ref,
            width: page.width,
            height: page.height,
            content_ref,
            resources: resources_dict,
        };

        self.page_refs.push(page.page_ref);
        self.pages.push(page_data);
    }

    /// The catalog (root) reference.
    pub fn catalog_ref(&self) -> PdfRef {
        self.catalog_ref
    }

    /// Total number of allocated objects (excluding object 0).
    pub fn object_count(&self) -> u32 {
        self.next_obj_num - 1
    }

    /// Build all document-level objects (catalog, page tree, info dict) and return
    /// the complete list of indirect objects for serialization.
    pub fn build(mut self) -> BuiltDocument {
        // Build info dict if any metadata is set.
        let info_ref = if self.info.title.is_some()
            || self.info.author.is_some()
            || self.info.subject.is_some()
            || self.info.creator.is_some()
            || self.info.producer.is_some()
        {
            let mut info = PdfDict::new();
            if let Some(ref t) = self.info.title {
                info.set("Title", PdfValue::text_string(t));
            }
            if let Some(ref a) = self.info.author {
                info.set("Author", PdfValue::text_string(a));
            }
            if let Some(ref s) = self.info.subject {
                info.set("Subject", PdfValue::text_string(s));
            }
            if let Some(ref k) = self.info.keywords {
                info.set("Keywords", PdfValue::text_string(k));
            }
            if let Some(ref c) = self.info.creator {
                info.set("Creator", PdfValue::text_string(c));
            }
            if let Some(ref p) = self.info.producer {
                info.set("Producer", PdfValue::text_string(p));
            }
            let r = self.add_object(PdfValue::Dict(info));
            self.info_ref = Some(r);
            Some(r)
        } else {
            None
        };

        // Build balanced page tree.
        self.build_page_tree();

        // Build catalog.
        let mut catalog = PdfDict::new();
        catalog.set("Type", PdfValue::name("Catalog"));
        catalog.set("Pages", PdfValue::Ref(self.pages_root_ref));
        self.set_object(self.catalog_ref, PdfValue::Dict(catalog));

        // Collect all objects.
        let mut objects = Vec::new();
        for (i, obj) in self.objects.into_iter().enumerate() {
            if let Some(value) = obj {
                let obj_num = (i + 1) as u32;
                objects.push(IndirectObject {
                    obj_ref: PdfRef::new(obj_num, 0),
                    value,
                });
            }
        }

        BuiltDocument {
            objects,
            catalog_ref: self.catalog_ref,
            info_ref,
            page_count: self.page_refs.len(),
        }
    }

    /// Build the page tree (possibly balanced for large documents).
    fn build_page_tree(&mut self) {
        let num_pages = self.pages.len();

        if num_pages <= MAX_PAGES_PER_NODE {
            // Simple flat page tree.
            self.build_flat_page_tree();
        } else {
            // Balanced page tree with intermediate nodes.
            self.build_balanced_page_tree();
        }
    }

    /// Build a flat page tree (all pages are direct children of root).
    fn build_flat_page_tree(&mut self) {
        let mut kids = Vec::new();
        let pages_root_ref = self.pages_root_ref;
        let num_pages = self.pages.len();

        // Collect lightweight page info to avoid cloning the entire pages Vec.
        // Only resources (PdfDict) requires a clone; the rest are Copy types.
        let page_info: Vec<(PdfRef, f64, f64, Option<PdfRef>, PdfDict)> = self
            .pages
            .iter()
            .map(|p| {
                (
                    p.page_ref,
                    p.width,
                    p.height,
                    p.content_ref,
                    p.resources.clone(),
                )
            })
            .collect();

        for (page_ref, width, height, content_ref, resources) in &page_info {
            let mut page_dict = PdfDict::new();
            page_dict.set("Type", PdfValue::name("Page"));
            page_dict.set("Parent", PdfValue::Ref(pages_root_ref));
            page_dict.set(
                "MediaBox",
                PdfValue::Array(vec![
                    PdfValue::Integer(0),
                    PdfValue::Integer(0),
                    PdfValue::Real(*width),
                    PdfValue::Real(*height),
                ]),
            );

            if let Some(cref) = content_ref {
                page_dict.set("Contents", PdfValue::Ref(*cref));
            }

            if !resources.is_empty() {
                page_dict.set("Resources", PdfValue::Dict(resources.clone()));
            }

            self.set_object(*page_ref, PdfValue::Dict(page_dict));
            kids.push(PdfValue::Ref(*page_ref));
        }

        let mut pages_root = PdfDict::new();
        pages_root.set("Type", PdfValue::name("Pages"));
        pages_root.set("Kids", PdfValue::Array(kids));
        pages_root.set("Count", PdfValue::Integer(num_pages as i64));
        self.set_object(pages_root_ref, PdfValue::Dict(pages_root));
    }

    /// Build a balanced page tree for large documents (>MAX_PAGES_PER_NODE pages).
    /// Creates intermediate /Pages nodes with up to MAX_PAGES_PER_NODE children each.
    fn build_balanced_page_tree(&mut self) {
        let num_pages = self.pages.len();

        // Collect lightweight page info to avoid cloning the entire pages Vec.
        let page_info: Vec<(PdfRef, f64, f64, Option<PdfRef>, PdfDict)> = self
            .pages
            .iter()
            .map(|p| {
                (
                    p.page_ref,
                    p.width,
                    p.height,
                    p.content_ref,
                    p.resources.clone(),
                )
            })
            .collect();
        let chunks: Vec<&[(PdfRef, f64, f64, Option<PdfRef>, PdfDict)]> =
            page_info.chunks(MAX_PAGES_PER_NODE).collect();

        // Create intermediate /Pages nodes.
        let mut intermediate_refs = Vec::new();

        for chunk in &chunks {
            let intermediate_ref = self.alloc_ref();
            let mut kids = Vec::new();

            for (page_ref, width, height, content_ref, resources) in *chunk {
                let mut page_dict = PdfDict::new();
                page_dict.set("Type", PdfValue::name("Page"));
                page_dict.set("Parent", PdfValue::Ref(intermediate_ref));
                page_dict.set(
                    "MediaBox",
                    PdfValue::Array(vec![
                        PdfValue::Integer(0),
                        PdfValue::Integer(0),
                        PdfValue::Real(*width),
                        PdfValue::Real(*height),
                    ]),
                );

                if let Some(cref) = content_ref {
                    page_dict.set("Contents", PdfValue::Ref(*cref));
                }

                if !resources.is_empty() {
                    page_dict.set("Resources", PdfValue::Dict(resources.clone()));
                }

                self.set_object(*page_ref, PdfValue::Dict(page_dict));
                kids.push(PdfValue::Ref(*page_ref));
            }

            let mut intermediate_dict = PdfDict::new();
            intermediate_dict.set("Type", PdfValue::name("Pages"));
            intermediate_dict.set("Parent", PdfValue::Ref(self.pages_root_ref));
            intermediate_dict.set("Kids", PdfValue::Array(kids));
            intermediate_dict.set("Count", PdfValue::Integer(chunk.len() as i64));
            self.set_object(intermediate_ref, PdfValue::Dict(intermediate_dict));

            intermediate_refs.push(PdfValue::Ref(intermediate_ref));
        }

        // Root /Pages node.
        let mut pages_root = PdfDict::new();
        pages_root.set("Type", PdfValue::name("Pages"));
        pages_root.set("Kids", PdfValue::Array(intermediate_refs));
        pages_root.set("Count", PdfValue::Integer(num_pages as i64));
        self.set_object(self.pages_root_ref, PdfValue::Dict(pages_root));
    }
}

impl Default for PdfDocument {
    fn default() -> Self {
        Self::new()
    }
}

/// The result of `PdfDocument::build()` — everything the serializer needs.
#[derive(Debug)]
pub struct BuiltDocument {
    /// All indirect objects in the document.
    pub objects: Vec<IndirectObject>,
    /// Reference to the catalog (root) object.
    pub catalog_ref: PdfRef,
    /// Optional reference to the /Info dictionary.
    pub info_ref: Option<PdfRef>,
    /// Total number of pages.
    pub page_count: usize,
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_alloc_ref_sequential() {
        let mut doc = PdfDocument::new();
        // The first two refs are pre-allocated (catalog + pages root).
        // catalog_ref = 1, pages_root_ref = 2
        let r3 = doc.alloc_ref();
        let r4 = doc.alloc_ref();
        assert_eq!(r3.obj_num, 3);
        assert_eq!(r4.obj_num, 4);
        assert_eq!(r3.gen_num, 0);
    }

    #[test]
    fn test_add_object() {
        let mut doc = PdfDocument::new();
        let r = doc.add_object(PdfValue::Integer(42));
        assert!(r.obj_num >= 3); // after catalog and pages root
    }

    #[test]
    fn test_empty_document_builds() {
        let doc = PdfDocument::new();
        let built = doc.build();

        assert_eq!(built.page_count, 0);
        assert!(built.info_ref.is_none());
        assert!(!built.objects.is_empty());

        // Should have catalog and pages root.
        let catalog = built
            .objects
            .iter()
            .find(|o| o.obj_ref == built.catalog_ref);
        assert!(catalog.is_some());
    }

    #[test]
    fn test_single_page_document() {
        let mut doc = PdfDocument::new();
        let page = doc.add_page(612.0, 792.0); // US Letter
        doc.finalize_page(page, false);

        let built = doc.build();
        assert_eq!(built.page_count, 1);

        // Find catalog and verify it points to pages.
        let catalog_obj = built
            .objects
            .iter()
            .find(|o| o.obj_ref == built.catalog_ref)
            .unwrap();
        if let PdfValue::Dict(ref d) = catalog_obj.value {
            assert_eq!(d.get_name("Type"), Some("Catalog"));
            assert!(d.get_ref("Pages").is_some());
        } else {
            panic!("Catalog should be a dict");
        }
    }

    #[test]
    fn test_document_with_info() {
        let mut doc = PdfDocument::new();
        doc.set_info(DocumentInfo {
            title: Some("Test Document".to_string()),
            author: Some("Test Author".to_string()),
            subject: None,
            keywords: None,
            creator: Some("pdf-core".to_string()),
            producer: Some("pdf-core 0.1.0".to_string()),
        });

        let page = doc.add_page(612.0, 792.0);
        doc.finalize_page(page, false);

        let built = doc.build();
        assert!(built.info_ref.is_some());

        let info_obj = built
            .objects
            .iter()
            .find(|o| o.obj_ref == built.info_ref.unwrap())
            .unwrap();
        if let PdfValue::Dict(ref d) = info_obj.value {
            assert_eq!(d.get_str("Title"), Some(b"Test Document".as_ref()));
            assert_eq!(d.get_str("Author"), Some(b"Test Author".as_ref()));
        } else {
            panic!("Info should be a dict");
        }
    }

    #[test]
    fn test_multiple_pages() {
        let mut doc = PdfDocument::new();
        for _ in 0..5 {
            let page = doc.add_page(612.0, 792.0);
            doc.finalize_page(page, false);
        }

        let built = doc.build();
        assert_eq!(built.page_count, 5);
    }

    #[test]
    fn test_balanced_page_tree() {
        let mut doc = PdfDocument::new();
        // Create 100 pages to trigger balanced tree.
        for _ in 0..100 {
            let page = doc.add_page(612.0, 792.0);
            doc.finalize_page(page, false);
        }

        let built = doc.build();
        assert_eq!(built.page_count, 100);

        // The pages root should have intermediate children, not 100 direct page refs.
        let pages_root_ref = {
            let catalog = built
                .objects
                .iter()
                .find(|o| o.obj_ref == built.catalog_ref)
                .unwrap();
            if let PdfValue::Dict(ref d) = catalog.value {
                d.get_ref("Pages").unwrap()
            } else {
                panic!("Catalog should be dict");
            }
        };

        let pages_root = built
            .objects
            .iter()
            .find(|o| o.obj_ref == pages_root_ref)
            .unwrap();
        if let PdfValue::Dict(ref d) = pages_root.value {
            assert_eq!(d.get_integer("Count"), Some(100));
            let kids = d.get_array("Kids").unwrap();
            // Should have 3 intermediate nodes (100/40 = 2.5, so 3 nodes).
            assert_eq!(kids.len(), 3);
        } else {
            panic!("Pages root should be dict");
        }
    }

    #[test]
    fn test_page_with_content() {
        use crate::content::ContentOp;

        let mut doc = PdfDocument::new();
        let mut page = doc.add_page(612.0, 792.0);
        page.content_ops.push(ContentOp::BeginText);
        page.content_ops
            .push(ContentOp::SetFont(PdfName::new("F1"), 12.0));
        page.content_ops.push(ContentOp::TextPosition(72.0, 720.0));
        page.content_ops
            .push(ContentOp::ShowText(b"Hello, PDF!".to_vec()));
        page.content_ops.push(ContentOp::EndText);
        doc.finalize_page(page, false);

        let built = doc.build();
        assert_eq!(built.page_count, 1);

        // There should be a content stream object.
        let has_stream = built
            .objects
            .iter()
            .any(|o| matches!(&o.value, PdfValue::Stream(_)));
        assert!(has_stream);
    }
}
