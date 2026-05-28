/// Extract hex RGB color from chart ShapeProperties fill.
pub(super) fn extract_fill_color(sp_pr: &ooxml_types::charts::ShapeProperties) -> Option<String> {
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

pub(super) fn extract_chart_format(
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

    if fill.is_none() && line.is_none() && font.is_none() && text_rotation.is_none() {
        return None;
    }

    Some(domain_types::chart::ChartFormatData {
        fill,
        line,
        font,
        text_rotation,
        shadow: None,
    })
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
pub(super) fn extract_chart_line(
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
                DashStyle::Dot | DashStyle::SystemDot => {
                    Some(domain_types::chart::ChartDashStyle::Dot)
                }
                DashStyle::Dash | DashStyle::SystemDash => {
                    Some(domain_types::chart::ChartDashStyle::Dash)
                }
                DashStyle::DashDot | DashStyle::SystemDashDot => {
                    Some(domain_types::chart::ChartDashStyle::DashDot)
                }
                DashStyle::LongDash => Some(domain_types::chart::ChartDashStyle::LongDash),
                DashStyle::LongDashDot => Some(domain_types::chart::ChartDashStyle::LongDashDot),
                DashStyle::LongDashDotDot | DashStyle::SystemDashDotDot => {
                    Some(domain_types::chart::ChartDashStyle::LongDashDotDot)
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
    }
}

/// Extract ChartFontData from a TextBody (uses defRPr from first paragraph).
fn extract_chart_font(
    tx_pr: &ooxml_types::drawings::TextBody,
) -> Option<domain_types::chart::ChartFontData> {
    // Use defRPr from first paragraph's properties
    let rpr = tx_pr
        .paragraphs
        .first()
        .and_then(|p| p.props.def_run_props.as_ref());

    let rpr = rpr.map(|b| b.as_ref())?;

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

/// Extract ChartColorData from a DrawingColor.
fn extract_chart_color(
    color: &ooxml_types::drawings::DrawingColor,
) -> Option<domain_types::chart::ChartColorData> {
    use ooxml_types::drawings::{ColorTransform, DrawingColor};

    match color {
        DrawingColor::SrgbClr { val, .. } if !val.is_empty() => {
            Some(domain_types::chart::ChartColorData::Hex(val.clone()))
        }
        DrawingColor::SchemeClr { val, transforms } => {
            let theme = val.to_ooxml().to_string();
            // Extract tint/shade transform if present
            let tint_shade = transforms.iter().find_map(|t| match t {
                ColorTransform::Tint { val } => Some(*val as f64 / 100000.0),
                ColorTransform::Shade { val } => Some(-(*val as f64 / 100000.0)),
                _ => None,
            });
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
