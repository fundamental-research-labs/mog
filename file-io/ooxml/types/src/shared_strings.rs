//! Shared string table types (ECMA-376 Part 1, Section 18.4 — SpreadsheetML Shared Strings).
//!
//! Types modelling the contents of `xl/sharedStrings.xml`: the shared string
//! table (`CT_Sst`), rich string type (`CT_Rst`), rich text runs (`CT_RElt`),
//! run properties (`CT_RPrElt`), and phonetic annotations.
//!
//! The `Rst` type is also used by comments (`Comment.text`) and inline strings.

// ============================================================================
// UnderlineValues — ST_UnderlineValues
// ============================================================================

/// Underline style for rich text runs (ECMA-376 ST_UnderlineValues).
///
/// Note: this is distinct from `styles::UnderlineStyle` which is used in cell
/// formatting. This enum is used within `RPrElt` (run properties for rich text).
#[derive(
    Debug,
    Clone,
    Copy,
    PartialEq,
    Eq,
    Hash,
    Default,
    serde::Serialize,
    serde::Deserialize,
    xml_derive::XmlEnum,
)]
pub enum UnderlineValues {
    /// Single underline (default).
    #[default]
    #[xml("single")]
    Single,
    /// Double underline.
    #[xml("double")]
    Double,
    /// Single accounting underline (extends to column width).
    #[xml("singleAccounting")]
    SingleAccounting,
    /// Double accounting underline.
    #[xml("doubleAccounting")]
    DoubleAccounting,
    /// No underline.
    #[xml("none")]
    None,
}

// ============================================================================
// VerticalAlignRun (re-exported from shared module)
// ============================================================================

pub use crate::shared::VerticalAlignRun;

// ============================================================================
// FontScheme — ST_FontScheme
// ============================================================================

/// Font scheme classification (ECMA-376 ST_FontScheme).
///
/// Indicates whether a font is part of the theme's major or minor font set.
#[derive(
    Debug,
    Clone,
    Copy,
    PartialEq,
    Eq,
    Hash,
    Default,
    serde::Serialize,
    serde::Deserialize,
    xml_derive::XmlEnum,
)]
pub enum FontScheme {
    /// No scheme — font is not themed (default).
    #[default]
    #[xml("none")]
    None,
    /// Major font scheme (headings).
    #[xml("major")]
    Major,
    /// Minor font scheme (body text).
    #[xml("minor")]
    Minor,
}

// ============================================================================
// PhoneticType — ST_PhoneticType
// ============================================================================

/// Phonetic text type (ECMA-376 ST_PhoneticType).
///
/// Controls the character set used for phonetic (furigana) annotations in
/// Japanese text.
#[derive(
    Debug,
    Clone,
    Copy,
    PartialEq,
    Eq,
    Hash,
    Default,
    serde::Serialize,
    serde::Deserialize,
    xml_derive::XmlEnum,
)]
pub enum PhoneticType {
    /// Half-width katakana.
    #[xml("halfwidthKatakana")]
    HalfwidthKatakana,
    /// Full-width katakana (default).
    #[default]
    #[xml("fullwidthKatakana")]
    FullwidthKatakana,
    /// Hiragana.
    #[xml("Hiragana")]
    Hiragana,
    /// No conversion.
    #[xml("noConversion")]
    NoConversion,
}

// ============================================================================
// PhoneticAlignment — ST_PhoneticAlignment
// ============================================================================

/// Phonetic text alignment (ECMA-376 ST_PhoneticAlignment).
///
/// Controls the horizontal alignment of phonetic (furigana) annotations.
#[derive(
    Debug,
    Clone,
    Copy,
    PartialEq,
    Eq,
    Hash,
    Default,
    serde::Serialize,
    serde::Deserialize,
    xml_derive::XmlEnum,
)]
pub enum PhoneticAlignment {
    /// No control over alignment.
    #[xml("noControl")]
    NoControl,
    /// Left-aligned (default).
    #[default]
    #[xml("left")]
    Left,
    /// Center-aligned.
    #[xml("center")]
    Center,
    /// Distributed (justified).
    #[xml("distributed")]
    Distributed,
}

// ============================================================================
// Sst — CT_Sst (Shared String Table)
// ============================================================================

/// Shared string table root element (ECMA-376 CT_Sst).
///
/// The `<sst>` element is the root of `xl/sharedStrings.xml`. It contains all
/// unique string values referenced by cells in the workbook. Each `<si>` child
/// is a shared string item represented as an [`Rst`].
///
/// # Attributes
/// - `count` — total number of string references in all cells (may exceed `si.len()`).
/// - `unique_count` — number of unique strings (should equal `si.len()`).
#[derive(Debug, Clone, PartialEq, serde::Serialize, serde::Deserialize, Default)]
pub struct Sst {
    /// Total number of string references across all cells (`@count`).
    pub count: Option<u32>,
    /// Number of unique strings in the table (`@uniqueCount`).
    pub unique_count: Option<u32>,
    /// Shared string items (`<si>` elements).
    pub si: Vec<Rst>,
    /// Extension list for vendor-specific data (CT_ExtensionList).
    pub ext_lst: Option<crate::ExtensionList>,
}

// ============================================================================
// Rst — CT_Rst (Rich String Type)
// ============================================================================

/// Rich string type (ECMA-376 CT_Rst).
///
/// Used as the content type for shared strings (`<si>`), inline strings
/// (`<is>`), and comment text (`<text>`). A rich string can contain either:
///
/// - **Plain text** — a single `<t>` child with unformatted text.
/// - **Rich text** — one or more `<r>` runs, each with optional formatting.
///
/// Both forms may include phonetic annotation runs (`<rPh>`) and phonetic
/// properties (`<phoneticPr>`) for Japanese text.
#[derive(Debug, Clone, PartialEq, serde::Serialize, serde::Deserialize, Default)]
pub struct Rst {
    /// Plain text content (`<t>` element). Present when the string has no
    /// per-run formatting.
    pub t: Option<String>,
    /// Rich text runs (`<r>` elements). Each run pairs optional formatting
    /// with a text fragment.
    pub r: Vec<RElt>,
    /// Phonetic (furigana) runs (`<rPh>` elements).
    pub r_ph: Vec<PhoneticRun>,
    /// Phonetic properties (`<phoneticPr>` element).
    pub phonetic_pr: Option<PhoneticPr>,
}

// ============================================================================
// RElt — CT_RElt (Rich Text Run)
// ============================================================================

/// A single rich text run (ECMA-376 CT_RElt).
///
/// Pairs a text fragment (`<t>`) with optional run properties (`<rPr>`) that
/// control the formatting of that fragment.
#[derive(Debug, Clone, PartialEq, serde::Serialize, serde::Deserialize, Default)]
pub struct RElt {
    /// Run properties (`<rPr>`) — font, colour, size, etc.
    pub r_pr: Option<RPrElt>,
    /// Text content (`<t>`) — required.
    pub t: String,
}

// ============================================================================
// RPrElt — CT_RPrElt (Run Properties)
// ============================================================================

/// Run properties for a rich text run (ECMA-376 CT_RPrElt).
///
/// Contains up to 15 optional child elements that control the visual
/// appearance of a text run within a shared/inline string or comment.
///
/// # Colour
/// The `color` field re-uses [`crate::styles::ColorDef`] from the styles
/// module, which supports theme, RGB, indexed, and automatic colours.
#[derive(Debug, Clone, PartialEq, serde::Serialize, serde::Deserialize, Default)]
pub struct RPrElt {
    /// Bold (`<b>`).
    pub b: Option<bool>,
    /// Italic (`<i>`).
    pub i: Option<bool>,
    /// Strikethrough (`<strike>`).
    pub strike: Option<bool>,
    /// Condense (East Asian layout) (`<condense>`).
    pub condense: Option<bool>,
    /// Extend (East Asian layout) (`<extend>`).
    pub extend: Option<bool>,
    /// Outline font effect (`<outline>`).
    pub outline: Option<bool>,
    /// Shadow font effect (`<shadow>`).
    pub shadow: Option<bool>,
    /// Underline style (`<u>`).
    pub u: Option<UnderlineValues>,
    /// Superscript / subscript (`<vertAlign>`).
    pub vert_align: Option<VerticalAlignRun>,
    /// Font size in points (`<sz>`).
    pub sz: Option<f64>,
    /// Font colour (`<color>`). Re-uses the colour definition from styles.
    pub color: Option<crate::styles::ColorDef>,
    /// Font name (`<rFont>`).
    pub r_font: Option<String>,
    /// Font family number (`<family>`, 0–14).
    pub family: Option<u32>,
    /// Character set (`<charset>`).
    pub charset: Option<u32>,
    /// Font scheme — major, minor, or none (`<scheme>`).
    pub scheme: Option<FontScheme>,
}

// ============================================================================
// PhoneticRun — CT_PhoneticRun
// ============================================================================

/// Phonetic (furigana) text run (ECMA-376 CT_PhoneticRun).
///
/// Associates a phonetic annotation with a range of base characters.
///
/// # Attributes
/// - `sb` — start index into the base text (0-based, inclusive).
/// - `eb` — end index into the base text (0-based, exclusive).
#[derive(Debug, Clone, PartialEq, serde::Serialize, serde::Deserialize, Default)]
pub struct PhoneticRun {
    /// Start base character index (`@sb`, required).
    pub sb: u32,
    /// End base character index (`@eb`, required).
    pub eb: u32,
    /// Phonetic text content (`<t>`, required).
    pub t: String,
}

// ============================================================================
// PhoneticPr — CT_PhoneticPr (Phonetic Properties)
// ============================================================================

/// Phonetic properties for a string (ECMA-376 CT_PhoneticPr).
///
/// Configures the font and display style for phonetic (furigana) annotations.
#[derive(Debug, Clone, PartialEq, serde::Serialize, serde::Deserialize)]
pub struct PhoneticPr {
    /// Font ID referencing the workbook's font table (`@fontId`, required).
    pub font_id: u32,
    /// Phonetic text type (`@type`, XSD optional, default: `FullwidthKatakana`).
    pub r#type: Option<PhoneticType>,
    /// Phonetic text alignment (`@alignment`, default: `Left`).
    pub alignment: PhoneticAlignment,
}

impl PhoneticPr {
    /// Effective phonetic type (defaults to `FullwidthKatakana` when absent per XSD).
    #[must_use]
    pub fn effective_type(&self) -> PhoneticType {
        self.r#type.unwrap_or(PhoneticType::FullwidthKatakana)
    }
}

impl Default for PhoneticPr {
    fn default() -> Self {
        Self {
            font_id: 0,
            r#type: None,
            alignment: PhoneticAlignment::Left,
        }
    }
}

// ============================================================================
// Tests
// ============================================================================

#[cfg(test)]
mod tests {
    use super::*;

    // --- UnderlineValues ---

    #[test]
    fn underline_values_roundtrip() {
        let variants = [
            UnderlineValues::Single,
            UnderlineValues::Double,
            UnderlineValues::SingleAccounting,
            UnderlineValues::DoubleAccounting,
            UnderlineValues::None,
        ];
        for v in &variants {
            assert_eq!(UnderlineValues::from_ooxml(v.to_ooxml()), *v);
            assert_eq!(UnderlineValues::from_bytes(v.to_ooxml().as_bytes()), *v);
            assert_eq!(v.as_str(), v.to_ooxml());
        }
    }

    // --- VerticalAlignRun ---

    #[test]
    fn vert_align_run_roundtrip() {
        let variants = [
            VerticalAlignRun::Baseline,
            VerticalAlignRun::Superscript,
            VerticalAlignRun::Subscript,
        ];
        for v in &variants {
            assert_eq!(VerticalAlignRun::from_ooxml(v.to_ooxml()), *v);
            assert_eq!(VerticalAlignRun::from_bytes(v.to_ooxml().as_bytes()), *v);
            assert_eq!(v.as_str(), v.to_ooxml());
        }
    }

    // --- FontScheme ---

    #[test]
    fn font_scheme_roundtrip() {
        let variants = [FontScheme::None, FontScheme::Major, FontScheme::Minor];
        for v in &variants {
            assert_eq!(FontScheme::from_ooxml(v.to_ooxml()), *v);
            assert_eq!(FontScheme::from_bytes(v.to_ooxml().as_bytes()), *v);
            assert_eq!(v.as_str(), v.to_ooxml());
        }
    }

    // --- PhoneticType ---

    #[test]
    fn phonetic_type_roundtrip() {
        let variants = [
            PhoneticType::HalfwidthKatakana,
            PhoneticType::FullwidthKatakana,
            PhoneticType::Hiragana,
            PhoneticType::NoConversion,
        ];
        for v in &variants {
            assert_eq!(PhoneticType::from_ooxml(v.to_ooxml()), *v);
            assert_eq!(PhoneticType::from_bytes(v.to_ooxml().as_bytes()), *v);
            assert_eq!(v.as_str(), v.to_ooxml());
        }
    }

    // --- PhoneticAlignment ---

    #[test]
    fn phonetic_alignment_roundtrip() {
        let variants = [
            PhoneticAlignment::NoControl,
            PhoneticAlignment::Left,
            PhoneticAlignment::Center,
            PhoneticAlignment::Distributed,
        ];
        for v in &variants {
            assert_eq!(PhoneticAlignment::from_ooxml(v.to_ooxml()), *v);
            assert_eq!(PhoneticAlignment::from_bytes(v.to_ooxml().as_bytes()), *v);
            assert_eq!(v.as_str(), v.to_ooxml());
        }
    }

    // --- Unknown / fallback defaults ---

    #[test]
    fn unknown_enum_defaults() {
        assert_eq!(
            UnderlineValues::from_ooxml("bogus"),
            UnderlineValues::Single
        );
        assert_eq!(
            UnderlineValues::from_bytes(b"bogus"),
            UnderlineValues::Single
        );

        assert_eq!(
            VerticalAlignRun::from_ooxml("bogus"),
            VerticalAlignRun::Baseline
        );
        assert_eq!(
            VerticalAlignRun::from_bytes(b"bogus"),
            VerticalAlignRun::Baseline
        );

        assert_eq!(FontScheme::from_ooxml("bogus"), FontScheme::None);
        assert_eq!(FontScheme::from_bytes(b"bogus"), FontScheme::None);

        assert_eq!(
            PhoneticType::from_ooxml("bogus"),
            PhoneticType::FullwidthKatakana
        );
        assert_eq!(
            PhoneticType::from_bytes(b"bogus"),
            PhoneticType::FullwidthKatakana
        );

        assert_eq!(
            PhoneticAlignment::from_ooxml("bogus"),
            PhoneticAlignment::Left
        );
        assert_eq!(
            PhoneticAlignment::from_bytes(b"bogus"),
            PhoneticAlignment::Left
        );
    }

    // --- Struct defaults ---

    #[test]
    fn sst_default() {
        let sst = Sst::default();
        assert_eq!(sst.count, None);
        assert_eq!(sst.unique_count, None);
        assert!(sst.si.is_empty());
        assert!(sst.ext_lst.is_none());
    }

    #[test]
    fn rst_plain_text() {
        let rst = Rst {
            t: Some("hello".to_string()),
            ..Rst::default()
        };
        assert_eq!(rst.t.as_deref(), Some("hello"));
        assert!(rst.r.is_empty());
        assert!(rst.r_ph.is_empty());
        assert!(rst.phonetic_pr.is_none());
    }

    #[test]
    fn rst_rich_text() {
        let rst = Rst {
            r: vec![
                RElt {
                    r_pr: Some(RPrElt {
                        b: Some(true),
                        sz: Some(12.0),
                        ..RPrElt::default()
                    }),
                    t: "bold text".to_string(),
                },
                RElt {
                    r_pr: None,
                    t: " normal text".to_string(),
                },
            ],
            ..Rst::default()
        };
        assert!(rst.t.is_none());
        assert_eq!(rst.r.len(), 2);
        assert_eq!(rst.r[0].t, "bold text");
        assert_eq!(rst.r[0].r_pr.as_ref().unwrap().b, Some(true));
        assert_eq!(rst.r[0].r_pr.as_ref().unwrap().sz, Some(12.0));
        assert_eq!(rst.r[1].t, " normal text");
        assert!(rst.r[1].r_pr.is_none());
    }

    #[test]
    fn rpr_elt_default() {
        let rpr = RPrElt::default();
        assert_eq!(rpr.b, None);
        assert_eq!(rpr.i, None);
        assert_eq!(rpr.strike, None);
        assert_eq!(rpr.condense, None);
        assert_eq!(rpr.extend, None);
        assert_eq!(rpr.outline, None);
        assert_eq!(rpr.shadow, None);
        assert_eq!(rpr.u, None);
        assert_eq!(rpr.vert_align, None);
        assert_eq!(rpr.sz, None);
        assert_eq!(rpr.color, None);
        assert_eq!(rpr.r_font, None);
        assert_eq!(rpr.family, None);
        assert_eq!(rpr.charset, None);
        assert_eq!(rpr.scheme, None);
    }

    #[test]
    fn phonetic_pr_defaults() {
        let pr = PhoneticPr::default();
        assert_eq!(pr.font_id, 0);
        assert_eq!(pr.r#type, None);
        assert_eq!(pr.effective_type(), PhoneticType::FullwidthKatakana);
        assert_eq!(pr.alignment, PhoneticAlignment::Left);
    }
}
