use crate::infra::opc::{
    PackageOwner, WorkbookRelationships, WorksheetRelationships, parse_owned_relationships,
};
use crate::infra::scanner::{find_attr_simd, find_closing_tag, find_gt_simd, find_tag_simd};
use crate::infra::xml::{parse_string_attr, parse_u32_attr};

pub fn parse_timelines_for_sheet(
    archive: &crate::zip::XlsxArchive,
    sheet_num: usize,
) -> (
    Vec<ooxml_types::timelines::TimelineDef>,
    Vec<ooxml_types::timelines::TimelineAnchor>,
) {
    let mut timelines = Vec::new();
    let mut anchors = Vec::new();
    let rels_path = format!("xl/worksheets/_rels/sheet{}.xml.rels", sheet_num);
    let Ok(rels_xml) = archive.read_file(&rels_path) else {
        return (timelines, anchors);
    };

    let rels = parse_owned_relationships(
        PackageOwner::Worksheet {
            sheet_index: sheet_num,
            path: format!("xl/worksheets/sheet{}.xml", sheet_num),
        },
        &rels_xml,
    );
    let worksheet_relationships = WorksheetRelationships::new(&rels);

    for rel in worksheet_relationships.timelines() {
        let Some(path) = rel.target.path() else {
            continue;
        };
        if let Ok(xml) = archive.read_file(path) {
            timelines.extend(parse_timeline_part(&xml));
        }
    }

    if let Some(drawing_rel) = worksheet_relationships.drawing()
        && let Some(drawing_path) = drawing_rel.target.path()
        && let Ok(drawing_xml) = archive.read_file(drawing_path)
    {
        anchors.extend(parse_timeline_anchors_from_drawing(&drawing_xml));
    }

    (timelines, anchors)
}

pub fn parse_all_timeline_caches(
    archive: &crate::zip::XlsxArchive,
) -> Vec<ooxml_types::timelines::TimelineCacheDef> {
    let mut caches = Vec::new();
    let Ok(rels_xml) = archive.read_file("xl/_rels/workbook.xml.rels") else {
        return caches;
    };
    let rels = parse_owned_relationships(PackageOwner::Workbook, &rels_xml);
    let workbook_relationships = WorkbookRelationships::new(&rels);
    for rel in workbook_relationships.timeline_caches() {
        let Some(path) = rel.target.path() else {
            continue;
        };
        if let Ok(xml) = archive.read_file(path)
            && let Some(cache) = parse_timeline_cache(&xml)
        {
            caches.push(cache);
        }
    }
    caches
}

fn parse_timeline_part(xml: &[u8]) -> Vec<ooxml_types::timelines::TimelineDef> {
    let mut timelines = Vec::new();
    let mut pos = 0;
    while let Some(start) = find_timeline_element(xml, pos) {
        let end = find_gt_simd(xml, start).map(|p| p + 1).unwrap_or(xml.len());
        let elem = &xml[start..end];
        if let (Some(name), Some(cache)) = (
            parse_string_attr(elem, b"name=\""),
            parse_string_attr(elem, b"cache=\""),
        ) {
            timelines.push(ooxml_types::timelines::TimelineDef {
                name,
                cache,
                caption: parse_string_attr(elem, b"caption=\""),
                level: parse_timeline_level(parse_u32_attr(elem, b"level=\"").unwrap_or(2)),
                selection_level: parse_u32_attr(elem, b"selectionLevel=\"")
                    .map(parse_timeline_level),
                scroll_position: parse_string_attr(elem, b"scrollPosition=\""),
                uid: parse_string_attr(elem, b"xr10:uid=\"")
                    .or_else(|| parse_string_attr(elem, b"uid=\"")),
                ext_lst: None,
            });
        }
        pos = end;
    }
    timelines
}

fn parse_timeline_cache(xml: &[u8]) -> Option<ooxml_types::timelines::TimelineCacheDef> {
    let start = find_tag_simd(xml, b"timelineCacheDefinition", 0)?;
    let end = find_gt_simd(xml, start).map(|p| p + 1).unwrap_or(xml.len());
    let elem = &xml[start..end];
    let state = find_tag_simd(xml, b"state", end).and_then(|state_start| {
        find_gt_simd(xml, state_start).map(|state_end| &xml[state_start..=state_end])
    });
    let bounds = find_tag_simd(xml, b"bounds", end).and_then(|bounds_start| {
        find_gt_simd(xml, bounds_start).map(|bounds_end| &xml[bounds_start..=bounds_end])
    });

    Some(ooxml_types::timelines::TimelineCacheDef {
        name: parse_string_attr(elem, b"name=\"")?,
        uid: parse_string_attr(elem, b"xr10:uid=\"").or_else(|| parse_string_attr(elem, b"uid=\"")),
        source_name: parse_string_attr(elem, b"sourceName=\"")?,
        pivot_cache_id: state.and_then(|s| parse_u32_attr(s, b"pivotCacheId=\"")),
        minimal_refresh_version: state.and_then(|s| parse_u32_attr(s, b"minimalRefreshVersion=\"")),
        last_refresh_version: state.and_then(|s| parse_u32_attr(s, b"lastRefreshVersion=\"")),
        filter_type: state.and_then(|s| parse_string_attr(s, b"filterType=\"")),
        start_date: bounds.and_then(|b| parse_string_attr(b, b"startDate=\"")),
        end_date: bounds.and_then(|b| parse_string_attr(b, b"endDate=\"")),
        pivot_tables: Vec::new(),
        ext_lst: extract_ext_lst(xml),
    })
}

fn parse_timeline_anchors_from_drawing(xml: &[u8]) -> Vec<ooxml_types::timelines::TimelineAnchor> {
    let mut anchors = Vec::new();
    let mut pos = 0;
    while let Some(ac_start) = find_tag_simd(xml, b"mc:AlternateContent", pos) {
        let ac_close = find_closing_tag(xml, b"mc:AlternateContent", ac_start).unwrap_or(xml.len());
        let ac_end = find_gt_simd(xml, ac_close)
            .map(|p| p + 1)
            .unwrap_or(ac_close);
        let block = &xml[ac_start..ac_end];
        if block
            .windows(b"timeslicer".len())
            .any(|w| w == b"timeslicer")
            && let Some(name) = extract_timeslicer_name(block)
            && let Some(anchor) = extract_one_cell_anchor(xml, ac_start, &name, block)
        {
            anchors.push(anchor);
        }
        pos = ac_end;
    }
    anchors
}

fn extract_timeslicer_name(block: &[u8]) -> Option<String> {
    let start = find_tag_simd(block, b"timeslicer", 0)?;
    let end = find_gt_simd(block, start)
        .map(|p| p + 1)
        .unwrap_or(block.len());
    parse_string_attr(&block[start..end], b"name=\"")
}

fn extract_one_cell_anchor(
    xml: &[u8],
    ac_start: usize,
    name: &str,
    block: &[u8],
) -> Option<ooxml_types::timelines::TimelineAnchor> {
    let anchor_start = find_enclosing_anchor(xml, b"oneCellAnchor", ac_start)?;
    let anchor_close = find_closing_tag(xml, b"oneCellAnchor", anchor_start).unwrap_or(xml.len());
    let anchor_end = find_gt_simd(xml, anchor_close)
        .map(|p| p + 1)
        .unwrap_or(anchor_close);
    let anchor_block = &xml[anchor_start..anchor_end];
    let from = parse_cell_anchor(anchor_block, b"from")?;
    Some(ooxml_types::timelines::TimelineAnchor {
        timeline_name: name.to_string(),
        from: from.clone(),
        to: from,
        object_id: extract_object_id(block),
        extent: parse_extent(anchor_block),
        macro_name: extract_graphic_frame_macro(block),
        nv_ext_lst: extract_cnvpr_ext_lst(block),
        drawing: ooxml_types::drawings::DrawingAnchorMetadata {
            anchor_index: drawing_anchor_index(xml, anchor_start),
        },
    })
}

fn drawing_anchor_index(xml: &[u8], anchor_start: usize) -> Option<usize> {
    let mut anchors = Vec::new();
    collect_anchor_starts(xml, b"twoCellAnchor", &mut anchors);
    collect_anchor_starts(xml, b"oneCellAnchor", &mut anchors);
    collect_anchor_starts(xml, b"absoluteAnchor", &mut anchors);
    anchors.sort_unstable();
    anchors.iter().position(|&start| start == anchor_start)
}

fn collect_anchor_starts(xml: &[u8], tag_name: &[u8], anchors: &mut Vec<usize>) {
    let mut pos = 0;
    while let Some(found) = find_tag_simd(xml, tag_name, pos) {
        anchors.push(found);
        pos = find_gt_simd(xml, found).map(|p| p + 1).unwrap_or(found + 1);
    }
}

fn extract_graphic_frame_macro(block: &[u8]) -> Option<String> {
    let start = find_tag_simd(block, b"graphicFrame", 0)?;
    let end = find_gt_simd(block, start)
        .map(|p| p + 1)
        .unwrap_or(block.len());
    parse_string_attr(&block[start..end], b"macro=\"")
}

fn extract_cnvpr_ext_lst(block: &[u8]) -> Option<String> {
    let cnv_start = find_tag_simd(block, b"cNvPr", 0)?;
    let cnv_close = find_closing_tag(block, b"cNvPr", cnv_start)?;
    let cnv_end = find_gt_simd(block, cnv_close).map(|p| p + 1)?;
    extract_ext_lst(&block[cnv_start..cnv_end])
}

fn extract_object_id(block: &[u8]) -> Option<u32> {
    let start = find_tag_simd(block, b"cNvPr", 0)?;
    let end = find_gt_simd(block, start)
        .map(|p| p + 1)
        .unwrap_or(block.len());
    parse_u32_attr(&block[start..end], b"id=\"")
}

fn find_enclosing_anchor(xml: &[u8], tag: &[u8], before: usize) -> Option<usize> {
    let mut last = None;
    let mut pos = 0;
    while pos < before {
        let Some(found) = find_tag_simd(xml, tag, pos) else {
            break;
        };
        if found >= before {
            break;
        }
        last = Some(found);
        pos = find_gt_simd(xml, found).map(|p| p + 1).unwrap_or(found + 1);
    }
    last
}

fn parse_cell_anchor(block: &[u8], tag: &[u8]) -> Option<ooxml_types::drawings::CellAnchor> {
    let start = find_tag_simd(block, tag, 0)?;
    let content_start = find_gt_simd(block, start)
        .map(|p| p + 1)
        .unwrap_or(block.len());
    let close = find_closing_tag(block, tag, content_start).unwrap_or(block.len());
    let inner = &block[content_start..close];
    Some(ooxml_types::drawings::CellAnchor {
        col: parse_element_text_u32(inner, b"col")?,
        col_off: parse_element_text_i64(inner, b"colOff").unwrap_or(0),
        row: parse_element_text_u32(inner, b"row")?,
        row_off: parse_element_text_i64(inner, b"rowOff").unwrap_or(0),
    })
}

fn parse_extent(block: &[u8]) -> Option<ooxml_types::drawings::Extent> {
    let start = find_tag_simd(block, b"xdr:ext", 0).or_else(|| find_tag_simd(block, b"ext", 0))?;
    let end = find_gt_simd(block, start)
        .map(|p| p + 1)
        .unwrap_or(block.len());
    let elem = &block[start..end];
    Some(ooxml_types::drawings::Extent {
        cx: parse_i64_attr(elem, b"cx=\"")?,
        cy: parse_i64_attr(elem, b"cy=\"")?,
    })
}

fn parse_element_text_u32(xml: &[u8], tag: &[u8]) -> Option<u32> {
    let start = find_tag_simd(xml, tag, 0)?;
    let text_start = find_gt_simd(xml, start).map(|p| p + 1).unwrap_or(xml.len());
    let end = xml[text_start..]
        .iter()
        .position(|b| *b == b'<')
        .map(|p| text_start + p)
        .unwrap_or(xml.len());
    std::str::from_utf8(&xml[text_start..end])
        .ok()?
        .trim()
        .parse()
        .ok()
}

fn parse_element_text_i64(xml: &[u8], tag: &[u8]) -> Option<i64> {
    let start = find_tag_simd(xml, tag, 0)?;
    let text_start = find_gt_simd(xml, start).map(|p| p + 1).unwrap_or(xml.len());
    let end = xml[text_start..]
        .iter()
        .position(|b| *b == b'<')
        .map(|p| text_start + p)
        .unwrap_or(xml.len());
    std::str::from_utf8(&xml[text_start..end])
        .ok()?
        .trim()
        .parse()
        .ok()
}

fn parse_i64_attr(elem: &[u8], attr: &[u8]) -> Option<i64> {
    let start = find_attr_simd(elem, attr, 0)? + attr.len();
    let end = elem[start..]
        .iter()
        .position(|b| *b == b'"')
        .map(|p| start + p)?;
    std::str::from_utf8(&elem[start..end]).ok()?.parse().ok()
}

fn parse_timeline_level(value: u32) -> ooxml_types::timelines::TimelineLevel {
    match value {
        0 => ooxml_types::timelines::TimelineLevel::Years,
        1 => ooxml_types::timelines::TimelineLevel::Quarters,
        3 => ooxml_types::timelines::TimelineLevel::Days,
        _ => ooxml_types::timelines::TimelineLevel::Months,
    }
}

fn timeline_level_value(value: ooxml_types::timelines::TimelineLevel) -> &'static str {
    match value {
        ooxml_types::timelines::TimelineLevel::Years => "0",
        ooxml_types::timelines::TimelineLevel::Quarters => "1",
        ooxml_types::timelines::TimelineLevel::Months => "2",
        ooxml_types::timelines::TimelineLevel::Days => "3",
    }
}

fn find_timeline_element(xml: &[u8], start: usize) -> Option<usize> {
    let mut pos = start;
    while let Some(found) = find_tag_simd(xml, b"timeline", pos) {
        let end = find_gt_simd(xml, found).unwrap_or(xml.len());
        let elem = &xml[found + usize::from(xml.get(found) == Some(&b'<'))..end];
        let name_end = elem
            .iter()
            .position(|b| matches!(*b, b' ' | b'\t' | b'\r' | b'\n' | b'/' | b'>'))
            .unwrap_or(elem.len());
        let name = &elem[..name_end];
        let local = name
            .iter()
            .position(|b| *b == b':')
            .map(|idx| &name[idx + 1..])
            .unwrap_or(name);
        if local == b"timeline" {
            return Some(found);
        }
        pos = end + 1;
    }
    None
}

fn extract_ext_lst(xml: &[u8]) -> Option<String> {
    let start = find_tag_simd(xml, b"extLst", 0)?;
    let close = find_closing_tag(xml, b"extLst", start)?;
    let end = find_gt_simd(xml, close).map(|p| p + 1).unwrap_or(close);
    std::str::from_utf8(&xml[start..end])
        .ok()
        .map(str::to_string)
}

pub(crate) fn timeline_level_attr(value: ooxml_types::timelines::TimelineLevel) -> &'static str {
    timeline_level_value(value)
}
