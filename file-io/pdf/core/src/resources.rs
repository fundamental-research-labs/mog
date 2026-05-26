//! PDF resource dictionary management.
//!
//! Tracks per-page resources (fonts, images, patterns, shadings, ExtGState, color spaces)
//! and auto-generates unique resource names (e.g., /F1, /Im1, /P1).

use crate::types::*;
use std::collections::BTreeMap;

/// Tracks all resources used on a single PDF page.
#[derive(Debug, Clone)]
pub struct PageResources {
    /// Font resources: name -> indirect reference (e.g., "F1" -> ref to font dict).
    fonts: BTreeMap<String, PdfRef>,
    /// XObject resources: name -> indirect reference (e.g., "Im1" -> ref to image).
    xobjects: BTreeMap<String, PdfRef>,
    /// Pattern resources: name -> indirect reference.
    patterns: BTreeMap<String, PdfRef>,
    /// Shading resources: name -> indirect reference.
    shadings: BTreeMap<String, PdfRef>,
    /// ExtGState resources: name -> indirect reference.
    ext_gstate: BTreeMap<String, PdfRef>,
    /// ColorSpace resources: name -> indirect reference.
    color_spaces: BTreeMap<String, PdfRef>,

    /// Counters for auto-generated names.
    next_font: u32,
    next_xobject: u32,
    next_pattern: u32,
    next_shading: u32,
    next_gstate: u32,
    next_colorspace: u32,
}

impl PageResources {
    /// Create a new empty resource tracker.
    pub fn new() -> Self {
        Self {
            fonts: BTreeMap::new(),
            xobjects: BTreeMap::new(),
            patterns: BTreeMap::new(),
            shadings: BTreeMap::new(),
            ext_gstate: BTreeMap::new(),
            color_spaces: BTreeMap::new(),
            next_font: 1,
            next_xobject: 1,
            next_pattern: 1,
            next_shading: 1,
            next_gstate: 1,
            next_colorspace: 1,
        }
    }

    /// Add a font resource with an auto-generated name. Returns the resource name (e.g., "F1").
    pub fn add_font(&mut self, font_ref: PdfRef) -> PdfName {
        let name = format!("F{}", self.next_font);
        self.next_font += 1;
        self.fonts.insert(name.clone(), font_ref);
        PdfName::new(name)
    }

    /// Add a font resource with a specific name.
    pub fn add_font_named(&mut self, name: impl Into<String>, font_ref: PdfRef) -> PdfName {
        let name = name.into();
        self.fonts.insert(name.clone(), font_ref);
        PdfName::new(name)
    }

    /// Add an XObject (image) resource with an auto-generated name. Returns the name (e.g., "Im1").
    pub fn add_xobject(&mut self, xobj_ref: PdfRef) -> PdfName {
        let name = format!("Im{}", self.next_xobject);
        self.next_xobject += 1;
        self.xobjects.insert(name.clone(), xobj_ref);
        PdfName::new(name)
    }

    /// Add an XObject resource with a specific name.
    pub fn add_xobject_named(&mut self, name: impl Into<String>, xobj_ref: PdfRef) -> PdfName {
        let name = name.into();
        self.xobjects.insert(name.clone(), xobj_ref);
        PdfName::new(name)
    }

    /// Add a pattern resource with an auto-generated name. Returns the name (e.g., "P1").
    pub fn add_pattern(&mut self, pattern_ref: PdfRef) -> PdfName {
        let name = format!("P{}", self.next_pattern);
        self.next_pattern += 1;
        self.patterns.insert(name.clone(), pattern_ref);
        PdfName::new(name)
    }

    /// Add a pattern resource with a specific name.
    pub fn add_pattern_named(&mut self, name: impl Into<String>, pattern_ref: PdfRef) -> PdfName {
        let name = name.into();
        self.patterns.insert(name.clone(), pattern_ref);
        PdfName::new(name)
    }

    /// Add a shading resource with an auto-generated name. Returns the name (e.g., "Sh1").
    pub fn add_shading(&mut self, shading_ref: PdfRef) -> PdfName {
        let name = format!("Sh{}", self.next_shading);
        self.next_shading += 1;
        self.shadings.insert(name.clone(), shading_ref);
        PdfName::new(name)
    }

    /// Add a shading resource with a specific name.
    pub fn add_shading_named(&mut self, name: impl Into<String>, shading_ref: PdfRef) -> PdfName {
        let name = name.into();
        self.shadings.insert(name.clone(), shading_ref);
        PdfName::new(name)
    }

    /// Add an ExtGState resource with an auto-generated name. Returns the name (e.g., "GS1").
    pub fn add_ext_gstate(&mut self, gstate_ref: PdfRef) -> PdfName {
        let name = format!("GS{}", self.next_gstate);
        self.next_gstate += 1;
        self.ext_gstate.insert(name.clone(), gstate_ref);
        PdfName::new(name)
    }

    /// Add an ExtGState resource with a specific name.
    pub fn add_ext_gstate_named(&mut self, name: impl Into<String>, gstate_ref: PdfRef) -> PdfName {
        let name = name.into();
        self.ext_gstate.insert(name.clone(), gstate_ref);
        PdfName::new(name)
    }

    /// Add a color space resource with an auto-generated name. Returns the name (e.g., "CS1").
    pub fn add_color_space(&mut self, cs_ref: PdfRef) -> PdfName {
        let name = format!("CS{}", self.next_colorspace);
        self.next_colorspace += 1;
        self.color_spaces.insert(name.clone(), cs_ref);
        PdfName::new(name)
    }

    /// Add a color space resource with a specific name.
    pub fn add_color_space_named(&mut self, name: impl Into<String>, cs_ref: PdfRef) -> PdfName {
        let name = name.into();
        self.color_spaces.insert(name.clone(), cs_ref);
        PdfName::new(name)
    }

    /// Returns true if no resources have been registered.
    pub fn is_empty(&self) -> bool {
        self.fonts.is_empty()
            && self.xobjects.is_empty()
            && self.patterns.is_empty()
            && self.shadings.is_empty()
            && self.ext_gstate.is_empty()
            && self.color_spaces.is_empty()
    }

    /// Total number of registered resources across all categories.
    pub fn total_count(&self) -> usize {
        self.fonts.len()
            + self.xobjects.len()
            + self.patterns.len()
            + self.shadings.len()
            + self.ext_gstate.len()
            + self.color_spaces.len()
    }

    /// Serialize to a PDF /Resources dictionary.
    pub fn to_pdf_dict(&self) -> PdfDict {
        let mut resources = PdfDict::new();

        if !self.fonts.is_empty() {
            let mut font_dict = PdfDict::new();
            for (name, pdf_ref) in &self.fonts {
                font_dict.set(name.as_str(), PdfValue::Ref(*pdf_ref));
            }
            resources.set("Font", PdfValue::Dict(font_dict));
        }

        if !self.xobjects.is_empty() {
            let mut xobj_dict = PdfDict::new();
            for (name, pdf_ref) in &self.xobjects {
                xobj_dict.set(name.as_str(), PdfValue::Ref(*pdf_ref));
            }
            resources.set("XObject", PdfValue::Dict(xobj_dict));
        }

        if !self.patterns.is_empty() {
            let mut pat_dict = PdfDict::new();
            for (name, pdf_ref) in &self.patterns {
                pat_dict.set(name.as_str(), PdfValue::Ref(*pdf_ref));
            }
            resources.set("Pattern", PdfValue::Dict(pat_dict));
        }

        if !self.shadings.is_empty() {
            let mut sh_dict = PdfDict::new();
            for (name, pdf_ref) in &self.shadings {
                sh_dict.set(name.as_str(), PdfValue::Ref(*pdf_ref));
            }
            resources.set("Shading", PdfValue::Dict(sh_dict));
        }

        if !self.ext_gstate.is_empty() {
            let mut gs_dict = PdfDict::new();
            for (name, pdf_ref) in &self.ext_gstate {
                gs_dict.set(name.as_str(), PdfValue::Ref(*pdf_ref));
            }
            resources.set("ExtGState", PdfValue::Dict(gs_dict));
        }

        if !self.color_spaces.is_empty() {
            let mut cs_dict = PdfDict::new();
            for (name, pdf_ref) in &self.color_spaces {
                cs_dict.set(name.as_str(), PdfValue::Ref(*pdf_ref));
            }
            resources.set("ColorSpace", PdfValue::Dict(cs_dict));
        }

        resources
    }

    /// Get font name for a given reference, if registered.
    pub fn get_font_name(&self, font_ref: PdfRef) -> Option<&str> {
        self.fonts
            .iter()
            .find(|(_, r)| **r == font_ref)
            .map(|(name, _)| name.as_str())
    }

    /// Get xobject name for a given reference, if registered.
    pub fn get_xobject_name(&self, xobj_ref: PdfRef) -> Option<&str> {
        self.xobjects
            .iter()
            .find(|(_, r)| **r == xobj_ref)
            .map(|(name, _)| name.as_str())
    }
}

impl Default for PageResources {
    fn default() -> Self {
        Self::new()
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_empty_resources() {
        let res = PageResources::new();
        assert!(res.is_empty());
        assert_eq!(res.total_count(), 0);
        let dict = res.to_pdf_dict();
        assert!(dict.is_empty());
    }

    #[test]
    fn test_add_fonts() {
        let mut res = PageResources::new();
        let f1 = res.add_font(PdfRef::new(10, 0));
        let f2 = res.add_font(PdfRef::new(11, 0));

        assert_eq!(f1.as_str(), "F1");
        assert_eq!(f2.as_str(), "F2");
        assert!(!res.is_empty());
        assert_eq!(res.total_count(), 2);
    }

    #[test]
    fn test_add_font_named() {
        let mut res = PageResources::new();
        let name = res.add_font_named("MyFont", PdfRef::new(10, 0));
        assert_eq!(name.as_str(), "MyFont");
    }

    #[test]
    fn test_add_xobjects() {
        let mut res = PageResources::new();
        let im1 = res.add_xobject(PdfRef::new(20, 0));
        let im2 = res.add_xobject(PdfRef::new(21, 0));

        assert_eq!(im1.as_str(), "Im1");
        assert_eq!(im2.as_str(), "Im2");
    }

    #[test]
    fn test_add_patterns() {
        let mut res = PageResources::new();
        let p1 = res.add_pattern(PdfRef::new(30, 0));
        assert_eq!(p1.as_str(), "P1");
    }

    #[test]
    fn test_add_shadings() {
        let mut res = PageResources::new();
        let sh1 = res.add_shading(PdfRef::new(40, 0));
        assert_eq!(sh1.as_str(), "Sh1");
    }

    #[test]
    fn test_add_ext_gstate() {
        let mut res = PageResources::new();
        let gs1 = res.add_ext_gstate(PdfRef::new(50, 0));
        assert_eq!(gs1.as_str(), "GS1");
    }

    #[test]
    fn test_add_color_spaces() {
        let mut res = PageResources::new();
        let cs1 = res.add_color_space(PdfRef::new(60, 0));
        assert_eq!(cs1.as_str(), "CS1");
    }

    #[test]
    fn test_to_pdf_dict_fonts_only() {
        let mut res = PageResources::new();
        res.add_font(PdfRef::new(10, 0));
        res.add_font(PdfRef::new(11, 0));

        let dict = res.to_pdf_dict();
        let font_dict = dict.get_dict("Font").unwrap();
        assert_eq!(font_dict.get_ref("F1"), Some(PdfRef::new(10, 0)));
        assert_eq!(font_dict.get_ref("F2"), Some(PdfRef::new(11, 0)));
    }

    #[test]
    fn test_to_pdf_dict_all_categories() {
        let mut res = PageResources::new();
        res.add_font(PdfRef::new(10, 0));
        res.add_xobject(PdfRef::new(20, 0));
        res.add_pattern(PdfRef::new(30, 0));
        res.add_shading(PdfRef::new(40, 0));
        res.add_ext_gstate(PdfRef::new(50, 0));
        res.add_color_space(PdfRef::new(60, 0));

        assert_eq!(res.total_count(), 6);

        let dict = res.to_pdf_dict();
        assert!(dict.get_dict("Font").is_some());
        assert!(dict.get_dict("XObject").is_some());
        assert!(dict.get_dict("Pattern").is_some());
        assert!(dict.get_dict("Shading").is_some());
        assert!(dict.get_dict("ExtGState").is_some());
        assert!(dict.get_dict("ColorSpace").is_some());
    }

    #[test]
    fn test_to_pdf_dict_empty_categories_omitted() {
        let mut res = PageResources::new();
        res.add_font(PdfRef::new(10, 0));

        let dict = res.to_pdf_dict();
        assert!(dict.get_dict("Font").is_some());
        assert!(dict.get_dict("XObject").is_none());
        assert!(dict.get_dict("Pattern").is_none());
        assert!(dict.get_dict("Shading").is_none());
        assert!(dict.get_dict("ExtGState").is_none());
        assert!(dict.get_dict("ColorSpace").is_none());
    }

    #[test]
    fn test_get_font_name() {
        let mut res = PageResources::new();
        let r = PdfRef::new(10, 0);
        res.add_font(r);
        assert_eq!(res.get_font_name(r), Some("F1"));
        assert_eq!(res.get_font_name(PdfRef::new(999, 0)), None);
    }

    #[test]
    fn test_get_xobject_name() {
        let mut res = PageResources::new();
        let r = PdfRef::new(20, 0);
        res.add_xobject(r);
        assert_eq!(res.get_xobject_name(r), Some("Im1"));
    }

    #[test]
    fn test_multiple_resources_unique_names() {
        let mut res = PageResources::new();
        let names: Vec<PdfName> = (0..10)
            .map(|i| res.add_font(PdfRef::new(100 + i, 0)))
            .collect();

        // All names should be unique.
        let name_strs: Vec<&str> = names.iter().map(|n| n.as_str()).collect();
        let mut sorted = name_strs.clone();
        sorted.sort();
        sorted.dedup();
        assert_eq!(name_strs.len(), sorted.len());

        // Names should be F1, F2, ..., F10.
        assert_eq!(names[0].as_str(), "F1");
        assert_eq!(names[9].as_str(), "F10");
    }

    #[test]
    fn test_resource_dict_references_correct() {
        let mut res = PageResources::new();
        let font_ref = PdfRef::new(42, 0);
        let img_ref = PdfRef::new(43, 0);
        let gs_ref = PdfRef::new(44, 0);

        res.add_font(font_ref);
        res.add_xobject(img_ref);
        res.add_ext_gstate(gs_ref);

        let dict = res.to_pdf_dict();

        // Verify each resource points to the correct indirect reference.
        let font_dict = dict.get_dict("Font").unwrap();
        assert_eq!(font_dict.get_ref("F1"), Some(font_ref));

        let xobj_dict = dict.get_dict("XObject").unwrap();
        assert_eq!(xobj_dict.get_ref("Im1"), Some(img_ref));

        let gs_dict = dict.get_dict("ExtGState").unwrap();
        assert_eq!(gs_dict.get_ref("GS1"), Some(gs_ref));
    }
}
