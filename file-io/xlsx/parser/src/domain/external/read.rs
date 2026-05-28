//! External links parser for XLSX files
//!
//! This module parses external workbook references, DDE links, and OLE links
//! from externalLink*.xml files in XLSX archives.
//!
//! # XLSX External Links Structure
//!
//! External links are stored in `xl/externalLinks/externalLink*.xml` files.
//! Each file can contain:
//! - External workbook references with cached sheet names and values
//! - DDE (Dynamic Data Exchange) links for legacy integration
//! - OLE (Object Linking and Embedding) links for embedded objects
//!
//! ## Example: External Workbook Reference
//! ```xml
//! <externalLink xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">
//!   <externalBook xmlns:r="..." r:id="rId1">
//!     <sheetNames>
//!       <sheetName val="Sheet1"/>
//!       <sheetName val="Data"/>
//!     </sheetNames>
//!     <definedNames>
//!       <definedName name="MyRange" refersTo="Sheet1!$A$1:$B$10"/>
//!     </definedNames>
//!     <sheetDataSet>
//!       <sheetData sheetId="0">
//!         <row r="1">
//!           <cell r="A1"><v>100</v></cell>
//!         </row>
//!       </sheetData>
//!     </sheetDataSet>
//!   </externalBook>
//! </externalLink>
//! ```
//!
//! ## Example: DDE Link
//! ```xml
//! <externalLink>
//!   <ddeLink ddeService="Excel" ddeTopic="[Book1.xlsx]Sheet1">
//!     <ddeItems>
//!       <ddeItem name="R1C1" advise="1"/>
//!     </ddeItems>
//!   </ddeLink>
//! </externalLink>
//! ```

use crate::infra::scanner::{
    StartTagEnd, find_closing_tag, find_gt_simd, find_start_tag_end_quoted, find_tag_simd,
};
use crate::infra::xml::{parse_string_attr_quoted, parse_u32_attr};

use domain_types::domain::external_link::{
    CachedValue, DdeItem, DdeValue, DdeValueType, ExternalCacheValue, ExternalDefinedName,
    ExternalLink, ExternalLinkType, OleItem,
};

#[cfg(test)]
use crate::infra::xml::decode_xml_entities;

/// External links collection parsed from all externalLink files
#[derive(Debug, Default)]
pub struct ExternalLinks {
    /// All external links in the workbook
    pub links: Vec<ExternalLink>,
}

impl ExternalLinks {
    /// Create a new empty collection
    pub fn new() -> Self {
        Self { links: Vec::new() }
    }

    /// Parse an externalLink*.xml file
    ///
    /// # Arguments
    /// * `xml` - Raw bytes of the externalLink XML file
    /// * `link_id` - Identifier for this link (e.g., "1" from externalLink1.xml)
    ///
    /// # Returns
    /// Parsed ExternalLink, or None if parsing fails
    pub fn parse_external_link(xml: &[u8], link_id: &str) -> Option<ExternalLink> {
        // Extract mc:Ignorable from root <externalLink> element for round-trip fidelity
        let mc_ignorable = extract_mc_ignorable(xml);
        let ext_lst_xml = extract_ext_lst_xml(xml);

        // Check for externalBook (workbook reference)
        if let Some(book_start) = find_tag_simd(xml, b"externalBook", 0) {
            let mut link = parse_external_book(xml, book_start, link_id);
            link.mc_ignorable = mc_ignorable;
            link.ext_lst_xml = ext_lst_xml;
            return Some(link);
        }

        // Check for ddeLink (DDE link)
        if let Some(dde_start) = find_tag_simd(xml, b"ddeLink", 0) {
            let mut link = parse_dde_link(xml, dde_start, link_id);
            link.mc_ignorable = mc_ignorable;
            link.ext_lst_xml = ext_lst_xml;
            return Some(link);
        }

        // Check for oleLink (OLE link)
        if let Some(ole_start) = find_tag_simd(xml, b"oleLink", 0) {
            let mut link = parse_ole_link(xml, ole_start, link_id);
            link.mc_ignorable = mc_ignorable;
            link.ext_lst_xml = ext_lst_xml;
            return Some(link);
        }

        None
    }

    /// Add an external link to the collection
    pub fn add_link(&mut self, link: ExternalLink) {
        self.links.push(link);
    }

    /// Get an external link by ID
    pub fn get_link(&self, id: &str) -> Option<&ExternalLink> {
        self.links.iter().find(|link| link.id == id)
    }

    /// Get the number of external links
    pub fn len(&self) -> usize {
        self.links.len()
    }

    /// Check if there are no external links
    pub fn is_empty(&self) -> bool {
        self.links.is_empty()
    }

    /// Resolve the file path and alternate URL for an external link
    /// from its rels XML (xl/externalLinks/_rels/externalLinkN.xml.rels).
    ///
    /// The rels file contains `<Relationship>` entries with type
    /// `externalLinkPath` pointing to external URLs (TargetMode="External").
    /// The externalBook element references one rId, and the alternateUrls
    /// extension may reference another.
    pub fn resolve_rels(link: &mut ExternalLink, rels_xml: &[u8], book_xml: &[u8]) {
        // Parse the r:id from the externalBook element
        let primary_r_id = external_book_rid(book_xml);

        // Parse the driveId and itemId attributes from xxl21:alternateUrls element
        if let Some(alt_urls_start) = find_tag_simd(book_xml, b"alternateUrls", 0) {
            let (el, _) = start_tag_element(book_xml, alt_urls_start, book_xml.len());
            link.alternate_urls_drive_id = parse_string_attr_quoted(el, b"driveId");
            link.alternate_urls_item_id = parse_string_attr_quoted(el, b"itemId");
        }

        // Parse the r:id from xxl21:absoluteUrl (alternate URL extension)
        let alt_r_id = if let Some(alt_start) = find_tag_simd(book_xml, b"absoluteUrl", 0) {
            let (el, _) = start_tag_element(book_xml, alt_start, book_xml.len());
            parse_string_attr_quoted(el, b"r:id")
        } else {
            None
        };

        // Parse the r:id from xxl21:relativeUrl (relative URL extension)
        let rel_r_id = if let Some(rel_start) = find_tag_simd(book_xml, b"relativeUrl", 0) {
            let (el, _) = start_tag_element(book_xml, rel_start, book_xml.len());
            parse_string_attr_quoted(el, b"r:id")
        } else {
            None
        };

        // Parse all relationships from the rels file, preserving order
        let mut pos = 0;
        let mut rels_order = Vec::new();
        while pos < rels_xml.len() {
            let rel_start = match find_tag_simd(rels_xml, b"Relationship", pos) {
                Some(p) => p,
                None => break,
            };
            let rel_end = start_tag_end_for_attrs(rels_xml, rel_start, rels_xml.len());
            let el = &rels_xml[rel_start..rel_end];

            let id = parse_string_attr_quoted(el, b"Id");
            let target = parse_string_attr_quoted(el, b"Target");
            let rel_type = parse_string_attr_quoted(el, b"Type");

            if let (Some(id), Some(target)) = (id, target) {
                rels_order.push(id.clone());
                if primary_r_id.as_deref() == Some(&id) {
                    link.file_path = Some(target);
                    link.file_path_rid = Some(id.clone());
                    // Preserve non-default relationship types (e.g., xlPathMissing)
                    if let Some(ref rt) = rel_type {
                        if rt != crate::infra::opc::REL_EXTERNAL_LINK_PATH {
                            link.file_path_rel_type = Some(rt.clone());
                        }
                    }
                } else if alt_r_id.as_deref() == Some(&id) {
                    link.alternate_url = Some(target);
                    link.alternate_url_rid = Some(id.clone());
                } else if rel_r_id.as_deref() == Some(&id) {
                    link.relative_url = Some(target);
                    link.relative_url_rid = Some(id.clone());
                } else {
                    // Preserve unmatched relationships (e.g., externalLinkLongPath)
                    use domain_types::domain::external_link::ExternalLinkExtraRel;
                    link.extra_rels.push(ExternalLinkExtraRel {
                        id: id.clone(),
                        target,
                        rel_type: rel_type.unwrap_or_default(),
                    });
                }
            }

            pos = rel_end;
        }

        // Store original rels order if it differs from default (rId1, rId2)
        if rels_order.len() >= 2 && rels_order[0] != "rId1" {
            link.rels_id_order = Some(rels_order);
        }
    }
}

/// Return the r:id from `<externalBook>`, if this external link is a workbook link.
pub fn external_book_rid(book_xml: &[u8]) -> Option<String> {
    let book_start = find_tag_simd(book_xml, b"externalBook", 0)?;
    let book_el_end = start_tag_end_for_attrs(book_xml, book_start, book_xml.len());
    let el = &book_xml[book_start..book_el_end];
    parse_string_attr_quoted(el, b"r:id")
}

/// Extract `mc:Ignorable` value from the root `<externalLink>` element.
fn extract_mc_ignorable(xml: &[u8]) -> Option<String> {
    // Find the <externalLink opening tag (skip XML declaration)
    let el_start = memchr::memmem::find(xml, b"<externalLink")?;
    let (element, _) = start_tag_element(xml, el_start, xml.len());
    parse_string_attr_quoted(element, b"mc:Ignorable")
}

fn extract_ext_lst_xml(xml: &[u8]) -> Option<String> {
    let start = find_tag_simd(xml, b"extLst", 0)?;
    let end = find_closing_tag(xml, b"extLst", start)?;
    let closing_end = find_gt_simd(xml, end)?.saturating_add(1);
    Some(String::from_utf8_lossy(&xml[start..closing_end]).into_owned())
}

fn start_tag_end_for_attrs(xml: &[u8], start: usize, limit: usize) -> usize {
    let limit = limit.min(xml.len());
    let end = match find_start_tag_end_quoted(xml, start) {
        StartTagEnd::Found(pos) => pos.saturating_add(1),
        StartTagEnd::UnterminatedQuote {
            fallback_gt: Some(pos),
            ..
        } => pos.saturating_add(1),
        StartTagEnd::UnterminatedQuote {
            fallback_gt: None, ..
        }
        | StartTagEnd::Missing => limit,
    };

    end.min(limit)
}

fn start_tag_element(xml: &[u8], start: usize, limit: usize) -> (&[u8], usize) {
    let end = start_tag_end_for_attrs(xml, start, limit);
    (&xml[start..end], end)
}

/// Parse an external workbook reference
fn parse_external_book(xml: &[u8], start: usize, link_id: &str) -> ExternalLink {
    let mut link = ExternalLink::new(link_id.to_string());
    link.link_type = ExternalLinkType::Workbook;

    // Find the end of externalBook element
    let book_end = find_closing_tag(xml, b"externalBook", start).unwrap_or(xml.len());

    // Parse sheetNames
    if let Some(names_start) = find_tag_simd(xml, b"sheetNames", start) {
        if names_start < book_end {
            let names_end = find_closing_tag(xml, b"sheetNames", names_start).unwrap_or(book_end);
            parse_sheet_names(xml, names_start, names_end, &mut link.sheet_names);
        }
    }

    // Parse definedNames
    if let Some(def_start) = find_tag_simd(xml, b"definedNames", start) {
        if def_start < book_end {
            let def_end = find_closing_tag(xml, b"definedNames", def_start).unwrap_or(book_end);
            parse_defined_names(xml, def_start, def_end, &mut link.defined_names);
        }
    }

    // Parse sheetDataSet (cached values)
    if let Some(data_start) = find_tag_simd(xml, b"sheetDataSet", start) {
        if data_start < book_end {
            let data_end = find_closing_tag(xml, b"sheetDataSet", data_start).unwrap_or(book_end);
            parse_sheet_data_set(
                xml,
                data_start,
                data_end,
                &mut link.cache_values,
                &mut link.sheet_data_ids,
                &mut link.refresh_error_sheet_ids,
            );
        }
    }

    link
}

/// Parse sheet names from <sheetNames> element
fn parse_sheet_names(xml: &[u8], start: usize, end: usize, names: &mut Vec<String>) {
    let mut pos = start;

    while pos < end {
        // Find next <sheetName element
        let name_pos = match find_tag_simd(xml, b"sheetName", pos) {
            Some(p) if p < end => p,
            _ => break,
        };

        let (element, element_end) = start_tag_element(xml, name_pos, end);

        // Extract val attribute
        if let Some(val) = parse_string_attr_quoted(element, b"val") {
            names.push(val);
        }

        pos = element_end;
    }
}

/// Parse defined names from <definedNames> element
fn parse_defined_names(xml: &[u8], start: usize, end: usize, names: &mut Vec<ExternalDefinedName>) {
    let mut pos = start;

    while pos < end {
        // Find next <definedName element
        let def_pos = match find_tag_simd(xml, b"definedName", pos) {
            Some(p) if p < end => p,
            _ => break,
        };

        let (element, element_end) = start_tag_element(xml, def_pos, end);

        // Extract name attribute
        if let Some(name) = parse_string_attr_quoted(element, b"name") {
            let refers_to = parse_string_attr_quoted(element, b"refersTo");
            let sheet_id = parse_u32_attr(element, b"sheetId=\"");

            names.push(ExternalDefinedName::with_details(name, refers_to, sheet_id));
        }

        pos = element_end;
    }
}

/// Parse cached sheet data from <sheetDataSet> element
fn parse_sheet_data_set(
    xml: &[u8],
    start: usize,
    end: usize,
    values: &mut Vec<ExternalCacheValue>,
    sheet_data_ids: &mut Vec<u32>,
    refresh_error_ids: &mut Vec<u32>,
) {
    let mut pos = start;

    while pos < end {
        // Find next <sheetData element
        let sheet_pos = match find_tag_simd(xml, b"sheetData", pos) {
            Some(p) if p < end => p,
            _ => break,
        };

        // Find sheetData end — could be self-closing or have a closing tag
        let (element, element_end) = start_tag_element(xml, sheet_pos, end);

        // Check if self-closing (e.g., <sheetData sheetId="0"/>)
        let is_self_closing = element.last() == Some(&b'/') || element.ends_with(b"/>");
        let sheet_end = if is_self_closing {
            element_end
        } else {
            find_closing_tag(xml, b"sheetData", sheet_pos).unwrap_or(end)
        };

        // Get sheet ID
        let sheet_id = parse_u32_attr(element, b"sheetId=\"").unwrap_or(0);
        sheet_data_ids.push(sheet_id);

        // Check for refreshError attribute
        if element.windows(13).any(|w| w == b"refreshError=") {
            refresh_error_ids.push(sheet_id);
        }

        // Parse cells within this sheet data (only if not self-closing)
        if !is_self_closing {
            parse_sheet_cells(xml, element_end, sheet_end, sheet_id, values);
        }

        // For self-closing, sheet_end == element_end which is already past '>'.
        // For closing-tag, sheet_end is at the start of '</sheetData>'.
        // In both cases, advance past the end to avoid re-matching.
        pos = if is_self_closing {
            sheet_end
        } else {
            sheet_end + 1
        };
    }
}

/// Parse cells within a <sheetData> element.
/// Handles both `<row r="N"><cell .../></row>` and bare `<cell .../>` layouts.
fn parse_sheet_cells(
    xml: &[u8],
    start: usize,
    end: usize,
    sheet_id: u32,
    values: &mut Vec<ExternalCacheValue>,
) {
    let mut pos = start;
    let mut current_row: Option<u32> = None;

    while pos < end {
        // Look for either <row or <cell — whichever comes first
        let row_pos = find_tag_simd(xml, b"row", pos).filter(|&p| p < end);
        let cell_pos = find_tag_simd(xml, b"cell", pos).filter(|&p| p < end);

        match (row_pos, cell_pos) {
            // <row> comes before <cell> — enter a row context
            (Some(rp), Some(cp)) if rp < cp => {
                let (row_el, row_el_end) = start_tag_element(xml, rp, end);
                current_row = parse_u32_attr(row_el, b"r=\"");

                // Check if self-closing row (unlikely but possible)
                if row_el.ends_with(b"/>") {
                    pos = row_el_end;
                    current_row = None;
                } else {
                    pos = row_el_end;
                }
            }
            // <cell> found (either no <row> or <cell> comes first)
            (_, Some(cp)) => {
                // Find element end for attributes
                let (element, element_end) = start_tag_element(xml, cp, end);

                // Detect self-closing <cell .../> — if so, cell_end = element_end
                let is_self_closing_cell =
                    element_end > 1 && xml.get(element_end - 2) == Some(&b'/');
                // For self-closing, cell_end = element_end - 1 so that pos = cell_end + 1 = element_end
                let cell_end = if is_self_closing_cell {
                    element_end.saturating_sub(1)
                } else {
                    find_closing_tag(xml, b"cell", cp)
                        .or_else(|| {
                            find_tag_simd(xml, b"cell", cp + 5).map(|p| p.saturating_sub(1))
                        })
                        .unwrap_or(end)
                };

                // Get cell reference
                if let Some(cell_ref) = parse_string_attr_quoted(element, b"r") {
                    // Get cell type
                    let cell_type = parse_string_attr_quoted(element, b"t");

                    // Find value
                    let (value, raw_value, has_preserve_space) = if let Some(v_start) =
                        find_tag_simd(xml, b"v", element_end)
                    {
                        if v_start < cell_end {
                            let v_gt = find_gt_simd(xml, v_start).unwrap_or(cell_end);
                            // Detect self-closing <v/> — byte before '>' is '/'
                            let is_self_closing = v_gt > 0 && xml.get(v_gt - 1) == Some(&b'/');
                            if is_self_closing {
                                // Self-closing <v/> with t="str" means empty string, not truly empty
                                let val = if cell_type.as_deref() == Some("str") {
                                    CachedValue::String(String::new())
                                } else {
                                    CachedValue::Empty
                                };
                                (val, None, false)
                            } else {
                                let v_end =
                                    find_closing_tag(xml, b"v", v_start).unwrap_or(cell_end);
                                let v_content_start = v_gt + 1;
                                // Check if <v> tag has xml:space="preserve"
                                let v_tag = &xml[v_start..v_content_start];
                                let has_space_preserve =
                                    v_tag.windows(9).any(|w| w == b"xml:space");
                                let content = &xml[v_content_start..v_end];
                                let (val, raw) = parse_cached_value(content, cell_type.as_deref());
                                (val, raw, has_space_preserve)
                            }
                        } else {
                            (CachedValue::Empty, None, false)
                        }
                    } else {
                        (CachedValue::Empty, None, false)
                    };

                    let mut cv = ExternalCacheValue::new(sheet_id, cell_ref, value);
                    cv.row = current_row;
                    cv.raw_value = raw_value;
                    cv.preserve_space = has_preserve_space;
                    values.push(cv);
                }

                pos = cell_end + 1;
            }
            // Only <row> found, no cells — skip past it
            (Some(rp), None) => {
                let row_el_end = start_tag_end_for_attrs(xml, rp, end);
                pos = row_el_end;
            }
            // Nothing found
            (None, None) => break,
        }

        // Check if we've passed a </row> closing tag — reset row context
        if let Some(row) = current_row {
            // Look for </row> between current pos and next interesting element
            let closing = find_closing_tag(xml, b"row", pos.saturating_sub(10));
            if let Some(close_pos) = closing {
                if close_pos < pos {
                    current_row = None;
                    let _ = row; // suppress unused warning
                }
            }
        }
    }
}

/// Parse a cached value from cell content.
///
/// Returns `(CachedValue, Option<String>)` where the second element is the raw
/// numeric string for round-trip fidelity (only set for `Number` values whose
/// Rust `f64::to_string()` differs from the original text).
fn parse_cached_value(content: &[u8], cell_type: Option<&str>) -> (CachedValue, Option<String>) {
    if content.is_empty() {
        return (CachedValue::Empty, None);
    }

    // Decode XML entities (e.g., &amp; → &, &lt; → <) since the content is raw XML bytes.
    // Without this, string values containing XML entities get double-escaped on write.
    let content_str = if memchr::memchr(b'&', content).is_some() {
        std::borrow::Cow::Owned(crate::infra::xml::decode_xml_entities(content))
    } else {
        String::from_utf8_lossy(content)
    };

    match cell_type {
        Some("s") => (CachedValue::String(content_str.into_owned()), None),
        Some("str") => (CachedValue::String(content_str.into_owned()), None),
        Some("b") => {
            let val = content_str.trim();
            (
                CachedValue::Boolean(val == "1" || val.eq_ignore_ascii_case("true")),
                None,
            )
        }
        Some("e") => (CachedValue::Error(content_str.into_owned()), None),
        _ => {
            // Try to parse as number, preserving raw string for round-trip fidelity
            let trimmed = content_str.trim();
            if let Ok(num) = trimmed.parse::<f64>() {
                // Only store raw string if it differs from Rust's default formatting
                let rust_repr = if num == (num as i64) as f64 {
                    (num as i64).to_string()
                } else {
                    num.to_string()
                };
                let raw = if rust_repr != trimmed {
                    Some(trimmed.to_string())
                } else {
                    None
                };
                (CachedValue::Number(num), raw)
            } else {
                (CachedValue::String(content_str.into_owned()), None)
            }
        }
    }
}

/// Parse a DDE link
fn parse_dde_link(xml: &[u8], start: usize, link_id: &str) -> ExternalLink {
    // Find element end for attributes
    let (element, element_end) = start_tag_element(xml, start, xml.len());

    // Extract DDE service and topic
    let service = parse_string_attr_quoted(element, b"ddeService").unwrap_or_default();
    let topic = parse_string_attr_quoted(element, b"ddeTopic").unwrap_or_default();
    let link_end = find_closing_tag(xml, b"ddeLink", start).unwrap_or(xml.len());
    let items = parse_dde_items(xml, element_end, link_end);

    let mut link = ExternalLink::new(link_id.to_string());
    link.link_type = ExternalLinkType::Dde {
        service,
        topic,
        items,
    };
    link
}

/// Parse an OLE link
fn parse_ole_link(xml: &[u8], start: usize, link_id: &str) -> ExternalLink {
    // Find element end for attributes
    let (element, element_end) = start_tag_element(xml, start, xml.len());

    // Extract OLE program ID
    let prog_id = parse_string_attr_quoted(element, b"progId").unwrap_or_default();
    let r_id = parse_string_attr_quoted(element, b"r:id");
    let link_end = find_closing_tag(xml, b"oleLink", start).unwrap_or(xml.len());
    let items = parse_ole_items(xml, element_end, link_end);

    let mut link = ExternalLink::new(link_id.to_string());
    link.link_type = ExternalLinkType::Ole {
        prog_id,
        r_id,
        items,
    };
    link
}

fn parse_dde_items(xml: &[u8], start: usize, end: usize) -> Vec<DdeItem> {
    let Some(items_start) = find_tag_simd(xml, b"ddeItems", start).filter(|&p| p < end) else {
        return Vec::new();
    };
    let items_end = find_closing_tag(xml, b"ddeItems", items_start).unwrap_or(end);
    let mut items = Vec::new();
    let mut pos = items_start;
    while let Some(item_start) = find_tag_simd(xml, b"ddeItem", pos).filter(|&p| p < items_end) {
        let (element, element_end) = start_tag_element(xml, item_start, items_end);
        let item_end = if element.ends_with(b"/>") {
            element_end
        } else {
            find_closing_tag(xml, b"ddeItem", item_start).unwrap_or(items_end)
        };
        let mut item = DdeItem {
            name: parse_string_attr_quoted(element, b"name"),
            ole: parse_bool_attr_quoted(element, b"ole").unwrap_or(false),
            advise: parse_bool_attr_quoted(element, b"advise").unwrap_or(false),
            prefer_pic: parse_bool_attr_quoted(element, b"preferPic").unwrap_or(false),
            ..Default::default()
        };
        parse_dde_values(xml, element_end, item_end, &mut item);
        items.push(item);
        pos = item_end.saturating_add(1);
    }
    items
}

fn parse_dde_values(xml: &[u8], start: usize, end: usize, item: &mut DdeItem) {
    let values_start = find_tag_simd(xml, b"values", start)
        .or_else(|| find_tag_simd(xml, b"ddeValues", start))
        .filter(|&p| p < end);
    let Some(values_start) = values_start else {
        return;
    };
    let (values_el, values_el_end) = start_tag_element(xml, values_start, end);
    item.rows = parse_u32_attr(values_el, b"rows=\"");
    item.cols = parse_u32_attr(values_el, b"cols=\"");
    let values_end = find_closing_tag(xml, b"values", values_start)
        .or_else(|| find_closing_tag(xml, b"ddeValues", values_start))
        .unwrap_or(end);
    let mut pos = values_el_end;
    while let Some(value_start) = find_tag_simd(xml, b"value", pos).filter(|&p| p < values_end) {
        let (value_el, value_el_end) = start_tag_element(xml, value_start, values_end);
        let value_type = parse_dde_value_type(parse_string_attr_quoted(value_el, b"t").as_deref());
        let value = parse_string_attr_quoted(value_el, b"val").unwrap_or_else(|| {
            if value_el.ends_with(b"/>") {
                String::new()
            } else {
                let value_end = find_closing_tag(xml, b"value", value_start).unwrap_or(values_end);
                let content_start = value_el_end;
                crate::infra::xml::decode_xml_entities(&xml[content_start..value_end])
            }
        });
        item.values.push(DdeValue { value_type, value });
        pos = value_el_end;
    }
}

fn parse_ole_items(xml: &[u8], start: usize, end: usize) -> Vec<OleItem> {
    let Some(items_start) = find_tag_simd(xml, b"oleItems", start).filter(|&p| p < end) else {
        return Vec::new();
    };
    let items_end = find_closing_tag(xml, b"oleItems", items_start).unwrap_or(end);
    let mut items = Vec::new();
    let mut pos = items_start;
    while let Some(item_start) = find_tag_simd(xml, b"oleItem", pos).filter(|&p| p < items_end) {
        let (element, element_end) = start_tag_element(xml, item_start, items_end);
        if let Some(name) = parse_string_attr_quoted(element, b"name") {
            items.push(OleItem {
                name,
                icon: parse_bool_attr_quoted(element, b"icon").unwrap_or(false),
                advise: parse_bool_attr_quoted(element, b"advise").unwrap_or(false),
                prefer_pic: parse_bool_attr_quoted(element, b"preferPic").unwrap_or(false),
            });
        }
        pos = element_end;
    }
    items
}

fn parse_bool_attr_quoted(element: &[u8], name: &[u8]) -> Option<bool> {
    parse_string_attr_quoted(element, name).map(|value| {
        value == "1" || value.eq_ignore_ascii_case("true") || value.eq_ignore_ascii_case("on")
    })
}

fn parse_dde_value_type(value: Option<&str>) -> DdeValueType {
    match value {
        Some("nil") => DdeValueType::Nil,
        Some("b") => DdeValueType::Boolean,
        Some("e") => DdeValueType::Error,
        Some("str") => DdeValueType::String,
        _ => DdeValueType::Number,
    }
}

// ============================================================================
// Unit Tests
// ============================================================================

#[cfg(test)]
mod tests {
    use super::*;

    // -------------------------------------------------------------------------
    // ExternalLink construction tests
    // -------------------------------------------------------------------------

    #[test]
    fn test_external_link_new() {
        let link = ExternalLink::new("1".to_string());
        assert_eq!(link.id, "1");
        assert_eq!(link.link_type, ExternalLinkType::Workbook);
        assert!(link.file_path.is_none());
        assert!(link.sheet_names.is_empty());
        assert!(link.defined_names.is_empty());
        assert!(link.cache_values.is_empty());
    }

    #[test]
    fn test_external_link_workbook() {
        let link = ExternalLink::workbook("1".to_string(), Some("/path/to/file.xlsx".to_string()));
        assert_eq!(link.id, "1");
        assert_eq!(link.link_type, ExternalLinkType::Workbook);
        assert_eq!(link.file_path, Some("/path/to/file.xlsx".to_string()));
    }

    #[test]
    fn test_external_link_dde() {
        let link = ExternalLink::dde(
            "1".to_string(),
            "Excel".to_string(),
            "[Book1.xlsx]Sheet1".to_string(),
        );
        assert_eq!(link.id, "1");
        match &link.link_type {
            ExternalLinkType::Dde {
                service,
                topic,
                items,
            } => {
                assert_eq!(service, "Excel");
                assert_eq!(topic, "[Book1.xlsx]Sheet1");
                assert!(items.is_empty());
            }
            _ => panic!("Expected DDE link type"),
        }
    }

    #[test]
    fn test_parse_dde_link_values() {
        let xml = br#"<externalLink>
    <ddeLink ddeService="Excel" ddeTopic="[Book1.xlsx]Sheet1">
        <ddeItems>
            <ddeItem name="R1C1" ole="1" preferPic="1">
                <values rows="1" cols="2">
                    <value t="str" val="hello"/>
                    <value t="n" val="42"/>
                </values>
            </ddeItem>
        </ddeItems>
    </ddeLink>
</externalLink>"#;

        let link = ExternalLinks::parse_external_link(xml, "1").unwrap();
        match &link.link_type {
            ExternalLinkType::Dde { items, .. } => {
                assert_eq!(items.len(), 1);
                assert!(items[0].ole);
                assert!(items[0].prefer_pic);
                assert_eq!(items[0].rows, Some(1));
                assert_eq!(items[0].cols, Some(2));
                assert_eq!(items[0].values.len(), 2);
                assert_eq!(items[0].values[0].value_type, DdeValueType::String);
                assert_eq!(items[0].values[0].value, "hello");
            }
            _ => panic!("Expected DDE link type"),
        }
    }

    #[test]
    fn test_external_link_ole() {
        let link = ExternalLink::ole("1".to_string(), "Excel.Sheet.12".to_string());
        assert_eq!(link.id, "1");
        match &link.link_type {
            ExternalLinkType::Ole {
                prog_id,
                r_id,
                items,
            } => {
                assert_eq!(prog_id, "Excel.Sheet.12");
                assert!(r_id.is_none());
                assert!(items.is_empty());
            }
            _ => panic!("Expected OLE link type"),
        }
    }

    #[test]
    fn test_parse_ole_link_items() {
        let xml = br#"<externalLink>
    <oleLink progId="Excel.Sheet.12" r:id="rId1">
        <oleItems>
            <oleItem name="Sheet1" icon="1" advise="1" preferPic="1"/>
        </oleItems>
    </oleLink>
</externalLink>"#;

        let link = ExternalLinks::parse_external_link(xml, "1").unwrap();
        match &link.link_type {
            ExternalLinkType::Ole { items, .. } => {
                assert_eq!(items.len(), 1);
                assert_eq!(items[0].name, "Sheet1");
                assert!(items[0].icon);
                assert!(items[0].advise);
                assert!(items[0].prefer_pic);
            }
            _ => panic!("Expected OLE link type"),
        }
    }

    // -------------------------------------------------------------------------
    // ExternalDefinedName tests
    // -------------------------------------------------------------------------

    #[test]
    fn test_external_defined_name_new() {
        let name = ExternalDefinedName::new("MyRange".to_string());
        assert_eq!(name.name, "MyRange");
        assert!(name.refers_to.is_none());
        assert!(name.sheet_id.is_none());
    }

    #[test]
    fn test_external_defined_name_with_details() {
        let name = ExternalDefinedName::with_details(
            "MyRange".to_string(),
            Some("Sheet1!$A$1:$B$10".to_string()),
            Some(0),
        );
        assert_eq!(name.name, "MyRange");
        assert_eq!(name.refers_to, Some("Sheet1!$A$1:$B$10".to_string()));
        assert_eq!(name.sheet_id, Some(0));
    }

    // -------------------------------------------------------------------------
    // ExternalCacheValue tests
    // -------------------------------------------------------------------------

    #[test]
    fn test_external_cache_value_new() {
        let value = ExternalCacheValue::new(0, "A1".to_string(), CachedValue::Number(42.0));
        assert_eq!(value.sheet_id, 0);
        assert_eq!(value.cell_ref, "A1");
        assert_eq!(value.value, CachedValue::Number(42.0));
    }

    // -------------------------------------------------------------------------
    // CachedValue tests
    // -------------------------------------------------------------------------

    #[test]
    fn test_cached_value_default() {
        let value: CachedValue = Default::default();
        assert_eq!(value, CachedValue::Empty);
    }

    #[test]
    fn test_cached_value_variants() {
        assert_eq!(CachedValue::Number(3.14), CachedValue::Number(3.14));
        assert_eq!(
            CachedValue::String("test".to_string()),
            CachedValue::String("test".to_string())
        );
        assert_eq!(CachedValue::Boolean(true), CachedValue::Boolean(true));
        assert_eq!(
            CachedValue::Error("#REF!".to_string()),
            CachedValue::Error("#REF!".to_string())
        );
        assert_eq!(CachedValue::Empty, CachedValue::Empty);
    }

    // -------------------------------------------------------------------------
    // ExternalLinks collection tests
    // -------------------------------------------------------------------------

    #[test]
    fn test_external_links_new() {
        let links = ExternalLinks::new();
        assert!(links.is_empty());
        assert_eq!(links.len(), 0);
    }

    #[test]
    fn test_external_links_add_and_get() {
        let mut links = ExternalLinks::new();
        links.add_link(ExternalLink::new("1".to_string()));
        links.add_link(ExternalLink::new("2".to_string()));

        assert_eq!(links.len(), 2);
        assert!(!links.is_empty());

        let link1 = links.get_link("1");
        assert!(link1.is_some());
        assert_eq!(link1.unwrap().id, "1");

        let link3 = links.get_link("3");
        assert!(link3.is_none());
    }

    // -------------------------------------------------------------------------
    // parse_external_link tests - External workbook
    // -------------------------------------------------------------------------

    #[test]
    fn test_parse_external_book_basic() {
        let xml = br#"<?xml version="1.0"?>
<externalLink xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">
    <externalBook xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" r:id="rId1">
        <sheetNames>
            <sheetName val="Sheet1"/>
            <sheetName val="Data"/>
        </sheetNames>
    </externalBook>
</externalLink>"#;

        let link = ExternalLinks::parse_external_link(xml, "1").unwrap();
        assert_eq!(link.id, "1");
        assert_eq!(link.link_type, ExternalLinkType::Workbook);
        assert_eq!(link.sheet_names.len(), 2);
        assert_eq!(link.sheet_names[0], "Sheet1");
        assert_eq!(link.sheet_names[1], "Data");
    }

    #[test]
    fn test_parse_external_book_with_defined_names() {
        let xml = br#"<externalLink>
    <externalBook r:id="rId1">
        <definedNames>
            <definedName name="MyRange" refersTo="Sheet1!$A$1:$B$10"/>
            <definedName name="Total" sheetId="0" refersTo="Sheet1!$C$1"/>
        </definedNames>
    </externalBook>
</externalLink>"#;

        let link = ExternalLinks::parse_external_link(xml, "1").unwrap();
        assert_eq!(link.defined_names.len(), 2);

        assert_eq!(link.defined_names[0].name, "MyRange");
        assert_eq!(
            link.defined_names[0].refers_to,
            Some("Sheet1!$A$1:$B$10".to_string())
        );
        assert!(link.defined_names[0].sheet_id.is_none());

        assert_eq!(link.defined_names[1].name, "Total");
        assert_eq!(link.defined_names[1].sheet_id, Some(0));
    }

    #[test]
    fn test_parse_external_book_with_cached_values() {
        let xml = br#"<externalLink>
    <externalBook r:id="rId1">
        <sheetDataSet>
            <sheetData sheetId="0">
                <row r="1">
                    <cell r="A1"><v>100</v></cell>
                    <cell r="B1" t="s"><v>Hello</v></cell>
                </row>
            </sheetData>
        </sheetDataSet>
    </externalBook>
</externalLink>"#;

        let link = ExternalLinks::parse_external_link(xml, "1").unwrap();
        assert_eq!(link.cache_values.len(), 2);

        assert_eq!(link.cache_values[0].sheet_id, 0);
        assert_eq!(link.cache_values[0].cell_ref, "A1");
        assert_eq!(link.cache_values[0].value, CachedValue::Number(100.0));

        assert_eq!(link.cache_values[1].cell_ref, "B1");
        assert_eq!(
            link.cache_values[1].value,
            CachedValue::String("Hello".to_string())
        );
    }

    #[test]
    fn test_parse_external_book_boolean_value() {
        let xml = br#"<externalLink>
    <externalBook r:id="rId1">
        <sheetDataSet>
            <sheetData sheetId="0">
                <cell r="A1" t="b"><v>1</v></cell>
                <cell r="A2" t="b"><v>0</v></cell>
            </sheetData>
        </sheetDataSet>
    </externalBook>
</externalLink>"#;

        let link = ExternalLinks::parse_external_link(xml, "1").unwrap();
        assert_eq!(link.cache_values[0].value, CachedValue::Boolean(true));
        assert_eq!(link.cache_values[1].value, CachedValue::Boolean(false));
    }

    #[test]
    fn test_parse_external_book_error_value() {
        let xml = br#"<externalLink>
    <externalBook r:id="rId1">
        <sheetDataSet>
            <sheetData sheetId="0">
                <cell r="A1" t="e"><v>#REF!</v></cell>
                <cell r="A2" t="e"><v>#VALUE!</v></cell>
            </sheetData>
        </sheetDataSet>
    </externalBook>
</externalLink>"#;

        let link = ExternalLinks::parse_external_link(xml, "1").unwrap();
        assert_eq!(
            link.cache_values[0].value,
            CachedValue::Error("#REF!".to_string())
        );
        assert_eq!(
            link.cache_values[1].value,
            CachedValue::Error("#VALUE!".to_string())
        );
    }

    // -------------------------------------------------------------------------
    // parse_external_link tests - DDE link
    // -------------------------------------------------------------------------

    #[test]
    fn test_parse_dde_link() {
        let xml = br#"<externalLink>
    <ddeLink ddeService="Excel" ddeTopic="[Book1.xlsx]Sheet1">
        <ddeItems>
            <ddeItem name="R1C1" advise="1"/>
        </ddeItems>
    </ddeLink>
</externalLink>"#;

        let link = ExternalLinks::parse_external_link(xml, "1").unwrap();
        assert_eq!(link.id, "1");

        match &link.link_type {
            ExternalLinkType::Dde { service, topic, .. } => {
                assert_eq!(service, "Excel");
                assert_eq!(topic, "[Book1.xlsx]Sheet1");
            }
            _ => panic!("Expected DDE link type"),
        }
    }

    #[test]
    fn test_parse_dde_link_empty_attributes() {
        let xml = br#"<externalLink>
    <ddeLink>
    </ddeLink>
</externalLink>"#;

        let link = ExternalLinks::parse_external_link(xml, "1").unwrap();
        match &link.link_type {
            ExternalLinkType::Dde { service, topic, .. } => {
                assert!(service.is_empty());
                assert!(topic.is_empty());
            }
            _ => panic!("Expected DDE link type"),
        }
    }

    // -------------------------------------------------------------------------
    // parse_external_link tests - OLE link
    // -------------------------------------------------------------------------

    #[test]
    fn test_parse_ole_link() {
        let xml = br#"<externalLink>
    <oleLink progId="Excel.Sheet.12" r:id="rId1">
    </oleLink>
</externalLink>"#;

        let link = ExternalLinks::parse_external_link(xml, "1").unwrap();
        assert_eq!(link.id, "1");

        match &link.link_type {
            ExternalLinkType::Ole { prog_id, r_id, .. } => {
                assert_eq!(prog_id, "Excel.Sheet.12");
                assert_eq!(r_id.as_deref(), Some("rId1"));
            }
            _ => panic!("Expected OLE link type"),
        }
    }

    // -------------------------------------------------------------------------
    // parse_external_link tests - edge cases
    // -------------------------------------------------------------------------

    #[test]
    fn test_parse_empty_xml() {
        let xml = b"";
        let link = ExternalLinks::parse_external_link(xml, "1");
        assert!(link.is_none());
    }

    #[test]
    fn test_parse_invalid_xml() {
        let xml = b"<invalid>content</invalid>";
        let link = ExternalLinks::parse_external_link(xml, "1");
        assert!(link.is_none());
    }

    #[test]
    fn test_parse_external_book_xml_entities() {
        let xml = br#"<externalLink>
    <externalBook r:id="rId1">
        <sheetNames>
            <sheetName val="Q1 &amp; Q2"/>
            <sheetName val="&lt;Data&gt;"/>
        </sheetNames>
    </externalBook>
</externalLink>"#;

        let link = ExternalLinks::parse_external_link(xml, "1").unwrap();
        assert_eq!(link.sheet_names[0], "Q1 & Q2");
        assert_eq!(link.sheet_names[1], "<Data>");
    }

    #[test]
    fn test_parse_external_book_sheet_names_with_raw_gt() {
        let xml = br#"<externalLink>
    <externalBook r:id="rId1">
        <sheetNames>
            <sheetName val="To be discussed >>"/>
            <sheetName val="To_be_discussed_>>1"/>
            <sheetName val="Merger_Outputs>1"/>
            <sheetName val=">>> Exch rates&lt;&lt;&lt;"/>
            <sheetName val="A>B&lt;C"/>
        </sheetNames>
    </externalBook>
</externalLink>"#;

        let link = ExternalLinks::parse_external_link(xml, "1").unwrap();
        assert_eq!(
            link.sheet_names,
            vec![
                "To be discussed >>",
                "To_be_discussed_>>1",
                "Merger_Outputs>1",
                ">>> Exch rates<<<",
                "A>B<C",
            ]
        );
    }

    #[test]
    fn test_parse_external_book_single_quoted_string_attributes() {
        let xml = br#"<externalLink mc:Ignorable='x15'>
    <externalBook r:id='rId1'>
        <sheetNames>
            <sheetName val='Single>Quoted'/>
        </sheetNames>
        <definedNames>
            <definedName name='Name>One' refersTo='Single>Quoted!$A$1' sheetId="0"/>
        </definedNames>
        <sheetDataSet>
            <sheetData sheetId="0">
                <cell r='A1' t='str'><v>ok</v></cell>
            </sheetData>
        </sheetDataSet>
    </externalBook>
</externalLink>"#;

        let link = ExternalLinks::parse_external_link(xml, "1").unwrap();
        assert_eq!(link.mc_ignorable, Some("x15".to_string()));
        assert_eq!(link.sheet_names, vec!["Single>Quoted"]);
        assert_eq!(link.defined_names.len(), 1);
        assert_eq!(link.defined_names[0].name, "Name>One");
        assert_eq!(
            link.defined_names[0].refers_to,
            Some("Single>Quoted!$A$1".to_string())
        );
        assert_eq!(link.cache_values.len(), 1);
        assert_eq!(link.cache_values[0].cell_ref, "A1");
        assert_eq!(
            link.cache_values[0].value,
            CachedValue::String("ok".to_string())
        );
    }

    #[test]
    fn test_resolve_rels_target_with_raw_gt_and_single_quotes() {
        let book_xml = br#"<externalLink>
    <externalBook r:id='rId1'/>
</externalLink>"#;
        let rels_xml = br#"<Relationships>
    <Relationship Id='rId1' Type='http://schemas.openxmlformats.org/officeDocument/2006/relationships/externalLinkPath' Target='file>name.xlsx' TargetMode='External'/>
</Relationships>"#;

        let mut link = ExternalLink::new("1".to_string());
        ExternalLinks::resolve_rels(&mut link, rels_xml, book_xml);
        assert_eq!(link.file_path, Some("file>name.xlsx".to_string()));
        assert_eq!(link.file_path_rid, Some("rId1".to_string()));
    }

    #[test]
    fn test_parse_multiple_sheets_with_data() {
        let xml = br#"<externalLink>
    <externalBook r:id="rId1">
        <sheetDataSet>
            <sheetData sheetId="0">
                <cell r="A1"><v>1</v></cell>
            </sheetData>
            <sheetData sheetId="1">
                <cell r="A1"><v>2</v></cell>
            </sheetData>
        </sheetDataSet>
    </externalBook>
</externalLink>"#;

        let link = ExternalLinks::parse_external_link(xml, "1").unwrap();
        assert_eq!(link.cache_values.len(), 2);
        assert_eq!(link.cache_values[0].sheet_id, 0);
        assert_eq!(link.cache_values[1].sheet_id, 1);
    }

    // -------------------------------------------------------------------------
    // Helper function tests
    // -------------------------------------------------------------------------

    #[test]
    fn test_decode_xml_entities() {
        assert_eq!(decode_xml_entities(b"hello"), "hello");
        assert_eq!(decode_xml_entities(b"&lt;tag&gt;"), "<tag>");
        assert_eq!(decode_xml_entities(b"&amp;"), "&");
        assert_eq!(decode_xml_entities(b"&quot;text&quot;"), "\"text\"");
        assert_eq!(decode_xml_entities(b"&apos;"), "'");
        assert_eq!(
            decode_xml_entities(b"a &lt; b &amp;&amp; c &gt; d"),
            "a < b && c > d"
        );
    }

    #[test]
    fn test_parse_cached_value_number() {
        let (value, raw) = parse_cached_value(b"42.5", None);
        assert_eq!(value, CachedValue::Number(42.5));
        assert_eq!(raw, None);
    }

    #[test]
    fn test_parse_cached_value_string_type() {
        let (value, _) = parse_cached_value(b"Hello", Some("s"));
        assert_eq!(value, CachedValue::String("Hello".to_string()));
    }

    #[test]
    fn test_parse_cached_value_str_type() {
        let (value, _) = parse_cached_value(b"World", Some("str"));
        assert_eq!(value, CachedValue::String("World".to_string()));
    }

    #[test]
    fn test_parse_cached_value_boolean_true() {
        let (value, _) = parse_cached_value(b"1", Some("b"));
        assert_eq!(value, CachedValue::Boolean(true));

        let (value, _) = parse_cached_value(b"true", Some("b"));
        assert_eq!(value, CachedValue::Boolean(true));
    }

    #[test]
    fn test_parse_cached_value_boolean_false() {
        let (value, _) = parse_cached_value(b"0", Some("b"));
        assert_eq!(value, CachedValue::Boolean(false));
    }

    #[test]
    fn test_parse_cached_value_error() {
        let (value, _) = parse_cached_value(b"#REF!", Some("e"));
        assert_eq!(value, CachedValue::Error("#REF!".to_string()));
    }

    #[test]
    fn test_parse_cached_value_empty() {
        let (value, _) = parse_cached_value(b"", None);
        assert_eq!(value, CachedValue::Empty);
    }

    // -------------------------------------------------------------------------
    // Integration tests
    // -------------------------------------------------------------------------

    #[test]
    fn test_full_external_link_parsing() {
        let xml = br#"<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<externalLink xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"
              xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">
    <externalBook r:id="rId1">
        <sheetNames>
            <sheetName val="Sheet1"/>
            <sheetName val="Sheet2"/>
            <sheetName val="Summary"/>
        </sheetNames>
        <definedNames>
            <definedName name="DataRange" refersTo="Sheet1!$A$1:$D$100"/>
            <definedName name="Total" sheetId="2" refersTo="Summary!$E$1"/>
        </definedNames>
        <sheetDataSet>
            <sheetData sheetId="0">
                <row r="1">
                    <cell r="A1"><v>100</v></cell>
                    <cell r="B1" t="s"><v>Product A</v></cell>
                    <cell r="C1" t="b"><v>1</v></cell>
                </row>
                <row r="2">
                    <cell r="A2"><v>200</v></cell>
                    <cell r="B2" t="s"><v>Product B</v></cell>
                    <cell r="C2" t="b"><v>0</v></cell>
                </row>
            </sheetData>
            <sheetData sheetId="2">
                <cell r="E1"><v>300</v></cell>
            </sheetData>
        </sheetDataSet>
    </externalBook>
</externalLink>"#;

        let link = ExternalLinks::parse_external_link(xml, "1").unwrap();

        // Verify basic info
        assert_eq!(link.id, "1");
        assert_eq!(link.link_type, ExternalLinkType::Workbook);

        // Verify sheet names
        assert_eq!(link.sheet_names.len(), 3);
        assert_eq!(link.sheet_names, vec!["Sheet1", "Sheet2", "Summary"]);

        // Verify defined names
        assert_eq!(link.defined_names.len(), 2);
        assert_eq!(link.defined_names[0].name, "DataRange");
        assert_eq!(link.defined_names[1].sheet_id, Some(2));

        // Verify cached values
        assert_eq!(link.cache_values.len(), 7);

        // Check first sheet data
        let sheet0_values: Vec<_> = link
            .cache_values
            .iter()
            .filter(|v| v.sheet_id == 0)
            .collect();
        assert_eq!(sheet0_values.len(), 6);

        // Check summary sheet data
        let sheet2_values: Vec<_> = link
            .cache_values
            .iter()
            .filter(|v| v.sheet_id == 2)
            .collect();
        assert_eq!(sheet2_values.len(), 1);
        assert_eq!(sheet2_values[0].cell_ref, "E1");
        assert_eq!(sheet2_values[0].value, CachedValue::Number(300.0));
    }

    #[test]
    fn test_external_links_collection_operations() {
        let mut links = ExternalLinks::new();

        // Add various link types
        let xml1 = br#"<externalLink><externalBook r:id="rId1">
            <sheetNames><sheetName val="Sheet1"/></sheetNames>
        </externalBook></externalLink>"#;

        let xml2 = br#"<externalLink>
            <ddeLink ddeService="Excel" ddeTopic="[Test.xlsx]Data"/>
        </externalLink>"#;

        if let Some(link1) = ExternalLinks::parse_external_link(xml1, "1") {
            links.add_link(link1);
        }

        if let Some(link2) = ExternalLinks::parse_external_link(xml2, "2") {
            links.add_link(link2);
        }

        assert_eq!(links.len(), 2);

        // Verify retrieval
        let link1 = links.get_link("1").unwrap();
        assert_eq!(link1.link_type, ExternalLinkType::Workbook);

        let link2 = links.get_link("2").unwrap();
        match &link2.link_type {
            ExternalLinkType::Dde { service, topic, .. } => {
                assert_eq!(service, "Excel");
                assert_eq!(topic, "[Test.xlsx]Data");
            }
            _ => panic!("Expected DDE link"),
        }
    }
}
