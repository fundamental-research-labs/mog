use domain_types::chart::{
    ChartColorData, ChartDashStyle, ChartFillData, ChartFontData, ChartFormatData, ChartLineData,
    ChartStrikeStyle, ChartUnderlineStyle,
};
use ooxml_types::drawings::{
    ColorTransform, DashStyle, DrawingColor, DrawingFill, GradientFill, GradientPathType,
    GradientStop, LineDash, LineFill, Outline, Paragraph, ParagraphProperties, PatternFill,
    PresetPatternVal, RunProperties, SchemeColor, ShapeProperties, SolidFill, StAngle,
    StPositiveFixedPercentageDecimal, TextBody, TextBodyProperties, TextFont, TextStrikeType,
    TextUnderlineType,
};

// =============================================================================
// Formatting builders (inverse of extraction formatters)
// =============================================================================

pub(super) fn build_shape_properties(fmt: &ChartFormatData) -> Option<ShapeProperties> {
    let fill = fmt.fill.as_ref().map(build_drawing_fill);
    let ln = fmt.line.as_ref().map(build_outline);

    if fill.is_none() && ln.is_none() {
        return None;
    }

    Some(ShapeProperties {
        fill,
        ln,
        ..Default::default()
    })
}

pub(super) fn build_text_body(fmt: &ChartFormatData) -> Option<TextBody> {
    let font = fmt.font.as_ref()?;
    let rpr = build_run_properties(font);

    let rot = fmt
        .text_rotation
        .map(|deg| StAngle::new((deg * 60000.0) as i32));
    let body_props = TextBodyProperties {
        rot,
        ..Default::default()
    };

    let para = Paragraph {
        props: ParagraphProperties {
            def_run_props: Some(Box::new(rpr)),
            ..Default::default()
        },
        runs: Vec::new(),
        end_para_rpr: None,
    };

    Some(TextBody {
        body_props,
        list_style: None,
        paragraphs: vec![para],
    })
}

pub(super) fn build_drawing_fill(fill: &ChartFillData) -> DrawingFill {
    match fill {
        ChartFillData::NoFill => DrawingFill::NoFill,
        ChartFillData::Solid {
            color,
            transparency,
        } => {
            let mut dc = build_drawing_color(color);
            // Apply transparency as alpha transform
            if let Some(t) = transparency {
                let alpha_val = ((1.0 - t / 100.0) * 100000.0) as i32;
                add_alpha_transform(&mut dc, alpha_val);
            }
            DrawingFill::Solid(SolidFill { color: dc })
        }
        ChartFillData::Gradient {
            gradient_type,
            angle,
            stops,
        } => {
            let gs_stops: Vec<GradientStop> = stops
                .iter()
                .map(|s| {
                    let mut color = build_drawing_color(&s.color);
                    if let Some(t) = s.transparency {
                        let alpha_val = ((1.0 - t / 100.0) * 100000.0) as i32;
                        add_alpha_transform(&mut color, alpha_val);
                    }
                    GradientStop {
                        position: StPositiveFixedPercentageDecimal::new_clamped(
                            (s.position * 1000.0) as u32,
                        ),
                        color,
                    }
                })
                .collect();

            let lin_ang = angle.map(|a| StAngle::new((a * 60000.0) as i32));
            let path = match gradient_type {
                domain_types::chart::ChartGradientType::Linear => None,
                domain_types::chart::ChartGradientType::Radial => Some(GradientPathType::Circle),
                domain_types::chart::ChartGradientType::Rectangular => Some(GradientPathType::Rect),
            };

            DrawingFill::Gradient(GradientFill {
                stops: gs_stops,
                lin_ang,
                path,
                ..Default::default()
            })
        }
        ChartFillData::Pattern {
            pattern,
            foreground,
            background,
        } => {
            let fg_color = foreground.as_ref().map(build_drawing_color);
            let bg_color = background.as_ref().map(build_drawing_color);
            // Parse pattern string to PresetPatternVal if possible; otherwise leave None
            let preset = PresetPatternVal::from_ooxml(pattern);
            DrawingFill::Pattern(PatternFill {
                preset,
                fg_color,
                bg_color,
            })
        }
    }
}

pub(super) fn build_outline(line: &ChartLineData) -> Outline {
    let width = line.width.map(|pts| (pts * 12700.0) as i64); // points to EMUs

    let fill = line.color.as_ref().map(|c| {
        let dc = build_drawing_color(c);
        LineFill::Solid(SolidFill { color: dc })
    });

    let dash = line.dash_style.as_ref().map(|ds| {
        let style = match ds {
            ChartDashStyle::Solid => DashStyle::Solid,
            ChartDashStyle::Dot => DashStyle::Dot,
            ChartDashStyle::Dash => DashStyle::Dash,
            ChartDashStyle::DashDot => DashStyle::DashDot,
            ChartDashStyle::LongDash => DashStyle::LongDash,
            ChartDashStyle::LongDashDot => DashStyle::LongDashDot,
            ChartDashStyle::LongDashDotDot => DashStyle::LongDashDotDot,
        };
        LineDash::Preset(style)
    });

    Outline {
        width,
        fill,
        dash,
        ..Default::default()
    }
}

pub(super) fn build_drawing_color(color: &ChartColorData) -> DrawingColor {
    match color {
        ChartColorData::Hex(hex) => DrawingColor::SrgbClr {
            val: hex.trim_start_matches('#').to_string(),
            transforms: Vec::new(),
        },
        ChartColorData::Theme { theme, tint_shade } => {
            let val = SchemeColor::from_ooxml(theme).unwrap_or(SchemeColor::Accent1);
            let mut transforms = Vec::new();
            if let Some(ts) = tint_shade {
                // Positive = tint (toward white), negative = shade (toward black)
                let ts_val = *ts;
                if ts_val >= 0.0 {
                    transforms.push(ColorTransform::Tint {
                        val: (ts_val * 100000.0) as i32,
                    });
                } else {
                    transforms.push(ColorTransform::Shade {
                        val: ((1.0 + ts_val) * 100000.0) as i32,
                    });
                }
            }
            DrawingColor::SchemeClr { val, transforms }
        }
    }
}

pub(super) fn add_alpha_transform(color: &mut DrawingColor, alpha_val: i32) {
    match color {
        DrawingColor::SrgbClr { transforms, .. }
        | DrawingColor::SchemeClr { transforms, .. }
        | DrawingColor::HslClr { transforms, .. }
        | DrawingColor::SysClr { transforms, .. }
        | DrawingColor::PrstClr { transforms, .. }
        | DrawingColor::ScrgbClr { transforms, .. } => {
            transforms.push(ColorTransform::Alpha { val: alpha_val });
        }
    }
}

pub(super) fn build_run_properties(font: &ChartFontData) -> RunProperties {
    let size = font
        .size
        .and_then(|pts| ooxml_types::drawings::StTextFontSize::new((pts * 100.0) as u32));
    let latin = font.name.as_ref().map(|n| TextFont {
        typeface: n.clone(),
        panose: None,
        pitch_family: None,
        charset: None,
    });

    let color = font.color.as_ref().map(build_drawing_color);

    let underline = font.underline.as_ref().map(|u| match u {
        ChartUnderlineStyle::None => TextUnderlineType::None,
        ChartUnderlineStyle::Single => TextUnderlineType::Single,
        ChartUnderlineStyle::Double => TextUnderlineType::Double,
        ChartUnderlineStyle::SingleAccountant => TextUnderlineType::Heavy, // closest match
        ChartUnderlineStyle::DoubleAccountant => TextUnderlineType::Double, // closest match
        ChartUnderlineStyle::Dash => TextUnderlineType::Dash,
        ChartUnderlineStyle::DashLong => TextUnderlineType::DashLong,
        ChartUnderlineStyle::DotDash => TextUnderlineType::DotDash,
        ChartUnderlineStyle::DotDotDash => TextUnderlineType::DotDotDash,
        ChartUnderlineStyle::Dotted => TextUnderlineType::Dotted,
        ChartUnderlineStyle::Heavy => TextUnderlineType::Heavy,
        ChartUnderlineStyle::Wavy => TextUnderlineType::Wavy,
        ChartUnderlineStyle::WavyDouble => TextUnderlineType::WavyDouble,
        ChartUnderlineStyle::WavyHeavy => TextUnderlineType::WavyHeavy,
        ChartUnderlineStyle::Words => TextUnderlineType::Words,
    });

    let strike = font.strikethrough.as_ref().map(|s| match s {
        ChartStrikeStyle::Single => TextStrikeType::SingleStrike,
        ChartStrikeStyle::Double => TextStrikeType::DoubleStrike,
    });

    RunProperties {
        size,
        bold: font.bold,
        italic: font.italic,
        underline,
        strike,
        latin,
        color,
        ..Default::default()
    }
}
