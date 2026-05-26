//! Slicer parser for XLSX files
//!
//! This module parses slicer definitions from XLSX files, including:
//! - Slicer parts (`xl/slicers/slicer{N}.xml`) — individual slicer definitions
//! - Slicer cache definitions (`xl/slicerCaches/slicerCache{N}.xml`) — data/filter state
//! - Slicer anchors from drawing XML — positioning in the spreadsheet
//!
//! Slicers are defined in Microsoft Office extension namespaces:
//! - **x14** (`http://schemas.microsoft.com/office/spreadsheetml/2009/9/main`) — CT_Slicer, CT_SlicerCacheDefinition
//! - **x15** (`http://schemas.microsoft.com/office/spreadsheetml/2010/11/main`) — CT_TableSlicerCache
//! - **sle** (`http://schemas.microsoft.com/office/drawing/2010/slicer`) — slicer anchor in drawing XML
//!
//! UTF-8 boundary guard: the single `&s[n..]` slice in this file splits an
//! XML attribute at an ASCII-only delimiter. Char-boundary by
//! construction. File-scope allow documented here.

#![allow(clippy::string_slice)]

use crate::infra::scanner::{find_attr_simd, find_closing_tag, find_gt_simd, find_tag_simd};
use crate::infra::xml::{parse_bool_attr_with_default, parse_string_attr, parse_u32_attr};

// Re-export all slicer types and constants from ooxml-types
pub use ooxml_types::slicers::{
    CONTENT_TYPE_SLICER, CONTENT_TYPE_SLICER_CACHE, REL_SLICER, REL_SLICER_CACHE, SlicerAnchor,
    SlicerCacheDef, SlicerCrossFilter, SlicerDef, SlicerPivotTableRef, SlicerSortOrder,
    SlicerTabularData, SlicerTabularItem, TableSlicerCache,
};

use ooxml_types::drawings::CellAnchor;

// ============================================================================
// Slicer Part Parser (xl/slicers/slicer{N}.xml)
// ============================================================================

/// Parse a slicer part XML file (`xl/slicers/slicer{N}.xml`).
///
/// Iterates over `<slicer>` or `<x14:slicer>` elements and extracts slicer definitions.
/// Fault-tolerant: skips malformed slicer elements with warnings.
///
/// # Arguments
/// * `xml` - The slicer part XML bytes
///
/// # Returns
/// A vector of parsed SlicerDef structs
pub fn parse_slicer_part(xml: &[u8]) -> Vec<SlicerDef> {
    let mut slicers = Vec::new();
    let mut pos = 0;

    // Slicer elements may be `<slicer ...>` or `<x14:slicer ...>` depending on namespace handling.
    // We search for both patterns. The containing element is `<slicers>` or `<x14:slicers>`.
    while pos < xml.len() {
        // Find the next <slicer or <x14:slicer element
        let slicer_start = find_slicer_element(xml, pos);
        let slicer_start = match slicer_start {
            Some(s) => s,
            None => break,
        };

        // Find the end of this element (self-closing or with closing tag)
        let elem_end = find_gt_simd(xml, slicer_start)
            .map(|p| p + 1)
            .unwrap_or(xml.len());
        let elem = &xml[slicer_start..elem_end];

        // Parse attributes
        if let Some(slicer) = parse_single_slicer(elem) {
            slicers.push(slicer);
        }

        pos = elem_end;
    }

    slicers
}

/// Find the next `<slicer` or `<x14:slicer` element start position.
fn find_slicer_element(xml: &[u8], start: usize) -> Option<usize> {
    // Try namespace-prefixed first (more common in real files)
    let prefixed = find_tag_simd(xml, b"x14:slicer", start);
    // Also try unprefixed
    let unprefixed = find_tag_simd(xml, b"slicer", start);

    match (prefixed, unprefixed) {
        (Some(p), Some(u)) => {
            // Take the one that appears first, but skip <slicers> container elements
            let first = p.min(u);
            // Verify it's actually a <slicer> or <x14:slicer> element, not <slicers>
            if is_slicer_element(xml, first) {
                Some(first)
            } else {
                // Skip past this tag and try again
                let skip_end = find_gt_simd(xml, first).map(|p| p + 1).unwrap_or(first + 1);
                find_slicer_element(xml, skip_end)
            }
        }
        (Some(p), None) => {
            if is_slicer_element(xml, p) {
                Some(p)
            } else {
                let skip_end = find_gt_simd(xml, p).map(|p| p + 1).unwrap_or(p + 1);
                find_slicer_element(xml, skip_end)
            }
        }
        (None, Some(u)) => {
            if is_slicer_element(xml, u) {
                Some(u)
            } else {
                let skip_end = find_gt_simd(xml, u).map(|p| p + 1).unwrap_or(u + 1);
                find_slicer_element(xml, skip_end)
            }
        }
        (None, None) => None,
    }
}

/// Check that the tag at `pos` is a `<slicer` or `<x14:slicer` element and NOT `<slicers>` or `<slicerCache>`.
///
/// `pos` is the position of the `<` character (as returned by `find_tag_simd`).
fn is_slicer_element(xml: &[u8], pos: usize) -> bool {
    // Skip past the '<' to get to the tag name
    let name_start = if pos < xml.len() && xml[pos] == b'<' {
        pos + 1
    } else {
        pos
    };
    // Find the end of this element (up to '>')
    let tag_end = find_gt_simd(xml, name_start).unwrap_or(xml.len());
    let tag_slice = &xml[name_start..tag_end];

    // Extract just the element name (before the first space/whitespace/>/slash).
    // We must NOT scan colons in attribute names (e.g., xr10:uid="...").
    let name_len = tag_slice
        .iter()
        .position(|&b| matches!(b, b' ' | b'\t' | b'\n' | b'\r' | b'>' | b'/'))
        .unwrap_or(tag_slice.len());
    let elem_name = &tag_slice[..name_len];

    // Check it's exactly "slicer" or "{prefix}:slicer" — not "slicers" or "slicerCache"
    if let Some(colon_pos) = memchr::memchr(b':', elem_name) {
        // Prefixed: check after the colon
        let local_name = &elem_name[colon_pos + 1..];
        local_name == b"slicer"
    } else {
        // Unprefixed
        elem_name == b"slicer"
    }
}

/// Parse a single `<slicer>` element's attributes into a SlicerDef.
fn parse_single_slicer(elem: &[u8]) -> Option<SlicerDef> {
    let name = parse_string_attr(elem, b"name=\"")?;
    let cache = parse_string_attr(elem, b"cache=\"")?;

    Some(SlicerDef {
        name,
        cache,
        caption: parse_string_attr(elem, b"caption=\""),
        start_item: parse_u32_attr(elem, b"startItem=\""),
        column_count: parse_u32_attr(elem, b"columnCount=\"").unwrap_or(1),
        show_caption: parse_bool_attr_with_default(elem, b"showCaption=\"", true),
        level: parse_u32_attr(elem, b"level=\"").unwrap_or(0),
        style: parse_string_attr(elem, b"style=\""),
        locked_position: parse_bool_attr_with_default(elem, b"lockedPosition=\"", false),
        row_height: parse_u32_attr(elem, b"rowHeight=\""),
        uid: parse_string_attr(elem, b"xr10:uid=\"").or_else(|| parse_string_attr(elem, b"uid=\"")),
        ext_lst: None, // Extension list parsing is opaque passthrough, skip for now
    })
}

// ============================================================================
// Slicer Cache Parser (xl/slicerCaches/slicerCache{N}.xml)
// ============================================================================

/// Parse a slicer cache definition XML file (`xl/slicerCaches/slicerCache{N}.xml`).
///
/// Extracts the top-level cache attributes, pivot table references, tabular data,
/// and table slicer cache from x15 extensions.
///
/// # Arguments
/// * `xml` - The slicer cache XML bytes
///
/// # Returns
/// A parsed SlicerCacheDef, or None if the XML is malformed
pub fn parse_slicer_cache(xml: &[u8]) -> Option<SlicerCacheDef> {
    // Find the root element: <slicerCacheDefinition> or <x14:slicerCacheDefinition>
    let root_start = find_tag_simd(xml, b"slicerCacheDefinition", 0)?;
    let root_elem_end = find_gt_simd(xml, root_start)
        .map(|p| p + 1)
        .unwrap_or(xml.len());
    let root_elem = &xml[root_start..root_elem_end];

    // Parse top-level attributes
    let name = parse_string_attr(root_elem, b"name=\"")?;
    let source_name = parse_string_attr(root_elem, b"sourceName=\"")?;
    let uid = parse_string_attr(root_elem, b"uid=\"")
        .or_else(|| parse_string_attr(root_elem, b"xr10:uid=\""));

    // Find the closing tag for the root element
    let root_close =
        find_closing_tag(xml, b"slicerCacheDefinition", root_start).unwrap_or(xml.len());
    let body = &xml[root_elem_end..root_close];

    // Parse pivotTables children
    let pivot_tables = parse_slicer_pivot_tables(body);

    // Parse tabular data (x14:data/x14:tabular)
    let tabular_data = parse_tabular_data(body);

    // Parse x15:tableSlicerCache from extLst
    let table_slicer_cache = parse_table_slicer_cache_from_ext(body);

    // Extract extLst as opaque XML if present
    let ext_lst = extract_ext_lst(body);

    Some(SlicerCacheDef {
        name,
        uid,
        source_name,
        pivot_tables,
        tabular_data,
        table_slicer_cache,
        ext_lst,
    })
}

/// Parse `<pivotTables>` or `<x14:pivotTables>` children within the cache body.
fn parse_slicer_pivot_tables(body: &[u8]) -> Vec<SlicerPivotTableRef> {
    let mut refs = Vec::new();

    // Find <pivotTables> section (may be x14:pivotTables)
    let section_start = find_tag_simd(body, b"pivotTable", 0);
    if section_start.is_none() {
        return refs;
    }

    let mut pos = 0;
    while pos < body.len() {
        // Find <pivotTable> elements (may be prefixed)
        let pt_start = find_pivot_table_element(body, pos);
        let pt_start = match pt_start {
            Some(s) => s,
            None => break,
        };

        let elem_end = find_gt_simd(body, pt_start)
            .map(|p| p + 1)
            .unwrap_or(body.len());
        let elem = &body[pt_start..elem_end];

        if let (Some(tab_id), Some(name)) = (
            parse_u32_attr(elem, b"tabId=\""),
            parse_string_attr(elem, b"name=\""),
        ) {
            refs.push(SlicerPivotTableRef { tab_id, name });
        }

        pos = elem_end;
    }

    refs
}

/// Find a `<pivotTable` element (not `<pivotTables>`).
///
/// `find_tag_simd` already distinguishes "pivotTable" from "pivotTables"
/// by checking that the character after the tag name is a delimiter
/// (space, '/', or '>'), so no additional filtering is needed here.
fn find_pivot_table_element(xml: &[u8], start: usize) -> Option<usize> {
    find_tag_simd(xml, b"pivotTable", start)
}

/// Parse tabular data section: `<data>/<tabular>` or `<x14:data>/<x14:tabular>`.
fn parse_tabular_data(body: &[u8]) -> Option<SlicerTabularData> {
    // Find <tabular> element (may be x14:tabular)
    let tabular_start = find_tag_simd(body, b"tabular", 0)?;
    let tabular_elem_end = find_gt_simd(body, tabular_start)
        .map(|p| p + 1)
        .unwrap_or(body.len());
    let tabular_elem = &body[tabular_start..tabular_elem_end];

    let pivot_cache_id = parse_u32_attr(tabular_elem, b"pivotCacheId=\"")?;

    let sort_order = parse_sort_order_attr(tabular_elem, b"sortOrder=\"");
    let custom_list_sort = parse_bool_attr_with_default(tabular_elem, b"customListSort=\"", false);
    let show_missing = parse_bool_attr_with_default(tabular_elem, b"showMissing=\"", false);
    let cross_filter = parse_cross_filter_attr(tabular_elem, b"crossFilter=\"");

    // Find closing tag for tabular section
    let tabular_close = find_closing_tag(body, b"tabular", tabular_start).unwrap_or(body.len());
    let tabular_body = &body[tabular_elem_end..tabular_close];

    // Parse items
    let items = parse_tabular_items(tabular_body);

    Some(SlicerTabularData {
        pivot_cache_id,
        sort_order,
        custom_list_sort,
        show_missing,
        cross_filter,
        items,
        ext_lst: None,
    })
}

/// Parse `<i>` or `<x14:i>` items within the tabular data section.
fn parse_tabular_items(body: &[u8]) -> Vec<SlicerTabularItem> {
    let mut items = Vec::new();
    let mut pos = 0;

    // Items can be <i x="0"/> or <x14:i x="0"/> — search raw bytes for either pattern
    while pos < body.len() {
        // Find next '<' character
        let lt_pos = match memchr::memchr(b'<', &body[pos..]) {
            Some(p) => pos + p,
            None => break,
        };

        // Skip closing tags
        if lt_pos + 1 < body.len() && body[lt_pos + 1] == b'/' {
            pos = lt_pos + 2;
            continue;
        }

        let after_lt = lt_pos + 1;
        if after_lt >= body.len() {
            break;
        }

        // Check if this is an <i ...> or <x14:i ...> or similar prefixed:i tag
        let is_i_element = is_item_element(body, after_lt);

        if is_i_element {
            let elem_end = find_gt_simd(body, after_lt)
                .map(|p| p + 1)
                .unwrap_or(body.len());
            let elem = &body[after_lt..elem_end];

            if let Some(x) = parse_u32_attr(elem, b"x=\"") {
                let s = parse_bool_attr_with_default(elem, b"s=\"", false);
                let nd = parse_bool_attr_with_default(elem, b"nd=\"", false);
                items.push(SlicerTabularItem { x, s, nd });
            }

            pos = elem_end;
        } else {
            pos = lt_pos + 1;
        }
    }

    items
}

/// Check if position in XML starts an `<i` or `<prefix:i` element (not `<items>` etc).
fn is_item_element(xml: &[u8], start: usize) -> bool {
    // Handle namespaced: find the local name after any prefix
    let mut local_start = start;

    // Check for namespace prefix (letters followed by ':')
    let mut p = start;
    while p < xml.len() && xml[p].is_ascii_alphanumeric() {
        p += 1;
    }
    if p < xml.len() && xml[p] == b':' {
        local_start = p + 1;
    }

    // The local name should be exactly "i" followed by space, /, or >
    if local_start >= xml.len() {
        return false;
    }
    if xml[local_start] != b'i' {
        return false;
    }
    let after = local_start + 1;
    if after >= xml.len() {
        return false;
    }
    xml[after] == b' ' || xml[after] == b'/' || xml[after] == b'>'
}

/// Parse `x15:tableSlicerCache` from `<extLst>` extensions.
fn parse_table_slicer_cache_from_ext(body: &[u8]) -> Option<TableSlicerCache> {
    // Look for tableSlicerCache element (may be prefixed with x15:)
    let tsc_start = find_tag_simd(body, b"tableSlicerCache", 0)?;
    let tsc_elem_end = find_gt_simd(body, tsc_start)
        .map(|p| p + 1)
        .unwrap_or(body.len());
    let tsc_elem = &body[tsc_start..tsc_elem_end];

    let table_id = parse_u32_attr(tsc_elem, b"tableId=\"")?;
    let column = parse_u32_attr(tsc_elem, b"column=\"")?;

    Some(TableSlicerCache {
        table_id,
        column,
        sort_order: parse_sort_order_attr(tsc_elem, b"sortOrder=\""),
        custom_list_sort: parse_bool_attr_with_default(tsc_elem, b"customListSort=\"", false),
        cross_filter: parse_cross_filter_attr(tsc_elem, b"crossFilter=\""),
        ext_lst: None,
    })
}

/// Extract `<extLst>` as opaque XML string.
fn extract_ext_lst(body: &[u8]) -> Option<String> {
    // find_tag_simd returns the position of '<' in '<extLst>'
    let ext_start = find_tag_simd(body, b"extLst", 0)?;
    let ext_close = find_closing_tag(body, b"extLst", ext_start)?;

    // Include up to and past closing tag
    let close_end = find_gt_simd(body, ext_close)
        .map(|p| p + 1)
        .unwrap_or(ext_close);

    std::str::from_utf8(&body[ext_start..close_end])
        .ok()
        .map(|s| s.to_string())
}

/// Parse a sort order attribute value.
fn parse_sort_order_attr(elem: &[u8], attr: &[u8]) -> SlicerSortOrder {
    if let Some(val) = parse_string_attr(elem, attr) {
        match val.as_str() {
            "descending" | "Descending" => SlicerSortOrder::Descending,
            _ => SlicerSortOrder::Ascending,
        }
    } else {
        SlicerSortOrder::Ascending
    }
}

/// Parse a cross-filter attribute value.
fn parse_cross_filter_attr(elem: &[u8], attr: &[u8]) -> SlicerCrossFilter {
    if let Some(val) = parse_string_attr(elem, attr) {
        match val.as_str() {
            "none" | "None" => SlicerCrossFilter::None,
            "showItemsWithNoData" | "ShowItemsWithNoData" => SlicerCrossFilter::ShowItemsWithNoData,
            _ => SlicerCrossFilter::ShowItemsWithDataAtTop,
        }
    } else {
        SlicerCrossFilter::ShowItemsWithDataAtTop
    }
}

// ============================================================================
// Slicer Anchor Parser (from drawing XML)
// ============================================================================

/// Parse slicer anchors from drawing XML.
///
/// Slicers appear in drawings as `mc:AlternateContent` elements with
/// `mc:Choice Requires="a14"` containing `<graphicFrame>` with `<sle:slicer name="..."/>`.
/// The from/to cell anchors come from the parent `<twoCellAnchor>`.
///
/// # Arguments
/// * `drawing_xml` - The drawing XML bytes
///
/// # Returns
/// A vector of SlicerAnchor structs
pub fn parse_slicer_anchors_from_drawing(drawing_xml: &[u8]) -> Vec<SlicerAnchor> {
    let mut anchors = Vec::new();
    let mut pos = 0;

    // Scan for mc:AlternateContent blocks
    while let Some(ac_start) = find_tag_simd(drawing_xml, b"mc:AlternateContent", pos) {
        let ac_close = find_closing_tag(drawing_xml, b"mc:AlternateContent", ac_start)
            .unwrap_or(drawing_xml.len());
        let ac_end = find_gt_simd(drawing_xml, ac_close)
            .map(|p| p + 1)
            .unwrap_or(ac_close);
        let ac_block = &drawing_xml[ac_start..ac_end];

        // Check if this AlternateContent has mc:Choice Requires="a14"
        if let Some(choice_start) = find_tag_simd(ac_block, b"mc:Choice", 0) {
            let choice_elem_end = find_gt_simd(ac_block, choice_start)
                .map(|p| p + 1)
                .unwrap_or(ac_block.len());
            let choice_elem = &ac_block[choice_start..choice_elem_end];

            if find_attr_simd(choice_elem, b"Requires=\"", 0).is_some() {
                let requires = parse_string_attr(choice_elem, b"Requires=\"");
                if requires.as_deref() == Some("a14") || requires.as_deref() == Some("sle") {
                    // Look for sle:slicer element within this block
                    if let Some(slicer_name) = extract_slicer_name_from_block(ac_block) {
                        // Extract the twoCellAnchor from/to from the parent context
                        // We need to look at the twoCellAnchor that contains this mc:AlternateContent
                        if let Some(anchor) =
                            extract_two_cell_anchor_for_slicer(drawing_xml, ac_start, &slicer_name)
                        {
                            anchors.push(anchor);
                        }
                    }
                }
            }
        }

        pos = ac_end;
    }

    anchors
}

/// Extract slicer name from within an mc:AlternateContent block.
fn extract_slicer_name_from_block(block: &[u8]) -> Option<String> {
    // Look for <sle:slicer name="..."/> or just <slicer name="..."/> within a graphicFrame
    let slicer_tag = find_tag_simd(block, b"sle:slicer", 0).or_else(|| {
        // Try without namespace prefix — some generators omit it
        let mut p = 0;
        loop {
            let found = find_tag_simd(block, b"slicer", p)?;
            let elem_end = find_gt_simd(block, found).unwrap_or(block.len());
            let tag = &block[found..elem_end.min(found + 20)];
            // Must be exactly "slicer" followed by space/>/
            if tag.starts_with(b"slicer")
                && tag.len() > 6
                && (tag[6] == b' ' || tag[6] == b'/' || tag[6] == b'>')
            {
                return Some(found);
            }
            p = elem_end;
        }
    })?;

    let slicer_elem_end = find_gt_simd(block, slicer_tag)
        .map(|p| p + 1)
        .unwrap_or(block.len());
    let slicer_elem = &block[slicer_tag..slicer_elem_end];

    parse_string_attr(slicer_elem, b"name=\"")
}

/// Find the parent twoCellAnchor for a slicer mc:AlternateContent and extract from/to anchors.
fn extract_two_cell_anchor_for_slicer(
    drawing_xml: &[u8],
    ac_start: usize,
    slicer_name: &str,
) -> Option<SlicerAnchor> {
    // Walk backwards from ac_start to find the enclosing <twoCellAnchor> or <xdr:twoCellAnchor>
    let two_cell_start = find_enclosing_two_cell_anchor(drawing_xml, ac_start)?;
    let two_cell_close = find_closing_tag(drawing_xml, b"twoCellAnchor", two_cell_start)
        .unwrap_or(drawing_xml.len());
    let two_cell_end = find_gt_simd(drawing_xml, two_cell_close)
        .map(|p| p + 1)
        .unwrap_or(two_cell_close);
    let two_cell_block = &drawing_xml[two_cell_start..two_cell_end];

    // Parse <from> and <to> cell anchors
    let from = parse_cell_anchor_element(two_cell_block, b"from")?;
    let to = parse_cell_anchor_element(two_cell_block, b"to")?;

    Some(SlicerAnchor {
        slicer_name: slicer_name.to_string(),
        from,
        to,
    })
}

/// Find the enclosing `<twoCellAnchor>` or `<xdr:twoCellAnchor>` tag before the given position.
fn find_enclosing_two_cell_anchor(xml: &[u8], before_pos: usize) -> Option<usize> {
    // Scan backwards for "<twoCellAnchor" or "<xdr:twoCellAnchor"
    // We search by scanning forward from the start and finding the last twoCellAnchor start before before_pos
    let mut last_found = None;
    let mut pos = 0;

    while pos < before_pos {
        if let Some(found) = find_tag_simd(xml, b"twoCellAnchor", pos) {
            if found < before_pos {
                last_found = Some(found);
                let end = find_gt_simd(xml, found).map(|p| p + 1).unwrap_or(found + 1);
                pos = end;
            } else {
                break;
            }
        } else {
            break;
        }
    }

    last_found
}

/// Parse a `<from>` or `<to>` cell anchor element.
fn parse_cell_anchor_element(block: &[u8], tag_name: &[u8]) -> Option<CellAnchor> {
    // For <from> or <to>, we also need to handle xdr:from / xdr:to
    let tag_start = find_from_to_tag(block, tag_name)?;
    let tag_elem_end = find_gt_simd(block, tag_start)
        .map(|p| p + 1)
        .unwrap_or(block.len());

    // Find closing tag
    let tag_close = find_closing_tag(block, tag_name, tag_start).unwrap_or(block.len());
    let inner = &block[tag_elem_end..tag_close];

    let col = parse_element_text_u32(inner, b"col")?;
    let col_off = parse_element_text_i64(inner, b"colOff").unwrap_or(0);
    let row = parse_element_text_u32(inner, b"row")?;
    let row_off = parse_element_text_i64(inner, b"rowOff").unwrap_or(0);

    Some(CellAnchor {
        col,
        col_off,
        row,
        row_off,
    })
}

/// Find a <from> or <to> tag, handling potential xdr: prefix.
fn find_from_to_tag(block: &[u8], tag_name: &[u8]) -> Option<usize> {
    // Try prefixed first
    let mut prefixed_tag = b"xdr:".to_vec();
    prefixed_tag.extend_from_slice(tag_name);

    find_tag_simd(block, &prefixed_tag, 0).or_else(|| find_tag_simd(block, tag_name, 0))
}

/// Extract the text content of a simple element like `<col>3</col>` as u32.
fn parse_element_text_u32(xml: &[u8], tag_name: &[u8]) -> Option<u32> {
    // Try with xdr: prefix first
    let mut prefixed = b"xdr:".to_vec();
    prefixed.extend_from_slice(tag_name);

    let tag_start = find_tag_simd(xml, &prefixed, 0).or_else(|| find_tag_simd(xml, tag_name, 0))?;

    let content_start = find_gt_simd(xml, tag_start)
        .map(|p| p + 1)
        .unwrap_or(xml.len());

    // Read digits until '<'
    let mut result: u32 = 0;
    let mut pos = content_start;
    let mut found_digit = false;

    while pos < xml.len() && xml[pos] != b'<' {
        if xml[pos].is_ascii_digit() {
            result = result
                .saturating_mul(10)
                .saturating_add((xml[pos] - b'0') as u32);
            found_digit = true;
        }
        pos += 1;
    }

    if found_digit { Some(result) } else { None }
}

/// Extract the text content of a simple element as i64 (for EMU offsets).
fn parse_element_text_i64(xml: &[u8], tag_name: &[u8]) -> Option<i64> {
    let mut prefixed = b"xdr:".to_vec();
    prefixed.extend_from_slice(tag_name);

    let tag_start = find_tag_simd(xml, &prefixed, 0).or_else(|| find_tag_simd(xml, tag_name, 0))?;

    let content_start = find_gt_simd(xml, tag_start)
        .map(|p| p + 1)
        .unwrap_or(xml.len());

    // Read until '<' and parse as i64
    let mut pos = content_start;
    while pos < xml.len() && xml[pos] != b'<' {
        pos += 1;
    }

    let text = &xml[content_start..pos];
    std::str::from_utf8(text).ok()?.trim().parse::<i64>().ok()
}

// ============================================================================
// Sheet-level slicer parse functions (extracted from parse_helpers.rs)
// ============================================================================

/// Parse slicers for a given sheet.
///
/// This function:
/// 1. Reads the sheet .rels to find slicer part targets (via REL_SLICER type)
/// 2. Reads and parses each slicer part XML
/// 3. Also extracts slicer anchors from the drawing XML
///
/// Returns a tuple of (slicer_defs, slicer_anchors).
pub fn parse_slicers_for_sheet(
    archive: &crate::zip::XlsxArchive,
    sheet_num: usize,
) -> (Vec<SlicerDef>, Vec<SlicerAnchor>) {
    let mut all_slicers = Vec::new();
    let mut all_anchors = Vec::new();

    // Step 1: Read sheet .rels to find slicer part targets
    let rels_path = format!("xl/worksheets/_rels/sheet{}.xml.rels", sheet_num);
    let rels_xml = match archive.read_file(&rels_path) {
        Ok(xml) => xml,
        Err(_) => return (all_slicers, all_anchors),
    };

    let slicer_targets = ph_extract_rel_targets_by_type(&rels_xml, REL_SLICER);

    // Step 2: Parse each slicer part
    for target in &slicer_targets {
        let full_path = ph_resolve_relative_path("xl/worksheets", target);
        if let Ok(slicer_xml) = archive.read_file(&full_path) {
            let mut parsed = parse_slicer_part(&slicer_xml);
            all_slicers.append(&mut parsed);
        }
    }

    // Step 3: Extract slicer anchors from drawing XML
    let drawing_target = ph_extract_drawing_target(&rels_xml);
    if let Some(drawing_target) = drawing_target {
        let drawing_path = ph_resolve_relative_path("xl/worksheets", &drawing_target);
        if let Ok(drawing_xml) = archive.read_file(&drawing_path) {
            let mut anchors = parse_slicer_anchors_from_drawing(&drawing_xml);
            all_anchors.append(&mut anchors);
        }
    }

    (all_slicers, all_anchors)
}

/// Parse all slicer cache definitions from the workbook.
///
/// Reads workbook .rels to find slicer cache targets (via REL_SLICER_CACHE type),
/// then parses each slicer cache XML file.
pub fn parse_all_slicer_caches(archive: &crate::zip::XlsxArchive) -> Vec<SlicerCacheDef> {
    let mut caches = Vec::new();

    // Read workbook .rels
    let rels_path = "xl/_rels/workbook.xml.rels";
    let rels_xml = match archive.read_file(rels_path) {
        Ok(xml) => xml,
        Err(_) => return caches,
    };

    let cache_targets = ph_extract_rel_targets_by_type(&rels_xml, REL_SLICER_CACHE);

    for target in &cache_targets {
        let full_path = ph_resolve_relative_path("xl", target);
        if let Ok(cache_xml) = archive.read_file(&full_path) {
            if let Some(cache) = parse_slicer_cache(&cache_xml) {
                caches.push(cache);
            }
        }
    }

    caches
}

/// Build a mapping from relationship Id (e.g. "rId3") to Target path from a .rels XML.
pub fn build_rel_id_map(rels_xml: &[u8]) -> std::collections::HashMap<String, String> {
    use crate::infra::scanner::extract_quoted_value;
    let mut map = std::collections::HashMap::new();
    let mut pos = 0;

    while let Some(rel_start) = find_tag_simd(rels_xml, b"Relationship", pos) {
        let rel_end = find_gt_simd(rels_xml, rel_start)
            .map(|p| p + 1)
            .unwrap_or(rels_xml.len());
        let rel_elem = &rels_xml[rel_start..rel_end];

        // Extract Id attribute
        if let Some(id_pos) = find_attr_simd(rel_elem, b"Id=\"", 0) {
            if let Some((is, ie)) = extract_quoted_value(rel_elem, id_pos + 4) {
                if let Ok(id) = std::str::from_utf8(&rel_elem[is..ie]) {
                    // Extract Target attribute
                    if let Some(target_pos) = find_attr_simd(rel_elem, b"Target=\"", 0) {
                        if let Some((ts, te)) = extract_quoted_value(rel_elem, target_pos + 8) {
                            if let Ok(target) = std::str::from_utf8(&rel_elem[ts..te]) {
                                map.insert(id.to_string(), target.to_string());
                            }
                        }
                    }
                }
            }
        }

        pos = rel_end;
    }

    map
}

// Private helpers (mirrors of parse_helpers.rs private fns, prefixed to avoid conflicts)

fn ph_extract_drawing_target(rels_xml: &[u8]) -> Option<String> {
    use crate::infra::scanner::extract_quoted_value;
    let mut pos = 0;
    while let Some(rel_start) = find_tag_simd(rels_xml, b"Relationship", pos) {
        let rel_end = find_gt_simd(rels_xml, rel_start)
            .map(|p| p + 1)
            .unwrap_or(rels_xml.len());
        let rel_elem = &rels_xml[rel_start..rel_end];

        if let Some(type_pos) = find_attr_simd(rel_elem, b"Type=\"", 0) {
            let value_start = type_pos + 6;
            if let Some((ts, te)) = extract_quoted_value(rel_elem, value_start) {
                let type_str = &rel_elem[ts..te];
                if memchr::memmem::find(type_str, b"drawing").is_some() {
                    if let Some(target_pos) = find_attr_simd(rel_elem, b"Target=\"", 0) {
                        let tgt_start = target_pos + 8;
                        if let Some((tgs, tge)) = extract_quoted_value(rel_elem, tgt_start) {
                            if let Ok(target) = std::str::from_utf8(&rel_elem[tgs..tge]) {
                                return Some(target.to_string());
                            }
                        }
                    }
                }
            }
        }
        pos = rel_end;
    }
    None
}

fn ph_extract_rel_targets_by_type(rels_xml: &[u8], rel_type: &str) -> Vec<String> {
    use crate::infra::scanner::extract_quoted_value;
    let mut targets = Vec::new();
    let rel_type_bytes = rel_type.as_bytes();
    let mut pos = 0;

    while let Some(rel_start) = find_tag_simd(rels_xml, b"Relationship", pos) {
        let rel_end = find_gt_simd(rels_xml, rel_start)
            .map(|p| p + 1)
            .unwrap_or(rels_xml.len());
        let rel_elem = &rels_xml[rel_start..rel_end];

        if let Some(type_pos) = find_attr_simd(rel_elem, b"Type=\"", 0) {
            if let Some((ts, te)) = extract_quoted_value(rel_elem, type_pos + 6) {
                if &rel_elem[ts..te] == rel_type_bytes {
                    if let Some(target_pos) = find_attr_simd(rel_elem, b"Target=\"", 0) {
                        if let Some((tgs, tge)) = extract_quoted_value(rel_elem, target_pos + 8) {
                            if let Ok(target) = std::str::from_utf8(&rel_elem[tgs..tge]) {
                                targets.push(target.to_string());
                            }
                        }
                    }
                }
            }
        }

        pos = rel_end;
    }

    targets
}

fn ph_resolve_relative_path(base_dir: &str, relative: &str) -> String {
    if !relative.starts_with("..") {
        if let Some(stripped) = relative.strip_prefix('/') {
            return stripped.to_string();
        }
        return format!("{}/{}", base_dir, relative);
    }

    let mut parts: Vec<&str> = base_dir.split('/').collect();
    for segment in relative.split('/') {
        if segment == ".." {
            parts.pop();
        } else {
            parts.push(segment);
        }
    }
    parts.join("/")
}

// ============================================================================
// Unit Tests
// ============================================================================

#[cfg(test)]
mod tests {
    use super::*;

    // -------------------------------------------------------------------------
    // SlicerDef parsing tests
    // -------------------------------------------------------------------------

    #[test]
    fn test_parse_single_table_slicer() {
        let xml = br#"<?xml version="1.0" encoding="UTF-8"?>
<x14:slicers xmlns:x14="http://schemas.microsoft.com/office/spreadsheetml/2009/9/main">
  <x14:slicer name="Slicer_Region" cache="Slicer_Region" caption="Region" columnCount="2" showCaption="1" style="SlicerStyleLight1" rowHeight="241300"/>
</x14:slicers>"#;

        let slicers = parse_slicer_part(xml);
        assert_eq!(slicers.len(), 1);

        let s = &slicers[0];
        assert_eq!(s.name, "Slicer_Region");
        assert_eq!(s.cache, "Slicer_Region");
        assert_eq!(s.caption.as_deref(), Some("Region"));
        assert_eq!(s.column_count, 2);
        assert!(s.show_caption);
        assert_eq!(s.style.as_deref(), Some("SlicerStyleLight1"));
        assert_eq!(s.row_height, Some(241300));
        assert_eq!(s.level, 0);
        assert!(!s.locked_position);
    }

    #[test]
    fn test_parse_multiple_slicers_in_one_part() {
        let xml = br#"<?xml version="1.0" encoding="UTF-8"?>
<x14:slicers xmlns:x14="http://schemas.microsoft.com/office/spreadsheetml/2009/9/main">
  <x14:slicer name="Slicer_Region" cache="Slicer_Region" caption="Region"/>
  <x14:slicer name="Slicer_Category" cache="Slicer_Category" caption="Category" columnCount="3" showCaption="0" lockedPosition="1"/>
  <x14:slicer name="Slicer_Year" cache="Slicer_Year" level="2"/>
</x14:slicers>"#;

        let slicers = parse_slicer_part(xml);
        assert_eq!(slicers.len(), 3);

        assert_eq!(slicers[0].name, "Slicer_Region");
        assert_eq!(slicers[0].column_count, 1); // default
        assert!(slicers[0].show_caption); // default

        assert_eq!(slicers[1].name, "Slicer_Category");
        assert_eq!(slicers[1].column_count, 3);
        assert!(!slicers[1].show_caption);
        assert!(slicers[1].locked_position);

        assert_eq!(slicers[2].name, "Slicer_Year");
        assert_eq!(slicers[2].level, 2);
    }

    #[test]
    fn test_parse_slicer_default_values() {
        let xml = br#"<x14:slicers xmlns:x14="http://schemas.microsoft.com/office/spreadsheetml/2009/9/main">
  <x14:slicer name="S1" cache="SC1"/>
</x14:slicers>"#;

        let slicers = parse_slicer_part(xml);
        assert_eq!(slicers.len(), 1);

        let s = &slicers[0];
        assert_eq!(s.column_count, 1);
        assert!(s.show_caption);
        assert_eq!(s.level, 0);
        assert!(!s.locked_position);
        assert!(s.caption.is_none());
        assert!(s.start_item.is_none());
        assert!(s.style.is_none());
        assert!(s.row_height.is_none());
    }

    // -------------------------------------------------------------------------
    // SlicerCacheDef parsing tests
    // -------------------------------------------------------------------------

    #[test]
    fn test_parse_cache_with_table_slicer_cache() {
        let xml = br#"<?xml version="1.0" encoding="UTF-8"?>
<x14:slicerCacheDefinition xmlns:x14="http://schemas.microsoft.com/office/spreadsheetml/2009/9/main"
    name="Slicer_Region" sourceName="Region">
  <extLst>
    <ext uri="{2F2917AC-EB37-4324-AD4E-5DD8C200BD13}">
      <x15:tableSlicerCache tableId="1" column="3" sortOrder="ascending" customListSort="0" crossFilter="showItemsWithDataAtTop"/>
    </ext>
  </extLst>
</x14:slicerCacheDefinition>"#;

        let cache = parse_slicer_cache(xml).unwrap();
        assert_eq!(cache.name, "Slicer_Region");
        assert_eq!(cache.source_name, "Region");
        assert!(cache.pivot_tables.is_empty());
        assert!(cache.tabular_data.is_none());

        let tsc = cache.table_slicer_cache.unwrap();
        assert_eq!(tsc.table_id, 1);
        assert_eq!(tsc.column, 3);
        assert_eq!(tsc.sort_order, SlicerSortOrder::Ascending);
        assert!(!tsc.custom_list_sort);
        assert_eq!(tsc.cross_filter, SlicerCrossFilter::ShowItemsWithDataAtTop);
    }

    #[test]
    fn test_parse_cache_with_tabular_data_and_items() {
        let xml = br#"<?xml version="1.0" encoding="UTF-8"?>
<x14:slicerCacheDefinition xmlns:x14="http://schemas.microsoft.com/office/spreadsheetml/2009/9/main"
    name="Slicer_City" sourceName="City">
  <x14:pivotTables>
    <x14:pivotTable tabId="0" name="PivotTable1"/>
  </x14:pivotTables>
  <x14:data>
    <x14:tabular pivotCacheId="5" sortOrder="descending" showMissing="1" crossFilter="none">
      <x14:items count="4">
        <x14:i x="0"/>
        <x14:i x="1" s="1"/>
        <x14:i x="2" s="0" nd="1"/>
        <x14:i x="3"/>
      </x14:items>
    </x14:tabular>
  </x14:data>
</x14:slicerCacheDefinition>"#;

        let cache = parse_slicer_cache(xml).unwrap();
        assert_eq!(cache.name, "Slicer_City");
        assert_eq!(cache.source_name, "City");

        assert_eq!(cache.pivot_tables.len(), 1);
        assert_eq!(cache.pivot_tables[0].tab_id, 0);
        assert_eq!(cache.pivot_tables[0].name, "PivotTable1");

        let tabular = cache.tabular_data.unwrap();
        assert_eq!(tabular.pivot_cache_id, 5);
        assert_eq!(tabular.sort_order, SlicerSortOrder::Descending);
        assert!(tabular.show_missing);
        assert_eq!(tabular.cross_filter, SlicerCrossFilter::None);

        assert_eq!(tabular.items.len(), 4);
        // Verify s defaults to false
        assert_eq!(tabular.items[0].x, 0);
        assert!(!tabular.items[0].s);
        assert!(!tabular.items[0].nd);

        assert_eq!(tabular.items[1].x, 1);
        assert!(tabular.items[1].s);
        assert!(!tabular.items[1].nd);

        assert_eq!(tabular.items[2].x, 2);
        assert!(!tabular.items[2].s);
        assert!(tabular.items[2].nd);

        assert_eq!(tabular.items[3].x, 3);
        assert!(!tabular.items[3].s);
        assert!(!tabular.items[3].nd);
    }

    // -------------------------------------------------------------------------
    // Enum parsing tests
    // -------------------------------------------------------------------------

    #[test]
    fn test_sort_order_default() {
        assert_eq!(SlicerSortOrder::default(), SlicerSortOrder::Ascending);
    }

    #[test]
    fn test_cross_filter_default() {
        assert_eq!(
            SlicerCrossFilter::default(),
            SlicerCrossFilter::ShowItemsWithDataAtTop
        );
    }

    #[test]
    fn test_parse_sort_order_values() {
        assert_eq!(
            parse_sort_order_attr(b"sortOrder=\"ascending\"", b"sortOrder=\""),
            SlicerSortOrder::Ascending
        );
        assert_eq!(
            parse_sort_order_attr(b"sortOrder=\"descending\"", b"sortOrder=\""),
            SlicerSortOrder::Descending
        );
        assert_eq!(
            parse_sort_order_attr(b"sortOrder=\"Descending\"", b"sortOrder=\""),
            SlicerSortOrder::Descending
        );
        // Missing attribute -> default
        assert_eq!(
            parse_sort_order_attr(b"other=\"value\"", b"sortOrder=\""),
            SlicerSortOrder::Ascending
        );
    }

    #[test]
    fn test_parse_cross_filter_values() {
        assert_eq!(
            parse_cross_filter_attr(b"crossFilter=\"none\"", b"crossFilter=\""),
            SlicerCrossFilter::None
        );
        assert_eq!(
            parse_cross_filter_attr(b"crossFilter=\"showItemsWithDataAtTop\"", b"crossFilter=\""),
            SlicerCrossFilter::ShowItemsWithDataAtTop
        );
        assert_eq!(
            parse_cross_filter_attr(b"crossFilter=\"showItemsWithNoData\"", b"crossFilter=\""),
            SlicerCrossFilter::ShowItemsWithNoData
        );
        // Missing attribute -> default
        assert_eq!(
            parse_cross_filter_attr(b"other=\"value\"", b"crossFilter=\""),
            SlicerCrossFilter::ShowItemsWithDataAtTop
        );
    }

    // -------------------------------------------------------------------------
    // Slicer anchor parsing tests
    // -------------------------------------------------------------------------

    #[test]
    fn test_parse_slicer_anchor_from_drawing() {
        let drawing_xml = br#"<?xml version="1.0" encoding="UTF-8"?>
<xdr:wsDr xmlns:xdr="http://schemas.openxmlformats.org/drawingml/2006/spreadsheetDrawing"
          xmlns:mc="http://schemas.openxmlformats.org/markup-compatibility/2006"
          xmlns:a14="http://schemas.microsoft.com/office/drawing/2010/main"
          xmlns:sle="http://schemas.microsoft.com/office/drawing/2010/slicer">
  <xdr:twoCellAnchor>
    <xdr:from>
      <xdr:col>5</xdr:col>
      <xdr:colOff>0</xdr:colOff>
      <xdr:row>1</xdr:row>
      <xdr:rowOff>12700</xdr:rowOff>
    </xdr:from>
    <xdr:to>
      <xdr:col>8</xdr:col>
      <xdr:colOff>304800</xdr:colOff>
      <xdr:row>15</xdr:row>
      <xdr:rowOff>0</xdr:rowOff>
    </xdr:to>
    <mc:AlternateContent>
      <mc:Choice Requires="a14">
        <xdr:graphicFrame>
          <xdr:nvGraphicFramePr>
            <xdr:cNvPr id="2" name="Region"/>
          </xdr:nvGraphicFramePr>
          <a:graphic>
            <a:graphicData uri="http://schemas.microsoft.com/office/drawing/2010/slicer">
              <sle:slicer name="Slicer_Region"/>
            </a:graphicData>
          </a:graphic>
        </xdr:graphicFrame>
      </mc:Choice>
    </mc:AlternateContent>
  </xdr:twoCellAnchor>
</xdr:wsDr>"#;

        let anchors = parse_slicer_anchors_from_drawing(drawing_xml);
        assert_eq!(anchors.len(), 1);

        let a = &anchors[0];
        assert_eq!(a.slicer_name, "Slicer_Region");
        assert_eq!(a.from.col, 5);
        assert_eq!(a.from.col_off, 0);
        assert_eq!(a.from.row, 1);
        assert_eq!(a.from.row_off, 12700);
        assert_eq!(a.to.col, 8);
        assert_eq!(a.to.col_off, 304800);
        assert_eq!(a.to.row, 15);
        assert_eq!(a.to.row_off, 0);
    }

    #[test]
    fn test_parse_cache_with_uid() {
        let xml = br#"<?xml version="1.0" encoding="UTF-8"?>
<x14:slicerCacheDefinition xmlns:x14="http://schemas.microsoft.com/office/spreadsheetml/2009/9/main"
    xmlns:xr10="http://schemas.microsoft.com/office/spreadsheetml/2024/richdata2"
    name="Slicer_Region" xr10:uid="{12345678-1234-1234-1234-123456789ABC}" sourceName="Region">
</x14:slicerCacheDefinition>"#;

        let cache = parse_slicer_cache(xml).unwrap();
        assert_eq!(cache.name, "Slicer_Region");
        assert_eq!(
            cache.uid.as_deref(),
            Some("{12345678-1234-1234-1234-123456789ABC}")
        );
        assert_eq!(cache.source_name, "Region");
    }

    #[test]
    fn test_parse_empty_slicer_part() {
        let xml = br#"<?xml version="1.0" encoding="UTF-8"?>
<x14:slicers xmlns:x14="http://schemas.microsoft.com/office/spreadsheetml/2009/9/main">
</x14:slicers>"#;

        let slicers = parse_slicer_part(xml);
        assert!(slicers.is_empty());
    }

    #[test]
    fn test_parse_malformed_slicer_skipped() {
        // Missing required 'name' attribute — should be skipped
        let xml = br#"<x14:slicers xmlns:x14="http://schemas.microsoft.com/office/spreadsheetml/2009/9/main">
  <x14:slicer cache="SC1"/>
  <x14:slicer name="Good" cache="SC2"/>
</x14:slicers>"#;

        let slicers = parse_slicer_part(xml);
        assert_eq!(slicers.len(), 1);
        assert_eq!(slicers[0].name, "Good");
    }

    #[test]
    fn test_parse_cache_returns_none_for_empty() {
        let xml = b"<root></root>";
        assert!(parse_slicer_cache(xml).is_none());
    }
}
