use super::*;

// =============================================================================
// Domain conversions: Conditional formatting
// =============================================================================

/// Convert fully-parsed `ooxml_types::ConditionalFormatting` into domain `ConditionalFormat` items.
/// Preserves complete rule definitions including color scales, data bars, icon sets,
/// cell-is conditions, formula rules, text rules, and all other CF rule types.
///
/// # Typed sqref boundary:
///
/// The `sqref` string is routed through the typed [`compute_parser::SqrefList`]
/// parser rather than naïve `split_whitespace` + per-token range parsing.
/// The typed form drops malformed tokens atomically (a single bad token
/// yields `None`), where the old path would silently keep whichever tokens
/// happened to parse — see [`parse_sqref_to_cf_ranges`] for the explicit
/// empty-on-error contract.
pub(crate) fn convert_conditional_formats(
    cfs: &[ooxml_types::cond_format::ConditionalFormatting],
    dxfs: &[crate::domain::styles::types::DxfDef],
    theme_colors: &[String],
) -> Vec<ConditionalFormat> {
    cfs.iter()
        .map(|cf| {
            let ranges = parse_sqref_to_cf_ranges(&cf.sqref);
            ConditionalFormat {
                id: make_cf_id(),
                sheet_id: String::new(), // Hydration layer sets the real sheet_id
                pivot: if cf.pivot { Some(true) } else { None },
                ranges,
                range_identities: None,
                rules: cf
                    .rules
                    .iter()
                    .map(|r| convert_cf_rule(r, dxfs, theme_colors))
                    .collect(),
            }
        })
        .collect()
}

/// Generate a deterministic CF/rule identifier.
/// Uses a simple counter-based scheme since the parser doesn't have UUID deps.
/// The hydration layer will assign real UUIDs when needed.
fn make_cf_id() -> String {
    use std::sync::atomic::{AtomicU64, Ordering};
    static COUNTER: AtomicU64 = AtomicU64::new(1);
    format!("cf-parse-{}", COUNTER.fetch_add(1, Ordering::Relaxed))
}

/// Parse a raw XLSX `sqref` string into a `Vec<CFCellRange>` via
/// [`compute_parser::SqrefList`] (typed sqref boundary typed boundary).
///
/// The canonical in-engine version of this helper lives at
/// `compute::import::parse_output_to_snapshot::cond_format_lowering`; the
/// copy here is mechanical, kept in `xlsx-parser` because that crate cannot
/// depend on `compute-core`. If the helper grows non-trivial logic both
/// copies must stay in sync.
///
/// Behaviour: empty / whitespace-only / fully-malformed input yields an
/// empty vector (no panic). A partially-valid sqref (one good token, one
/// bad) also yields an empty vector — the typed `SqrefList::parse` fails
/// atomically on any token error, which is stricter than the old
/// per-token `filter_map` and surfaces malformed XLSX to the downstream
/// layer instead of silently half-accepting it.
fn parse_sqref_to_cf_ranges(sqref: &str) -> Vec<CFCellRange> {
    compute_parser::SqrefList::parse(sqref)
        .as_ref()
        .map(|list| list.0.iter().filter_map(range_ref_to_cf_range).collect())
        .unwrap_or_default()
}

/// Convert a single [`compute_parser::RangeRef`] into the positional
/// [`CFCellRange`] form. Returns `None` if either corner is already a
/// [`formula_types::CellRef::Resolved`] — that shape is impossible at
/// XLSX-import time but we skip rather than panic.
fn range_ref_to_cf_range(r: &compute_parser::RangeRef) -> Option<CFCellRange> {
    let (start_row, start_col) = match r.start {
        formula_types::CellRef::Positional { row, col, .. } => (row, col),
        formula_types::CellRef::Resolved(_) => return None,
    };
    let (end_row, end_col) = match r.end {
        formula_types::CellRef::Positional { row, col, .. } => (row, col),
        formula_types::CellRef::Resolved(_) => return None,
    };
    Some(CFCellRange::new(start_row, start_col, end_row, end_col))
}

/// Resolve a style `ColorDef` to a `#RRGGBB` hex string.
///
/// `theme_colors` is a 12-element palette of resolved hex strings
/// (dk1, lt1, dk2, lt2, accent1..6, hlink, fol_hlink) extracted from the theme.
fn resolve_color_def_to_hex(
    color: &crate::domain::styles::types::ColorDef,
    theme_colors: &[String],
) -> Option<String> {
    use crate::domain::styles::types::ColorDef;

    /// Parse an AARRGGBB or RRGGBB hex string to (r, g, b).
    fn parse_hex_rgb(s: &str) -> Option<(u8, u8, u8)> {
        let hex = s.strip_prefix('#').unwrap_or(s);
        let rgb_part = if hex.len() == 8 { &hex[2..] } else { hex };
        if rgb_part.len() != 6 {
            return None;
        }
        let r = u8::from_str_radix(&rgb_part[0..2], 16).ok()?;
        let g = u8::from_str_radix(&rgb_part[2..4], 16).ok()?;
        let b = u8::from_str_radix(&rgb_part[4..6], 16).ok()?;
        Some((r, g, b))
    }

    /// Apply ECMA-376 tint to an (r, g, b) tuple, returning the adjusted color.
    fn apply_tint(r: u8, g: u8, b: u8, tint: f64) -> (u8, u8, u8) {
        // Convert to HSL
        let rf = r as f64 / 255.0;
        let gf = g as f64 / 255.0;
        let bf = b as f64 / 255.0;
        let max = rf.max(gf).max(bf);
        let min = rf.min(gf).min(bf);
        let l = (max + min) / 2.0;
        let s = if (max - min).abs() < f64::EPSILON {
            0.0
        } else if l <= 0.5 {
            (max - min) / (max + min)
        } else {
            (max - min) / (2.0 - max - min)
        };
        let h = if (max - min).abs() < f64::EPSILON {
            0.0
        } else if (max - rf).abs() < f64::EPSILON {
            ((gf - bf) / (max - min)).rem_euclid(6.0) * 60.0
        } else if (max - gf).abs() < f64::EPSILON {
            ((bf - rf) / (max - min) + 2.0) * 60.0
        } else {
            ((rf - gf) / (max - min) + 4.0) * 60.0
        };

        // Apply tint per ECMA-376 spec
        let new_l = if tint < 0.0 {
            l * (1.0 + tint)
        } else {
            l * (1.0 - tint) + tint
        }
        .clamp(0.0, 1.0);

        // Convert back to RGB
        let c = (1.0 - (2.0 * new_l - 1.0).abs()) * s;
        let x = c * (1.0 - ((h / 60.0).rem_euclid(2.0) - 1.0).abs());
        let m = new_l - c / 2.0;
        let (r1, g1, b1) = match h as u32 {
            0..=59 => (c, x, 0.0),
            60..=119 => (x, c, 0.0),
            120..=179 => (0.0, c, x),
            180..=239 => (0.0, x, c),
            240..=299 => (x, 0.0, c),
            _ => (c, 0.0, x),
        };
        (
            ((r1 + m) * 255.0).round() as u8,
            ((g1 + m) * 255.0).round() as u8,
            ((b1 + m) * 255.0).round() as u8,
        )
    }

    /// Resolve and optionally tint a base hex color.
    fn resolve_with_tint(base_hex: &str, tint_str: &Option<String>) -> Option<String> {
        let (r, g, b) = parse_hex_rgb(base_hex)?;
        if let Some(t) = tint_str.as_deref().and_then(|s| s.parse::<f64>().ok()) {
            if t.abs() > f64::EPSILON {
                let (r2, g2, b2) = apply_tint(r, g, b, t);
                return Some(format!("#{:02x}{:02x}{:02x}", r2, g2, b2));
            }
        }
        Some(format!("#{:02x}{:02x}{:02x}", r, g, b))
    }

    match color {
        ColorDef::Rgb { val, tint } => resolve_with_tint(val, tint),
        ColorDef::Theme { id, tint } => {
            let base = theme_colors.get(*id as usize)?;
            resolve_with_tint(base, tint)
        }
        ColorDef::Indexed { id, tint } => {
            // Use the standard Excel indexed color palette
            let rgb = crate::domain::themes::types::Theme::indexed_color(*id as u8)?;
            let base = format!("#{:02x}{:02x}{:02x}", rgb.r, rgb.g, rgb.b);
            resolve_with_tint(&base, tint)
        }
        ColorDef::Auto { .. } => None, // Auto means inherit from context
    }
}

/// Resolve a `DxfDef` (differential formatting record) into a `CFStyle`.
///
/// Extracts font color, background color, bold, italic, strikethrough, underline,
/// and number format from the DXF, resolving theme/indexed colors to hex.
fn resolve_dxf_to_cf_style(
    dxf: &crate::domain::styles::types::DxfDef,
    theme_colors: &[String],
    dxf_id: Option<u32>,
) -> CFStyle {
    let font_color = dxf
        .font
        .as_ref()
        .and_then(|f| f.color.as_ref())
        .and_then(|c| resolve_color_def_to_hex(c, theme_colors));

    let background_color = dxf.fill.as_ref().and_then(|fill| {
        use crate::domain::styles::types::FillDef;
        match fill {
            FillDef::Solid { fg_color } => resolve_color_def_to_hex(fg_color, theme_colors),
            FillDef::Pattern {
                fg_color, bg_color, ..
            } => {
                // For CF, foreground color of a pattern fill is the cell background
                fg_color
                    .as_ref()
                    .and_then(|c| resolve_color_def_to_hex(c, theme_colors))
                    .or_else(|| {
                        bg_color
                            .as_ref()
                            .and_then(|c| resolve_color_def_to_hex(c, theme_colors))
                    })
            }
            _ => None,
        }
    });

    let bold = dxf.font.as_ref().and_then(|f| f.bold);
    let italic = dxf.font.as_ref().and_then(|f| f.italic);
    let strikethrough = dxf.font.as_ref().and_then(|f| f.strikethrough);
    // CFStyle.underline_type is now the typed ooxml UnderlineStyle; no
    // conversion needed.
    let underline_type = dxf.font.as_ref().and_then(|f| f.underline);
    let number_format = dxf.num_fmt.as_ref().map(|nf| nf.format_code.clone());

    // Resolve border colors from DXF
    let border_color = dxf
        .border
        .as_ref()
        .and_then(|b| {
            // Use the first non-None side color as unified border color
            b.left
                .as_ref()
                .and_then(|s| s.color.as_ref())
                .or_else(|| b.top.as_ref().and_then(|s| s.color.as_ref()))
                .or_else(|| b.right.as_ref().and_then(|s| s.color.as_ref()))
                .or_else(|| b.bottom.as_ref().and_then(|s| s.color.as_ref()))
        })
        .and_then(|c| resolve_color_def_to_hex(c, theme_colors));

    CFStyle {
        background_color,
        font_color,
        bold,
        italic,
        underline_type,
        underline_legacy: None,
        strikethrough,
        number_format,
        border_color,
        border_style: None,
        border_top_color: None,
        border_top_style: None,
        border_bottom_color: None,
        border_bottom_style: None,
        border_left_color: None,
        border_left_style: None,
        border_right_color: None,
        border_right_style: None,
        dxf_id,
    }
}

/// Convert a single `ooxml_types::CfRule` to a `domain_types::CFRule`.
///
/// Resolves the DXF style from the dxf table into inline CFStyle properties
/// (font_color, background_color, bold, etc.) while preserving the dxf_id
/// for round-trip fidelity.
pub(crate) fn convert_cf_rule(
    rule: &ooxml_types::cond_format::CfRule,
    dxfs: &[crate::domain::styles::types::DxfDef],
    theme_colors: &[String],
) -> CFRule {
    use ooxml_types::cond_format::CfRuleType;

    let id = make_cf_id();
    let priority = rule.priority;
    let stop_if_true = if rule.stop_if_true { Some(true) } else { None };
    // Resolve DXF to inline style properties, preserving dxf_id for round-trip
    let style = match rule.dxf_id {
        Some(idx) => {
            if let Some(dxf) = dxfs.get(idx as usize) {
                resolve_dxf_to_cf_style(dxf, theme_colors, Some(idx))
            } else {
                CFStyle {
                    dxf_id: Some(idx),
                    ..CFStyle::default()
                }
            }
        }
        None => CFStyle::default(),
    };

    match rule.rule_type {
        CfRuleType::CellIs => CFRule::CellValue {
            id,
            operator: rule.operator.unwrap_or_default(),
            value1: rule
                .formulas
                .first()
                .map(|v| serde_json::Value::String(v.clone()))
                .unwrap_or(serde_json::Value::Null),
            value2: rule
                .formulas
                .get(1)
                .map(|v| serde_json::Value::String(v.clone())),
            style,
            priority,
            stop_if_true,
            text: rule.text.clone(),
        },
        CfRuleType::Expression => CFRule::Formula {
            id,
            formula: rule.formulas.first().cloned().unwrap_or_default(),
            style,
            priority,
            stop_if_true,
            text: rule.text.clone(),
        },
        CfRuleType::ColorScale => {
            let color_scale = if let Some(ref cs) = rule.color_scale {
                let points: Vec<CFColorPoint> = cs
                    .cfvo
                    .iter()
                    .zip(cs.colors.iter())
                    .map(|(cfvo, color)| cf_color_point(cfvo, color))
                    .collect();
                let min_point = points.first().cloned().unwrap_or_else(|| CFColorPoint {
                    value: domain_types::CFValueRef::Min,
                    ooxml_value: None,
                    color: String::new(),
                    color_theme: None,
                    color_tint: None,
                    color_indexed: None,
                    color_auto: None,
                    ext_lst_xml: None,
                });
                let max_point = points.last().cloned().unwrap_or_else(|| CFColorPoint {
                    value: domain_types::CFValueRef::Max,
                    ooxml_value: None,
                    color: String::new(),
                    color_theme: None,
                    color_tint: None,
                    color_indexed: None,
                    color_auto: None,
                    ext_lst_xml: None,
                });
                let mid_point = if points.len() == 3 {
                    Some(points[1].clone())
                } else {
                    None
                };
                CFColorScale {
                    points,
                    min_point,
                    mid_point,
                    max_point,
                }
            } else {
                CFColorScale {
                    points: Vec::new(),
                    min_point: CFColorPoint {
                        value: domain_types::CFValueRef::Min,
                        ooxml_value: None,
                        color: String::new(),
                        color_theme: None,
                        color_tint: None,
                        color_indexed: None,
                        color_auto: None,
                        ext_lst_xml: None,
                    },
                    mid_point: None,
                    max_point: CFColorPoint {
                        value: domain_types::CFValueRef::Max,
                        ooxml_value: None,
                        color: String::new(),
                        color_theme: None,
                        color_tint: None,
                        color_indexed: None,
                        color_auto: None,
                        ext_lst_xml: None,
                    },
                }
            };
            CFRule::ColorScale {
                id,
                priority,
                stop_if_true,
                color_scale,
            }
        }
        CfRuleType::DataBar => {
            let data_bar = if let Some(ref db) = rule.data_bar {
                let min_cfvo = db.cfvo.first();
                let max_cfvo = db.cfvo.get(1);
                CFDataBar {
                    min_point: CFColorPoint {
                        value: domain_types::CFValueRef::from_ooxml(
                            min_cfvo.map(|c| c.cfvo_type).unwrap_or_default(),
                            min_cfvo.and_then(|c| c.val.as_deref()),
                        ),
                        ooxml_value: min_cfvo.and_then(|c| c.val.clone()),
                        color: String::new(), // data bar min/max color points don't carry color; positive_color does
                        color_theme: None,
                        color_tint: None,
                        color_indexed: None,
                        color_auto: None,
                        ext_lst_xml: min_cfvo.and_then(|c| c.ext_lst_xml.clone()),
                    },
                    max_point: CFColorPoint {
                        value: domain_types::CFValueRef::from_ooxml(
                            max_cfvo.map(|c| c.cfvo_type).unwrap_or_default(),
                            max_cfvo.and_then(|c| c.val.as_deref()),
                        ),
                        ooxml_value: max_cfvo.and_then(|c| c.val.clone()),
                        color: String::new(),
                        color_theme: None,
                        color_tint: None,
                        color_indexed: None,
                        color_auto: None,
                        ext_lst_xml: max_cfvo.and_then(|c| c.ext_lst_xml.clone()),
                    },
                    min_length: db.min_length_attr_present.then_some(db.min_length),
                    max_length: db.max_length_attr_present.then_some(db.max_length),
                    positive_color: cf_color_to_rgb(&db.color),
                    show_value: db.show_value_attr_present.then_some(db.show_value),
                    border_color: db.border_color.as_ref().map(cf_color_to_rgb),
                    negative_border_color: db.negative_border_color.as_ref().map(cf_color_to_rgb),
                    negative_color: db.negative_fill_color.as_ref().map(cf_color_to_rgb),
                    axis_color: db.axis_color.as_ref().map(cf_color_to_rgb),
                    direction: db.direction_attr_present.then_some(db.direction),
                    gradient: db.gradient_attr_present.then_some(db.gradient),
                    ext_id: rule.ext_id.clone(),
                    show_border: db.border_attr_present.then_some(db.border),
                    axis_position: db.axis_position_attr_present.then_some(db.axis_position),
                    match_positive_fill_color: db
                        .negative_bar_color_same_as_positive_attr_present
                        .then_some(db.negative_bar_color_same_as_positive),
                    match_positive_border_color: db
                        .negative_bar_border_color_same_as_positive_attr_present
                        .then_some(db.negative_bar_border_color_same_as_positive),
                }
            } else {
                CFDataBar {
                    min_point: CFColorPoint {
                        value: domain_types::CFValueRef::Min,
                        ooxml_value: None,
                        color: String::new(),
                        color_theme: None,
                        color_tint: None,
                        color_indexed: None,
                        color_auto: None,
                        ext_lst_xml: None,
                    },
                    max_point: CFColorPoint {
                        value: domain_types::CFValueRef::Max,
                        ooxml_value: None,
                        color: String::new(),
                        color_theme: None,
                        color_tint: None,
                        color_indexed: None,
                        color_auto: None,
                        ext_lst_xml: None,
                    },
                    min_length: None,
                    max_length: None,
                    positive_color: String::new(),
                    negative_color: None,
                    border_color: None,
                    negative_border_color: None,
                    show_border: None,
                    gradient: None,
                    direction: None,
                    axis_position: None,
                    axis_color: None,
                    show_value: None,
                    match_positive_fill_color: None,
                    match_positive_border_color: None,
                    ext_id: None,
                }
            };
            CFRule::DataBar {
                id,
                priority,
                stop_if_true,
                data_bar,
            }
        }
        CfRuleType::IconSet => {
            let icon_set = if let Some(ref is) = rule.icon_set {
                CFIconSet {
                    icon_set_name: is.icon_set,
                    reverse_order: if is.reverse { Some(true) } else { None },
                    show_icon_only: if !is.show_value { Some(true) } else { None },
                    percent: is.percent_attr_present.then_some(is.percent),
                    thresholds: is
                        .cfvo
                        .iter()
                        .map(|cfvo| CFIconThreshold {
                            value_type: cfvo.cfvo_type,
                            value: cfvo.val.clone(),
                            gte: cfvo.gte,
                            ext_lst_xml: cfvo.ext_lst_xml.clone(),
                        })
                        .collect(),
                    custom_icons: is
                        .cf_icon
                        .iter()
                        .map(|icon| {
                            Some(CFCustomIcon {
                                icon_set: icon.icon_set.to_ooxml().to_string(),
                                icon_id: icon.icon_id,
                            })
                        })
                        .collect(),
                }
            } else {
                CFIconSet {
                    icon_set_name: ooxml_types::cond_format::IconSetType::ThreeTrafficLights1,
                    reverse_order: None,
                    show_icon_only: None,
                    percent: None,
                    thresholds: Vec::new(),
                    custom_icons: Vec::new(),
                }
            };
            CFRule::IconSet {
                id,
                priority,
                stop_if_true,
                icon_set,
            }
        }
        CfRuleType::Top10 => CFRule::Top10 {
            id,
            rank: rule.rank.unwrap_or(10),
            percent: if rule.percent { Some(true) } else { None },
            bottom: if rule.bottom { Some(true) } else { None },
            style,
            priority,
            stop_if_true,
        },
        CfRuleType::DuplicateValues => CFRule::DuplicateValues {
            id,
            unique: None,
            style,
            priority,
            stop_if_true,
        },
        CfRuleType::UniqueValues => CFRule::DuplicateValues {
            id,
            unique: Some(true),
            style,
            priority,
            stop_if_true,
        },
        CfRuleType::ContainsText
        | CfRuleType::NotContainsText
        | CfRuleType::BeginsWith
        | CfRuleType::EndsWith => {
            use ooxml_types::cond_format::CfOperator;
            // If the XLSX didn't carry an explicit `operator`, derive it from the
            // rule_type (Excel sometimes omits operator on NotContainsText /
            // BeginsWith / EndsWith because the rule_type alone is sufficient).
            let operator = rule.operator.unwrap_or(match rule.rule_type {
                CfRuleType::NotContainsText => CfOperator::NotContains,
                CfRuleType::BeginsWith => CfOperator::BeginsWith,
                CfRuleType::EndsWith => CfOperator::EndsWith,
                _ => CfOperator::ContainsText,
            });
            CFRule::ContainsText {
                id,
                operator,
                text: rule.text.clone().unwrap_or_default(),
                style,
                priority,
                stop_if_true,
                formula: rule.formulas.first().cloned(),
            }
        }
        CfRuleType::ContainsBlanks => CFRule::ContainsBlanks {
            id,
            blanks: true,
            style,
            priority,
            stop_if_true,
            formula: rule.formulas.first().cloned(),
        },
        CfRuleType::NotContainsBlanks => CFRule::ContainsBlanks {
            id,
            blanks: false,
            style,
            priority,
            stop_if_true,
            formula: rule.formulas.first().cloned(),
        },
        CfRuleType::ContainsErrors => CFRule::ContainsErrors {
            id,
            errors: true,
            style,
            priority,
            stop_if_true,
            formula: rule.formulas.first().cloned(),
        },
        CfRuleType::NotContainsErrors => CFRule::ContainsErrors {
            id,
            errors: false,
            style,
            priority,
            stop_if_true,
            formula: rule.formulas.first().cloned(),
        },
        CfRuleType::TimePeriod => CFRule::TimePeriod {
            id,
            time_period: rule.time_period.unwrap_or_default(),
            style,
            priority,
            stop_if_true,
            formula: rule.formulas.first().cloned(),
        },
        CfRuleType::AboveAverage => CFRule::AboveAverage {
            id,
            above_average: rule.above_average,
            equal_average: if rule.equal_average { Some(true) } else { None },
            std_dev: rule.std_dev,
            style,
            priority,
            stop_if_true,
            formula: rule.formulas.first().cloned(),
        },
    }
}

/// Extract an RGB hex string from a `CfColor`, falling back to an empty string.
pub(crate) fn cf_color_to_rgb(color: &ooxml_types::cond_format::CfColor) -> String {
    color.rgb.clone().unwrap_or_default()
}

/// Build a `CFColorPoint` from a `Cfvo` and `CfColor`, preserving theme/indexed/tint/auto.
fn cf_color_point(
    cfvo: &ooxml_types::cond_format::Cfvo,
    color: &ooxml_types::cond_format::CfColor,
) -> CFColorPoint {
    CFColorPoint {
        value: domain_types::CFValueRef::from_ooxml(cfvo.cfvo_type, cfvo.val.as_deref()),
        ooxml_value: cfvo.val.clone(),
        color: color.rgb.clone().unwrap_or_default(),
        color_theme: color.theme,
        color_tint: color.tint,
        color_indexed: color.indexed,
        color_auto: if color.auto { Some(true) } else { None },
        ext_lst_xml: cfvo.ext_lst_xml.clone(),
    }
}
