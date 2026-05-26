//! Structure tree builder for tagged PDF.
//!
//! Builds the PDF structure tree (/StructTreeRoot) with StructElem nodes
//! for tables (Table, TR, TH, TD), figures, paragraphs, etc.

use crate::document::PdfDocument;
use crate::tag::parent_tree;
use crate::types::*;

/// A structure element in the tagged PDF tree.
#[derive(Debug, Clone)]
pub struct StructElem {
    pub struct_type: String,
    pub children: Vec<StructChild>,
    pub attributes: Option<PdfDict>,
    pub alt_text: Option<String>,
    pub lang: Option<String>,
}

/// A child of a structure element.
#[derive(Debug, Clone)]
pub enum StructChild {
    Element(StructElem),
    MarkedContentRef { page_ref: PdfRef, mcid: u32 },
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum HeaderScope {
    Column,
    Row,
    Both,
}

impl HeaderScope {
    pub fn as_str(&self) -> &'static str {
        match self {
            HeaderScope::Column => "Column",
            HeaderScope::Row => "Row",
            HeaderScope::Both => "Both",
        }
    }
}

#[derive(Debug)]
pub struct StructureTreeBuilder {
    root_children: Vec<StructElem>,
    next_mcid: u32,
    mcid_pages: Vec<(u32, PdfRef)>,
}

impl Default for StructureTreeBuilder {
    fn default() -> Self {
        Self::new()
    }
}

impl StructureTreeBuilder {
    pub fn new() -> Self {
        Self {
            root_children: Vec::new(),
            next_mcid: 0,
            mcid_pages: Vec::new(),
        }
    }

    pub fn alloc_mcid(&mut self) -> u32 {
        let mcid = self.next_mcid;
        self.next_mcid += 1;
        mcid
    }

    pub fn register_mcid_page(&mut self, mcid: u32, page_ref: PdfRef) {
        self.mcid_pages.push((mcid, page_ref));
    }

    pub fn begin_table(&self) -> StructElem {
        StructElem::new("Table")
    }

    pub fn add_row(&self) -> StructElem {
        StructElem::new("TR")
    }

    pub fn add_header_cell(&self, scope: HeaderScope) -> StructElem {
        let mut elem = StructElem::new("TH");
        let mut attrs = PdfDict::new();
        attrs.set("O", PdfValue::name("Table"));
        attrs.set("Scope", PdfValue::name(scope.as_str()));
        elem.attributes = Some(attrs);
        elem
    }

    pub fn add_data_cell(&self) -> StructElem {
        StructElem::new("TD")
    }

    pub fn add_figure(&self, alt_text: &str) -> StructElem {
        let mut elem = StructElem::new("Figure");
        elem.alt_text = Some(alt_text.to_string());
        elem
    }

    pub fn add_paragraph(&self) -> StructElem {
        StructElem::new("P")
    }

    pub fn add_element(&mut self, elem: StructElem) {
        self.root_children.push(elem);
    }

    pub fn finalize(self, doc: &mut PdfDocument) -> PdfRef {
        let tree_root_ref = doc.alloc_ref();
        let mut pte: Vec<(u32, PdfRef)> = Vec::new();
        let mut kid_refs = Vec::new();

        for elem in &self.root_children {
            let elem_ref =
                Self::write_struct_elem(doc, elem, tree_root_ref, &self.mcid_pages, &mut pte);
            kid_refs.push(PdfValue::Ref(elem_ref));
        }

        let parent_tree_ref = parent_tree::build_parent_tree(doc, &pte);

        let mut root_dict = PdfDict::new();
        root_dict.set("Type", PdfValue::name("StructTreeRoot"));
        root_dict.set("K", PdfValue::Array(kid_refs));
        root_dict.set("ParentTree", PdfValue::Ref(parent_tree_ref));
        doc.set_object(tree_root_ref, PdfValue::Dict(root_dict));

        tree_root_ref
    }

    fn write_struct_elem(
        doc: &mut PdfDocument,
        elem: &StructElem,
        parent_ref: PdfRef,
        mcid_pages: &[(u32, PdfRef)],
        pte: &mut Vec<(u32, PdfRef)>,
    ) -> PdfRef {
        let elem_ref = doc.alloc_ref();
        let mut kids = Vec::new();

        for child in &elem.children {
            match child {
                StructChild::Element(child_elem) => {
                    let child_ref =
                        Self::write_struct_elem(doc, child_elem, elem_ref, mcid_pages, pte);
                    kids.push(PdfValue::Ref(child_ref));
                }
                StructChild::MarkedContentRef { page_ref, mcid } => {
                    let mut mcr = PdfDict::new();
                    mcr.set("Type", PdfValue::name("MCR"));
                    mcr.set("Pg", PdfValue::Ref(*page_ref));
                    mcr.set("MCID", PdfValue::Integer(*mcid as i64));
                    kids.push(PdfValue::Dict(mcr));
                    pte.push((*mcid, elem_ref));
                }
            }
        }

        let mut dict = PdfDict::new();
        dict.set("Type", PdfValue::name("StructElem"));
        dict.set("S", PdfValue::name(&elem.struct_type));
        dict.set("P", PdfValue::Ref(parent_ref));
        if !kids.is_empty() {
            dict.set("K", PdfValue::Array(kids));
        }
        if let Some(ref alt) = elem.alt_text {
            dict.set("Alt", PdfValue::text_string(alt));
        }
        if let Some(ref lang) = elem.lang {
            dict.set("Lang", PdfValue::text_string(lang));
        }
        if let Some(ref attrs) = elem.attributes {
            dict.set("A", PdfValue::Dict(attrs.clone()));
        }

        doc.set_object(elem_ref, PdfValue::Dict(dict));
        elem_ref
    }
}

impl StructElem {
    pub fn new(struct_type: &str) -> Self {
        Self {
            struct_type: struct_type.to_string(),
            children: Vec::new(),
            attributes: None,
            alt_text: None,
            lang: None,
        }
    }

    pub fn add_mcr(&mut self, page_ref: PdfRef, mcid: u32) {
        self.children
            .push(StructChild::MarkedContentRef { page_ref, mcid });
    }

    pub fn add_child(&mut self, child: StructElem) {
        self.children.push(StructChild::Element(child));
    }

    pub fn set_span(&mut self, col_span: u32, row_span: u32) {
        let attrs = self.attributes.get_or_insert_with(PdfDict::new);
        attrs.set("O", PdfValue::name("Table"));
        if col_span > 1 {
            attrs.set("ColSpan", PdfValue::Integer(col_span as i64));
        }
        if row_span > 1 {
            attrs.set("RowSpan", PdfValue::Integer(row_span as i64));
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::document::PdfDocument;

    #[test]
    fn test_alloc_mcid() {
        let mut builder = StructureTreeBuilder::new();
        assert_eq!(builder.alloc_mcid(), 0);
        assert_eq!(builder.alloc_mcid(), 1);
        assert_eq!(builder.alloc_mcid(), 2);
    }

    #[test]
    fn test_scope_names() {
        assert_eq!(HeaderScope::Column.as_str(), "Column");
        assert_eq!(HeaderScope::Row.as_str(), "Row");
        assert_eq!(HeaderScope::Both.as_str(), "Both");
    }

    #[test]
    fn test_empty_tree() {
        let mut doc = PdfDocument::new();
        let builder = StructureTreeBuilder::new();
        let root_ref = builder.finalize(&mut doc);
        let built = doc.build();
        let obj = built
            .objects
            .iter()
            .find(|o| o.obj_ref == root_ref)
            .unwrap();
        if let PdfValue::Dict(ref d) = obj.value {
            assert_eq!(d.get_name("Type"), Some("StructTreeRoot"));
            let kids = d.get_array("K").unwrap();
            assert!(kids.is_empty());
        } else {
            panic!("Expected dict");
        }
    }

    #[test]
    fn test_build_table() {
        let mut doc = PdfDocument::new();
        let page = doc.add_page(612.0, 792.0);
        let page_ref = page.page_ref;
        doc.finalize_page(page, false);

        let mut builder = StructureTreeBuilder::new();
        let mcid0 = builder.alloc_mcid();
        let mcid1 = builder.alloc_mcid();
        builder.register_mcid_page(mcid0, page_ref);
        builder.register_mcid_page(mcid1, page_ref);

        let mut table = builder.begin_table();
        let mut row = builder.add_row();
        let mut th = builder.add_header_cell(HeaderScope::Column);
        th.add_mcr(page_ref, mcid0);
        let mut td = builder.add_data_cell();
        td.add_mcr(page_ref, mcid1);
        row.add_child(th);
        row.add_child(td);
        table.add_child(row);
        builder.add_element(table);

        let root_ref = builder.finalize(&mut doc);
        let built = doc.build();

        let root_obj = built
            .objects
            .iter()
            .find(|o| o.obj_ref == root_ref)
            .unwrap();
        if let PdfValue::Dict(ref d) = root_obj.value {
            assert_eq!(d.get_name("Type"), Some("StructTreeRoot"));
            let kids = d.get_array("K").unwrap();
            assert_eq!(kids.len(), 1);
        } else {
            panic!("Expected dict");
        }
    }

    #[test]
    fn test_figure() {
        let mut doc = PdfDocument::new();
        let page = doc.add_page(612.0, 792.0);
        let page_ref = page.page_ref;
        doc.finalize_page(page, false);

        let mut builder = StructureTreeBuilder::new();
        let mcid = builder.alloc_mcid();
        builder.register_mcid_page(mcid, page_ref);

        let mut fig = builder.add_figure("A chart");
        fig.add_mcr(page_ref, mcid);
        builder.add_element(fig);

        let _root_ref = builder.finalize(&mut doc);
        let built = doc.build();

        let figure_elem = built.objects.iter().find(|o| {
            if let PdfValue::Dict(ref d) = o.value {
                d.get_name("S") == Some("Figure")
            } else {
                false
            }
        });
        assert!(figure_elem.is_some());
        if let PdfValue::Dict(ref d) = figure_elem.unwrap().value {
            assert_eq!(d.get_str("Alt"), Some(b"A chart".as_ref()));
        }
    }

    #[test]
    fn test_span() {
        let mut elem = StructElem::new("TH");
        elem.set_span(3, 2);
        let attrs = elem.attributes.as_ref().unwrap();
        assert_eq!(attrs.get_integer("ColSpan"), Some(3));
        assert_eq!(attrs.get_integer("RowSpan"), Some(2));
    }

    #[test]
    fn test_mcr() {
        let page_ref = PdfRef::new(10, 0);
        let mut elem = StructElem::new("TD");
        elem.add_mcr(page_ref, 5);
        assert_eq!(elem.children.len(), 1);
        match &elem.children[0] {
            StructChild::MarkedContentRef { page_ref: pr, mcid } => {
                assert_eq!(pr.obj_num, 10);
                assert_eq!(*mcid, 5);
            }
            _ => panic!("Expected MCR"),
        }
    }

    #[test]
    fn test_paragraph() {
        let mut doc = PdfDocument::new();
        let page = doc.add_page(612.0, 792.0);
        let page_ref = page.page_ref;
        doc.finalize_page(page, false);

        let mut builder = StructureTreeBuilder::new();
        let mcid = builder.alloc_mcid();
        builder.register_mcid_page(mcid, page_ref);

        let mut p = builder.add_paragraph();
        p.add_mcr(page_ref, mcid);
        builder.add_element(p);

        let _root_ref = builder.finalize(&mut doc);
        let built = doc.build();

        let p_elem = built.objects.iter().find(|o| {
            if let PdfValue::Dict(ref d) = o.value {
                d.get_name("S") == Some("P")
            } else {
                false
            }
        });
        assert!(p_elem.is_some());
    }

    #[test]
    fn test_lang_attribute() {
        let mut elem = StructElem::new("P");
        elem.lang = Some("en-US".to_string());
        assert_eq!(elem.lang.as_deref(), Some("en-US"));
    }
}
