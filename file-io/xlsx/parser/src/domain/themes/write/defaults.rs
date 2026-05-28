use ooxml_types::drawings::{
    DrawingColor, DrawingFill, EffectList, EffectProperties, LineFill, Outline, SolidFill,
};
use ooxml_types::themes::{EffectStyleItem, FormatScheme};

/// Build the standard Office default format scheme.
///
/// This matches the hardcoded XML that was previously in `write_format_scheme()`:
/// - 3 solid phClr fills
/// - 3 lines with widths 6350, 12700, 19050 EMU and solid phClr fill
/// - 3 empty effect styles
/// - 3 solid phClr background fills
pub(super) fn default_format_scheme() -> FormatScheme {
    use ooxml_types::drawings::Emu;
    use ooxml_types::drawings::SchemeColor;

    let ph_clr_fill = || {
        DrawingFill::Solid(SolidFill {
            color: DrawingColor::SchemeClr {
                val: SchemeColor::PhClr,
                transforms: vec![],
            },
        })
    };

    let line_style = |width: Emu| Outline {
        width: Some(width),
        fill: Some(LineFill::Solid(SolidFill {
            color: DrawingColor::SchemeClr {
                val: SchemeColor::PhClr,
                transforms: vec![],
            },
        })),
        dash: None,
        compound: None,
        cap: None,
        head_end: None,
        tail_end: None,
        join: None,
        align: None,
    };

    let empty_effect_style = || EffectStyleItem {
        effect_properties: Some(EffectProperties::EffectList(EffectList::default())),
        scene_3d: None,
        sp_3d: None,
    };

    FormatScheme {
        name: "Office".to_string(),
        fill_style_lst: vec![ph_clr_fill(), ph_clr_fill(), ph_clr_fill()],
        ln_style_lst: vec![line_style(6350), line_style(12700), line_style(19050)],
        effect_style_lst: vec![
            empty_effect_style(),
            empty_effect_style(),
            empty_effect_style(),
        ],
        bg_fill_style_lst: vec![ph_clr_fill(), ph_clr_fill(), ph_clr_fill()],
    }
}
