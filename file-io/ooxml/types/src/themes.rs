//! Theme types (ECMA-376 DrawingML Theming — Part 1, Section 20.1.6).
//!
//! Canonical vocabulary types for Office theme definitions. These types are shared
//! by both the read (parser) and write (writer) sides of the xlsx-parser crate.
//!
//! # Overview
//!
//! A theme (`CT_OfficeStyleSheet`) contains:
//! - **Theme Elements** (`CT_BaseStyles`): color scheme, font scheme, format scheme
//! - **Object Defaults** (`CT_ObjectStyleDefaults`): default styles for shapes, lines, text
//! - **Extra Color Scheme List** (`CT_ColorSchemeList`): additional color scheme/mapping pairs
//! - **Custom Color List** (`CT_CustomColorList`): user-defined custom colors
//!
//! # Color Scheme (`CT_ColorScheme`)
//! 12 named color slots using `DrawingColor` (EG_ColorChoice) — dk1, lt1, dk2, lt2,
//! accent1-6, hlink, folHlink.
//!
//! # Font Scheme (`CT_FontScheme`)
//! Major (headings) and minor (body) font collections with script-specific mappings.
//!
//! # Format Scheme (`CT_FmtScheme`)
//! Fill styles, line styles, effect styles, and background fill styles.
//!
//! # Color Mapping (`CT_ColorMapping`)
//! Maps logical presentation slots (bg1, tx1, ...) to scheme color indices.

use crate::drawings::{
    DrawingColor, DrawingFill, EffectProperties, ExtensionList, Outline, Scene3D, Shape3D,
    SystemColorVal,
};

// =============================================================================
// Color Scheme
// =============================================================================

/// Theme color scheme with 12 named color slots (ECMA-376 CT_ColorScheme).
///
/// Each color slot holds a `DrawingColor` (EG_ColorChoice). In real Office themes,
/// dk1 and lt1 are typically system colors (`SysClr`), while the rest are sRGB colors.
#[derive(Debug, Clone, PartialEq, serde::Serialize, serde::Deserialize)]
pub struct ColorScheme {
    /// Scheme name (e.g., "Office")
    pub name: String,
    /// Dark 1 — primary dark color (usually black for text)
    pub dk1: DrawingColor,
    /// Light 1 — primary light color (usually white for background)
    pub lt1: DrawingColor,
    /// Dark 2 — secondary dark color
    pub dk2: DrawingColor,
    /// Light 2 — secondary light color
    pub lt2: DrawingColor,
    /// Accent color 1 (primary accent)
    pub accent1: DrawingColor,
    /// Accent color 2
    pub accent2: DrawingColor,
    /// Accent color 3
    pub accent3: DrawingColor,
    /// Accent color 4
    pub accent4: DrawingColor,
    /// Accent color 5
    pub accent5: DrawingColor,
    /// Accent color 6
    pub accent6: DrawingColor,
    /// Hyperlink color
    pub hlink: DrawingColor,
    /// Followed hyperlink color
    pub fol_hlink: DrawingColor,
    /// Extension list
    pub ext_lst: Option<ExtensionList>,
}

impl Default for ColorScheme {
    fn default() -> Self {
        Self::office_default()
    }
}

impl ColorScheme {
    /// Create the default Office color scheme (Office 2016+).
    ///
    /// dk1 and lt1 use system colors (windowText / window) as real Office themes do.
    /// All other slots use sRGB hex colors.
    pub fn office_default() -> Self {
        Self {
            name: "Office".to_string(),
            dk1: DrawingColor::SysClr {
                val: SystemColorVal::WindowText,
                last_clr: Some("000000".to_string()),
                transforms: vec![],
            },
            lt1: DrawingColor::SysClr {
                val: SystemColorVal::Window,
                last_clr: Some("FFFFFF".to_string()),
                transforms: vec![],
            },
            dk2: DrawingColor::SrgbClr {
                val: "44546A".to_string(),
                transforms: vec![],
            },
            lt2: DrawingColor::SrgbClr {
                val: "E7E6E6".to_string(),
                transforms: vec![],
            },
            accent1: DrawingColor::SrgbClr {
                val: "4472C4".to_string(),
                transforms: vec![],
            },
            accent2: DrawingColor::SrgbClr {
                val: "ED7D31".to_string(),
                transforms: vec![],
            },
            accent3: DrawingColor::SrgbClr {
                val: "A5A5A5".to_string(),
                transforms: vec![],
            },
            accent4: DrawingColor::SrgbClr {
                val: "FFC000".to_string(),
                transforms: vec![],
            },
            accent5: DrawingColor::SrgbClr {
                val: "5B9BD5".to_string(),
                transforms: vec![],
            },
            accent6: DrawingColor::SrgbClr {
                val: "70AD47".to_string(),
                transforms: vec![],
            },
            hlink: DrawingColor::SrgbClr {
                val: "0563C1".to_string(),
                transforms: vec![],
            },
            fol_hlink: DrawingColor::SrgbClr {
                val: "954F72".to_string(),
                transforms: vec![],
            },
            ext_lst: None,
        }
    }

    /// Get a color by theme index (0-11).
    ///
    /// Index mapping follows ECMA-376 clrScheme element order:
    /// 0=dk1, 1=lt1, 2=dk2, 3=lt2, 4-9=accent1-6, 10=hlink, 11=folHlink
    pub fn get_by_index(&self, index: u8) -> Option<&DrawingColor> {
        match index {
            0 => Some(&self.dk1),
            1 => Some(&self.lt1),
            2 => Some(&self.dk2),
            3 => Some(&self.lt2),
            4 => Some(&self.accent1),
            5 => Some(&self.accent2),
            6 => Some(&self.accent3),
            7 => Some(&self.accent4),
            8 => Some(&self.accent5),
            9 => Some(&self.accent6),
            10 => Some(&self.hlink),
            11 => Some(&self.fol_hlink),
            _ => None,
        }
    }

    /// Set a color by theme index (0-11).
    pub fn set_by_index(&mut self, index: u8, color: DrawingColor) {
        match index {
            0 => self.dk1 = color,
            1 => self.lt1 = color,
            2 => self.dk2 = color,
            3 => self.lt2 = color,
            4 => self.accent1 = color,
            5 => self.accent2 = color,
            6 => self.accent3 = color,
            7 => self.accent4 = color,
            8 => self.accent5 = color,
            9 => self.accent6 = color,
            10 => self.hlink = color,
            11 => self.fol_hlink = color,
            _ => {}
        }
    }

    /// Resolve a color slot to a hex RGB string (6 chars, e.g. "4472C4").
    ///
    /// For `SrgbClr`, returns the `val` directly.
    /// For `SysClr`, returns the `last_clr` if available.
    /// For other color types, returns `None` (would need full color resolution).
    pub fn resolve_hex(&self, index: u8) -> Option<String> {
        let color = self.get_by_index(index)?;
        match color {
            DrawingColor::SrgbClr { val, .. } => Some(val.clone()),
            DrawingColor::SysClr { last_clr, .. } => last_clr.clone(),
            _ => None,
        }
    }
}

// =============================================================================
// ST_ColorSchemeIndex
// =============================================================================

/// String-token enum for color mapping attributes (ECMA-376 ST_ColorSchemeIndex).
///
/// Used in `CT_ColorMapping` to map logical slots to scheme color indices.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, serde::Serialize, serde::Deserialize)]
pub enum ColorSchemeIndex {
    Dk1,
    Lt1,
    Dk2,
    Lt2,
    Accent1,
    Accent2,
    Accent3,
    Accent4,
    Accent5,
    Accent6,
    Hlink,
    FolHlink,
}

impl ColorSchemeIndex {
    /// Parse from OOXML attribute value.
    pub fn from_ooxml(s: &str) -> Option<Self> {
        match s {
            "dk1" => Some(Self::Dk1),
            "lt1" => Some(Self::Lt1),
            "dk2" => Some(Self::Dk2),
            "lt2" => Some(Self::Lt2),
            "accent1" => Some(Self::Accent1),
            "accent2" => Some(Self::Accent2),
            "accent3" => Some(Self::Accent3),
            "accent4" => Some(Self::Accent4),
            "accent5" => Some(Self::Accent5),
            "accent6" => Some(Self::Accent6),
            "hlink" => Some(Self::Hlink),
            "folHlink" => Some(Self::FolHlink),
            _ => None,
        }
    }

    /// Convert to OOXML attribute value.
    pub fn to_ooxml(&self) -> &'static str {
        match self {
            Self::Dk1 => "dk1",
            Self::Lt1 => "lt1",
            Self::Dk2 => "dk2",
            Self::Lt2 => "lt2",
            Self::Accent1 => "accent1",
            Self::Accent2 => "accent2",
            Self::Accent3 => "accent3",
            Self::Accent4 => "accent4",
            Self::Accent5 => "accent5",
            Self::Accent6 => "accent6",
            Self::Hlink => "hlink",
            Self::FolHlink => "folHlink",
        }
    }
}

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

// =============================================================================
// Theme Color Index
// =============================================================================

/// Theme color indices (0-11) for the 12 standard Office theme colors.
///
/// Order matches ECMA-376 clrScheme element order and `SchemeColor::to_theme_index()`:
/// Dk1=0, Lt1=1, Dk2=2, Lt2=3, Accent1-6=4-9, Hyperlink=10, FollowedHyperlink=11.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, serde::Serialize, serde::Deserialize)]
pub enum ThemeColorIndex {
    /// Dark 1 — Text 1 (usually black)
    Dark1 = 0,
    /// Light 1 — Background 1 (usually white)
    Light1 = 1,
    /// Dark 2 — Text 2
    Dark2 = 2,
    /// Light 2 — Background 2
    Light2 = 3,
    /// Accent color 1 (primary accent)
    Accent1 = 4,
    /// Accent color 2
    Accent2 = 5,
    /// Accent color 3
    Accent3 = 6,
    /// Accent color 4
    Accent4 = 7,
    /// Accent color 5
    Accent5 = 8,
    /// Accent color 6
    Accent6 = 9,
    /// Hyperlink color
    Hyperlink = 10,
    /// Followed hyperlink color
    FollowedHyperlink = 11,
}

impl ThemeColorIndex {
    /// Get all theme color indices in spec order.
    pub fn all() -> [ThemeColorIndex; 12] {
        [
            ThemeColorIndex::Dark1,
            ThemeColorIndex::Light1,
            ThemeColorIndex::Dark2,
            ThemeColorIndex::Light2,
            ThemeColorIndex::Accent1,
            ThemeColorIndex::Accent2,
            ThemeColorIndex::Accent3,
            ThemeColorIndex::Accent4,
            ThemeColorIndex::Accent5,
            ThemeColorIndex::Accent6,
            ThemeColorIndex::Hyperlink,
            ThemeColorIndex::FollowedHyperlink,
        ]
    }

    /// Convert to theme index (0-11).
    pub fn as_index(&self) -> u8 {
        *self as u8
    }

    /// Create from a numeric index (0-11).
    pub fn from_index(index: u8) -> Option<Self> {
        match index {
            0 => Some(Self::Dark1),
            1 => Some(Self::Light1),
            2 => Some(Self::Dark2),
            3 => Some(Self::Light2),
            4 => Some(Self::Accent1),
            5 => Some(Self::Accent2),
            6 => Some(Self::Accent3),
            7 => Some(Self::Accent4),
            8 => Some(Self::Accent5),
            9 => Some(Self::Accent6),
            10 => Some(Self::Hyperlink),
            11 => Some(Self::FollowedHyperlink),
            _ => None,
        }
    }
}

// =============================================================================
// Format Scheme (CT_FmtScheme)
// =============================================================================

/// Format scheme defining fill, line, and effect styles (ECMA-376 CT_FmtScheme).
///
/// Each style list typically has 3 entries (subtle, moderate, intense).
#[derive(Debug, Clone, PartialEq, serde::Serialize, serde::Deserialize, Default)]
pub struct FormatScheme {
    /// Scheme name (e.g., "Office")
    pub name: String,
    /// Fill style list (typically 3 entries: subtle, moderate, intense)
    pub fill_style_lst: Vec<DrawingFill>,
    /// Line style list (typically 3 entries)
    pub ln_style_lst: Vec<Outline>,
    /// Effect style list (typically 3 entries)
    pub effect_style_lst: Vec<EffectStyleItem>,
    /// Background fill style list (typically 3 entries)
    pub bg_fill_style_lst: Vec<DrawingFill>,
}

// =============================================================================
// Effect Style Item (CT_EffectStyleItem)
// =============================================================================

/// A single effect style entry within a format scheme (ECMA-376 CT_EffectStyleItem).
#[derive(Debug, Clone, PartialEq, serde::Serialize, serde::Deserialize, Default)]
pub struct EffectStyleItem {
    /// Effect properties (either an effect list or effect DAG)
    pub effect_properties: Option<EffectProperties>,
    /// Optional 3D scene properties
    pub scene_3d: Option<Scene3D>,
    /// Optional 3D shape properties
    pub sp_3d: Option<Shape3D>,
}

// =============================================================================
// Base Styles (CT_BaseStyles)
// =============================================================================

/// Theme elements: color scheme, font scheme, and format scheme (ECMA-376 CT_BaseStyles).
#[derive(Debug, Clone, PartialEq, serde::Serialize, serde::Deserialize, Default)]
pub struct BaseStyles {
    /// Color scheme
    pub clr_scheme: ColorScheme,
    /// Font scheme
    pub font_scheme: FontScheme,
    /// Format scheme
    pub fmt_scheme: FormatScheme,
    /// Extension list
    pub ext_lst: Option<ExtensionList>,
}

// =============================================================================
// Base Styles Override (CT_BaseStylesOverride)
// =============================================================================

/// Override for base styles, allowing partial replacement (ECMA-376 CT_BaseStylesOverride).
#[derive(Debug, Clone, PartialEq, serde::Serialize, serde::Deserialize, Default)]
pub struct BaseStylesOverride {
    /// Optional color scheme override
    pub clr_scheme: Option<ColorScheme>,
    /// Optional font scheme override
    pub font_scheme: Option<FontScheme>,
    /// Optional format scheme override
    pub fmt_scheme: Option<FormatScheme>,
}

// =============================================================================
// Color Mapping (CT_ColorMapping)
// =============================================================================

/// Maps logical color slots to scheme color indices (ECMA-376 CT_ColorMapping).
///
/// Used in slide masters and layouts to remap logical colors (bg1, tx1, etc.)
/// to scheme color slots (dk1, lt1, etc.).
#[derive(Debug, Clone, PartialEq, Eq, serde::Serialize, serde::Deserialize)]
pub struct ColorMapping {
    /// Background 1
    pub bg1: ColorSchemeIndex,
    /// Text 1
    pub tx1: ColorSchemeIndex,
    /// Background 2
    pub bg2: ColorSchemeIndex,
    /// Text 2
    pub tx2: ColorSchemeIndex,
    /// Accent 1
    pub accent1: ColorSchemeIndex,
    /// Accent 2
    pub accent2: ColorSchemeIndex,
    /// Accent 3
    pub accent3: ColorSchemeIndex,
    /// Accent 4
    pub accent4: ColorSchemeIndex,
    /// Accent 5
    pub accent5: ColorSchemeIndex,
    /// Accent 6
    pub accent6: ColorSchemeIndex,
    /// Hyperlink
    pub hlink: ColorSchemeIndex,
    /// Followed hyperlink
    pub fol_hlink: ColorSchemeIndex,
    /// Extension list
    pub ext_lst: Option<ExtensionList>,
}

impl ColorMapping {
    /// Create the identity mapping where each logical slot maps to its own scheme color.
    pub fn identity() -> Self {
        Self {
            bg1: ColorSchemeIndex::Lt1,
            tx1: ColorSchemeIndex::Dk1,
            bg2: ColorSchemeIndex::Lt2,
            tx2: ColorSchemeIndex::Dk2,
            accent1: ColorSchemeIndex::Accent1,
            accent2: ColorSchemeIndex::Accent2,
            accent3: ColorSchemeIndex::Accent3,
            accent4: ColorSchemeIndex::Accent4,
            accent5: ColorSchemeIndex::Accent5,
            accent6: ColorSchemeIndex::Accent6,
            hlink: ColorSchemeIndex::Hlink,
            fol_hlink: ColorSchemeIndex::FolHlink,
            ext_lst: None,
        }
    }
}

impl Default for ColorMapping {
    fn default() -> Self {
        Self::identity()
    }
}

// =============================================================================
// Color Mapping Override (CT_ColorMappingOverride)
// =============================================================================

/// Override for color mapping — either inherit from master or provide a full override
/// (ECMA-376 CT_ColorMappingOverride).
#[derive(Debug, Clone, PartialEq, Eq, serde::Serialize, serde::Deserialize, Default)]
pub enum ColorMappingOverride {
    /// Use the master color mapping (no override)
    #[default]
    MasterClrMapping,
    /// Provide a full override color mapping
    OverrideClrMapping(ColorMapping),
}

// =============================================================================
// Color Scheme And Mapping (CT_ColorSchemeAndMapping)
// =============================================================================

/// A color scheme paired with an optional color mapping (ECMA-376 CT_ColorSchemeAndMapping).
#[derive(Debug, Clone, PartialEq, serde::Serialize, serde::Deserialize)]
pub struct ColorSchemeAndMapping {
    /// The color scheme
    pub clr_scheme: ColorScheme,
    /// Optional color mapping
    pub clr_map: Option<ColorMapping>,
}

// =============================================================================
// Color Scheme List (CT_ColorSchemeList)
// =============================================================================

/// List of extra color scheme/mapping pairs (ECMA-376 CT_ColorSchemeList).
#[derive(Debug, Clone, PartialEq, serde::Serialize, serde::Deserialize, Default)]
pub struct ColorSchemeList {
    /// Extra color scheme entries
    pub extra_clr_scheme: Vec<ColorSchemeAndMapping>,
}

// =============================================================================
// Custom Color (CT_CustomColor)
// =============================================================================

/// A user-defined custom color (ECMA-376 CT_CustomColor).
#[derive(Debug, Clone, PartialEq, serde::Serialize, serde::Deserialize)]
pub struct CustomColor {
    /// Optional display name
    pub name: Option<String>,
    /// The color value
    pub color: DrawingColor,
}

// =============================================================================
// Custom Color List (CT_CustomColorList)
// =============================================================================

/// List of custom colors (ECMA-376 CT_CustomColorList).
#[derive(Debug, Clone, PartialEq, serde::Serialize, serde::Deserialize, Default)]
pub struct CustomColorList {
    /// Custom color entries
    pub cust_clr: Vec<CustomColor>,
}

// =============================================================================
// Default Shape Definition (CT_DefaultShapeDefinition)
// =============================================================================

/// Default shape definition (ECMA-376 CT_DefaultShapeDefinition, dml-main.xsd:2266).
///
/// The XSD defines required children `spPr` (CT_ShapeProperties), `bodyPr`
/// (CT_TextBodyProperties), and `lstStyle` (CT_TextListStyle), plus optional
/// `style` (CT_ShapeStyle) and `extLst`.
///
/// **Intentional simplification**: Stored as raw XML passthrough since the inner
/// structure is complex and rarely needed for spreadsheet processing. The raw XML
/// preserves full fidelity for roundtrip — `spPr`, `bodyPr`, and `lstStyle` are
/// all captured within `raw_xml`.
#[derive(Debug, Clone, PartialEq, Eq, serde::Serialize, serde::Deserialize, Default)]
pub struct DefaultShapeDefinition {
    /// Raw XML content of the shape definition (contains spPr, bodyPr, lstStyle, etc.)
    pub raw_xml: Option<String>,
}

// =============================================================================
// Object Style Defaults (CT_ObjectStyleDefaults)
// =============================================================================

/// Default styles for shapes, lines, and text boxes (ECMA-376 CT_ObjectStyleDefaults).
#[derive(Debug, Clone, PartialEq, Eq, serde::Serialize, serde::Deserialize, Default)]
pub struct ObjectStyleDefaults {
    /// Default shape definition
    pub sp_def: Option<DefaultShapeDefinition>,
    /// Default line definition
    pub ln_def: Option<DefaultShapeDefinition>,
    /// Default text definition
    pub tx_def: Option<DefaultShapeDefinition>,
    /// Extension list
    pub ext_lst: Option<ExtensionList>,
}

// =============================================================================
// Office Style Sheet (CT_OfficeStyleSheet)
// =============================================================================

/// Root theme element (ECMA-376 CT_OfficeStyleSheet).
///
/// Represents the `<a:theme>` root element in a theme part (e.g., `xl/theme/theme1.xml`).
#[derive(Debug, Clone, PartialEq, serde::Serialize, serde::Deserialize, Default)]
pub struct OfficeStyleSheet {
    /// Theme name
    pub name: String,
    /// Theme elements (color, font, format schemes)
    pub theme_elements: BaseStyles,
    /// Default styles for objects
    pub object_defaults: Option<ObjectStyleDefaults>,
    /// Extra color scheme list
    pub extra_clr_scheme_lst: Option<ColorSchemeList>,
    /// Custom color list
    pub cust_clr_lst: Option<CustomColorList>,
    /// Extension list
    pub ext_lst: Option<ExtensionList>,
}

// =============================================================================
// Clipboard Style Sheet (CT_ClipboardStyleSheet)
// =============================================================================

/// Clipboard style sheet for paste operations (ECMA-376 CT_ClipboardStyleSheet).
#[derive(Debug, Clone, PartialEq, serde::Serialize, serde::Deserialize)]
pub struct ClipboardStyleSheet {
    /// Theme elements (color, font, format schemes)
    pub theme_elements: BaseStyles,
    /// Color mapping
    pub clr_map: ColorMapping,
}

// =============================================================================
// Tests
// =============================================================================

#[cfg(test)]
mod tests {
    use super::*;

    // -----------------------------------------------------------------------
    // ColorScheme tests
    // -----------------------------------------------------------------------

    #[test]
    fn test_color_scheme_office_default() {
        let scheme = ColorScheme::office_default();
        assert_eq!(scheme.name, "Office");
        // dk1 is a system color
        assert!(matches!(
            &scheme.dk1,
            DrawingColor::SysClr {
                val: SystemColorVal::WindowText,
                ..
            }
        ));
        // lt1 is a system color
        assert!(matches!(
            &scheme.lt1,
            DrawingColor::SysClr {
                val: SystemColorVal::Window,
                ..
            }
        ));
        // accent1 is sRGB
        assert!(matches!(&scheme.accent1, DrawingColor::SrgbClr { val, .. } if val == "4472C4"));
        // hlink is sRGB
        assert!(matches!(&scheme.hlink, DrawingColor::SrgbClr { val, .. } if val == "0563C1"));
        // fol_hlink is sRGB
        assert!(matches!(&scheme.fol_hlink, DrawingColor::SrgbClr { val, .. } if val == "954F72"));
    }

    #[test]
    fn test_color_scheme_get_by_index() {
        let scheme = ColorScheme::office_default();
        // dk1 at index 0
        assert!(scheme.get_by_index(0).is_some());
        assert!(matches!(
            scheme.get_by_index(0).unwrap(),
            DrawingColor::SysClr {
                val: SystemColorVal::WindowText,
                ..
            }
        ));
        // lt1 at index 1
        assert!(matches!(
            scheme.get_by_index(1).unwrap(),
            DrawingColor::SysClr {
                val: SystemColorVal::Window,
                ..
            }
        ));
        // accent1 at index 4
        assert!(
            matches!(scheme.get_by_index(4).unwrap(), DrawingColor::SrgbClr { val, .. } if val == "4472C4")
        );
        // out of range
        assert_eq!(scheme.get_by_index(12), None);
    }

    #[test]
    fn test_color_scheme_set_by_index() {
        let mut scheme = ColorScheme::office_default();
        let red = DrawingColor::SrgbClr {
            val: "FF0000".to_string(),
            transforms: vec![],
        };
        scheme.set_by_index(4, red.clone());
        assert_eq!(scheme.accent1, red);
    }

    #[test]
    fn test_color_scheme_resolve_hex_srgb() {
        let scheme = ColorScheme::office_default();
        // accent1 (index 4) is SrgbClr "4472C4"
        assert_eq!(scheme.resolve_hex(4), Some("4472C4".to_string()));
        // accent2 (index 5)
        assert_eq!(scheme.resolve_hex(5), Some("ED7D31".to_string()));
    }

    #[test]
    fn test_color_scheme_resolve_hex_sysclr() {
        let scheme = ColorScheme::office_default();
        // dk1 (index 0) is SysClr with last_clr "000000"
        assert_eq!(scheme.resolve_hex(0), Some("000000".to_string()));
        // lt1 (index 1) is SysClr with last_clr "FFFFFF"
        assert_eq!(scheme.resolve_hex(1), Some("FFFFFF".to_string()));
    }

    #[test]
    fn test_color_scheme_resolve_hex_out_of_range() {
        let scheme = ColorScheme::office_default();
        assert_eq!(scheme.resolve_hex(12), None);
    }

    #[test]
    fn test_color_scheme_default_is_office() {
        let s1 = ColorScheme::default();
        let s2 = ColorScheme::office_default();
        assert_eq!(s1, s2);
    }

    // -----------------------------------------------------------------------
    // ColorSchemeIndex tests
    // -----------------------------------------------------------------------

    #[test]
    fn test_color_scheme_index_from_ooxml() {
        assert_eq!(
            ColorSchemeIndex::from_ooxml("dk1"),
            Some(ColorSchemeIndex::Dk1)
        );
        assert_eq!(
            ColorSchemeIndex::from_ooxml("lt1"),
            Some(ColorSchemeIndex::Lt1)
        );
        assert_eq!(
            ColorSchemeIndex::from_ooxml("accent1"),
            Some(ColorSchemeIndex::Accent1)
        );
        assert_eq!(
            ColorSchemeIndex::from_ooxml("folHlink"),
            Some(ColorSchemeIndex::FolHlink)
        );
        assert_eq!(ColorSchemeIndex::from_ooxml("invalid"), None);
    }

    #[test]
    fn test_color_scheme_index_to_ooxml() {
        assert_eq!(ColorSchemeIndex::Dk1.to_ooxml(), "dk1");
        assert_eq!(ColorSchemeIndex::Lt1.to_ooxml(), "lt1");
        assert_eq!(ColorSchemeIndex::Accent1.to_ooxml(), "accent1");
        assert_eq!(ColorSchemeIndex::FolHlink.to_ooxml(), "folHlink");
    }

    #[test]
    fn test_color_scheme_index_roundtrip() {
        let all = [
            ColorSchemeIndex::Dk1,
            ColorSchemeIndex::Lt1,
            ColorSchemeIndex::Dk2,
            ColorSchemeIndex::Lt2,
            ColorSchemeIndex::Accent1,
            ColorSchemeIndex::Accent2,
            ColorSchemeIndex::Accent3,
            ColorSchemeIndex::Accent4,
            ColorSchemeIndex::Accent5,
            ColorSchemeIndex::Accent6,
            ColorSchemeIndex::Hlink,
            ColorSchemeIndex::FolHlink,
        ];
        for idx in &all {
            let s = idx.to_ooxml();
            let parsed = ColorSchemeIndex::from_ooxml(s).unwrap();
            assert_eq!(*idx, parsed);
        }
    }

    // -----------------------------------------------------------------------
    // FontScheme tests
    // -----------------------------------------------------------------------

    #[test]
    fn test_font_scheme_office_default() {
        let scheme = FontScheme::office_default();
        assert_eq!(scheme.name, "Office");
        assert_eq!(scheme.major_font.latin.typeface, "Calibri Light");
        assert_eq!(scheme.minor_font.latin.typeface, "Calibri");
        assert!(scheme.ext_lst.is_none());
    }

    #[test]
    fn test_font_scheme_simple() {
        let scheme = FontScheme::simple("Custom", "Arial", "Times New Roman");
        assert_eq!(scheme.name, "Custom");
        assert_eq!(scheme.major_font.latin.typeface, "Arial");
        assert_eq!(scheme.minor_font.latin.typeface, "Times New Roman");
    }

    #[test]
    fn test_font_scheme_default_is_office() {
        let s1 = FontScheme::default();
        let s2 = FontScheme::office_default();
        assert_eq!(s1, s2);
    }

    // -----------------------------------------------------------------------
    // FontCollection tests
    // -----------------------------------------------------------------------

    #[test]
    fn test_font_collection_office_major() {
        let collection = FontCollection::office_major();
        assert_eq!(collection.latin.typeface, "Calibri Light");
        assert!(collection.latin.panose.is_some());
        assert_eq!(collection.ea.typeface, "");
        assert_eq!(collection.cs.typeface, "");
        assert!(!collection.script_fonts.is_empty());
    }

    #[test]
    fn test_font_collection_office_minor() {
        let collection = FontCollection::office_minor();
        assert_eq!(collection.latin.typeface, "Calibri");
        assert!(collection.latin.panose.is_some());
        assert_eq!(collection.ea.typeface, "");
        assert_eq!(collection.cs.typeface, "");
        assert!(!collection.script_fonts.is_empty());
    }

    #[test]
    fn test_font_collection_ea_cs_required() {
        // ea and cs are now required (not Option)
        let collection = FontCollection::new("Arial");
        let _ea: &ThemeFontDef = &collection.ea;
        let _cs: &ThemeFontDef = &collection.cs;
        assert_eq!(collection.ea.typeface, "");
        assert_eq!(collection.cs.typeface, "");
    }

    // -----------------------------------------------------------------------
    // ThemeFontDef tests
    // -----------------------------------------------------------------------

    #[test]
    fn test_theme_font_def_new() {
        let font = ThemeFontDef::new("Calibri");
        assert_eq!(font.typeface, "Calibri");
        assert!(font.panose.is_none());
    }

    #[test]
    fn test_theme_font_def_with_panose() {
        let font = ThemeFontDef::with_panose("Calibri Light", "020F0302020204030204");
        assert_eq!(font.typeface, "Calibri Light");
        assert_eq!(font.panose, Some("020F0302020204030204".to_string()));
    }

    #[test]
    fn test_theme_font_def_constants() {
        assert_eq!(ThemeFontDef::DEFAULT_PITCH_FAMILY, 0i8);
        assert_eq!(ThemeFontDef::DEFAULT_CHARSET, 1i8);
    }

    // -----------------------------------------------------------------------
    // ScriptFont tests
    // -----------------------------------------------------------------------

    #[test]
    fn test_script_font_new() {
        let sf = ScriptFont::new("Jpan", "Yu Gothic");
        assert_eq!(sf.script, "Jpan");
        assert_eq!(sf.typeface, "Yu Gothic");
    }

    // -----------------------------------------------------------------------
    // ThemeColorIndex tests
    // -----------------------------------------------------------------------

    #[test]
    fn test_theme_color_index_all() {
        let all = ThemeColorIndex::all();
        assert_eq!(all.len(), 12);
        assert_eq!(all[0], ThemeColorIndex::Dark1);
        assert_eq!(all[1], ThemeColorIndex::Light1);
        assert_eq!(all[2], ThemeColorIndex::Dark2);
        assert_eq!(all[3], ThemeColorIndex::Light2);
        assert_eq!(all[11], ThemeColorIndex::FollowedHyperlink);
    }

    #[test]
    fn test_theme_color_index_as_index() {
        assert_eq!(ThemeColorIndex::Dark1.as_index(), 0);
        assert_eq!(ThemeColorIndex::Light1.as_index(), 1);
        assert_eq!(ThemeColorIndex::Dark2.as_index(), 2);
        assert_eq!(ThemeColorIndex::Light2.as_index(), 3);
        assert_eq!(ThemeColorIndex::Accent1.as_index(), 4);
        assert_eq!(ThemeColorIndex::FollowedHyperlink.as_index(), 11);
    }

    #[test]
    fn test_theme_color_index_from_index() {
        assert_eq!(ThemeColorIndex::from_index(0), Some(ThemeColorIndex::Dark1));
        assert_eq!(
            ThemeColorIndex::from_index(1),
            Some(ThemeColorIndex::Light1)
        );
        assert_eq!(
            ThemeColorIndex::from_index(4),
            Some(ThemeColorIndex::Accent1)
        );
        assert_eq!(
            ThemeColorIndex::from_index(11),
            Some(ThemeColorIndex::FollowedHyperlink)
        );
        assert_eq!(ThemeColorIndex::from_index(12), None);
    }

    #[test]
    fn test_theme_color_index_roundtrip() {
        for i in 0..12u8 {
            let idx = ThemeColorIndex::from_index(i).unwrap();
            assert_eq!(idx.as_index(), i);
        }
    }

    // -----------------------------------------------------------------------
    // ColorMapping tests
    // -----------------------------------------------------------------------

    #[test]
    fn test_color_mapping_identity() {
        let mapping = ColorMapping::identity();
        assert_eq!(mapping.bg1, ColorSchemeIndex::Lt1);
        assert_eq!(mapping.tx1, ColorSchemeIndex::Dk1);
        assert_eq!(mapping.bg2, ColorSchemeIndex::Lt2);
        assert_eq!(mapping.tx2, ColorSchemeIndex::Dk2);
        assert_eq!(mapping.accent1, ColorSchemeIndex::Accent1);
        assert_eq!(mapping.accent2, ColorSchemeIndex::Accent2);
        assert_eq!(mapping.accent3, ColorSchemeIndex::Accent3);
        assert_eq!(mapping.accent4, ColorSchemeIndex::Accent4);
        assert_eq!(mapping.accent5, ColorSchemeIndex::Accent5);
        assert_eq!(mapping.accent6, ColorSchemeIndex::Accent6);
        assert_eq!(mapping.hlink, ColorSchemeIndex::Hlink);
        assert_eq!(mapping.fol_hlink, ColorSchemeIndex::FolHlink);
        assert!(mapping.ext_lst.is_none());
    }

    #[test]
    fn test_color_mapping_default_is_identity() {
        let m1 = ColorMapping::default();
        let m2 = ColorMapping::identity();
        assert_eq!(m1, m2);
    }

    // -----------------------------------------------------------------------
    // ColorMappingOverride tests
    // -----------------------------------------------------------------------

    #[test]
    fn test_color_mapping_override_default() {
        let o = ColorMappingOverride::default();
        assert!(matches!(o, ColorMappingOverride::MasterClrMapping));
    }

    #[test]
    fn test_color_mapping_override_with_mapping() {
        let mapping = ColorMapping::identity();
        let o = ColorMappingOverride::OverrideClrMapping(mapping);
        assert!(matches!(o, ColorMappingOverride::OverrideClrMapping(_)));
    }

    // -----------------------------------------------------------------------
    // FormatScheme tests
    // -----------------------------------------------------------------------

    #[test]
    fn test_format_scheme_default() {
        let fs = FormatScheme::default();
        assert_eq!(fs.name, "");
        assert!(fs.fill_style_lst.is_empty());
        assert!(fs.ln_style_lst.is_empty());
        assert!(fs.effect_style_lst.is_empty());
        assert!(fs.bg_fill_style_lst.is_empty());
    }

    // -----------------------------------------------------------------------
    // EffectStyleItem tests
    // -----------------------------------------------------------------------

    #[test]
    fn test_effect_style_item_default() {
        let item = EffectStyleItem::default();
        assert!(item.effect_properties.is_none());
        assert!(item.scene_3d.is_none());
        assert!(item.sp_3d.is_none());
    }

    // -----------------------------------------------------------------------
    // BaseStyles tests
    // -----------------------------------------------------------------------

    #[test]
    fn test_base_styles_default() {
        let bs = BaseStyles::default();
        assert_eq!(bs.clr_scheme, ColorScheme::default());
        assert_eq!(bs.font_scheme, FontScheme::default());
        assert!(bs.ext_lst.is_none());
    }

    // -----------------------------------------------------------------------
    // BaseStylesOverride tests
    // -----------------------------------------------------------------------

    #[test]
    fn test_base_styles_override_default() {
        let bso = BaseStylesOverride::default();
        assert!(bso.clr_scheme.is_none());
        assert!(bso.font_scheme.is_none());
        assert!(bso.fmt_scheme.is_none());
    }

    // -----------------------------------------------------------------------
    // OfficeStyleSheet tests
    // -----------------------------------------------------------------------

    #[test]
    fn test_office_style_sheet_default() {
        let sheet = OfficeStyleSheet::default();
        assert_eq!(sheet.name, "");
        assert!(sheet.object_defaults.is_none());
        assert!(sheet.extra_clr_scheme_lst.is_none());
        assert!(sheet.cust_clr_lst.is_none());
        assert!(sheet.ext_lst.is_none());
    }

    // -----------------------------------------------------------------------
    // CustomColor / CustomColorList tests
    // -----------------------------------------------------------------------

    #[test]
    fn test_custom_color_construction() {
        let cc = CustomColor {
            name: Some("My Red".to_string()),
            color: DrawingColor::SrgbClr {
                val: "FF0000".to_string(),
                transforms: vec![],
            },
        };
        assert_eq!(cc.name, Some("My Red".to_string()));
    }

    #[test]
    fn test_custom_color_list_default() {
        let ccl = CustomColorList::default();
        assert!(ccl.cust_clr.is_empty());
    }

    // -----------------------------------------------------------------------
    // ObjectStyleDefaults tests
    // -----------------------------------------------------------------------

    #[test]
    fn test_object_style_defaults_default() {
        let osd = ObjectStyleDefaults::default();
        assert!(osd.sp_def.is_none());
        assert!(osd.ln_def.is_none());
        assert!(osd.tx_def.is_none());
        assert!(osd.ext_lst.is_none());
    }

    // -----------------------------------------------------------------------
    // DefaultShapeDefinition tests
    // -----------------------------------------------------------------------

    #[test]
    fn test_default_shape_definition() {
        let dsd = DefaultShapeDefinition::default();
        assert!(dsd.raw_xml.is_none());

        let dsd2 = DefaultShapeDefinition {
            raw_xml: Some("<xml/>".to_string()),
        };
        assert_eq!(dsd2.raw_xml, Some("<xml/>".to_string()));
    }

    // -----------------------------------------------------------------------
    // ColorSchemeAndMapping tests
    // -----------------------------------------------------------------------

    #[test]
    fn test_color_scheme_and_mapping() {
        let csm = ColorSchemeAndMapping {
            clr_scheme: ColorScheme::default(),
            clr_map: Some(ColorMapping::identity()),
        };
        assert!(csm.clr_map.is_some());
    }

    // -----------------------------------------------------------------------
    // ColorSchemeList tests
    // -----------------------------------------------------------------------

    #[test]
    fn test_color_scheme_list_default() {
        let csl = ColorSchemeList::default();
        assert!(csl.extra_clr_scheme.is_empty());
    }

    // -----------------------------------------------------------------------
    // ClipboardStyleSheet tests
    // -----------------------------------------------------------------------

    #[test]
    fn test_clipboard_style_sheet() {
        let css = ClipboardStyleSheet {
            theme_elements: BaseStyles::default(),
            clr_map: ColorMapping::identity(),
        };
        assert_eq!(css.clr_map, ColorMapping::identity());
    }
}
