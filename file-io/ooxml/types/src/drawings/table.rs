//! DrawingML table types (ECMA-376 dml-main.xsd, CT_Table and related types).
//!
//! These types model the `<a:tbl>` element tree for tables embedded in graphic frames.
//! Extension lists (`extLst`) are intentionally omitted; they will be preserved as opaque
//! XML during roundtrip.

use super::style::{FontReference, StyleRef};
use super::three_d::{Bevel, LightRig, PresetMaterialType};
use super::{
    DrawingColor, DrawingFill, EffectProperties, Emu, Outline, TextAnchor, TextBody, TextFont,
    TextHorzOverflow, TextVerticalType,
};

// =============================================================================
// Table (CT_Table)
// =============================================================================

/// DrawingML table (CT_Table, dml-main.xsd:2423).
///
/// Root element for tables embedded in graphic frames.
#[derive(Debug, Clone, Default, PartialEq, serde::Serialize, serde::Deserialize)]
pub struct Table {
    /// Table properties (fill, style, banding flags).
    pub tbl_pr: Option<TableProperties>,
    /// Column grid — defines column widths.
    pub tbl_grid: TableGrid,
    /// Table rows.
    pub tr: Vec<TableRow>,
}

// =============================================================================
// TableProperties (CT_TableProperties)
// =============================================================================

/// Table properties (CT_TableProperties, dml-main.xsd:2405).
#[derive(Debug, Clone, Default, PartialEq, serde::Serialize, serde::Deserialize)]
pub struct TableProperties {
    /// Table background fill (EG_FillProperties).
    pub fill: Option<DrawingFill>,
    /// Effect properties (EG_EffectProperties: effectLst or effectDag).
    pub effect: Option<EffectProperties>,
    /// Inline table style definition (CT_TableStyle).
    pub table_style: Option<TableStyle>,
    /// Table style GUID reference.
    pub table_style_id: Option<String>,
    /// Right-to-left table (XSD default: false).
    pub rtl: Option<bool>,
    /// Apply first-row formatting (XSD default: false).
    pub first_row: Option<bool>,
    /// Apply first-column formatting (XSD default: false).
    pub first_col: Option<bool>,
    /// Apply last-row formatting (XSD default: false).
    pub last_row: Option<bool>,
    /// Apply last-column formatting (XSD default: false).
    pub last_col: Option<bool>,
    /// Apply row banding (XSD default: false).
    pub band_row: Option<bool>,
    /// Apply column banding (XSD default: false).
    pub band_col: Option<bool>,
}

// =============================================================================
// TableGrid / TableCol (CT_TableGrid, CT_TableCol)
// =============================================================================

/// Table column grid (CT_TableGrid, dml-main.xsd:2381).
#[derive(Debug, Clone, Default, PartialEq, serde::Serialize, serde::Deserialize)]
pub struct TableGrid {
    /// Column definitions.
    pub grid_col: Vec<TableCol>,
}

/// Single table column (CT_TableCol, dml-main.xsd:2375).
#[derive(Debug, Clone, Default, PartialEq, serde::Serialize, serde::Deserialize)]
pub struct TableCol {
    /// Column width in EMUs (required).
    pub w: Emu,
}

// =============================================================================
// TableRow (CT_TableRow)
// =============================================================================

/// Table row (CT_TableRow, dml-main.xsd:2398).
#[derive(Debug, Clone, Default, PartialEq, serde::Serialize, serde::Deserialize)]
pub struct TableRow {
    /// Row height in EMUs (required).
    pub h: Emu,
    /// Cells in this row.
    pub tc: Vec<TableCell>,
}

// =============================================================================
// TableCell (CT_TableCell)
// =============================================================================

/// Table cell (CT_TableCell, dml-main.xsd:2386).
///
/// Note: `row_span` and `grid_span` use `i32` per XSD `xsd:int` type, though negative
/// values are meaningless. This preserves strict XSD fidelity.
#[derive(Debug, Clone, Default, PartialEq, serde::Serialize, serde::Deserialize)]
pub struct TableCell {
    /// Cell text body (rich text content).
    pub tx_body: Option<TextBody>,
    /// Cell properties (borders, fill, margins, alignment).
    pub tc_pr: Option<TableCellProperties>,
    /// Number of rows this cell spans (XSD optional, default 1).
    pub row_span: Option<i32>,
    /// Number of columns this cell spans (XSD optional, default 1).
    pub grid_span: Option<i32>,
    /// Horizontal merge continuation (XSD optional, default false).
    pub h_merge: Option<bool>,
    /// Vertical merge continuation (XSD optional, default false).
    pub v_merge: Option<bool>,
    /// Optional cell identifier.
    pub id: Option<String>,
}

impl TableCell {
    /// Create a new default table cell with spec-correct defaults (spans of 1).
    pub fn new() -> Self {
        Self {
            row_span: Some(1),
            grid_span: Some(1),
            ..Default::default()
        }
    }

    /// Get row span, defaulting to 1 per XSD spec.
    pub fn effective_row_span(&self) -> i32 {
        self.row_span.unwrap_or(1)
    }

    /// Get grid span, defaulting to 1 per XSD spec.
    pub fn effective_grid_span(&self) -> i32 {
        self.grid_span.unwrap_or(1)
    }

    /// Get horizontal merge, defaulting to false per XSD spec.
    pub fn effective_h_merge(&self) -> bool {
        self.h_merge.unwrap_or(false)
    }

    /// Get vertical merge, defaulting to false per XSD spec.
    pub fn effective_v_merge(&self) -> bool {
        self.v_merge.unwrap_or(false)
    }
}

// =============================================================================
// TableCellProperties (CT_TableCellProperties)
// =============================================================================

/// Table cell properties (CT_TableCellProperties, dml-main.xsd:2347).
#[derive(Debug, Clone, Default, PartialEq, serde::Serialize, serde::Deserialize)]
pub struct TableCellProperties {
    /// Left border line.
    pub ln_l: Option<Outline>,
    /// Right border line.
    pub ln_r: Option<Outline>,
    /// Top border line.
    pub ln_t: Option<Outline>,
    /// Bottom border line.
    pub ln_b: Option<Outline>,
    /// Top-left to bottom-right diagonal border.
    pub ln_tl_to_br: Option<Outline>,
    /// Bottom-left to top-right diagonal border.
    pub ln_bl_to_tr: Option<Outline>,
    /// 3D cell properties.
    pub cell_3d: Option<Cell3D>,
    /// Cell fill (EG_FillProperties).
    pub fill: Option<DrawingFill>,
    /// Accessibility headers (CT_Headers, flattened to string list).
    pub headers: Vec<String>,
    /// Left margin in EMUs (default 91440 = 0.1 inch).
    pub mar_l: Option<i32>,
    /// Right margin in EMUs (default 91440 = 0.1 inch).
    pub mar_r: Option<i32>,
    /// Top margin in EMUs (default 45720 = 0.05 inch).
    pub mar_t: Option<i32>,
    /// Bottom margin in EMUs (default 45720 = 0.05 inch).
    pub mar_b: Option<i32>,
    /// Text vertical type (default "horz").
    pub vert: Option<TextVerticalType>,
    /// Text anchor (default "t" = top).
    pub anchor: Option<TextAnchor>,
    /// Center text horizontally within anchor.
    pub anchor_ctr: Option<bool>,
    /// Horizontal overflow (default "clip").
    pub horz_overflow: Option<TextHorzOverflow>,
}

// =============================================================================
// Cell3D (CT_Cell3D)
// =============================================================================

/// 3D cell properties (CT_Cell3D, dml-main.xsd:2431).
#[derive(Debug, Clone, PartialEq, serde::Serialize, serde::Deserialize)]
pub struct Cell3D {
    /// Bevel (required).
    pub bevel: Bevel,
    /// Light rig (optional).
    pub light_rig: Option<LightRig>,
    /// Preset material type (XSD optional, default "plastic").
    pub prst_material: Option<PresetMaterialType>,
}

impl Cell3D {
    /// Get effective material type, defaulting to Plastic per XSD spec.
    pub fn effective_material(&self) -> PresetMaterialType {
        self.prst_material.unwrap_or(PresetMaterialType::Plastic)
    }
}

// =============================================================================
// OnOffStyleType (ST_OnOffStyleType)
// =============================================================================

/// On/off/default style type (ECMA-376 ST_OnOffStyleType).
#[derive(
    Debug, Clone, Copy, Default, PartialEq, Eq, Hash, serde::Serialize, serde::Deserialize,
)]
pub enum OnOffStyleType {
    #[default]
    Def,
    On,
    Off,
}

impl OnOffStyleType {
    /// Parse from OOXML string value.
    pub fn from_ooxml(s: &str) -> Self {
        match s {
            "on" => Self::On,
            "off" => Self::Off,
            "def" => Self::Def,
            _ => Self::Def,
        }
    }

    /// Serialize to OOXML string value.
    pub fn to_ooxml(&self) -> &'static str {
        match self {
            Self::On => "on",
            Self::Off => "off",
            Self::Def => "def",
        }
    }
}

// =============================================================================
// ThemeableLineStyle (CT_ThemeableLineStyle)
// =============================================================================

/// Themeable line style — inline line or theme reference (ECMA-376 CT_ThemeableLineStyle).
#[derive(Debug, Clone, PartialEq, serde::Serialize, serde::Deserialize)]
pub enum ThemeableLineStyle {
    /// Inline line properties.
    Ln(Outline),
    /// Theme style matrix reference.
    LnRef(StyleRef),
}

// =============================================================================
// ThemeableFillStyle (EG_ThemeableFillStyle)
// =============================================================================

/// Themeable fill style — inline fill or theme reference (ECMA-376 EG_ThemeableFillStyle).
#[derive(Debug, Clone, PartialEq, serde::Serialize, serde::Deserialize)]
pub enum ThemeableFillStyle {
    Fill(DrawingFill),
    FillRef(StyleRef),
}

// =============================================================================
// ThemeableEffectStyle (EG_ThemeableEffectStyle)
// =============================================================================

/// Themeable effect style — inline effect or theme reference (ECMA-376 EG_ThemeableEffectStyle).
#[derive(Debug, Clone, PartialEq, serde::Serialize, serde::Deserialize)]
pub enum ThemeableEffectStyle {
    Effect(EffectProperties),
    EffectRef(StyleRef),
}

// =============================================================================
// TableCellBorderStyle (CT_TableCellBorderStyle)
// =============================================================================

/// Table cell border style (ECMA-376 CT_TableCellBorderStyle).
#[derive(Debug, Clone, Default, PartialEq, serde::Serialize, serde::Deserialize)]
pub struct TableCellBorderStyle {
    pub left: Option<ThemeableLineStyle>,
    pub right: Option<ThemeableLineStyle>,
    pub top: Option<ThemeableLineStyle>,
    pub bottom: Option<ThemeableLineStyle>,
    pub inside_h: Option<ThemeableLineStyle>,
    pub inside_v: Option<ThemeableLineStyle>,
    pub tl2br: Option<ThemeableLineStyle>,
    pub tr2bl: Option<ThemeableLineStyle>,
}

// =============================================================================
// TableStyleCellStyle (CT_TableStyleCellStyle)
// =============================================================================

/// Table style cell formatting (ECMA-376 CT_TableStyleCellStyle, dml-main.xsd:2499).
///
/// **Audit note**: The XSD uses `EG_ThemeableFillStyle` group which is a choice of `fill`
/// or `fillRef` elements. Both are captured by the `ThemeableFillStyle` enum (`Fill` /
/// `FillRef` variants) in the `fill` field below — `fillRef` is not a separate missing field.
#[derive(Debug, Clone, Default, PartialEq, serde::Serialize, serde::Deserialize)]
pub struct TableStyleCellStyle {
    pub tc_bdr: Option<TableCellBorderStyle>,
    /// Fill style — covers both inline `fill` and theme `fillRef` via `ThemeableFillStyle` enum.
    pub fill: Option<ThemeableFillStyle>,
    pub cell_3d: Option<Cell3D>,
}

// =============================================================================
// ThemeableFontStyle (EG_ThemeableFontStyles)
// =============================================================================

/// Themeable font style — inline font or theme reference (ECMA-376 EG_ThemeableFontStyles).
#[derive(Debug, Clone, PartialEq, serde::Serialize, serde::Deserialize)]
pub enum ThemeableFontStyle {
    Font(TextFont),
    FontRef(FontReference),
}

// =============================================================================
// TableStyleTextStyle (CT_TableStyleTextStyle)
// =============================================================================

/// Table style text formatting (ECMA-376 CT_TableStyleTextStyle, dml-main.xsd:2471).
///
/// **Audit note**: The XSD uses `EG_ThemeableFontStyles` group which is a choice of `font`
/// (CT_FontCollection) or `fontRef` (CT_FontReference). Both are captured by the
/// `ThemeableFontStyle` enum (`Font` / `FontRef` variants) in the `font` field below —
/// `fontRef` is not a separate missing field.
#[derive(Debug, Clone, Default, PartialEq, serde::Serialize, serde::Deserialize)]
pub struct TableStyleTextStyle {
    /// Font style — covers both inline `font` and theme `fontRef` via `ThemeableFontStyle` enum.
    pub font: Option<ThemeableFontStyle>,
    pub color: Option<DrawingColor>,
    pub bold: OnOffStyleType,
    pub italic: OnOffStyleType,
}

// =============================================================================
// TablePartStyle (CT_TablePartStyle)
// =============================================================================

/// Table part style for a specific region (ECMA-376 CT_TablePartStyle).
#[derive(Debug, Clone, Default, PartialEq, serde::Serialize, serde::Deserialize)]
pub struct TablePartStyle {
    pub tc_tx_style: Option<TableStyleTextStyle>,
    pub tc_style: Option<TableStyleCellStyle>,
}

// =============================================================================
// TableBackgroundStyle (CT_TableBackgroundStyle)
// =============================================================================

/// Table background style (ECMA-376 CT_TableBackgroundStyle).
#[derive(Debug, Clone, Default, PartialEq, serde::Serialize, serde::Deserialize)]
pub struct TableBackgroundStyle {
    pub fill: Option<ThemeableFillStyle>,
    pub effect: Option<ThemeableEffectStyle>,
    pub fill_ref: Option<StyleRef>,
    pub effect_ref: Option<StyleRef>,
}

// =============================================================================
// TableStyle (CT_TableStyle)
// =============================================================================

/// Table style definition (ECMA-376 CT_TableStyle).
#[derive(Debug, Clone, Default, PartialEq, serde::Serialize, serde::Deserialize)]
pub struct TableStyle {
    pub style_id: String,
    pub style_name: String,
    pub tbl_bg: Option<TableBackgroundStyle>,
    pub whole_tbl: Option<TablePartStyle>,
    pub band1_h: Option<TablePartStyle>,
    pub band2_h: Option<TablePartStyle>,
    pub band1_v: Option<TablePartStyle>,
    pub band2_v: Option<TablePartStyle>,
    pub last_col: Option<TablePartStyle>,
    pub first_col: Option<TablePartStyle>,
    pub last_row: Option<TablePartStyle>,
    pub se_cell: Option<TablePartStyle>,
    pub sw_cell: Option<TablePartStyle>,
    pub first_row: Option<TablePartStyle>,
    pub ne_cell: Option<TablePartStyle>,
    pub nw_cell: Option<TablePartStyle>,
}

// =============================================================================
// TableStyleList (CT_TableStyleList)
// =============================================================================

/// Table style list (ECMA-376 CT_TableStyleList).
#[derive(Debug, Clone, Default, PartialEq, serde::Serialize, serde::Deserialize)]
pub struct TableStyleList {
    pub def: String,
    pub tbl_style: Vec<TableStyle>,
}

// =============================================================================
// Tests
// =============================================================================

#[cfg(test)]
mod tests {
    use super::*;
    use crate::drawings::primitives::{StPositiveCoordinate, StPositiveFixedAngle};
    use crate::drawings::three_d::{
        BevelPresetType, LightRig, LightRigDirection, LightRigType, Rotation3D,
    };

    #[test]
    fn table_default() {
        let t = Table::default();
        assert!(t.tbl_pr.is_none());
        assert!(t.tbl_grid.grid_col.is_empty());
        assert!(t.tr.is_empty());
    }

    #[test]
    fn table_cell_default_spans() {
        // Default derived: all Optional fields are None
        let cell = TableCell::default();
        assert_eq!(cell.row_span, None);
        assert_eq!(cell.grid_span, None);
        assert_eq!(cell.h_merge, None);
        assert_eq!(cell.v_merge, None);
        // Effective defaults match XSD spec
        assert_eq!(cell.effective_row_span(), 1);
        assert_eq!(cell.effective_grid_span(), 1);
        assert!(!cell.effective_h_merge());
        assert!(!cell.effective_v_merge());

        // new() gives spec-correct defaults explicitly
        let cell2 = TableCell::new();
        assert_eq!(cell2.row_span, Some(1));
        assert_eq!(cell2.grid_span, Some(1));
    }

    #[test]
    fn table_cell_properties_default() {
        let props = TableCellProperties::default();
        assert!(props.ln_l.is_none());
        assert!(props.ln_r.is_none());
        assert!(props.fill.is_none());
        assert!(props.cell_3d.is_none());
        assert!(props.headers.is_empty());
        assert!(props.mar_l.is_none());
        assert!(props.vert.is_none());
        assert!(props.anchor.is_none());
        assert!(props.anchor_ctr.is_none());
        assert!(props.horz_overflow.is_none());
    }

    #[test]
    fn cell_3d_fields() {
        let c = Cell3D {
            bevel: Bevel {
                w: Some(StPositiveCoordinate::new_unchecked(50800)),
                h: Some(StPositiveCoordinate::new_unchecked(50800)),
                prst: Some(BevelPresetType::Circle),
            },
            light_rig: Some(LightRig {
                rig: LightRigType::ThreePt,
                dir: LightRigDirection::Top,
                rot: Some(Rotation3D {
                    lat: StPositiveFixedAngle::new_unchecked(0),
                    lon: StPositiveFixedAngle::new_unchecked(0),
                    rev: StPositiveFixedAngle::new_unchecked(0),
                }),
            }),
            prst_material: Some(PresetMaterialType::Plastic),
        };
        assert_eq!(c.bevel.w, Some(StPositiveCoordinate::new_unchecked(50800)));
        assert!(c.light_rig.is_some());
        assert_eq!(c.effective_material().to_ooxml(), "plastic");
    }

    #[test]
    fn table_properties_booleans_default_none() {
        let props = TableProperties::default();
        assert_eq!(props.rtl, None);
        assert_eq!(props.first_row, None);
        assert_eq!(props.first_col, None);
        assert_eq!(props.last_row, None);
        assert_eq!(props.last_col, None);
        assert_eq!(props.band_row, None);
        assert_eq!(props.band_col, None);
    }

    #[test]
    fn cell_3d_bevel_composition() {
        // Verify Cell3D composes correctly with three_d module types
        let c = Cell3D {
            bevel: Bevel {
                w: Some(StPositiveCoordinate::new_unchecked(914400)),
                h: Some(StPositiveCoordinate::new_unchecked(457200)),
                prst: Some(BevelPresetType::RelaxedInset),
            },
            light_rig: None,
            prst_material: Some(PresetMaterialType::Matte),
        };
        assert_eq!(c.bevel.prst, Some(BevelPresetType::RelaxedInset));
        assert_eq!(c.effective_material().to_ooxml(), "matte");
    }

    #[test]
    fn on_off_style_type_roundtrip() {
        for (s, expected) in [
            ("on", OnOffStyleType::On),
            ("off", OnOffStyleType::Off),
            ("def", OnOffStyleType::Def),
        ] {
            let parsed = OnOffStyleType::from_ooxml(s);
            assert_eq!(parsed, expected);
            assert_eq!(parsed.to_ooxml(), s);
        }
        // Unknown values fall back to Def
        assert_eq!(OnOffStyleType::from_ooxml("unknown"), OnOffStyleType::Def);
    }

    #[test]
    fn table_style_default_has_empty_fields() {
        let ts = TableStyle::default();
        assert!(ts.style_id.is_empty());
        assert!(ts.style_name.is_empty());
        assert!(ts.tbl_bg.is_none());
        assert!(ts.whole_tbl.is_none());
        assert!(ts.first_row.is_none());
        assert!(ts.last_row.is_none());
        assert!(ts.first_col.is_none());
        assert!(ts.last_col.is_none());
        assert!(ts.band1_h.is_none());
        assert!(ts.band2_h.is_none());
        assert!(ts.band1_v.is_none());
        assert!(ts.band2_v.is_none());
        assert!(ts.ne_cell.is_none());
        assert!(ts.nw_cell.is_none());
        assert!(ts.se_cell.is_none());
        assert!(ts.sw_cell.is_none());
    }

    #[test]
    fn table_style_list_default() {
        let tsl = TableStyleList::default();
        assert!(tsl.def.is_empty());
        assert!(tsl.tbl_style.is_empty());
    }
}
