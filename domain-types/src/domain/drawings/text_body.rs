//! CT_TextBody parity — lossless mirror of the OOXML text body surface for
//! `<a:txBody>`.
//!
//! Adds a lossless `TextBody` domain struct parallel to the simplified
//! `ShapeText` that lives on `FloatingObjectData::Shape` / `Textbox`.
//! Existing `ShapeText` callers stay untouched; writers that want
//! byte-identical CT_TextBody round-trip consult the new `text_body` sidecar
//! when present and fall back to the simplified `ShapeText` when absent.
//!
//! Surface covered (matches `ooxml_types::drawings::TextBody`):
//!
//! - `bodyPr` — anchor, anchorCtr, wrap, insets, spAutoFit / normAutofit /
//!   noAutofit, numCol, spcCol, rot, vert, vert/horz overflow,
//!   spcFirstLastPara, fromWordArt, forceAA, compatLnSpc, prstTxWarp,
//!   scene3d / sp3d / flatTx.
//! - `lstStyle` — defPPr + lvl1pPr…lvl9pPr.
//! - `<a:p>` — pPr + content (runs, line breaks, fields) + endParaRPr.
//! - `<a:r>`, `<a:br>`, `<a:fld>` — CT_RegularTextRun / LineBreak / Field.
//! - Paragraph props — marL / marR / lvl / indent / algn / defTabSz / rtl /
//!   eaLnBrk / fontAlgn / latinLnBrk / hangingPunct / lnSpc / spcBef /
//!   spcAft / buClr / buSzPct / buSzPts / buFontTx / buNone / buAutoNum /
//!   buChar / tabLst / defRPr.
//! - Run props — sz / b / i / u / strike / kern / cap / spc / baseline /
//!   normalizeH / noProof / dirty / err / smtClean / smtId / bmk / lang /
//!   altLang / latin / ea / cs / sym / color / highlight / ln / fill /
//!   effectLst-as-opaque / underlineLine / underlineFill / rtl /
//!   hlinkClick / hlinkMouseOver / extLst.
//!
//! Deep-nested sub-structures that aren't primary UI surfaces (effect DAGs,
//! geometry guides under prstTxWarp beyond the preset token) are preserved
//! via raw-xml fallback.
//!
//! `Default` emits no JSON keys; all fields skip-if-none.

use serde::{Deserialize, Serialize};

use super::color::DomainDrawingColor;
use super::hyperlink::HyperlinkRef;
use super::scene::SceneSettings;
use super::shape_3d::Shape3DSettings;

// ===========================================================================
// TextBody
// ===========================================================================

/// Lossless CT_TextBody domain mirror.
#[derive(Debug, Clone, PartialEq, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
#[serde(default)]
pub struct TextBody {
    /// `<a:bodyPr>` properties.
    #[serde(skip_serializing_if = "TextBodyProps::is_empty")]
    pub body_pr: TextBodyProps,
    /// `<a:lstStyle>` — default + 9 level paragraph properties.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub lst_style: Option<TextListStyle>,
    /// Paragraphs `<a:p>`.
    #[serde(skip_serializing_if = "Vec::is_empty")]
    pub paragraphs: Vec<TextParagraph>,
}

// ===========================================================================
// TextBodyProps (CT_TextBodyProperties)
// ===========================================================================

/// Text body properties (`<a:bodyPr>`).
#[derive(Debug, Clone, PartialEq, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
#[serde(default)]
pub struct TextBodyProps {
    /// Rotation `@rot` (60_000ths of a degree).
    #[serde(skip_serializing_if = "Option::is_none")]
    pub rot: Option<i32>,
    /// Vertical anchor `@anchor` token: `"t" | "ctr" | "b" | "just" | "dist"`.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub anchor: Option<String>,
    /// Anchor at centre `@anchorCtr`.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub anchor_ctr: Option<bool>,
    /// Wrap token `@wrap`: `"none" | "square"`.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub wrap: Option<String>,
    /// Left inset in EMUs (`@lIns`).
    #[serde(skip_serializing_if = "Option::is_none")]
    pub l_ins: Option<i64>,
    /// Top inset in EMUs (`@tIns`).
    #[serde(skip_serializing_if = "Option::is_none")]
    pub t_ins: Option<i64>,
    /// Right inset in EMUs (`@rIns`).
    #[serde(skip_serializing_if = "Option::is_none")]
    pub r_ins: Option<i64>,
    /// Bottom inset in EMUs (`@bIns`).
    #[serde(skip_serializing_if = "Option::is_none")]
    pub b_ins: Option<i64>,
    /// Number of text columns (`@numCol`).
    #[serde(skip_serializing_if = "Option::is_none")]
    pub num_col: Option<u32>,
    /// Space between columns in EMUs (`@spcCol`).
    #[serde(skip_serializing_if = "Option::is_none")]
    pub spc_col: Option<i64>,
    /// RTL columns (`@rtlCol`).
    #[serde(skip_serializing_if = "Option::is_none")]
    pub rtl_col: Option<bool>,
    /// Space first and last paragraph (`@spcFirstLastPara`).
    #[serde(skip_serializing_if = "Option::is_none")]
    pub spc_first_last_para: Option<bool>,
    /// Vertical text type `@vert` token.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub vert: Option<String>,
    /// Vertical overflow token `@vertOverflow`.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub vert_overflow: Option<String>,
    /// Horizontal overflow token `@horzOverflow`.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub horz_overflow: Option<String>,
    /// Upright text `@upright`.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub upright: Option<bool>,
    /// Compat line spacing `@compatLnSpc`.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub compat_ln_spc: Option<bool>,
    /// Force anti-alias `@forceAA`.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub force_aa: Option<bool>,
    /// From WordArt `@fromWordArt`.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub from_word_art: Option<bool>,
    /// Autofit choice (noAutofit / normAutofit / spAutoFit).
    #[serde(skip_serializing_if = "Option::is_none")]
    pub autofit: Option<TextAutofit>,
    /// Preset text warp `<a:prstTxWarp>`.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub prst_tx_warp: Option<PresetTextWarp>,
    /// 3D scene `<a:scene3d>`.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub scene3d: Option<SceneSettings>,
    /// 3D shape `<a:sp3d>` (EG_Text3D choice).
    #[serde(skip_serializing_if = "Option::is_none")]
    pub sp3d: Option<Shape3DSettings>,
    /// Flat text `<a:flatTx z="...">` (EG_Text3D choice).
    #[serde(skip_serializing_if = "Option::is_none")]
    pub flat_tx_z: Option<i64>,
    /// Extension list (opaque).
    #[serde(skip_serializing_if = "Option::is_none")]
    pub ext_lst: Option<String>,
}

impl TextBodyProps {
    /// True when no field carries a value.
    pub fn is_empty(&self) -> bool {
        *self == Self::default()
    }
}

/// Text autofit choice — `<a:noAutofit/>`, `<a:normAutofit …/>`, or `<a:spAutoFit/>`.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(tag = "type", rename_all = "camelCase")]
pub enum TextAutofit {
    /// `<a:noAutofit/>`.
    NoAutofit,
    /// `<a:normAutofit fontScale="..." lnSpcReduction="..."/>`.
    #[serde(rename_all = "camelCase")]
    NormAutofit {
        #[serde(default, skip_serializing_if = "Option::is_none")]
        font_scale: Option<i32>,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        ln_spc_reduction: Option<i32>,
    },
    /// `<a:spAutoFit/>`.
    SpAutoFit,
}

/// Preset text warp — `<a:prstTxWarp prst="..." adj="..."/>`.
#[derive(Debug, Clone, PartialEq, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
#[serde(default)]
pub struct PresetTextWarp {
    /// Preset token (e.g. `"textWave1"`).
    #[serde(default, skip_serializing_if = "String::is_empty")]
    pub preset: String,
    /// Adjustment guides (CT_GeomGuide `name` / `fmla`).
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub adjust_values: Vec<GeomGuide>,
}

/// Geometry guide — `<a:gd name="..." fmla="..."/>`.
#[derive(Debug, Clone, PartialEq, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
#[serde(default)]
pub struct GeomGuide {
    /// Guide name.
    #[serde(default, skip_serializing_if = "String::is_empty")]
    pub name: String,
    /// Guide formula.
    #[serde(default, skip_serializing_if = "String::is_empty")]
    pub fmla: String,
}

// ===========================================================================
// TextListStyle (CT_TextListStyle)
// ===========================================================================

/// List style — default + 9 level paragraph properties.
#[derive(Debug, Clone, PartialEq, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
#[serde(default)]
pub struct TextListStyle {
    /// `<a:defPPr>`.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub def_ppr: Option<TextParagraphProps>,
    /// `<a:lvl1pPr>`.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub lvl1_ppr: Option<TextParagraphProps>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub lvl2_ppr: Option<TextParagraphProps>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub lvl3_ppr: Option<TextParagraphProps>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub lvl4_ppr: Option<TextParagraphProps>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub lvl5_ppr: Option<TextParagraphProps>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub lvl6_ppr: Option<TextParagraphProps>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub lvl7_ppr: Option<TextParagraphProps>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub lvl8_ppr: Option<TextParagraphProps>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub lvl9_ppr: Option<TextParagraphProps>,
}

// ===========================================================================
// Paragraph (CT_TextParagraph)
// ===========================================================================

/// Text paragraph `<a:p>`.
#[derive(Debug, Clone, PartialEq, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
#[serde(default)]
pub struct TextParagraph {
    /// `<a:pPr>`.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub p_pr: Option<TextParagraphProps>,
    /// Ordered content children — runs, line breaks, fields.
    #[serde(skip_serializing_if = "Vec::is_empty")]
    pub content: Vec<ParagraphContent>,
    /// `<a:endParaRPr>`.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub end_para_r_pr: Option<TextRunProps>,
}

/// One of the three things that can appear inside `<a:p>` besides `<a:pPr>`.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(tag = "kind", rename_all = "camelCase")]
// CT_TextParagraph content is a schema choice; direct variants preserve the
// shared typed contract for runs, breaks, and fields.
#[allow(clippy::large_enum_variant)]
pub enum ParagraphContent {
    /// `<a:r>` — regular text run.
    Run(TextRunData),
    /// `<a:br>` — line break with optional run props.
    #[serde(rename_all = "camelCase")]
    Break {
        #[serde(default, skip_serializing_if = "Option::is_none")]
        r_pr: Option<TextRunProps>,
    },
    /// `<a:fld>` — text field.
    #[serde(rename_all = "camelCase")]
    Field {
        id: String,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        field_type: Option<String>,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        text: Option<String>,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        r_pr: Option<TextRunProps>,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        p_pr: Option<TextParagraphProps>,
    },
}

/// Regular text run `<a:r>`.
#[derive(Debug, Clone, PartialEq, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
#[serde(default)]
pub struct TextRunData {
    /// Run properties `<a:rPr>`.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub r_pr: Option<TextRunProps>,
    /// Text content `<a:t>`.
    #[serde(default, skip_serializing_if = "String::is_empty")]
    pub text: String,
}

// ===========================================================================
// TextParagraphProps (CT_TextParagraphProperties)
// ===========================================================================

/// Paragraph properties `<a:pPr>`, `<a:defPPr>`, `<a:lvlNpPr>`.
#[derive(Debug, Clone, PartialEq, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
#[serde(default)]
pub struct TextParagraphProps {
    /// Left margin in EMUs (`@marL`).
    #[serde(skip_serializing_if = "Option::is_none")]
    pub mar_l: Option<i64>,
    /// Right margin in EMUs (`@marR`).
    #[serde(skip_serializing_if = "Option::is_none")]
    pub mar_r: Option<i64>,
    /// Indentation level 0..=8 (`@lvl`).
    #[serde(skip_serializing_if = "Option::is_none")]
    pub lvl: Option<u32>,
    /// Indent in EMUs (`@indent`).
    #[serde(skip_serializing_if = "Option::is_none")]
    pub indent: Option<i64>,
    /// Alignment token `@algn`: `"l" | "ctr" | "r" | "just" | "justLow" | "dist" | "thaiDist"`.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub algn: Option<String>,
    /// Default tab size in EMUs (`@defTabSz`).
    #[serde(skip_serializing_if = "Option::is_none")]
    pub def_tab_sz: Option<i64>,
    /// Right-to-left (`@rtl`).
    #[serde(skip_serializing_if = "Option::is_none")]
    pub rtl: Option<bool>,
    /// East-Asian line break (`@eaLnBrk`).
    #[serde(skip_serializing_if = "Option::is_none")]
    pub ea_ln_brk: Option<bool>,
    /// Latin line break (`@latinLnBrk`).
    #[serde(skip_serializing_if = "Option::is_none")]
    pub latin_ln_brk: Option<bool>,
    /// Hanging punctuation (`@hangingPunct`).
    #[serde(skip_serializing_if = "Option::is_none")]
    pub hanging_punct: Option<bool>,
    /// Font alignment token `@fontAlgn`: `"auto" | "t" | "ctr" | "base" | "b"`.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub font_algn: Option<String>,
    /// Line spacing `<a:lnSpc>`.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub ln_spc: Option<TextSpacing>,
    /// Space before `<a:spcBef>`.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub spc_bef: Option<TextSpacing>,
    /// Space after `<a:spcAft>`.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub spc_aft: Option<TextSpacing>,
    /// Bullet properties `<a:buClr>`, `<a:buSzPct>`, `<a:buFontTx|buFont|buNone|buAutoNum|buChar>`.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub bullet: Option<BulletProps>,
    /// Tab stops `<a:tabLst>`.
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub tab_lst: Vec<TextTabStop>,
    /// Default run properties `<a:defRPr>`.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub def_r_pr: Option<Box<TextRunProps>>,
    /// Extension list (opaque).
    #[serde(skip_serializing_if = "Option::is_none")]
    pub ext_lst: Option<String>,
}

/// Line / paragraph spacing — CT_TextSpacing.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(tag = "type", rename_all = "camelCase")]
pub enum TextSpacing {
    /// `<a:spcPct val="..."/>` — percentage (100000 = 100%).
    Pct { val: i32 },
    /// `<a:spcPts val="..."/>` — hundredths of a point.
    Pts { val: i32 },
}

/// Tab stop — `<a:tab pos="..." algn="..."/>`.
#[derive(Debug, Clone, PartialEq, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
#[serde(default)]
pub struct TextTabStop {
    /// Position in EMUs.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub pos: Option<i64>,
    /// Alignment token: `"l" | "ctr" | "r" | "dec"`.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub algn: Option<String>,
}

/// Bullet properties (CT_TextParagraphProperties bullet child set).
#[derive(Debug, Clone, PartialEq, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
#[serde(default)]
pub struct BulletProps {
    /// `<a:buClr>` (solid color) or `<a:buClrTx/>` (follow text).
    #[serde(skip_serializing_if = "Option::is_none")]
    pub color: Option<BulletColor>,
    /// `<a:buSzPct val="..."/>`, `<a:buSzPts val="..."/>`, `<a:buSzTx/>`.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub size: Option<BulletSize>,
    /// Font: `<a:buFont>` (CT_TextFont) or `<a:buFontTx/>` (follow text).
    #[serde(skip_serializing_if = "Option::is_none")]
    pub font: Option<BulletFont>,
    /// Bullet variant: `<a:buNone/>`, `<a:buAutoNum>`, or `<a:buChar>`.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub variant: Option<BulletVariant>,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(tag = "type", rename_all = "camelCase")]
pub enum BulletColor {
    /// `<a:buClrTx/>` — follow text color.
    Tx,
    /// `<a:buClr><color/></a:buClr>`.
    Clr { color: DomainDrawingColor },
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(tag = "type", rename_all = "camelCase")]
pub enum BulletSize {
    /// `<a:buSzTx/>` — follow text size.
    Tx,
    /// `<a:buSzPct val="..."/>`.
    Pct { val: i32 },
    /// `<a:buSzPts val="..."/>` — hundredths of a point.
    Pts { val: i32 },
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(tag = "type", rename_all = "camelCase")]
pub enum BulletFont {
    /// `<a:buFontTx/>` — follow text font.
    Tx,
    /// `<a:buFont typeface="..." .../>`.
    Font(TextFontRef),
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(tag = "type", rename_all = "camelCase")]
pub enum BulletVariant {
    /// `<a:buNone/>`.
    None,
    /// `<a:buAutoNum type="..." startAt="..."/>`.
    #[serde(rename_all = "camelCase")]
    AutoNum {
        auto_type: String,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        start_at: Option<u32>,
    },
    /// `<a:buChar char="..."/>`.
    Char { ch: String },
}

/// CT_TextFont — `typeface`, `panose`, `pitchFamily`, `charset`.
#[derive(Debug, Clone, PartialEq, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
#[serde(default)]
pub struct TextFontRef {
    #[serde(default, skip_serializing_if = "String::is_empty")]
    pub typeface: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub panose: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub pitch_family: Option<i32>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub charset: Option<i32>,
}

// ===========================================================================
// TextRunProps (CT_TextCharacterProperties)
// ===========================================================================

/// Text run properties — `<a:rPr>`, `<a:defRPr>`, `<a:endParaRPr>`.
#[derive(Debug, Clone, PartialEq, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
#[serde(default)]
pub struct TextRunProps {
    /// Language (`@lang`).
    #[serde(skip_serializing_if = "Option::is_none")]
    pub lang: Option<String>,
    /// Alternate language (`@altLang`).
    #[serde(skip_serializing_if = "Option::is_none")]
    pub alt_lang: Option<String>,
    /// Font size in hundredths of a point (`@sz`).
    #[serde(skip_serializing_if = "Option::is_none")]
    pub sz: Option<i32>,
    /// Bold (`@b`).
    #[serde(skip_serializing_if = "Option::is_none")]
    pub b: Option<bool>,
    /// Italic (`@i`).
    #[serde(skip_serializing_if = "Option::is_none")]
    pub i: Option<bool>,
    /// Underline token (`@u`): `"none" | "sng" | "dbl" | …`.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub u: Option<String>,
    /// Strikethrough token (`@strike`): `"noStrike" | "sngStrike" | "dblStrike"`.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub strike: Option<String>,
    /// Kerning in hundredths of a point (`@kern`).
    #[serde(skip_serializing_if = "Option::is_none")]
    pub kern: Option<i32>,
    /// Caps token (`@cap`): `"none" | "small" | "all"`.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub cap: Option<String>,
    /// Spacing in hundredths of a point (`@spc`).
    #[serde(skip_serializing_if = "Option::is_none")]
    pub spc: Option<i32>,
    /// Normalize heights (`@normalizeH`).
    #[serde(skip_serializing_if = "Option::is_none")]
    pub normalize_h: Option<bool>,
    /// Baseline shift — percentage * 1000 (`@baseline`).
    #[serde(skip_serializing_if = "Option::is_none")]
    pub baseline: Option<i32>,
    /// No proof (`@noProof`).
    #[serde(skip_serializing_if = "Option::is_none")]
    pub no_proof: Option<bool>,
    /// Dirty — needs recalc (`@dirty`).
    #[serde(skip_serializing_if = "Option::is_none")]
    pub dirty: Option<bool>,
    /// Error flag (`@err`).
    #[serde(skip_serializing_if = "Option::is_none")]
    pub err: Option<bool>,
    /// Smart-tag clean (`@smtClean`).
    #[serde(skip_serializing_if = "Option::is_none")]
    pub smt_clean: Option<bool>,
    /// Smart-tag id (`@smtId`).
    #[serde(skip_serializing_if = "Option::is_none")]
    pub smt_id: Option<u32>,
    /// Bookmark (`@bmk`).
    #[serde(skip_serializing_if = "Option::is_none")]
    pub bmk: Option<String>,
    /// Right-to-left (`@rtl`).
    #[serde(skip_serializing_if = "Option::is_none")]
    pub rtl: Option<bool>,
    /// Kumimoji (`@kumimoji`).
    #[serde(skip_serializing_if = "Option::is_none")]
    pub kumimoji: Option<bool>,
    /// Text color — CT_Color child of this element.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub color: Option<DomainDrawingColor>,
    /// Highlight color.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub highlight: Option<DomainDrawingColor>,
    /// Latin typeface reference (`<a:latin>`).
    #[serde(skip_serializing_if = "Option::is_none")]
    pub latin: Option<TextFontRef>,
    /// East-Asian typeface reference (`<a:ea>`).
    #[serde(skip_serializing_if = "Option::is_none")]
    pub ea: Option<TextFontRef>,
    /// Complex-script typeface reference (`<a:cs>`).
    #[serde(skip_serializing_if = "Option::is_none")]
    pub cs: Option<TextFontRef>,
    /// Symbol typeface reference (`<a:sym>`).
    #[serde(skip_serializing_if = "Option::is_none")]
    pub sym: Option<TextFontRef>,
    /// Click hyperlink (`<a:hlinkClick>`).
    #[serde(skip_serializing_if = "Option::is_none")]
    pub hlink_click: Option<HyperlinkRef>,
    /// Mouse-over hyperlink (`<a:hlinkMouseOver>`).
    #[serde(skip_serializing_if = "Option::is_none")]
    pub hlink_mouse_over: Option<HyperlinkRef>,
    /// Text fill — preserved as raw XML (structured fill audit is PR 3).
    #[serde(skip_serializing_if = "Option::is_none")]
    pub fill_raw_xml: Option<String>,
    /// Text outline — preserved as raw XML (structured line audit is PR 3).
    #[serde(skip_serializing_if = "Option::is_none")]
    pub ln_raw_xml: Option<String>,
    /// Effect list — preserved as raw XML.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub effect_lst_raw_xml: Option<String>,
    /// Underline line `<a:uLn>` — raw XML (mirrors ooxml-types UnderlineLine).
    #[serde(skip_serializing_if = "Option::is_none")]
    pub u_ln_raw_xml: Option<String>,
    /// Underline fill `<a:uFill>` or `<a:uFillTx/>` — raw XML.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub u_fill_raw_xml: Option<String>,
    /// Extension list (opaque).
    #[serde(skip_serializing_if = "Option::is_none")]
    pub ext_lst: Option<String>,
}

// ===========================================================================
// Tests
// ===========================================================================

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn default_emits_no_keys() {
        let t = TextBody::default();
        let json = serde_json::to_string(&t).unwrap();
        assert_eq!(json, "{}");
    }

    #[test]
    fn body_props_is_empty_round_trip() {
        let props = TextBodyProps::default();
        assert!(props.is_empty());
        let props = TextBodyProps {
            anchor: Some("ctr".into()),
            ..Default::default()
        };
        assert!(!props.is_empty());
    }

    #[test]
    fn autofit_variants_serialize() {
        let a = TextAutofit::NoAutofit;
        let json = serde_json::to_string(&a).unwrap();
        assert_eq!(json, r#"{"type":"noAutofit"}"#);

        let b = TextAutofit::NormAutofit {
            font_scale: Some(90_000),
            ln_spc_reduction: None,
        };
        let json = serde_json::to_string(&b).unwrap();
        assert_eq!(json, r#"{"type":"normAutofit","fontScale":90000}"#);

        let c = TextAutofit::SpAutoFit;
        let json = serde_json::to_string(&c).unwrap();
        assert_eq!(json, r#"{"type":"spAutoFit"}"#);
    }

    #[test]
    fn paragraph_content_variants_serialize() {
        let r = ParagraphContent::Run(TextRunData {
            r_pr: None,
            text: "hi".into(),
        });
        let json = serde_json::to_string(&r).unwrap();
        assert_eq!(json, r#"{"kind":"run","text":"hi"}"#);

        let b = ParagraphContent::Break { r_pr: None };
        let json = serde_json::to_string(&b).unwrap();
        assert_eq!(json, r#"{"kind":"break"}"#);

        let f = ParagraphContent::Field {
            id: "{GUID}".into(),
            field_type: Some("slidenum".into()),
            text: Some("4".into()),
            r_pr: None,
            p_pr: None,
        };
        let json = serde_json::to_string(&f).unwrap();
        assert!(json.contains(r#""kind":"field""#));
        assert!(json.contains(r#""id":"{GUID}""#));
        assert!(json.contains(r#""fieldType":"slidenum""#));
    }

    #[test]
    fn bullet_variants_serialize() {
        let v = BulletVariant::None;
        let json = serde_json::to_string(&v).unwrap();
        assert_eq!(json, r#"{"type":"none"}"#);

        let v = BulletVariant::Char { ch: "•".into() };
        let json = serde_json::to_string(&v).unwrap();
        assert_eq!(json, r#"{"type":"char","ch":"•"}"#);

        let v = BulletVariant::AutoNum {
            auto_type: "arabicPeriod".into(),
            start_at: Some(1),
        };
        let json = serde_json::to_string(&v).unwrap();
        assert_eq!(
            json,
            r#"{"type":"autoNum","autoType":"arabicPeriod","startAt":1}"#
        );
    }

    #[test]
    fn bullet_color_tx_vs_clr() {
        let tx = BulletColor::Tx;
        let json = serde_json::to_string(&tx).unwrap();
        assert_eq!(json, r#"{"type":"tx"}"#);

        let clr = BulletColor::Clr {
            color: DomainDrawingColor::SrgbClr {
                val: "FF0000".into(),
                transforms: vec![],
            },
        };
        let json = serde_json::to_string(&clr).unwrap();
        assert!(json.contains(r#""type":"clr""#));
        assert!(json.contains(r#""val":"FF0000""#));
    }

    #[test]
    fn spacing_variants_serialize() {
        let pct = TextSpacing::Pct { val: 150_000 };
        let pts = TextSpacing::Pts { val: 2_400 };
        let jpct = serde_json::to_string(&pct).unwrap();
        let jpts = serde_json::to_string(&pts).unwrap();
        assert_eq!(jpct, r#"{"type":"pct","val":150000}"#);
        assert_eq!(jpts, r#"{"type":"pts","val":2400}"#);
    }

    #[test]
    fn round_trip_through_json() {
        let original = TextBody {
            body_pr: TextBodyProps {
                anchor: Some("ctr".into()),
                wrap: Some("square".into()),
                l_ins: Some(91440),
                autofit: Some(TextAutofit::NormAutofit {
                    font_scale: Some(90_000),
                    ln_spc_reduction: Some(20_000),
                }),
                ..Default::default()
            },
            lst_style: Some(TextListStyle {
                def_ppr: Some(TextParagraphProps {
                    algn: Some("l".into()),
                    ..Default::default()
                }),
                ..Default::default()
            }),
            paragraphs: vec![TextParagraph {
                p_pr: Some(TextParagraphProps {
                    algn: Some("ctr".into()),
                    lvl: Some(1),
                    bullet: Some(BulletProps {
                        variant: Some(BulletVariant::Char { ch: "•".into() }),
                        ..Default::default()
                    }),
                    ..Default::default()
                }),
                content: vec![
                    ParagraphContent::Run(TextRunData {
                        r_pr: Some(TextRunProps {
                            sz: Some(1400),
                            b: Some(true),
                            color: Some(DomainDrawingColor::SrgbClr {
                                val: "333333".into(),
                                transforms: vec![],
                            }),
                            latin: Some(TextFontRef {
                                typeface: "Calibri".into(),
                                ..Default::default()
                            }),
                            ..Default::default()
                        }),
                        text: "Hello".into(),
                    }),
                    ParagraphContent::Break { r_pr: None },
                ],
                end_para_r_pr: None,
            }],
        };
        let json = serde_json::to_string(&original).unwrap();
        let round: TextBody = serde_json::from_str(&json).unwrap();
        assert_eq!(original, round);
    }
}
