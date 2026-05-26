use rustybuzz::Face;
use std::collections::HashMap;

/// A loaded font entry: owns the font data bytes and the parsed Face.
pub struct FontEntry {
    /// Raw font file bytes (owned).
    data: Vec<u8>,
    /// Index within the font collection (0 for single-font files).
    index: u32,
}

impl FontEntry {
    /// Create a Face from this entry. The Face borrows from data,
    /// so we return it freshly each time (Face is cheap to create from parsed data).
    ///
    /// SAFETY: We store data in a pinned Vec, and Face borrows from it.
    /// The FontEntry owns the data, so the Face is valid for the entry's lifetime.
    pub fn face(&self) -> Option<Face<'_>> {
        Face::from_slice(&self.data, self.index)
    }

    /// Raw font file bytes (for constructing ttf_parser::Face externally).
    pub fn data(&self) -> &[u8] {
        &self.data
    }

    /// Font collection index.
    pub fn index(&self) -> u32 {
        self.index
    }
}

/// Font database — loads, caches, and resolves fonts by family name.
pub struct FontDb {
    /// font_id (index) -> FontEntry
    fonts: Vec<FontEntry>,
    /// Lowercase font family -> font_id
    name_to_id: HashMap<String, u16>,
    /// Metric-compatible fallback chains
    fallbacks: HashMap<String, Vec<String>>,
    /// Whether default Latin fonts have been loaded
    defaults_loaded: bool,
}

impl FontDb {
    pub fn new() -> Self {
        let mut fallbacks = HashMap::new();
        // Metric-compatible fallback chains (same as TS font-utils.ts)
        fallbacks.insert("calibri".to_string(), vec!["carlito".to_string()]);
        fallbacks.insert("cambria".to_string(), vec!["caladea".to_string()]);
        fallbacks.insert("arial".to_string(), vec!["liberation sans".to_string()]);
        fallbacks.insert("helvetica".to_string(), vec!["liberation sans".to_string()]);
        fallbacks.insert(
            "times new roman".to_string(),
            vec!["liberation serif".to_string()],
        );
        fallbacks.insert("times".to_string(), vec!["liberation serif".to_string()]);
        fallbacks.insert(
            "courier new".to_string(),
            vec!["liberation mono".to_string()],
        );
        fallbacks.insert("courier".to_string(), vec!["liberation mono".to_string()]);

        Self {
            fonts: Vec::new(),
            name_to_id: HashMap::new(),
            fallbacks,
            defaults_loaded: false,
        }
    }

    /// Load a font from raw bytes, registering it under `family`.
    /// Returns the assigned font_id.
    pub fn load_font(&mut self, family: &str, data: Vec<u8>) -> u16 {
        self.load_font_with_index(family, data, 0)
    }

    /// Load a font from raw bytes with a specific font collection index.
    pub fn load_font_with_index(&mut self, family: &str, data: Vec<u8>, index: u32) -> u16 {
        let id = self.fonts.len() as u16;
        self.fonts.push(FontEntry { data, index });
        self.name_to_id.insert(family.to_lowercase(), id);
        id
    }

    /// Load bundled Latin fonts at init.
    /// Fonts are at compute-core/fonts/ relative to the workspace root,
    /// which is ../../../fonts/ relative to this crate's src/.
    pub fn load_defaults(&mut self) {
        if self.defaults_loaded {
            return;
        }
        // Carlito (Calibri metric-compatible)
        self.load_font(
            "carlito",
            include_bytes!("../../../fonts/Carlito-Regular.ttf").to_vec(),
        );
        self.load_font(
            "carlito bold",
            include_bytes!("../../../fonts/Carlito-Bold.ttf").to_vec(),
        );
        self.load_font(
            "carlito italic",
            include_bytes!("../../../fonts/Carlito-Italic.ttf").to_vec(),
        );
        self.load_font(
            "carlito bolditalic",
            include_bytes!("../../../fonts/Carlito-BoldItalic.ttf").to_vec(),
        );

        // Caladea (Cambria metric-compatible)
        self.load_font(
            "caladea",
            include_bytes!("../../../fonts/Caladea-Regular.ttf").to_vec(),
        );
        self.load_font(
            "caladea bold",
            include_bytes!("../../../fonts/Caladea-Bold.ttf").to_vec(),
        );
        self.load_font(
            "caladea italic",
            include_bytes!("../../../fonts/Caladea-Italic.ttf").to_vec(),
        );
        self.load_font(
            "caladea bolditalic",
            include_bytes!("../../../fonts/Caladea-BoldItalic.ttf").to_vec(),
        );

        // Liberation Sans (Arial metric-compatible)
        self.load_font(
            "liberation sans",
            include_bytes!("../../../fonts/LiberationSans-Regular.ttf").to_vec(),
        );
        self.load_font(
            "liberation sans bold",
            include_bytes!("../../../fonts/LiberationSans-Bold.ttf").to_vec(),
        );
        self.load_font(
            "liberation sans italic",
            include_bytes!("../../../fonts/LiberationSans-Italic.ttf").to_vec(),
        );
        self.load_font(
            "liberation sans bolditalic",
            include_bytes!("../../../fonts/LiberationSans-BoldItalic.ttf").to_vec(),
        );

        // Liberation Serif (Times New Roman metric-compatible)
        self.load_font(
            "liberation serif",
            include_bytes!("../../../fonts/LiberationSerif-Regular.ttf").to_vec(),
        );
        self.load_font(
            "liberation serif bold",
            include_bytes!("../../../fonts/LiberationSerif-Bold.ttf").to_vec(),
        );
        self.load_font(
            "liberation serif italic",
            include_bytes!("../../../fonts/LiberationSerif-Italic.ttf").to_vec(),
        );
        self.load_font(
            "liberation serif bolditalic",
            include_bytes!("../../../fonts/LiberationSerif-BoldItalic.ttf").to_vec(),
        );

        // Liberation Mono (Courier New metric-compatible)
        self.load_font(
            "liberation mono",
            include_bytes!("../../../fonts/LiberationMono-Regular.ttf").to_vec(),
        );
        self.load_font(
            "liberation mono bold",
            include_bytes!("../../../fonts/LiberationMono-Bold.ttf").to_vec(),
        );
        self.load_font(
            "liberation mono italic",
            include_bytes!("../../../fonts/LiberationMono-Italic.ttf").to_vec(),
        );
        self.load_font(
            "liberation mono bolditalic",
            include_bytes!("../../../fonts/LiberationMono-BoldItalic.ttf").to_vec(),
        );

        self.defaults_loaded = true;
    }

    /// Create a FontDb with defaults already loaded.
    pub fn with_defaults() -> Self {
        let mut db = Self::new();
        db.load_defaults();
        db
    }

    /// Load a CJK font from externally-provided bytes.
    pub fn load_cjk(&mut self, data: Vec<u8>) {
        self.load_font("noto sans cjk sc", data);
    }

    /// Resolve a font family name to a font_id and entry.
    /// Tries exact match first, then fallback chains, then default (Carlito).
    pub fn resolve(&self, family: &str) -> Option<(u16, &FontEntry)> {
        let key = family.to_lowercase();

        // Exact match
        if let Some(&id) = self.name_to_id.get(&key) {
            return Some((id, &self.fonts[id as usize]));
        }

        // Fallback chain
        if let Some(chain) = self.fallbacks.get(&key) {
            for fallback in chain {
                if let Some(&id) = self.name_to_id.get(fallback) {
                    return Some((id, &self.fonts[id as usize]));
                }
            }
        }

        // Default: Carlito (most spreadsheets use Calibri -> Carlito)
        if let Some(&id) = self.name_to_id.get("carlito") {
            return Some((id, &self.fonts[id as usize]));
        }

        None
    }

    /// Resolve a font family with style (bold, italic) consideration.
    /// Returns the best matching font_id and entry.
    pub fn resolve_styled(
        &self,
        family: &str,
        bold: bool,
        italic: bool,
    ) -> Option<(u16, &FontEntry)> {
        let base_key = family.to_lowercase();

        // Build the styled key
        let styled_key = match (bold, italic) {
            (true, true) => format!("{} bolditalic", base_key),
            (true, false) => format!("{} bold", base_key),
            (false, true) => format!("{} italic", base_key),
            (false, false) => base_key.clone(),
        };

        // Try styled variant first
        if let Some(&id) = self.name_to_id.get(&styled_key) {
            return Some((id, &self.fonts[id as usize]));
        }

        // Fall through to unstyled resolution (with fallback chains)
        self.resolve(family)
    }

    /// Check if a string contains CJK characters that need CJK fonts.
    pub fn needs_cjk(text: &str) -> bool {
        text.chars().any(is_cjk_char)
    }
}

/// Check if a character is in CJK Unicode ranges.
fn is_cjk_char(c: char) -> bool {
    matches!(
        c as u32,
        0x4E00..=0x9FFF        // CJK Unified Ideographs
        | 0x3400..=0x4DBF      // CJK Unified Ideographs Extension A
        | 0x20000..=0x2A6DF    // CJK Unified Ideographs Extension B
        | 0xF900..=0xFAFF      // CJK Compatibility Ideographs
        | 0x2F800..=0x2FA1F    // CJK Compatibility Ideographs Supplement
        | 0x3000..=0x303F      // CJK Symbols and Punctuation
        | 0x3040..=0x309F      // Hiragana
        | 0x30A0..=0x30FF      // Katakana
        | 0x31F0..=0x31FF      // Katakana Phonetic Extensions
        | 0xAC00..=0xD7AF      // Hangul Syllables
        | 0x1100..=0x11FF      // Hangul Jamo
        | 0xFF00..=0xFFEF      // Halfwidth and Fullwidth Forms
    )
}

impl Default for FontDb {
    fn default() -> Self {
        Self::new()
    }
}
