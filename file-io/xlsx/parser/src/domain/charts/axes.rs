//! Chart axis parsing for XLSX charts
//!
//! This module parses chart axis definitions from OOXML chart XML.
//! Axes define the scaling, labels, and gridlines for charts.
//!
//! # OOXML Axis Types
//!
//! - CategoryAxis (c:catAx) - X-axis for category-based charts
//! - ValueAxis (c:valAx) - Y-axis for numeric values
//! - DateAxis (c:dateAx) - X-axis for date-based data
//! - SeriesAxis (c:serAx) - Z-axis for 3D charts

use crate::infra::scanner::{
    extract_quoted_value, find_attr_simd, find_closing_tag, find_element_end, find_gt_simd,
    find_lt_simd, find_tag_simd,
};

use super::{parse_shape_properties, parse_text_body};

// =============================================================================
// Re-exports from ooxml-types
// =============================================================================

pub use ooxml_types::charts::{
    AxisCrosses, AxisType, ChartAxis, ChartAxisPosition, ChartLines, CrossBetween, DisplayUnitKind,
    DisplayUnits, DisplayUnitsLabel, LabelAlignment, NumFmt, Orientation, Scaling,
    TickLabelPosition, TickMark, TimeUnit,
};
// These types are pub-use'd by the parent mod.rs; import privately for local use.
use ooxml_types::charts::{BuiltInUnit, ShapeProperties, Title, TitleText};
use ooxml_types::drawings::TextRunContent;

// =============================================================================
// Axis Parsing
// =============================================================================

/// Parse an axis element from OOXML XML bytes into a canonical `ChartAxis`.
pub fn parse_axis(xml: &[u8]) -> ChartAxis {
    let mut axis = ChartAxis::default();

    // Detect axis type from the XML element
    axis.axis_type = detect_axis_type(xml);

    // Capture non-standard axisType attribute (Google Sheets) for round-trip fidelity
    if let Some(attr_pos) = find_attr_simd(xml, b"axisType=\"", 0) {
        let value_start = attr_pos + b"axisType=\"".len();
        if let Some((start, end)) = extract_quoted_value(xml, value_start) {
            axis.raw_axis_type_attr = Some(String::from_utf8_lossy(&xml[start..end]).to_string());
        }
    }

    // Parse axId
    if let Some(axid_start) = find_tag_simd(xml, b"axId", 0) {
        axis.ax_id = parse_val_attr(&xml[axid_start..]);
    }

    // Parse crossAx
    if let Some(crossax_start) = find_tag_simd(xml, b"crossAx", 0) {
        axis.cross_ax = parse_val_attr(&xml[crossax_start..]);
    }

    // Parse delete
    if let Some(delete_start) = find_tag_simd(xml, b"delete", 0) {
        axis.delete_explicit = true;
        axis.delete = parse_bool_val(&xml[delete_start..]);
    }

    // Parse axPos (position)
    if let Some(pos_start) = find_tag_simd(xml, b"axPos", 0) {
        if let Some(attr_pos) = find_attr_simd(&xml[pos_start..], b"val=\"", 0) {
            let value_start = pos_start + attr_pos + 5;
            if let Some((start, end)) = extract_quoted_value(xml, value_start) {
                let val = String::from_utf8_lossy(&xml[start..end]);
                axis.ax_pos = ChartAxisPosition::from_ooxml(&val);
            }
        }
    }

    // Parse scaling
    if let Some(scaling_start) = find_tag_simd(xml, b"scaling", 0) {
        let scaling_end = find_closing_tag(xml, b"scaling", scaling_start).unwrap_or(xml.len());
        axis.scaling = parse_scaling(&xml[scaling_start..scaling_end]);
    }

    // Parse title
    if let Some(title_start) = find_tag_simd(xml, b"title", 0) {
        let title_end = find_closing_tag(xml, b"title", title_start).unwrap_or(xml.len());
        axis.title = Some(parse_axis_title(&xml[title_start..title_end]));
    }

    // Parse numFmt
    if let Some(numfmt_start) = find_tag_simd(xml, b"numFmt", 0) {
        axis.num_fmt = Some(parse_num_fmt(&xml[numfmt_start..]));
    }

    // Parse majorTickMark
    if let Some(major_start) = find_tag_simd(xml, b"majorTickMark", 0) {
        axis.major_tick_mark_explicit = true;
        if let Some(attr_pos) = find_attr_simd(&xml[major_start..], b"val=\"", 0) {
            let value_start = major_start + attr_pos + 5;
            if let Some((start, end)) = extract_quoted_value(xml, value_start) {
                let val = String::from_utf8_lossy(&xml[start..end]);
                axis.major_tick_mark = TickMark::from_ooxml(&val);
            }
        }
    }

    // Parse minorTickMark
    if let Some(minor_start) = find_tag_simd(xml, b"minorTickMark", 0) {
        axis.minor_tick_mark_explicit = true;
        if let Some(attr_pos) = find_attr_simd(&xml[minor_start..], b"val=\"", 0) {
            let value_start = minor_start + attr_pos + 5;
            if let Some((start, end)) = extract_quoted_value(xml, value_start) {
                let val = String::from_utf8_lossy(&xml[start..end]);
                axis.minor_tick_mark = TickMark::from_ooxml(&val);
            }
        }
    }

    // Parse tickLblPos
    if let Some(lblpos_start) = find_tag_simd(xml, b"tickLblPos", 0) {
        axis.tick_lbl_pos_explicit = true;
        if let Some(attr_pos) = find_attr_simd(&xml[lblpos_start..], b"val=\"", 0) {
            let value_start = lblpos_start + attr_pos + 5;
            if let Some((start, end)) = extract_quoted_value(xml, value_start) {
                let val = String::from_utf8_lossy(&xml[start..end]);
                axis.tick_lbl_pos = TickLabelPosition::from_ooxml(&val);
            }
        }
    }

    // Parse majorGridlines
    if let Some(mg_start) = find_tag_simd(xml, b"majorGridlines", 0) {
        let mg_end = element_span_from_start(xml, mg_start, b"majorGridlines")
            .map(|(_, end)| end)
            .unwrap_or(xml.len());
        let mg_bytes = &xml[mg_start..mg_end];
        let sp_pr = if let Some(sp_start) = find_tag_simd(mg_bytes, b"spPr", 0) {
            let sp_end = find_closing_tag(mg_bytes, b"spPr", sp_start).unwrap_or(mg_bytes.len());
            Some(parse_shape_properties(&mg_bytes[sp_start..sp_end]))
        } else {
            None
        };
        axis.major_gridlines = Some(ChartLines { sp_pr });
    }

    // Parse minorGridlines
    if let Some(mg_start) = find_tag_simd(xml, b"minorGridlines", 0) {
        let mg_end = element_span_from_start(xml, mg_start, b"minorGridlines")
            .map(|(_, end)| end)
            .unwrap_or(xml.len());
        let mg_bytes = &xml[mg_start..mg_end];
        let sp_pr = if let Some(sp_start) = find_tag_simd(mg_bytes, b"spPr", 0) {
            let sp_end = find_closing_tag(mg_bytes, b"spPr", sp_start).unwrap_or(mg_bytes.len());
            Some(parse_shape_properties(&mg_bytes[sp_start..sp_end]))
        } else {
            None
        };
        axis.minor_gridlines = Some(ChartLines { sp_pr });
    }

    // Parse crosses
    if let Some(crosses_start) = find_tag_simd(xml, b"crosses", 0) {
        axis.crosses_explicit = true;
        if let Some(attr_pos) = find_attr_simd(&xml[crosses_start..], b"val=\"", 0) {
            let value_start = crosses_start + attr_pos + 5;
            if let Some((start, end)) = extract_quoted_value(xml, value_start) {
                let val = String::from_utf8_lossy(&xml[start..end]);
                axis.crosses = AxisCrosses::from_ooxml(&val);
            }
        }
    }

    // Parse crossesAt
    if let Some(crossesat_start) = find_tag_simd(xml, b"crossesAt", 0) {
        axis.crosses_at = Some(parse_val_f64(&xml[crossesat_start..]));
    }

    // Parse lblAlgn
    if let Some(algn_start) = find_tag_simd(xml, b"lblAlgn", 0) {
        if let Some(attr_pos) = find_attr_simd(&xml[algn_start..], b"val=\"", 0) {
            let value_start = algn_start + attr_pos + 5;
            if let Some((start, end)) = extract_quoted_value(xml, value_start) {
                let val = String::from_utf8_lossy(&xml[start..end]);
                axis.lbl_algn = Some(LabelAlignment::from_ooxml(&val));
            }
        }
    }

    // Parse lblOffset — preserve val=0 explicitly (it's different from absent).
    if let Some(offset_start) = find_tag_simd(xml, b"lblOffset", 0) {
        let val = parse_val_attr(&xml[offset_start..]);
        {
            axis.lbl_offset = Some(val);
        }
    }

    // Parse majorUnit
    if let Some(major_start) = find_tag_simd(xml, b"majorUnit", 0) {
        axis.major_unit = Some(parse_val_f64(&xml[major_start..]));
    }

    // Parse minorUnit
    if let Some(minor_start) = find_tag_simd(xml, b"minorUnit", 0) {
        axis.minor_unit = Some(parse_val_f64(&xml[minor_start..]));
    }

    // Parse baseTimeUnit (for date axes)
    if let Some(base_start) = find_tag_simd(xml, b"baseTimeUnit", 0) {
        if let Some(attr_pos) = find_attr_simd(&xml[base_start..], b"val=\"", 0) {
            let value_start = base_start + attr_pos + 5;
            if let Some((start, end)) = extract_quoted_value(xml, value_start) {
                let val = String::from_utf8_lossy(&xml[start..end]);
                axis.base_time_unit = Some(TimeUnit::from_ooxml(&val));
            }
        }
    }

    // Parse majorTimeUnit (for date axes)
    if let Some(major_start) = find_tag_simd(xml, b"majorTimeUnit", 0) {
        if let Some(attr_pos) = find_attr_simd(&xml[major_start..], b"val=\"", 0) {
            let value_start = major_start + attr_pos + 5;
            if let Some((start, end)) = extract_quoted_value(xml, value_start) {
                let val = String::from_utf8_lossy(&xml[start..end]);
                axis.major_time_unit = Some(TimeUnit::from_ooxml(&val));
            }
        }
    }

    // Parse minorTimeUnit (for date axes)
    if let Some(minor_start) = find_tag_simd(xml, b"minorTimeUnit", 0) {
        if let Some(attr_pos) = find_attr_simd(&xml[minor_start..], b"val=\"", 0) {
            let value_start = minor_start + attr_pos + 5;
            if let Some((start, end)) = extract_quoted_value(xml, value_start) {
                let val = String::from_utf8_lossy(&xml[start..end]);
                axis.minor_time_unit = Some(TimeUnit::from_ooxml(&val));
            }
        }
    }

    // Parse tickLblSkip (for category axes)
    if let Some(skip_start) = find_tag_simd(xml, b"tickLblSkip", 0) {
        let val = parse_val_attr(&xml[skip_start..]);
        if val > 0 {
            axis.tick_lbl_skip = Some(val);
        }
    }

    // Parse tickMarkSkip (for category axes)
    if let Some(skip_start) = find_tag_simd(xml, b"tickMarkSkip", 0) {
        let val = parse_val_attr(&xml[skip_start..]);
        if val > 0 {
            axis.tick_mark_skip = Some(val);
        }
    }

    // Parse auto
    if let Some(auto_start) = find_tag_simd(xml, b"auto", 0) {
        axis.auto = Some(parse_bool_val(&xml[auto_start..]));
    }

    // Parse axis-level spPr (NOT nested child spPr).
    // Google Sheets can place spPr BEFORE majorGridlines (non-standard ordering),
    // so we can't assume it comes after.  Instead, iterate all spPr occurrences
    // and pick the first one that's NOT inside a nested child container.
    {
        // Build a list of byte ranges that belong to nested containers
        // whose spPr we must skip.
        let mut nested_ranges: Vec<(usize, usize)> = Vec::new();
        for tag in &[
            b"majorGridlines" as &[u8],
            b"minorGridlines",
            b"title",
            b"dispUnits",
        ] {
            if let Some((start, end)) = find_tag_simd(xml, tag, 0)
                .and_then(|start| element_span_from_start(xml, start, tag))
            {
                nested_ranges.push((start, end));
            }
        }

        let mut pos = 0;
        while let Some(sp_start) = find_tag_simd(xml, b"spPr", pos) {
            // Check if this spPr is inside any nested container
            let inside_nested = nested_ranges
                .iter()
                .any(|&(ns, ne)| sp_start >= ns && sp_start < ne);
            if !inside_nested {
                // Handle self-closing <c:spPr/> — preserve as empty ShapeProperties
                if is_self_closing_sp_pr(xml, sp_start) {
                    axis.sp_pr = Some(ShapeProperties::default());
                } else {
                    let sp_end = find_closing_tag(xml, b"spPr", sp_start).unwrap_or(xml.len());
                    axis.sp_pr = Some(parse_shape_properties(&xml[sp_start..sp_end]));
                }
                break;
            }
            pos = sp_start + 1;
        }
    }

    // Parse only direct-child txPr. Nested title or display-unit-label txPr belongs
    // to that child element, not to axis tick labels.
    if let Some(txpr_bytes) = direct_child_slice(xml, b"txPr") {
        axis.tx_pr = Some(parse_text_body(txpr_bytes));
    }

    // Parse crossBetween (valAx only)
    if let Some(cb_start) = find_tag_simd(xml, b"crossBetween", 0) {
        if let Some(attr_pos) = find_attr_simd(&xml[cb_start..], b"val=\"", 0) {
            let value_start = cb_start + attr_pos + 5;
            if let Some((start, end)) = extract_quoted_value(xml, value_start) {
                let val = String::from_utf8_lossy(&xml[start..end]);
                axis.cross_between = Some(CrossBetween::from_ooxml(&val));
            }
        }
    }

    // Parse noMultiLvlLbl (catAx only)
    if let Some(nm_start) = find_tag_simd(xml, b"noMultiLvlLbl", 0) {
        axis.no_multi_lvl_lbl = Some(parse_bool_val(&xml[nm_start..]));
    }

    // Parse dispUnits (valAx only)
    if let Some(du_start) = find_tag_simd(xml, b"dispUnits", 0) {
        let du_end = find_closing_tag(xml, b"dispUnits", du_start).unwrap_or(xml.len());
        axis.disp_units = Some(parse_display_units(&xml[du_start..du_end]));
    }

    axis
}

fn parse_display_units(xml: &[u8]) -> DisplayUnits {
    let mut disp_units = DisplayUnits::default();

    if let Some(bu_start) = find_tag_simd(xml, b"builtInUnit", 0) {
        if let Some(attr_pos) = find_attr_simd(&xml[bu_start..], b"val=\"", 0) {
            let value_start = bu_start + attr_pos + 5;
            if let Some((start, end)) = extract_quoted_value(xml, value_start) {
                let val = String::from_utf8_lossy(&xml[start..end]);
                disp_units.kind = Some(DisplayUnitKind::BuiltIn(BuiltInUnit::from_ooxml(&val)));
            }
        }
    } else if let Some(cu_start) = find_tag_simd(xml, b"custUnit", 0) {
        if let Some(value) = parse_optional_val_f64(&xml[cu_start..]) {
            disp_units.kind = Some(DisplayUnitKind::Custom(value));
        }
    }

    if let Some(lbl_start) = find_tag_simd(xml, b"dispUnitsLbl", 0) {
        let lbl_end = find_closing_tag(xml, b"dispUnitsLbl", lbl_start).unwrap_or(xml.len());
        disp_units.disp_units_lbl = Some(parse_display_units_label(&xml[lbl_start..lbl_end]));
    }

    disp_units
}

fn parse_display_units_label(xml: &[u8]) -> DisplayUnitsLabel {
    let title_like = crate::domain::charts::Chart::parse_title_from_xml(xml);
    DisplayUnitsLabel {
        layout: title_like.layout,
        tx: title_like.tx,
        sp_pr: title_like.sp_pr,
        tx_pr: title_like.tx_pr,
    }
}

// =============================================================================
// Helper: Detect axis type
// =============================================================================

/// Detect axis type from XML element.
fn detect_axis_type(xml: &[u8]) -> AxisType {
    if find_tag_simd(xml, b"catAx", 0).is_some() {
        AxisType::Category
    } else if find_tag_simd(xml, b"valAx", 0).is_some() {
        AxisType::Value
    } else if find_tag_simd(xml, b"dateAx", 0).is_some() {
        AxisType::Date
    } else if find_tag_simd(xml, b"serAx", 0).is_some() {
        AxisType::Series
    } else {
        // Default based on common elements
        AxisType::Category
    }
}

// =============================================================================
// Helper: Parse scaling
// =============================================================================

/// Parse scaling element into the canonical `Scaling` type.
pub fn parse_scaling(xml: &[u8]) -> Scaling {
    let mut scaling = Scaling::default();

    // Parse orientation
    if let Some(orient_start) = find_tag_simd(xml, b"orientation", 0) {
        if let Some(attr_pos) = find_attr_simd(&xml[orient_start..], b"val=\"", 0) {
            let value_start = orient_start + attr_pos + 5;
            if let Some((start, end)) = extract_quoted_value(xml, value_start) {
                let val = String::from_utf8_lossy(&xml[start..end]);
                scaling.orientation = Orientation::from_ooxml(&val);
            }
        }
    }

    // Parse min
    if let Some(min_start) = find_tag_simd(xml, b"min", 0) {
        scaling.min = Some(parse_val_f64(&xml[min_start..]));
    }

    // Parse max
    if let Some(max_start) = find_tag_simd(xml, b"max", 0) {
        scaling.max = Some(parse_val_f64(&xml[max_start..]));
    }

    // Parse logBase
    if let Some(log_start) = find_tag_simd(xml, b"logBase", 0) {
        scaling.log_base = Some(parse_val_f64(&xml[log_start..]));
    }

    scaling
}

// =============================================================================
// Helper: Parse axis title → Title (ooxml_types)
// =============================================================================

/// Parse axis title element into the canonical `Title` type.
///
/// The OOXML axis title is simplified: we extract rich text into a `TextBody`
/// and store it as `TitleText::Rich`, preserving the overlay flag.
fn parse_axis_title(xml: &[u8]) -> Title {
    // Reuse the full chart title parser which handles rich text, strRef,
    // overlay, layout, spPr, and txPr with full fidelity.
    crate::domain::charts::Chart::parse_title_from_xml(xml)
}

// =============================================================================
// Helper: Parse number format → NumFmt (ooxml_types)
// =============================================================================

/// Parse number format element into the canonical `NumFmt` type.
fn parse_num_fmt(xml: &[u8]) -> NumFmt {
    let mut num_fmt = NumFmt::default();

    // Parse formatCode
    if let Some(attr_pos) = find_attr_simd(xml, b"formatCode=\"", 0) {
        let value_start = attr_pos + 12;
        if let Some((start, end)) = extract_quoted_value(xml, value_start) {
            num_fmt.format_code = crate::infra::xml::decode_xml_entities(&xml[start..end]);
        }
    }

    // Parse sourceLinked
    if let Some(attr_pos) = find_attr_simd(xml, b"sourceLinked=\"", 0) {
        let value_start = attr_pos + 14;
        if let Some((start, end)) = extract_quoted_value(xml, value_start) {
            let val = &xml[start..end];
            num_fmt.source_linked = Some(val == b"1" || val == b"true");
        }
    }

    num_fmt
}

// =============================================================================
// Shared parse helpers
// =============================================================================

/// Parse a val="N" attribute as u32.
fn parse_val_attr(xml: &[u8]) -> u32 {
    if let Some(attr_pos) = find_attr_simd(xml, b"val=\"", 0) {
        let value_start = attr_pos + 5;
        if let Some((start, end)) = extract_quoted_value(xml, value_start) {
            return parse_u32(&xml[start..end]);
        }
    }
    0
}

/// Parse a val="N.N" attribute as f64.
fn parse_val_f64(xml: &[u8]) -> f64 {
    parse_optional_val_f64(xml).unwrap_or(0.0)
}

fn parse_optional_val_f64(xml: &[u8]) -> Option<f64> {
    if let Some(attr_pos) = find_attr_simd(xml, b"val=\"", 0) {
        let value_start = attr_pos + 5;
        if let Some((start, end)) = extract_quoted_value(xml, value_start) {
            let s = std::str::from_utf8(&xml[start..end]).unwrap_or("0");
            return s.parse().ok();
        }
    }
    None
}

/// Parse a val="0/1" attribute as bool.
fn parse_bool_val(xml: &[u8]) -> bool {
    if let Some(attr_pos) = find_attr_simd(xml, b"val=\"", 0) {
        let value_start = attr_pos + 5;
        if let Some((start, end)) = extract_quoted_value(xml, value_start) {
            let val = &xml[start..end];
            return val == b"1" || val == b"true" || val == b"True";
        }
    }
    false
}

/// Parse bytes to u32.
fn parse_u32(bytes: &[u8]) -> u32 {
    let mut result: u32 = 0;
    for &b in bytes {
        if b.is_ascii_digit() {
            result = result.saturating_mul(10).saturating_add((b - b'0') as u32);
        } else {
            break;
        }
    }
    result
}

// =============================================================================
// Helpers to extract text from Title (used by convert.rs)
// =============================================================================

/// Extract plain text from a `Title`, if it contains rich text.
pub fn extract_title_text(title: &Title) -> Option<String> {
    match &title.tx {
        Some(TitleText::Rich(body)) => {
            let mut parts = Vec::new();
            for para in &body.paragraphs {
                for run_content in &para.runs {
                    if let TextRunContent::Run(run) = run_content {
                        if !run.text.is_empty() {
                            parts.push(run.text.clone());
                        }
                    }
                }
            }
            if parts.is_empty() {
                None
            } else {
                Some(parts.join(""))
            }
        }
        Some(TitleText::StrRef(str_ref)) => str_ref
            .str_cache
            .as_ref()
            .and_then(|c| c.pts.first().map(|pt| pt.v.clone())),
        None => None,
    }
}

/// Extract the overlay flag from a `Title`.
pub fn extract_title_overlay(title: &Title) -> bool {
    title.overlay.unwrap_or(false)
}

/// Check if an `<…spPr…/>` tag at `pos` is self-closing.
/// Returns true when the `>` that closes the opening tag is preceded by `/`.
fn is_self_closing_sp_pr(xml: &[u8], pos: usize) -> bool {
    if let Some(gt) = find_gt_simd(xml, pos) {
        gt > 0 && xml[gt - 1] == b'/'
    } else {
        false
    }
}

fn direct_child_slice<'a>(xml: &'a [u8], local_name: &[u8]) -> Option<&'a [u8]> {
    let mut pos = find_element_end(xml, 0).map_or(0, |gt| gt + 1);
    while let Some(start) = find_lt_simd(xml, pos) {
        match xml.get(start + 1) {
            Some(b'/') => return None,
            Some(b'!') | Some(b'?') => {
                pos = find_element_end(xml, start).map_or(start + 1, |gt| gt + 1);
                continue;
            }
            None => return None,
            _ => {}
        }

        let Some(child_name) = start_tag_local_name(xml, start) else {
            pos = start + 1;
            continue;
        };
        let open_end = find_element_end(xml, start)?;
        let end = if is_self_closing_open_tag(xml, open_end) {
            open_end + 1
        } else {
            find_closing_tag(xml, child_name, start)
                .and_then(|close| find_gt_simd(xml, close).map(|gt| gt + 1))
                .unwrap_or(xml.len())
        };

        if child_name == local_name {
            return Some(&xml[start..end]);
        }
        pos = end;
    }
    None
}

fn element_span_from_start(xml: &[u8], start: usize, local_name: &[u8]) -> Option<(usize, usize)> {
    let open_end = find_element_end(xml, start)?;
    let end = if is_self_closing_open_tag(xml, open_end) {
        open_end + 1
    } else {
        find_closing_tag(xml, local_name, start)
            .and_then(|close| find_gt_simd(xml, close).map(|gt| gt + 1))
            .unwrap_or(xml.len())
    };
    Some((start, end))
}

fn start_tag_local_name(xml: &[u8], start: usize) -> Option<&[u8]> {
    if xml.get(start) != Some(&b'<') {
        return None;
    }
    let name_start = start + 1;
    if matches!(xml.get(name_start), Some(b'/') | Some(b'!') | Some(b'?')) {
        return None;
    }
    let mut name_end = name_start;
    while name_end < xml.len() {
        if matches!(xml[name_end], b' ' | b'\t' | b'\n' | b'\r' | b'>' | b'/') {
            break;
        }
        name_end += 1;
    }
    if name_end == name_start {
        return None;
    }
    let local_start = xml[name_start..name_end]
        .iter()
        .rposition(|b| *b == b':')
        .map_or(name_start, |offset| name_start + offset + 1);
    Some(&xml[local_start..name_end])
}

fn is_self_closing_open_tag(xml: &[u8], open_end: usize) -> bool {
    xml[..open_end]
        .iter()
        .rposition(|b| !b.is_ascii_whitespace())
        .is_some_and(|pos| xml[pos] == b'/')
}

// =============================================================================
// Tests
// =============================================================================

#[cfg(test)]
mod parser_regression_tests;

#[cfg(test)]
mod gridline_regression_tests;
