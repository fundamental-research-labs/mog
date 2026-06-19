use ooxml_types::drawings::{ColorTransform, TextRunContent};

/// Extract hex RGB color from chart ShapeProperties fill.
pub(crate) fn extract_fill_color(sp_pr: &ooxml_types::charts::ShapeProperties) -> Option<String> {
    use ooxml_types::drawings::DrawingFill;

    match &sp_pr.fill {
        Some(DrawingFill::Solid(sf)) => match &sf.color {
            ooxml_types::drawings::DrawingColor::SrgbClr { val, .. } if !val.is_empty() => {
                Some(val.clone())
            }
            _ => None,
        },
        _ => None,
    }
}

pub(crate) fn extract_chart_format(
    sp_pr: Option<&ooxml_types::charts::ShapeProperties>,
    tx_pr: Option<&ooxml_types::drawings::TextBody>,
) -> Option<domain_types::chart::ChartFormatData> {
    let fill = sp_pr
        .and_then(|sp| sp.fill.as_ref())
        .map(|f| extract_chart_fill(f));
    let line = sp_pr
        .and_then(|sp| sp.ln.as_ref())
        .map(|ln| extract_chart_line(ln));
    let font = tx_pr.and_then(|tp| extract_chart_font(tp));
    let text_rotation = tx_pr
        .map(|tp| &tp.body_props)
        .and_then(|bp| bp.rot)
        .map(|r| r.value() as f64 / 60000.0);
    let text_vertical_type = tx_pr
        .map(|tp| &tp.body_props)
        .and_then(|bp| bp.vert.as_ref())
        .map(chart_text_vertical_type_from_ooxml);

    if fill.is_none()
        && line.is_none()
        && font.is_none()
        && text_rotation.is_none()
        && text_vertical_type.is_none()
    {
        return None;
    }

    Some(domain_types::chart::ChartFormatData {
        fill,
        line,
        font,
        text_rotation,
        text_vertical_type,
        shadow: None,
    })
}

/// Extract a chart/axis title format.
///
/// Excel commonly stores title text styling inside `<c:tx><c:rich>` instead of
/// the sibling `<c:txPr>`. Shape formatting still comes from `<c:spPr>`, while
/// rich text supplies missing font/rotation fields.
pub(super) fn extract_title_chart_format(
    title: &ooxml_types::charts::Title,
) -> Option<domain_types::chart::ChartFormatData> {
    let mut format = extract_chart_format(title.sp_pr.as_ref(), title.tx_pr.as_ref());

    let rich_format = title.tx.as_ref().and_then(|tx| match tx {
        ooxml_types::charts::ChartText::Rich(body) => extract_chart_format(None, Some(body)),
        ooxml_types::charts::ChartText::StrRef(_) => None,
    });

    let Some(rich_format) = rich_format else {
        return format;
    };

    match format.as_mut() {
        Some(existing) => {
            existing.font = merge_chart_font(existing.font.take(), rich_format.font);
            if existing.text_rotation.is_none() {
                existing.text_rotation = rich_format.text_rotation;
            }
            if existing.text_vertical_type.is_none() {
                existing.text_vertical_type = rich_format.text_vertical_type;
            }
            format
        }
        None => Some(rich_format),
    }
}

/// Extract ChartFillData from a DrawingFill.
fn extract_chart_fill(
    fill: &ooxml_types::drawings::DrawingFill,
) -> domain_types::chart::ChartFillData {
    use ooxml_types::drawings::DrawingFill;

    match fill {
        DrawingFill::NoFill => domain_types::chart::ChartFillData::NoFill,
        DrawingFill::Solid(sf) => {
            let color = extract_chart_color(&sf.color);
            let transparency = extract_alpha_transparency(&sf.color);
            match color {
                Some(c) => domain_types::chart::ChartFillData::Solid {
                    color: c,
                    transparency,
                },
                None => domain_types::chart::ChartFillData::NoFill,
            }
        }
        DrawingFill::Gradient(gf) => {
            let gradient_type = if gf.path.is_some() {
                match gf.path {
                    Some(ooxml_types::drawings::GradientPathType::Circle) => {
                        domain_types::chart::ChartGradientType::Radial
                    }
                    Some(ooxml_types::drawings::GradientPathType::Rect)
                    | Some(ooxml_types::drawings::GradientPathType::Shape) => {
                        domain_types::chart::ChartGradientType::Rectangular
                    }
                    None => domain_types::chart::ChartGradientType::Linear,
                }
            } else {
                domain_types::chart::ChartGradientType::Linear
            };

            let angle = gf.lin_ang.map(|a| a.value() as f64 / 60000.0);

            let stops = gf
                .stops
                .iter()
                .filter_map(|gs| {
                    let color = extract_chart_color(&gs.color)?;
                    let transparency = extract_alpha_transparency(&gs.color);
                    Some(domain_types::chart::ChartGradientStop {
                        position: gs.position.value() as f64 / 100000.0,
                        color,
                        transparency,
                    })
                })
                .collect();

            domain_types::chart::ChartFillData::Gradient {
                gradient_type,
                angle,
                stops,
            }
        }
        DrawingFill::Pattern(pf) => {
            let pattern = pf
                .preset
                .as_ref()
                .map(|p| p.to_ooxml().to_string())
                .unwrap_or_default();
            let foreground = pf.fg_color.as_ref().and_then(|c| extract_chart_color(c));
            let background = pf.bg_color.as_ref().and_then(|c| extract_chart_color(c));
            domain_types::chart::ChartFillData::Pattern {
                pattern,
                foreground,
                background,
            }
        }
        // BlipFill and Group — not representable in our domain model, fallback to NoFill
        _ => domain_types::chart::ChartFillData::NoFill,
    }
}

/// Extract ChartLineData from an Outline.
pub(crate) fn extract_chart_line(
    outline: &ooxml_types::drawings::Outline,
) -> domain_types::chart::ChartLineData {
    use ooxml_types::drawings::{LineDash, LineFill};

    let color = outline.fill.as_ref().and_then(|lf| match lf {
        LineFill::Solid(sf) => extract_chart_color(&sf.color),
        _ => None,
    });

    let width = outline.width.map(|w| w as f64 / 12700.0); // EMU to points

    let dash_style = outline.dash.as_ref().and_then(|d| match d {
        LineDash::Preset(ds) => {
            use ooxml_types::drawings::DashStyle;
            match ds {
                DashStyle::Solid => Some(domain_types::chart::ChartDashStyle::Solid),
                DashStyle::Dot => Some(domain_types::chart::ChartDashStyle::Dot),
                DashStyle::SystemDot => Some(domain_types::chart::ChartDashStyle::SysDot),
                DashStyle::Dash => Some(domain_types::chart::ChartDashStyle::Dash),
                DashStyle::SystemDash => Some(domain_types::chart::ChartDashStyle::SysDash),
                DashStyle::DashDot => Some(domain_types::chart::ChartDashStyle::DashDot),
                DashStyle::SystemDashDot => Some(domain_types::chart::ChartDashStyle::SysDashDot),
                DashStyle::LongDash => Some(domain_types::chart::ChartDashStyle::LongDash),
                DashStyle::LongDashDot => Some(domain_types::chart::ChartDashStyle::LongDashDot),
                DashStyle::LongDashDotDot => {
                    Some(domain_types::chart::ChartDashStyle::LongDashDotDot)
                }
                DashStyle::SystemDashDotDot => {
                    Some(domain_types::chart::ChartDashStyle::SysDashDotDot)
                }
            }
        }
        LineDash::Custom(_) => None,
    });

    let transparency = outline.fill.as_ref().and_then(|lf| match lf {
        LineFill::Solid(sf) => extract_alpha_transparency(&sf.color),
        _ => None,
    });

    domain_types::chart::ChartLineData {
        color,
        width,
        dash_style,
        transparency,
        no_fill: matches!(outline.fill.as_ref(), Some(LineFill::NoFill)).then_some(true),
    }
}

/// Extract ChartFontData from a TextBody.
fn extract_chart_font(
    tx_pr: &ooxml_types::drawings::TextBody,
) -> Option<domain_types::chart::ChartFontData> {
    for paragraph in &tx_pr.paragraphs {
        let default_font = paragraph
            .props
            .def_run_props
            .as_deref()
            .and_then(extract_chart_font_from_run_properties);

        for run_content in &paragraph.runs {
            let run_font = match run_content {
                TextRunContent::Run(run) => extract_chart_font_from_run_properties(&run.props),
                TextRunContent::LineBreak { props } => props
                    .as_ref()
                    .and_then(extract_chart_font_from_run_properties),
                TextRunContent::Field { run_props, .. } => run_props
                    .as_ref()
                    .and_then(extract_chart_font_from_run_properties),
            };
            if default_font.is_some() || run_font.is_some() {
                return merge_chart_font(default_font, run_font);
            }
        }

        if default_font.is_some() {
            return default_font;
        }

        if let Some(end_font) = paragraph
            .end_para_rpr
            .as_ref()
            .and_then(extract_chart_font_from_run_properties)
        {
            return Some(end_font);
        }
    }

    None
}

pub(crate) fn extract_chart_rich_text(
    tx_pr: &ooxml_types::drawings::TextBody,
) -> Option<Vec<domain_types::chart::ChartFormatStringData>> {
    let mut runs = Vec::new();
    for paragraph in &tx_pr.paragraphs {
        let default_font = paragraph
            .props
            .def_run_props
            .as_deref()
            .and_then(extract_chart_font_from_run_properties);

        for run_content in &paragraph.runs {
            match run_content {
                TextRunContent::Run(run) if !run.text.is_empty() => {
                    runs.push(domain_types::chart::ChartFormatStringData {
                        text: run.text.clone(),
                        font: merge_chart_font(
                            default_font.clone(),
                            extract_chart_font_from_run_properties(&run.props),
                        ),
                    });
                }
                TextRunContent::Field {
                    text: Some(text),
                    run_props,
                    ..
                } if !text.is_empty() => {
                    runs.push(domain_types::chart::ChartFormatStringData {
                        text: text.clone(),
                        font: merge_chart_font(
                            default_font.clone(),
                            run_props
                                .as_ref()
                                .and_then(extract_chart_font_from_run_properties),
                        ),
                    });
                }
                TextRunContent::LineBreak { .. } => {
                    runs.push(domain_types::chart::ChartFormatStringData {
                        text: "\n".to_string(),
                        font: default_font.clone(),
                    });
                }
                _ => {}
            }
        }
    }

    (!runs.is_empty()).then_some(runs)
}

fn extract_chart_font_from_run_properties(
    rpr: &ooxml_types::drawings::RunProperties,
) -> Option<domain_types::chart::ChartFontData> {
    let name = rpr.latin.as_ref().map(|f| f.typeface.clone());
    let size = rpr.size.map(|s| s.value() as f64 / 100.0); // hundredths of a point to points
    let bold = rpr.bold;
    let italic = rpr.italic;
    let color = rpr.color.as_ref().and_then(|c| extract_chart_color(c));

    let underline = rpr.underline.and_then(|u| {
        use ooxml_types::drawings::TextUnderlineType;
        match u {
            TextUnderlineType::None => None, // Don't emit for "none"
            TextUnderlineType::Single => Some(domain_types::chart::ChartUnderlineStyle::Single),
            TextUnderlineType::Double => Some(domain_types::chart::ChartUnderlineStyle::Double),
            TextUnderlineType::Dash | TextUnderlineType::DashHeavy => {
                Some(domain_types::chart::ChartUnderlineStyle::Dash)
            }
            TextUnderlineType::DashLong | TextUnderlineType::DashLongHeavy => {
                Some(domain_types::chart::ChartUnderlineStyle::DashLong)
            }
            TextUnderlineType::DotDash | TextUnderlineType::DotDashHeavy => {
                Some(domain_types::chart::ChartUnderlineStyle::DotDash)
            }
            TextUnderlineType::DotDotDash | TextUnderlineType::DotDotDashHeavy => {
                Some(domain_types::chart::ChartUnderlineStyle::DotDotDash)
            }
            TextUnderlineType::Dotted | TextUnderlineType::DottedHeavy => {
                Some(domain_types::chart::ChartUnderlineStyle::Dotted)
            }
            TextUnderlineType::Heavy => Some(domain_types::chart::ChartUnderlineStyle::Heavy),
            TextUnderlineType::Wavy => Some(domain_types::chart::ChartUnderlineStyle::Wavy),
            TextUnderlineType::WavyDouble => {
                Some(domain_types::chart::ChartUnderlineStyle::WavyDouble)
            }
            TextUnderlineType::WavyHeavy => {
                Some(domain_types::chart::ChartUnderlineStyle::WavyHeavy)
            }
            TextUnderlineType::Words => Some(domain_types::chart::ChartUnderlineStyle::Words),
        }
    });

    let strikethrough = rpr.strike.and_then(|s| {
        use ooxml_types::drawings::TextStrikeType;
        match s {
            TextStrikeType::NoStrike => None,
            TextStrikeType::SingleStrike => Some(domain_types::chart::ChartStrikeStyle::Single),
            TextStrikeType::DoubleStrike => Some(domain_types::chart::ChartStrikeStyle::Double),
        }
    });

    if name.is_none()
        && size.is_none()
        && bold.is_none()
        && italic.is_none()
        && color.is_none()
        && underline.is_none()
        && strikethrough.is_none()
    {
        return None;
    }

    Some(domain_types::chart::ChartFontData {
        name,
        size,
        bold,
        italic,
        color,
        underline,
        strikethrough,
    })
}

fn merge_chart_font(
    base: Option<domain_types::chart::ChartFontData>,
    override_font: Option<domain_types::chart::ChartFontData>,
) -> Option<domain_types::chart::ChartFontData> {
    match (base, override_font) {
        (Some(mut base), Some(override_font)) => {
            if override_font.name.is_some() {
                base.name = override_font.name;
            }
            if override_font.size.is_some() {
                base.size = override_font.size;
            }
            if override_font.bold.is_some() {
                base.bold = override_font.bold;
            }
            if override_font.italic.is_some() {
                base.italic = override_font.italic;
            }
            if override_font.color.is_some() {
                base.color = override_font.color;
            }
            if override_font.underline.is_some() {
                base.underline = override_font.underline;
            }
            if override_font.strikethrough.is_some() {
                base.strikethrough = override_font.strikethrough;
            }
            Some(base)
        }
        (Some(base), None) => Some(base),
        (None, Some(override_font)) => Some(override_font),
        (None, None) => None,
    }
}

fn chart_text_vertical_type_from_ooxml(
    value: &ooxml_types::drawings::TextVerticalType,
) -> domain_types::chart::ChartTextVerticalType {
    match value {
        ooxml_types::drawings::TextVerticalType::Horizontal => {
            domain_types::chart::ChartTextVerticalType::Horizontal
        }
        ooxml_types::drawings::TextVerticalType::Vertical => {
            domain_types::chart::ChartTextVerticalType::Vertical
        }
        ooxml_types::drawings::TextVerticalType::Vertical270 => {
            domain_types::chart::ChartTextVerticalType::Vertical270
        }
        ooxml_types::drawings::TextVerticalType::WordArtVert => {
            domain_types::chart::ChartTextVerticalType::WordArtVert
        }
        ooxml_types::drawings::TextVerticalType::EastAsianVert => {
            domain_types::chart::ChartTextVerticalType::EastAsianVert
        }
        ooxml_types::drawings::TextVerticalType::MongolianVert => {
            domain_types::chart::ChartTextVerticalType::MongolianVert
        }
        ooxml_types::drawings::TextVerticalType::WordArtVertRtl => {
            domain_types::chart::ChartTextVerticalType::WordArtVertRtl
        }
    }
}

/// Extract ChartColorData from a DrawingColor.
pub(crate) fn extract_chart_color(
    color: &ooxml_types::drawings::DrawingColor,
) -> Option<domain_types::chart::ChartColorData> {
    use ooxml_types::drawings::DrawingColor;

    match color {
        DrawingColor::SrgbClr { val, .. } if !val.is_empty() => {
            Some(domain_types::chart::ChartColorData::Hex(val.clone()))
        }
        DrawingColor::SchemeClr { val, transforms } => {
            let theme = val.to_ooxml().to_string();
            let tint_shade = extract_luminance_tint_shade(transforms);
            Some(domain_types::chart::ChartColorData::Theme { theme, tint_shade })
        }
        DrawingColor::SysClr { last_clr, .. } => {
            // Use last computed color if available
            last_clr
                .as_ref()
                .filter(|c| !c.is_empty())
                .map(|c| domain_types::chart::ChartColorData::Hex(c.clone()))
        }
        DrawingColor::PrstClr { val, .. } => Some(domain_types::chart::ChartColorData::Hex(
            val.to_ooxml().to_string(),
        )),
        // ScrgbClr, HslClr — not directly representable in our domain model
        _ => None,
    }
}

fn extract_luminance_tint_shade(transforms: &[ColorTransform]) -> Option<f64> {
    for transform in transforms {
        match transform {
            ColorTransform::Tint { val } => return Some(*val as f64 / 100000.0),
            ColorTransform::Shade { val } => return Some(*val as f64 / 100000.0 - 1.0),
            _ => {}
        }
    }

    let lum_mod = transforms.iter().find_map(|t| match t {
        ColorTransform::LumMod { val } => Some(*val as f64 / 100000.0),
        _ => None,
    });
    let lum_off = transforms.iter().find_map(|t| match t {
        ColorTransform::LumOff { val } => Some(*val as f64 / 100000.0),
        _ => None,
    });

    match (lum_mod, lum_off) {
        (Some(lum_mod), Some(lum_off)) if (lum_mod + lum_off - 1.0_f64).abs() < 0.00001_f64 => {
            Some(lum_off)
        }
        (Some(lum_mod), _) => Some(lum_mod - 1.0),
        (None, Some(lum_off)) => Some(lum_off),
        (None, None) => None,
    }
}

/// Extract alpha transparency from color transforms.
/// Returns Some(fraction) where 0.0 = fully opaque, 1.0 = fully transparent.
fn extract_alpha_transparency(color: &ooxml_types::drawings::DrawingColor) -> Option<f64> {
    use ooxml_types::drawings::ColorTransform;

    let transforms = match color {
        ooxml_types::drawings::DrawingColor::SrgbClr { transforms, .. } => transforms,
        ooxml_types::drawings::DrawingColor::SchemeClr { transforms, .. } => transforms,
        ooxml_types::drawings::DrawingColor::HslClr { transforms, .. } => transforms,
        ooxml_types::drawings::DrawingColor::SysClr { transforms, .. } => transforms,
        ooxml_types::drawings::DrawingColor::PrstClr { transforms, .. } => transforms,
        ooxml_types::drawings::DrawingColor::ScrgbClr { transforms, .. } => transforms,
    };

    transforms.iter().find_map(|t| match t {
        ColorTransform::Alpha { val } => {
            let opacity = *val as f64 / 100000.0; // 0-1
            let transparency = 1.0 - opacity;
            if transparency > 0.001 {
                Some(transparency)
            } else {
                None
            }
        }
        _ => None,
    })
}

// Extract plain text from a ChartText (CT_Tx).

#[cfg(test)]
mod tests {
    use super::*;
    use domain_types::chart::{ChartColorData, ChartDashStyle};
    use ooxml_types::drawings::{
        ColorTransform, DashStyle, DrawingColor, LineDash, Outline, SchemeColor,
    };

    fn tint_shade_for(transforms: Vec<ColorTransform>) -> Option<f64> {
        match extract_chart_color(&DrawingColor::SchemeClr {
            val: SchemeColor::Accent1,
            transforms,
        }) {
            Some(ChartColorData::Theme { tint_shade, .. }) => tint_shade,
            other => panic!("expected theme color, got {other:?}"),
        }
    }

    fn assert_close(actual: Option<f64>, expected: f64) {
        let actual = actual.expect("expected tint/shade value");
        assert!(
            (actual - expected).abs() < 0.00001,
            "expected {expected}, got {actual}"
        );
    }

    #[test]
    fn preserves_system_line_dash_styles() {
        let cases = [
            (DashStyle::SystemDash, ChartDashStyle::SysDash),
            (DashStyle::SystemDot, ChartDashStyle::SysDot),
            (DashStyle::SystemDashDot, ChartDashStyle::SysDashDot),
            (DashStyle::SystemDashDotDot, ChartDashStyle::SysDashDotDot),
        ];

        for (source, expected) in cases {
            let outline = Outline {
                dash: Some(LineDash::Preset(source)),
                ..Default::default()
            };

            assert_eq!(extract_chart_line(&outline).dash_style, Some(expected));
        }
    }

    #[test]
    fn extracts_luminance_mod_as_shade() {
        assert_close(
            tint_shade_for(vec![ColorTransform::LumMod { val: 60000 }]),
            -0.4,
        );
    }

    #[test]
    fn extracts_luminance_mod_off_as_tint() {
        assert_close(
            tint_shade_for(vec![
                ColorTransform::LumMod { val: 60000 },
                ColorTransform::LumOff { val: 40000 },
            ]),
            0.4,
        );
    }

    #[test]
    fn extracts_shade_as_remaining_luminance_delta() {
        assert_close(
            tint_shade_for(vec![ColorTransform::Shade { val: 60000 }]),
            -0.4,
        );
    }

    #[test]
    fn extracts_font_from_run_properties_when_default_run_properties_are_absent() {
        let body = crate::domain::charts::parse_text_body(
            br#"<c:rich xmlns:c="http://schemas.openxmlformats.org/drawingml/2006/chart"
                      xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main">
                <a:bodyPr/>
                <a:p>
                    <a:r>
                        <a:rPr sz="1200" b="1">
                            <a:latin typeface="+mn-lt"/>
                        </a:rPr>
                        <a:t>Title</a:t>
                    </a:r>
                </a:p>
            </c:rich>"#,
        );

        let format = extract_chart_format(None, Some(&body)).expect("expected text format");
        let font = format.font.expect("expected font");
        assert_eq!(font.size, Some(12.0));
        assert_eq!(font.bold, Some(true));
        assert_eq!(font.name.as_deref(), Some("+mn-lt"));
    }

    #[test]
    fn extracts_title_font_from_rich_text_when_title_tx_pr_is_absent() {
        let body = crate::domain::charts::parse_text_body(
            br#"<c:rich xmlns:c="http://schemas.openxmlformats.org/drawingml/2006/chart"
                      xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main">
                <a:bodyPr rot="-5400000"/>
                <a:p>
                    <a:pPr>
                        <a:defRPr sz="1400" b="1"/>
                    </a:pPr>
                    <a:r>
                        <a:rPr lang="en-US"/>
                        <a:t>Capital Capable Media LLC</a:t>
                    </a:r>
                </a:p>
            </c:rich>"#,
        );
        let title = ooxml_types::charts::Title {
            tx: Some(ooxml_types::charts::ChartText::Rich(body)),
            ..Default::default()
        };

        let format = extract_title_chart_format(&title).expect("expected title format");
        let font = format.font.expect("expected title font");
        assert_eq!(font.size, Some(14.0));
        assert_eq!(font.bold, Some(true));
        assert_eq!(format.text_rotation, Some(-90.0));
    }

    #[test]
    fn merges_title_rich_text_font_with_title_tx_pr_font() {
        let tx_pr = crate::domain::charts::parse_text_body(
            br#"<c:txPr xmlns:c="http://schemas.openxmlformats.org/drawingml/2006/chart"
                       xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main">
                <a:bodyPr/>
                <a:p>
                    <a:pPr>
                        <a:defRPr sz="1600">
                            <a:solidFill>
                                <a:srgbClr val="1F1F1F"/>
                            </a:solidFill>
                        </a:defRPr>
                    </a:pPr>
                </a:p>
            </c:txPr>"#,
        );
        let rich = crate::domain::charts::parse_text_body(
            br#"<c:rich xmlns:c="http://schemas.openxmlformats.org/drawingml/2006/chart"
                      xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main">
                <a:bodyPr/>
                <a:p>
                    <a:pPr>
                        <a:defRPr b="1"/>
                    </a:pPr>
                    <a:r>
                        <a:rPr lang="en-US"/>
                        <a:t>Modern Specialty Proxy 39</a:t>
                    </a:r>
                </a:p>
            </c:rich>"#,
        );
        let title = ooxml_types::charts::Title {
            tx: Some(ooxml_types::charts::ChartText::Rich(rich)),
            tx_pr: Some(tx_pr),
            ..Default::default()
        };

        let format = extract_title_chart_format(&title).expect("expected title format");
        let font = format.font.expect("expected title font");
        assert_eq!(font.size, Some(16.0));
        assert_eq!(
            font.color,
            Some(domain_types::chart::ChartColorData::Hex(
                "1F1F1F".to_string()
            ))
        );
        assert_eq!(font.bold, Some(true));
    }

    #[test]
    fn extracts_text_vertical_type_separately_from_rotation() {
        let body = crate::domain::charts::parse_text_body(
            br#"<c:rich xmlns:c="http://schemas.openxmlformats.org/drawingml/2006/chart"
                      xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main">
                <a:bodyPr rot="-60000000" vert="horz"/>
                <a:p/>
            </c:rich>"#,
        );

        let format = extract_chart_format(None, Some(&body)).expect("expected text format");
        assert_eq!(format.text_rotation, Some(-1000.0));
        assert_eq!(
            format.text_vertical_type,
            Some(domain_types::chart::ChartTextVerticalType::Horizontal)
        );
    }
}
