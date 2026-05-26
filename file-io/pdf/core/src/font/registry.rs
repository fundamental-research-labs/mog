//! Font registry for PDF document generation.
//! Manages font registration, codepoint tracking, and finalization.

use super::cid_font::{CidFontObjects, build_cid_font};
use super::subset::subset_font;
use crate::document::PdfDocument;
use std::collections::{BTreeSet, HashMap};

/// Handle to a registered font.
#[derive(Debug, Clone, PartialEq, Eq, Hash)]
pub struct FontHandle {
    pub id: u64,
}

struct RegisteredFont {
    font_data: Vec<u8>,
    used_codepoints: BTreeSet<u32>,
    font_name: String,
}

/// Font registry that tracks fonts and their used codepoints.
pub struct FontRegistry {
    fonts: HashMap<u64, RegisteredFont>,
}

fn hash_bytes(data: &[u8]) -> u64 {
    let mut h: u64 = 0xcbf29ce484222325;
    for &b in data {
        h ^= b as u64;
        h = h.wrapping_mul(0x100000001b3);
    }
    h
}

impl FontRegistry {
    pub fn new() -> Self {
        Self {
            fonts: HashMap::new(),
        }
    }

    /// Register a font. Same binary produces same handle (dedup).
    pub fn register_font(&mut self, font_data: &[u8], font_name: &str) -> FontHandle {
        let id = hash_bytes(font_data);
        self.fonts.entry(id).or_insert_with(|| RegisteredFont {
            font_data: font_data.to_vec(),
            used_codepoints: BTreeSet::new(),
            font_name: font_name.to_string(),
        });
        FontHandle { id }
    }

    /// Record codepoints used with this font.
    pub fn add_codepoints(&mut self, handle: &FontHandle, codepoints: &BTreeSet<u32>) {
        if let Some(font) = self.fonts.get_mut(&handle.id) {
            font.used_codepoints.extend(codepoints);
        }
    }

    /// Measure text width in PDF points.
    pub fn measure_text(&self, handle: &FontHandle, text: &str, size: f64) -> f64 {
        let font = match self.fonts.get(&handle.id) {
            Some(f) => f,
            None => return 0.0,
        };
        let face = match ttf_parser::Face::parse(&font.font_data, 0) {
            Ok(f) => f,
            Err(_) => return 0.0,
        };
        let upem = face.units_per_em() as f64;
        let scale = size / upem;
        let mut width = 0.0;
        for ch in text.chars() {
            if let Some(gid) = face.glyph_index(ch) {
                let adv = face.glyph_hor_advance(gid).unwrap_or(0) as f64;
                width += adv * scale;
            }
        }
        width
    }

    /// Finalize: subset all fonts and build CIDFont objects.
    pub fn finalize(&self, doc: &mut PdfDocument) -> HashMap<u64, CidFontObjects> {
        let mut result = HashMap::new();
        for (&id, font) in &self.fonts {
            if font.used_codepoints.is_empty() {
                continue;
            }
            let subset = match subset_font(&font.font_data, &font.used_codepoints) {
                Ok(s) => s,
                Err(_) => continue,
            };
            let objs = build_cid_font(doc, &subset, &font.font_name);
            result.insert(id, objs);
        }
        result
    }
}

impl Default for FontRegistry {
    fn default() -> Self {
        Self::new()
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_new_registry() {
        let reg = FontRegistry::new();
        assert!(reg.fonts.is_empty());
    }

    #[test]
    fn test_register_font_dedup() {
        let mut reg = FontRegistry::new();
        let data = vec![1u8, 2, 3, 4];
        let h1 = reg.register_font(&data, "TestFont");
        let h2 = reg.register_font(&data, "TestFont");
        assert_eq!(h1.id, h2.id);
        assert_eq!(reg.fonts.len(), 1);
    }

    #[test]
    fn test_register_different_fonts() {
        let mut reg = FontRegistry::new();
        let h1 = reg.register_font(&[1, 2, 3], "Font1");
        let h2 = reg.register_font(&[4, 5, 6], "Font2");
        assert_ne!(h1.id, h2.id);
        assert_eq!(reg.fonts.len(), 2);
    }

    #[test]
    fn test_add_codepoints() {
        let mut reg = FontRegistry::new();
        let h = reg.register_font(&[1, 2], "Test");
        let mut cps = BTreeSet::new();
        cps.insert(0x41);
        cps.insert(0x42);
        reg.add_codepoints(&h, &cps);
        assert_eq!(reg.fonts[&h.id].used_codepoints.len(), 2);
    }

    #[test]
    fn test_measure_text_invalid_font() {
        let mut reg = FontRegistry::new();
        let h = reg.register_font(&[0, 1, 2], "Bad");
        let w = reg.measure_text(&h, "hello", 12.0);
        assert_eq!(w, 0.0);
    }

    #[test]
    fn test_finalize_empty_codepoints_skipped() {
        let mut reg = FontRegistry::new();
        reg.register_font(&[0, 1, 2], "Test");
        let mut doc = PdfDocument::new();
        let result = reg.finalize(&mut doc);
        assert!(result.is_empty()); // no codepoints = skip
    }

    #[test]
    fn test_hash_bytes_deterministic() {
        let a = hash_bytes(&[1, 2, 3]);
        let b = hash_bytes(&[1, 2, 3]);
        assert_eq!(a, b);
    }

    #[test]
    fn test_hash_bytes_different() {
        let a = hash_bytes(&[1, 2, 3]);
        let b = hash_bytes(&[4, 5, 6]);
        assert_ne!(a, b);
    }
}
