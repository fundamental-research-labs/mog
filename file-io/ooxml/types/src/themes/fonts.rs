use crate::drawings::ExtensionList;

// =============================================================================
// Font Scheme
// =============================================================================

/// Theme font scheme with major and minor font definitions (ECMA-376 CT_FontScheme, dml-main.xsd).
///
/// **Audit note**: The DML `CT_FontScheme` has a required `name` attribute (mapped to `name`
/// field below). The SML `CT_FontScheme` (sml.xsd:3730) is a *different* type with a `val`
/// attribute for font scheme enum values — that type is not modeled here.
#[derive(Debug, Clone, PartialEq, Eq, serde::Serialize, serde::Deserialize)]
pub struct FontScheme {
    /// Scheme name — maps to XSD `@name` attribute (required).
    pub name: String,
    /// Major font — used for headings
    pub major_font: FontCollection,
    /// Minor font — used for body text
    pub minor_font: FontCollection,
    /// Extension list
    pub ext_lst: Option<ExtensionList>,
}

impl Default for FontScheme {
    fn default() -> Self {
        Self::office_default()
    }
}

impl FontScheme {
    /// Create the default Office font scheme.
    pub fn office_default() -> Self {
        Self {
            name: "Office".to_string(),
            major_font: FontCollection::office_major(),
            minor_font: FontCollection::office_minor(),
            ext_lst: None,
        }
    }

    /// Create a simple font scheme with just Latin fonts.
    pub fn simple(name: &str, major: &str, minor: &str) -> Self {
        Self {
            name: name.to_string(),
            major_font: FontCollection::new(major),
            minor_font: FontCollection::new(minor),
            ext_lst: None,
        }
    }
}

// =============================================================================
// Font Collection
// =============================================================================

/// Collection of fonts for different scripts (ECMA-376 CT_FontCollection).
///
/// Represents either `majorFont` or `minorFont` within a font scheme.
#[derive(Debug, Clone, PartialEq, Eq, serde::Serialize, serde::Deserialize)]
pub struct FontCollection {
    /// Latin script font (required)
    pub latin: ThemeFontDef,
    /// East Asian script font (required per spec)
    pub ea: ThemeFontDef,
    /// Complex script font (required per spec, e.g. Arabic, Hebrew)
    pub cs: ThemeFontDef,
    /// Script-specific font mappings (e.g. "Jpan" -> font)
    pub script_fonts: Vec<ScriptFont>,
    /// Extension list
    pub ext_lst: Option<ExtensionList>,
}

impl Default for FontCollection {
    fn default() -> Self {
        Self {
            latin: ThemeFontDef::new(""),
            ea: ThemeFontDef::new(""),
            cs: ThemeFontDef::new(""),
            script_fonts: Vec::new(),
            ext_lst: None,
        }
    }
}

impl FontCollection {
    /// Create a new font collection with a Latin font.
    pub fn new(latin_typeface: impl Into<String>) -> Self {
        Self {
            latin: ThemeFontDef::new(latin_typeface),
            ea: ThemeFontDef::new(""),
            cs: ThemeFontDef::new(""),
            script_fonts: Vec::new(),
            ext_lst: None,
        }
    }

    /// Create the default major (heading) font collection.
    pub fn office_major() -> Self {
        let mut collection = Self {
            latin: ThemeFontDef::with_panose("Calibri Light", "020F0302020204030204"),
            ea: ThemeFontDef::new(""),
            cs: ThemeFontDef::new(""),
            script_fonts: Vec::new(),
            ext_lst: None,
        };
        collection
            .script_fonts
            .push(ScriptFont::new("Jpan", "Yu Gothic Light"));
        collection
            .script_fonts
            .push(ScriptFont::new("Hang", "Malgun Gothic"));
        collection
            .script_fonts
            .push(ScriptFont::new("Hans", "DengXian Light"));
        collection
            .script_fonts
            .push(ScriptFont::new("Hant", "Microsoft JhengHei Light"));
        collection
            .script_fonts
            .push(ScriptFont::new("Arab", "Times New Roman"));
        collection
            .script_fonts
            .push(ScriptFont::new("Hebr", "Times New Roman"));
        collection
            .script_fonts
            .push(ScriptFont::new("Thai", "Angsana New"));
        collection
            .script_fonts
            .push(ScriptFont::new("Ethi", "Nyala"));
        collection
            .script_fonts
            .push(ScriptFont::new("Beng", "Vrinda"));
        collection
            .script_fonts
            .push(ScriptFont::new("Gujr", "Shruti"));
        collection
            .script_fonts
            .push(ScriptFont::new("Khmr", "MoolBoran"));
        collection
            .script_fonts
            .push(ScriptFont::new("Knda", "Tunga"));
        collection
    }

    /// Create the default minor (body) font collection.
    pub fn office_minor() -> Self {
        let mut collection = Self {
            latin: ThemeFontDef::with_panose("Calibri", "020F0502020204030204"),
            ea: ThemeFontDef::new(""),
            cs: ThemeFontDef::new(""),
            script_fonts: Vec::new(),
            ext_lst: None,
        };
        collection
            .script_fonts
            .push(ScriptFont::new("Jpan", "Yu Gothic"));
        collection
            .script_fonts
            .push(ScriptFont::new("Hang", "Malgun Gothic"));
        collection
            .script_fonts
            .push(ScriptFont::new("Hans", "DengXian"));
        collection
            .script_fonts
            .push(ScriptFont::new("Hant", "Microsoft JhengHei"));
        collection
            .script_fonts
            .push(ScriptFont::new("Arab", "Arial"));
        collection
            .script_fonts
            .push(ScriptFont::new("Hebr", "Arial"));
        collection
            .script_fonts
            .push(ScriptFont::new("Thai", "Cordia New"));
        collection
            .script_fonts
            .push(ScriptFont::new("Ethi", "Nyala"));
        collection
            .script_fonts
            .push(ScriptFont::new("Beng", "Vrinda"));
        collection
            .script_fonts
            .push(ScriptFont::new("Gujr", "Shruti"));
        collection
            .script_fonts
            .push(ScriptFont::new("Khmr", "DaunPenh"));
        collection
            .script_fonts
            .push(ScriptFont::new("Knda", "Tunga"));
        collection
    }
}

// =============================================================================
// Theme Font Definition
// =============================================================================

/// Font definition with optional metadata (ECMA-376 CT_TextFont).
#[derive(Debug, Clone, PartialEq, Eq, serde::Serialize, serde::Deserialize)]
pub struct ThemeFontDef {
    /// Font typeface name (e.g., "Calibri")
    pub typeface: String,
    /// PANOSE-1 classification (optional, 20-character hex string)
    pub panose: Option<String>,
    /// Pitch family (optional)
    pub pitch_family: Option<i8>,
    /// Character set (optional)
    pub charset: Option<i8>,
}

impl ThemeFontDef {
    /// Default pitch family value per spec.
    pub const DEFAULT_PITCH_FAMILY: i8 = 0;
    /// Default charset value per spec.
    pub const DEFAULT_CHARSET: i8 = 1;

    /// Create a new font definition with just the typeface.
    pub fn new(typeface: impl Into<String>) -> Self {
        Self {
            typeface: typeface.into(),
            panose: None,
            pitch_family: None,
            charset: None,
        }
    }

    /// Create a new font definition with typeface and PANOSE.
    pub fn with_panose(typeface: impl Into<String>, panose: impl Into<String>) -> Self {
        Self {
            typeface: typeface.into(),
            panose: Some(panose.into()),
            pitch_family: None,
            charset: None,
        }
    }
}

// =============================================================================
// Script Font
// =============================================================================

/// Script-specific font mapping (e.g., "Jpan" -> "Yu Gothic").
#[derive(Debug, Clone, PartialEq, Eq, serde::Serialize, serde::Deserialize)]
pub struct ScriptFont {
    /// Script identifier (e.g., "Jpan", "Hans", "Arab")
    pub script: String,
    /// Font typeface name
    pub typeface: String,
}

impl ScriptFont {
    /// Create a new script font mapping.
    pub fn new(script: impl Into<String>, typeface: impl Into<String>) -> Self {
        Self {
            script: script.into(),
            typeface: typeface.into(),
        }
    }
}
