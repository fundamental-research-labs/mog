//! Reconcile editable CF properties with their complete imported DXF.
//!
//! A CFStyle is a projection, not a replacement for font/fill/border OOXML.
//! Keep untouched source properties (including theme colors and extensions),
//! and apply only changes to properties that the editable model exposes.
use super::*;
use crate::output::to_parse_output::resolve_dxf_to_cf_style;

pub(super) fn theme_colors(output: &ParseOutput) -> Vec<String> {
    let Some(theme) = output.theme.as_ref() else {
        return Vec::new();
    };
    if let Some(scheme) = theme.color_scheme.as_ref() {
        return (0..12)
            .map(|index| {
                let value = scheme.resolve_hex(index).unwrap_or_else(|| "000000".into());
                if value.starts_with('#') {
                    value
                } else if value.len() == 8 {
                    format!("#{}", &value[2..])
                } else {
                    format!("#{value}")
                }
            })
            .collect();
    }
    [
        "dk1", "lt1", "dk2", "lt2", "accent1", "accent2", "accent3", "accent4", "accent5",
        "accent6", "hlink", "folHlink",
    ]
    .iter()
    .map(|name| {
        theme
            .colors
            .iter()
            .find(|color| color.name == *name)
            .map(|color| color.color.clone())
            .unwrap_or_else(|| "#000000".into())
    })
    .collect()
}

fn source(style: &CFStyle, registry: &[domain_types::DxfDef]) -> Option<DxfDef> {
    let id = style.dxf_id?;
    registry
        .iter()
        .find(|entry| entry.id == id)
        .map(domain_types::DxfDef::to_ooxml)
}

pub(super) fn collect_unchanged_ids(
    output: &ParseOutput,
    registry: &[domain_types::DxfDef],
    theme: &[String],
    reachable: &mut HashSet<u32>,
) {
    for sheet in &output.sheets {
        for format in &sheet.conditional_formats {
            for style in format.rules.iter().filter_map(rule_style) {
                if let Some(original) = source(style, registry)
                    && reconcile(style, &original, theme) == original
                    && let Some(id) = style.dxf_id
                {
                    reachable.insert(id);
                }
            }
        }
    }
}

pub(super) fn assign_styles(
    output: &mut ParseOutput,
    registry: &[domain_types::DxfDef],
    theme: &[String],
    id_map: &HashMap<u32, u32>,
    dxfs: &mut Vec<DxfDef>,
) {
    for sheet in &mut output.sheets {
        for format in &mut sheet.conditional_formats {
            for style in format.rules.iter_mut().filter_map(rule_style_mut) {
                let original = source(style, registry);
                let updated = original
                    .as_ref()
                    .map(|original| reconcile(style, original, theme))
                    .or_else(|| {
                        cf_style_has_exportable_properties(style).then(|| cf_style_to_dxf(style))
                    });
                let old_id = style.dxf_id;
                style.dxf_id = None;
                let Some(updated) = updated.filter(|dxf| *dxf != DxfDef::default()) else {
                    continue;
                };
                if original.as_ref() == Some(&updated)
                    && let Some(mapped) = old_id.and_then(|id| id_map.get(&id)).copied()
                {
                    style.dxf_id = Some(mapped);
                    continue;
                }
                let id = dxfs
                    .iter()
                    .position(|existing| *existing == updated)
                    .unwrap_or_else(|| {
                        dxfs.push(updated);
                        dxfs.len() - 1
                    });
                style.dxf_id = Some(id as u32);
            }
        }
    }
}

fn reconcile(style: &CFStyle, original: &DxfDef, theme: &[String]) -> DxfDef {
    let baseline = resolve_dxf_to_cf_style(
        original,
        style.dxf_theme_palette.as_deref().unwrap_or(theme),
        style.dxf_id,
    );
    if *style == baseline {
        return original.clone();
    }
    let mut result = original.clone();
    let generated = cf_style_to_dxf(style);
    if style.background_color != baseline.background_color {
        result.fill = match (&original.fill, style.background_color.as_deref()) {
            (
                Some(FillDef::Pattern {
                    pattern_type,
                    fg_color,
                    bg_color,
                }),
                Some(color),
            ) => {
                // Editing the projected color must not flatten a patterned fill.
                // Use the same foreground/fallback choice as the import projection.
                let foreground_resolves = fg_color.as_ref().is_some_and(|color| {
                    resolve_dxf_to_cf_style(
                        &DxfDef {
                            fill: Some(FillDef::Solid {
                                fg_color: color.clone(),
                            }),
                            ..Default::default()
                        },
                        style.dxf_theme_palette.as_deref().unwrap_or(theme),
                        None,
                    )
                    .background_color
                    .is_some()
                });
                let color = Some(hex_to_color_def(color));
                Some(FillDef::Pattern {
                    pattern_type: *pattern_type,
                    fg_color: if foreground_resolves || baseline.background_color.is_none() {
                        color.clone()
                    } else {
                        fg_color.clone()
                    },
                    bg_color: if foreground_resolves || baseline.background_color.is_none() {
                        bg_color.clone()
                    } else {
                        color
                    },
                })
            }
            _ => generated.fill,
        };
    }
    if style.number_format != baseline.number_format {
        result.num_fmt = generated.num_fmt;
    }
    let mut font = result.font.clone().unwrap_or_default();
    let fresh_font = generated.font.unwrap_or_default();
    macro_rules! font_field {
        ($model:ident, $ooxml:ident) => {
            if style.$model != baseline.$model {
                font.$ooxml = fresh_font.$ooxml.clone();
            }
        };
    }
    font_field!(font_color, color);
    font_field!(bold, bold);
    font_field!(italic, italic);
    font_field!(strikethrough, strikethrough);
    if style.underline_type != baseline.underline_type
        || style.underline_legacy != baseline.underline_legacy
    {
        font.underline = fresh_font.underline;
    }
    result.font = (font != FontDef::default()).then_some(font);
    let mut borders = result.border.clone().unwrap_or_default();
    let unified_color_changed = style.border_color != baseline.border_color;
    let unified_style_changed = style.border_style != baseline.border_style;
    macro_rules! border_field {
        ($side:ident, $color:ident, $kind:ident) => {
            if unified_color_changed
                || unified_style_changed
                || style.$color != baseline.$color
                || style.$kind != baseline.$kind
            {
                let mut side = borders.$side.clone().unwrap_or_default();
                // Imported projections carry both unified and per-side fields.
                // Only changed fields are edits: unchanged per-side aliases must
                // not mask a newly assigned unified color/style. An explicit
                // per-side removal likewise must not fall back to an old alias.
                if style.$color != baseline.$color {
                    side.color = style.$color.as_deref().map(hex_to_color_def);
                } else if unified_color_changed {
                    side.color = style.border_color.as_deref().map(hex_to_color_def);
                }
                if style.$kind != baseline.$kind {
                    side.style = style
                        .$kind
                        .as_deref()
                        .and_then(BorderStyle::from_ooxml_token)
                        .unwrap_or(BorderStyle::None);
                } else if unified_style_changed {
                    side.style = style.border_style.unwrap_or(BorderStyle::None);
                } else if borders.$side.is_none() && side.color.is_some() {
                    // New color-only borders use the same visible default as
                    // fresh CF styles; existing style-less sides stay intact.
                    side.style = BorderStyle::Thin;
                }
                borders.$side = (side != BorderSideDef::default()).then_some(side);
            }
        };
    }
    border_field!(left, border_left_color, border_left_style);
    border_field!(right, border_right_color, border_right_style);
    border_field!(top, border_top_color, border_top_style);
    border_field!(bottom, border_bottom_color, border_bottom_style);
    result.border = (borders != BorderDef::default()).then_some(borders);
    result
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn new_color_only_borders_keep_the_fresh_style_default() {
        let original = DxfDef {
            font: Some(FontDef {
                bold: Some(true),
                ..Default::default()
            }),
            ..Default::default()
        };
        for unified in [true, false] {
            let mut style = resolve_dxf_to_cf_style(&original, &[], Some(0));
            if unified {
                style.border_color = Some("#112233".into());
            } else {
                style.border_left_color = Some("#112233".into());
            }
            let updated = reconcile(&style, &original, &[]);
            assert_eq!(updated.border, cf_style_to_dxf(&style).border);
            assert_eq!(
                updated.border.unwrap().left.unwrap().style,
                BorderStyle::Thin
            );
            style.border_left_style = Some("none".into());
            let updated = reconcile(&style, &original, &[]);
            assert_eq!(
                updated.border.unwrap().left.unwrap().style,
                BorderStyle::None
            );
        }
    }

    #[test]
    fn patterned_fill_color_edit_preserves_pattern_and_unedited_channel() {
        for (foreground, foreground_resolves) in [
            (Some(hex_to_color_def("#112233")), true),
            (None, false),
            (Some(ColorDef::auto()), false),
        ] {
            let original = DxfDef {
                fill: Some(FillDef::Pattern {
                    pattern_type: Some(PatternType::DarkGrid),
                    fg_color: foreground.clone(),
                    bg_color: Some(hex_to_color_def("#445566")),
                }),
                ..Default::default()
            };
            let mut projected = resolve_dxf_to_cf_style(&original, &[], Some(0));
            projected.background_color = Some("#778899".into());
            let expected = Some(FillDef::Pattern {
                pattern_type: Some(PatternType::DarkGrid),
                fg_color: if foreground_resolves {
                    Some(hex_to_color_def("#778899"))
                } else {
                    foreground.clone()
                },
                bg_color: Some(hex_to_color_def(if foreground_resolves {
                    "#445566"
                } else {
                    "#778899"
                })),
            });
            assert_eq!(reconcile(&projected, &original, &[]).fill, expected);
            projected.background_color = None;
            assert_eq!(reconcile(&projected, &original, &[]).fill, None);
        }
    }

    #[test]
    fn theme_change_preserves_structured_color_but_explicit_color_edit_replaces_it() {
        let original = DxfDef {
            font: Some(FontDef {
                color: Some(ColorDef::Theme { id: 4, tint: None }),
                ..Default::default()
            }),
            ..Default::default()
        };
        let old_theme = vec!["#112233".into(); 12];
        let new_theme = vec!["#445566".into(); 12];
        let mut projected = resolve_dxf_to_cf_style(&original, &old_theme, Some(0));
        assert_eq!(reconcile(&projected, &original, &new_theme), original);
        projected.font_color = Some("#778899".into());
        assert_eq!(
            reconcile(&projected, &original, &new_theme)
                .font
                .unwrap()
                .color,
            Some(hex_to_color_def("#778899"))
        );
    }

    #[test]
    fn unified_border_edits_and_explicit_side_removals_override_imported_aliases() {
        let side = Some(BorderSideDef {
            style: BorderStyle::Thin,
            color: Some(hex_to_color_def("#112233")),
        });
        let original = DxfDef {
            border: Some(BorderDef {
                top: side.clone(),
                bottom: side.clone(),
                left: side.clone(),
                right: side,
                ..Default::default()
            }),
            ..Default::default()
        };
        let mut projected = resolve_dxf_to_cf_style(&original, &[], Some(0));
        projected.border_color = Some("#445566".into());
        projected.border_style = Some(BorderStyle::Thick);
        let updated = reconcile(&projected, &original, &[]).border.unwrap();
        for side in [updated.left, updated.right, updated.top, updated.bottom] {
            let side = side.unwrap();
            assert_eq!(side.style, BorderStyle::Thick);
            assert_eq!(side.color, Some(hex_to_color_def("#445566")));
        }
        projected.border_left_color = None;
        projected.border_left_style = None;
        let updated = reconcile(&projected, &original, &[]).border.unwrap();
        assert_eq!(updated.left, None);
        assert_eq!(updated.right.unwrap().style, BorderStyle::Thick);
    }
}
