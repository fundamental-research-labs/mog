use crate::infra::scanner::{
    extract_quoted_value, find_attr_simd, find_closing_tag, find_gt_simd, find_tag_simd,
};
use crate::infra::xml::decode_xml_entities;

use super::xml_values::{parse_bytes_u32, parse_val_attr_u32};
use super::{
    CatDataSource, NumData, NumDataSource, NumPoint, NumRef, SeriesTextSource, StrData, StrPoint,
    StrRef, parse_chart_ext_lst,
};

pub fn parse_series_text(xml: &[u8]) -> Option<SeriesTextSource> {
    // Parse string reference
    if let Some(strref_start) = find_tag_simd(xml, b"strRef", 0) {
        let strref_end = find_closing_tag(xml, b"strRef", strref_start).unwrap_or(xml.len());
        return Some(SeriesTextSource::StrRef(parse_str_ref(
            &xml[strref_start..strref_end],
        )));
    }

    // Parse direct value — decode XML entities for correct round-trip
    if let Some(v_start) = find_tag_simd(xml, b"v", 0) {
        let v_content_start = find_gt_simd(xml, v_start).map(|p| p + 1);
        let v_end = find_closing_tag(xml, b"v", v_start);

        if let (Some(start), Some(end)) = (v_content_start, v_end) {
            if start < end {
                return Some(SeriesTextSource::Value(decode_xml_entities(
                    &xml[start..end],
                )));
            }
        }
    }

    None
}
// =============================================================================
// Data References
// =============================================================================

/// Axis data (category or value data).
#[derive(Debug, Clone, Default)]
pub struct AxisData {
    /// Numeric reference
    pub num_ref: Option<NumRef>,
    /// String reference
    pub str_ref: Option<StrRef>,
    /// Numeric literal values
    pub num_lit: Option<NumData>,
    /// String literal values
    pub str_lit: Option<StrData>,
}

impl AxisData {
    /// Convert to a `CatDataSource` (numeric ref, string ref, numeric lit, or string lit).
    pub fn to_cat_source(self) -> Option<CatDataSource> {
        if let Some(nr) = self.num_ref {
            Some(CatDataSource::NumRef(nr))
        } else if let Some(sr) = self.str_ref {
            Some(CatDataSource::StrRef(sr))
        } else if let Some(nl) = self.num_lit {
            Some(CatDataSource::NumLit(nl))
        } else {
            self.str_lit.map(CatDataSource::StrLit)
        }
    }

    /// Convert to a `NumDataSource` (numeric ref or numeric lit only).
    pub fn to_num_source(self) -> Option<NumDataSource> {
        if let Some(nr) = self.num_ref {
            Some(NumDataSource::Ref(nr))
        } else {
            self.num_lit.map(NumDataSource::Lit)
        }
    }

    /// Parse axis data element.
    pub fn parse(xml: &[u8]) -> Self {
        let mut data = AxisData::default();

        // Parse numeric reference
        if let Some(numref_start) = find_tag_simd(xml, b"numRef", 0) {
            let numref_end = find_closing_tag(xml, b"numRef", numref_start).unwrap_or(xml.len());
            data.num_ref = Some(parse_num_ref(&xml[numref_start..numref_end]));
        }

        // Parse string reference
        if let Some(strref_start) = find_tag_simd(xml, b"strRef", 0) {
            let strref_end = find_closing_tag(xml, b"strRef", strref_start).unwrap_or(xml.len());
            data.str_ref = Some(parse_str_ref(&xml[strref_start..strref_end]));
        }

        // Parse numeric literal
        if let Some(numlit_start) = find_tag_simd(xml, b"numLit", 0) {
            let numlit_end = find_closing_tag(xml, b"numLit", numlit_start).unwrap_or(xml.len());
            data.num_lit = Some(parse_num_data(&xml[numlit_start..numlit_end]));
        }

        // Parse string literal
        if let Some(strlit_start) = find_tag_simd(xml, b"strLit", 0) {
            let strlit_end = find_closing_tag(xml, b"strLit", strlit_start).unwrap_or(xml.len());
            data.str_lit = Some(parse_str_data(&xml[strlit_start..strlit_end]));
        }

        data
    }
}

/// Parse numeric reference element (CT_NumRef).
pub fn parse_num_ref(xml: &[u8]) -> NumRef {
    let mut num_ref = NumRef::default();

    // Parse formula
    if let Some(f_start) = find_tag_simd(xml, b"f", 0) {
        let f_content_start = find_gt_simd(xml, f_start).map(|p| p + 1);
        let f_end = find_closing_tag(xml, b"f", f_start);

        if let (Some(start), Some(end)) = (f_content_start, f_end) {
            if start < end {
                num_ref.f = decode_xml_entities(&xml[start..end]);
            }
        }
    }

    // Parse cached values
    if let Some(cache_start) = find_tag_simd(xml, b"numCache", 0) {
        let cache_end = find_closing_tag(xml, b"numCache", cache_start).unwrap_or(xml.len());
        num_ref.num_cache = Some(parse_num_data(&xml[cache_start..cache_end]));
    }
    num_ref.extensions = parse_chart_ext_lst(xml);
    num_ref
}

/// Parse string reference element (CT_StrRef).
pub fn parse_str_ref(xml: &[u8]) -> StrRef {
    let mut str_ref = StrRef::default();

    // Parse formula
    if let Some(f_start) = find_tag_simd(xml, b"f", 0) {
        let f_content_start = find_gt_simd(xml, f_start).map(|p| p + 1);
        let f_end = find_closing_tag(xml, b"f", f_start);

        if let (Some(start), Some(end)) = (f_content_start, f_end) {
            if start < end {
                str_ref.f = decode_xml_entities(&xml[start..end]);
            }
        }
    }

    // Parse cached values
    if let Some(cache_start) = find_tag_simd(xml, b"strCache", 0) {
        let cache_end = find_closing_tag(xml, b"strCache", cache_start).unwrap_or(xml.len());
        str_ref.str_cache = Some(parse_str_data(&xml[cache_start..cache_end]));
    }
    str_ref.extensions = parse_chart_ext_lst(xml);
    str_ref
}

/// Parse numeric cache/data element (CT_NumData).
pub fn parse_num_data(xml: &[u8]) -> NumData {
    let mut data = NumData::default();

    // Parse format code
    if let Some(fmt_start) = find_tag_simd(xml, b"formatCode", 0) {
        let fmt_content_start = find_gt_simd(xml, fmt_start).map(|p| p + 1);
        let fmt_end = find_closing_tag(xml, b"formatCode", fmt_start);

        if let (Some(start), Some(end)) = (fmt_content_start, fmt_end) {
            if start < end {
                data.format_code = Some(decode_xml_entities(&xml[start..end]));
            }
        }
    }

    // Parse point count
    if let Some(ptcount_start) = find_tag_simd(xml, b"ptCount", 0) {
        data.pt_count = Some(parse_val_attr_u32(&xml[ptcount_start..]));
    }

    // Parse points
    let mut pos = 0;
    while let Some(pt_start) = find_tag_simd(xml, b"pt", pos) {
        let pt_end = find_closing_tag(xml, b"pt", pt_start).unwrap_or(xml.len());
        let pt_bytes = &xml[pt_start..pt_end];

        let mut idx = 0u32;
        let mut v = String::new();

        // Parse index
        if let Some(attr_pos) = find_attr_simd(pt_bytes, b"idx=\"", 0) {
            let value_start = attr_pos + 5;
            if let Some((start, end)) = extract_quoted_value(pt_bytes, value_start) {
                idx = parse_bytes_u32(&pt_bytes[start..end]);
            }
        }

        // Parse per-point formatCode attribute (override for this data point)
        let mut pt_format_code = None;
        if let Some(attr_pos) = find_attr_simd(pt_bytes, b"formatCode=\"", 0) {
            let value_start = attr_pos + 12;
            if let Some((start, end)) = extract_quoted_value(pt_bytes, value_start) {
                if start < end {
                    pt_format_code = Some(decode_xml_entities(&pt_bytes[start..end]));
                }
            }
        }

        // Parse value — decode XML entities so the writer's escaping round-trips correctly
        if let Some(v_start) = find_tag_simd(pt_bytes, b"v", 0) {
            let v_content_start = find_gt_simd(pt_bytes, v_start).map(|p| p + 1);
            let v_end = find_closing_tag(pt_bytes, b"v", v_start);

            if let (Some(start), Some(end)) = (v_content_start, v_end) {
                if start < end {
                    v = decode_xml_entities(&pt_bytes[start..end]);
                }
            }
        }

        data.pts.push(NumPoint {
            idx,
            v,
            format_code: pt_format_code,
        });
        pos = pt_end;
    }

    data
}

/// Parse string cache/data element (CT_StrData).
pub fn parse_str_data(xml: &[u8]) -> StrData {
    let mut data = StrData::default();

    // Parse point count
    if let Some(ptcount_start) = find_tag_simd(xml, b"ptCount", 0) {
        data.pt_count = Some(parse_val_attr_u32(&xml[ptcount_start..]));
    }

    // Parse points
    let mut pos = 0;
    while let Some(pt_start) = find_tag_simd(xml, b"pt", pos) {
        let pt_end = find_closing_tag(xml, b"pt", pt_start).unwrap_or(xml.len());
        let pt_bytes = &xml[pt_start..pt_end];

        let mut idx = 0u32;
        let mut v = String::new();

        // Parse index
        if let Some(attr_pos) = find_attr_simd(pt_bytes, b"idx=\"", 0) {
            let value_start = attr_pos + 5;
            if let Some((start, end)) = extract_quoted_value(pt_bytes, value_start) {
                idx = parse_bytes_u32(&pt_bytes[start..end]);
            }
        }

        // Parse value — decode XML entities so the writer's escaping round-trips correctly
        if let Some(v_start) = find_tag_simd(pt_bytes, b"v", 0) {
            let v_content_start = find_gt_simd(pt_bytes, v_start).map(|p| p + 1);
            let v_end = find_closing_tag(pt_bytes, b"v", v_start);

            if let (Some(start), Some(end)) = (v_content_start, v_end) {
                if start < end {
                    v = decode_xml_entities(&pt_bytes[start..end]);
                }
            }
        }

        data.pts.push(StrPoint { idx, v });
        pos = pt_end;
    }

    data
}
