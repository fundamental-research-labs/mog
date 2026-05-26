//! Workbook metadata parser
//!
//! This module parses workbook.xml and workbook.xml.rels to extract sheet
//! information including names, sheet IDs, and relationship mappings.
//!
//! # XLSX Workbook Structure
//!
//! The workbook.xml file contains sheet definitions:
//! ```xml
//! <workbook>
//!   <sheets>
//!     <sheet name="Sheet1" sheetId="1" r:id="rId1"/>
//!     <sheet name="Data" sheetId="2" r:id="rId2"/>
//!   </sheets>
//! </workbook>
//! ```
//!
//! The workbook.xml.rels file maps relationship IDs to worksheet paths:
//! ```xml
//! <Relationships>
//!   <Relationship Id="rId1" Type="...worksheet" Target="worksheets/sheet1.xml"/>
//!   <Relationship Id="rId2" Type="...worksheet" Target="worksheets/sheet2.xml"/>
//! </Relationships>
//! ```

use crate::infra::scanner::{extract_quoted_value, find_attr_simd, find_gt_simd, find_tag_simd};
use crate::zip::constants::MAX_RELATIONSHIPS_PER_PART;

#[inline]
fn checked_xml_text(bytes: &[u8]) -> String {
    std::str::from_utf8(bytes)
        .expect("relationship/workbook XML was validated as UTF-8 at the archive boundary")
        .to_owned()
}

/// Sheet metadata from workbook.xml
#[derive(Debug, Clone)]
pub struct SheetInfo {
    /// Display name of the sheet (e.g., "Sheet1", "Sales Data")
    pub name: String,
    /// Unique sheet ID within the workbook
    pub sheet_id: u32,
    /// Relationship ID linking to workbook.xml.rels (e.g., "rId1")
    pub r_id: String,
    /// Sheet visibility state (visible, hidden, or veryHidden)
    pub state: crate::domain::workbook::write::SheetState,
}

impl SheetInfo {
    /// Create a new SheetInfo instance
    pub fn new(name: String, sheet_id: u32, r_id: String) -> Self {
        Self {
            name,
            sheet_id,
            r_id,
            state: crate::domain::workbook::write::SheetState::Visible,
        }
    }
}

/// Parse workbook.xml to extract sheet information
///
/// Returns a vector of SheetInfo in document order (which corresponds to
/// the order sheets appear in the workbook UI).
///
/// # Arguments
/// * `xml` - Raw bytes of the workbook.xml file
///
/// # Returns
/// Vector of SheetInfo for each sheet in the workbook
///
/// # Example
/// ```ignore
/// use xlsx_parser::workbook::parse_workbook;
///
/// let xml = br#"<workbook><sheets>
///   <sheet name="Sheet1" sheetId="1" r:id="rId1"/>
/// </sheets></workbook>"#;
/// let sheets = parse_workbook(xml);
/// assert_eq!(sheets.len(), 1);
/// assert_eq!(sheets[0].name, "Sheet1");
/// ```
pub fn parse_workbook(xml: &[u8]) -> Vec<SheetInfo> {
    let mut sheets = Vec::new();

    // Find <sheets> element to narrow our search
    let sheets_start = match find_tag_simd(xml, b"sheets", 0) {
        Some(pos) => pos,
        None => return sheets,
    };

    // Find </sheets> to know where to stop
    let sheets_end = find_closing_tag_simple(xml, b"sheets", sheets_start).unwrap_or(xml.len());

    // Parse each <sheet> element within <sheets>
    let mut pos = sheets_start;

    while pos < sheets_end {
        // Find next <sheet element
        let sheet_pos = match find_tag_simd(xml, b"sheet", pos) {
            Some(p) if p < sheets_end => p,
            _ => break,
        };

        // Make sure this is <sheet not <sheets
        // Check the byte after "sheet" is a delimiter (space, >, /)
        let after_tag = sheet_pos + 6; // len("<sheet")
        if after_tag < xml.len() {
            let next_byte = xml[after_tag];
            if next_byte == b's' {
                // This is <sheets, skip it
                pos = sheet_pos + 7;
                continue;
            }
        }

        // Find the end of this element (either > or />)
        let element_end = find_element_end_simple(xml, sheet_pos).unwrap_or(xml.len());

        // Extract attributes from this <sheet> element
        let element = &xml[sheet_pos..element_end.min(xml.len())];

        // Extract name attribute
        let name = extract_attr_value_in_range(element, b"name=\"")
            .map(|s| decode_xml_entities(s))
            .unwrap_or_default();

        // Extract sheetId attribute
        let sheet_id = extract_attr_value_in_range(element, b"sheetId=\"")
            .and_then(|s| std::str::from_utf8(s).ok())
            .and_then(|s| s.parse::<u32>().ok())
            .unwrap_or(0);

        // Extract r:id attribute (note: could also be written as r:id or just id in some cases)
        let r_id = extract_attr_value_in_range(element, b"r:id=\"")
            .or_else(|| extract_attr_value_in_range(element, b":id=\""))
            .map(checked_xml_text)
            .unwrap_or_default();

        // Extract state attribute (visible is default when absent)
        let state = extract_attr_value_in_range(element, b"state=\"")
            .map(|v| match v {
                b"hidden" => crate::domain::workbook::write::SheetState::Hidden,
                b"veryHidden" => crate::domain::workbook::write::SheetState::VeryHidden,
                _ => crate::domain::workbook::write::SheetState::Visible,
            })
            .unwrap_or(crate::domain::workbook::write::SheetState::Visible);

        if !name.is_empty() {
            sheets.push(SheetInfo {
                name,
                sheet_id,
                r_id,
                state,
            });
        }

        pos = element_end + 1;
    }

    sheets
}

/// Parse workbook.xml.rels to map relationship IDs to worksheet paths
///
/// Returns a vector of (relationship_id, target_path) pairs.
/// Only includes relationships of type "worksheet".
///
/// # Arguments
/// * `xml` - Raw bytes of the workbook.xml.rels file
///
/// # Returns
/// Vector of (r:id, target_path) pairs, e.g., `[("rId1", "worksheets/sheet1.xml")]`
///
/// # Example
/// ```ignore
/// use xlsx_parser::workbook::parse_workbook_rels;
///
/// let xml = br#"<Relationships>
///   <Relationship Id="rId1" Type=".../worksheet" Target="worksheets/sheet1.xml"/>
/// </Relationships>"#;
/// let rels = parse_workbook_rels(xml);
/// assert_eq!(rels.len(), 1);
/// assert_eq!(rels[0].0, "rId1");
/// assert_eq!(rels[0].1, "worksheets/sheet1.xml");
/// ```
pub fn parse_workbook_rels(xml: &[u8]) -> Vec<(String, String)> {
    let mut relationships = Vec::new();
    let mut pos = 0;

    while pos < xml.len() {
        // Find next <Relationship element
        let rel_pos = match find_tag_simd(xml, b"Relationship", pos) {
            Some(p) => p,
            None => break,
        };

        // Find the end of this element
        let element_end = find_element_end_simple(xml, rel_pos).unwrap_or(xml.len());

        let element = &xml[rel_pos..element_end.min(xml.len())];

        // Check if this is a worksheet relationship by looking at Type attribute
        // Type typically contains "worksheet" for worksheet relationships
        let type_value = extract_attr_value_in_range(element, b"Type=\"");
        let is_worksheet = type_value
            .map(|t| {
                // Look for "worksheet" in the type URL
                memchr::memmem::find(t, b"worksheet").is_some()
            })
            .unwrap_or(false);

        if is_worksheet {
            // Extract Id attribute
            let id = extract_attr_value_in_range(element, b"Id=\"")
                .map(checked_xml_text)
                .unwrap_or_default();

            // Extract Target attribute
            let target = extract_attr_value_in_range(element, b"Target=\"")
                .map(checked_xml_text)
                .unwrap_or_default();

            if !id.is_empty() && !target.is_empty() {
                relationships.push((id, target));
                if relationships.len() >= MAX_RELATIONSHIPS_PER_PART {
                    break;
                }
            }
        }

        pos = element_end + 1;
    }

    relationships
}

/// Parse all relationships from any `.rels` file, preserving IDs, types, targets, and order.
///
/// Unlike `parse_workbook_rels()` which filters to worksheet relationships only,
/// this returns every `<Relationship>` entry for round-trip fidelity.
pub fn parse_all_rels(xml: &[u8]) -> Vec<ooxml_types::shared::OpcRelationship> {
    let mut relationships = Vec::new();
    let mut pos = 0;

    while pos < xml.len() {
        let rel_pos = match find_tag_simd(xml, b"Relationship", pos) {
            Some(p) => p,
            None => break,
        };

        // Skip <Relationships (the container element)
        let after = rel_pos + b"<Relationship".len();
        if after < xml.len() && xml[after] == b's' {
            pos = after;
            continue;
        }

        let element_end = find_element_end_simple(xml, rel_pos).unwrap_or(xml.len());
        let element = &xml[rel_pos..element_end.min(xml.len())];

        let id = extract_attr_value_in_range(element, b"Id=\"")
            .map(checked_xml_text)
            .unwrap_or_default();

        let rel_type = extract_attr_value_in_range(element, b"Type=\"")
            .map(checked_xml_text)
            .unwrap_or_default();

        let target = extract_attr_value_in_range(element, b"Target=\"")
            .map(|s| decode_xml_entities(s))
            .unwrap_or_default();

        let target_mode =
            extract_attr_value_in_range(element, b"TargetMode=\"").map(checked_xml_text);

        if !id.is_empty() && !rel_type.is_empty() {
            relationships.push(ooxml_types::shared::OpcRelationship {
                id,
                rel_type,
                target,
                target_mode,
            });
            if relationships.len() >= MAX_RELATIONSHIPS_PER_PART {
                break;
            }
        }

        pos = element_end + 1;
    }

    relationships
}

/// Decode common XML entities in a string
/// Handles: &amp; &lt; &gt; &quot; &apos;
fn decode_xml_entities(bytes: &[u8]) -> String {
    let s = std::str::from_utf8(bytes)
        .expect("relationship/workbook XML was validated as UTF-8 at the archive boundary");

    // Fast path: if no & found, return as-is
    if !s.contains('&') {
        return s.to_owned();
    }

    s.replace("&amp;", "&")
        .replace("&lt;", "<")
        .replace("&gt;", ">")
        .replace("&quot;", "\"")
        .replace("&apos;", "'")
}

/// Extract attribute value within a byte slice
/// Returns the bytes between quotes after the attribute name
fn extract_attr_value_in_range<'a>(bytes: &'a [u8], attr: &[u8]) -> Option<&'a [u8]> {
    // Find the attribute
    let attr_pos = find_attr_simd(bytes, attr, 0)?;
    let value_start = attr_pos + attr.len();

    // Find the closing quote
    let (start, end) = extract_quoted_value(bytes, value_start)?;
    Some(&bytes[start..end])
}

/// Simple closing tag finder that doesn't use the full scanner
/// Looks for </tagname> starting from pos
fn find_closing_tag_simple(bytes: &[u8], tag: &[u8], start: usize) -> Option<usize> {
    let mut pos = start;

    while pos + 2 + tag.len() < bytes.len() {
        // Find next '<'
        if let Some(lt_offset) = memchr::memchr(b'<', &bytes[pos..]) {
            let lt_pos = pos + lt_offset;

            // Check if it's followed by '/'
            if lt_pos + 1 < bytes.len() && bytes[lt_pos + 1] == b'/' {
                // Check if tag matches
                let tag_start = lt_pos + 2;
                if tag_start + tag.len() <= bytes.len()
                    && &bytes[tag_start..tag_start + tag.len()] == tag
                {
                    // Verify followed by '>' or whitespace
                    let after_tag = tag_start + tag.len();
                    if after_tag < bytes.len()
                        && matches!(bytes[after_tag], b'>' | b' ' | b'\t' | b'\n' | b'\r')
                    {
                        return Some(lt_pos);
                    }
                }
            }
            pos = lt_pos + 1;
        } else {
            break;
        }
    }

    None
}

/// Find the end of an XML element (the closing > character)
/// Handles quoted attribute values
fn find_element_end_simple(bytes: &[u8], start: usize) -> Option<usize> {
    let mut pos = start;
    let mut in_quotes = false;

    while pos < bytes.len() {
        let b = bytes[pos];

        if b == b'"' {
            in_quotes = !in_quotes;
        } else if b == b'>' && !in_quotes {
            return Some(pos);
        }

        pos += 1;
    }

    None
}

/// Parsed calculation settings from `<calcPr>` element in workbook.xml.
///
/// Covers all OOXML CT_CalcPr attributes for full round-trip fidelity:
/// calcId, calcMode, fullCalcOnLoad, refMode, iterate, iterateCount,
/// iterateDelta, fullPrecision, calcCompleted, calcOnSave, concurrentCalc,
/// concurrentManualCount, forceFullCalc.
#[derive(Debug, Clone)]
pub struct CalcPrSettings {
    /// The calcId attribute value (identifies the engine version; Excel uses this
    /// to decide whether to recalculate). Preserved for round-trip fidelity.
    pub calc_id: Option<u32>,
    /// Calculation mode: "auto" (default), "manual", or "autoNoTable"
    pub calc_mode: Option<String>,
    /// Whether to perform a full recalculation on load (fullCalcOnLoad="1")
    pub full_calc_on_load: bool,
    /// Reference mode: "A1" (default) or "R1C1"
    pub ref_mode: Option<String>,
    /// Whether iterative calculation is enabled (iterate="1")
    pub iterate: bool,
    /// Maximum number of iterations (iterateCount attribute, default 100)
    pub iterate_count: Option<u32>,
    /// Maximum change between iterations (iterateDelta attribute, default 0.001)
    pub iterate_delta: Option<f64>,
    /// Whether to use full precision for calculations (fullPrecision attribute, default true)
    pub full_precision: Option<bool>,
    /// Whether calculation was completed before save (calcCompleted attribute)
    pub calc_completed: Option<bool>,
    /// Whether to save calculation results on save (calcOnSave attribute, default true)
    pub calc_on_save: Option<bool>,
    /// Whether concurrent calculation is enabled (concurrentCalc attribute, default true)
    pub concurrent_calc: Option<bool>,
    /// Maximum concurrent threads for manual calc (concurrentManualCount attribute)
    pub concurrent_manual_count: Option<u32>,
    /// Whether to force a full calculation (forceFullCalc attribute)
    pub force_full_calc: Option<bool>,
}

impl Default for CalcPrSettings {
    fn default() -> Self {
        Self {
            calc_id: None,
            calc_mode: None,
            full_calc_on_load: false,
            ref_mode: None,
            iterate: false,
            iterate_count: None,
            iterate_delta: None,
            full_precision: None,
            calc_completed: None,
            calc_on_save: None,
            concurrent_calc: None,
            concurrent_manual_count: None,
            force_full_calc: None,
        }
    }
}

/// Parse the `<calcPr>` element from workbook.xml to extract calculation settings.
///
/// Returns the iterative calculation settings. If no `<calcPr>` element is found,
/// returns default settings (non-iterative).
///
/// # Arguments
/// * `xml` - Raw bytes of the workbook.xml file
///
/// # Returns
/// Parsed CalcPrSettings
pub fn parse_calc_settings(xml: &[u8]) -> CalcPrSettings {
    // Find <calcPr element
    let calc_start = match find_tag_simd(xml, b"calcPr", 0) {
        Some(pos) => pos,
        None => return CalcPrSettings::default(),
    };

    // Find end of the element
    let element_end = find_element_end_simple(xml, calc_start).unwrap_or(xml.len());

    let element = &xml[calc_start..element_end.min(xml.len())];

    // Helper closures for attribute parsing
    let parse_u32_attr = |attr: &[u8]| -> Option<u32> {
        extract_attr_value_in_range(element, attr)
            .and_then(|v| std::str::from_utf8(v).ok())
            .and_then(|s| s.parse::<u32>().ok())
    };
    let parse_f64_attr = |attr: &[u8]| -> Option<f64> {
        extract_attr_value_in_range(element, attr)
            .and_then(|v| std::str::from_utf8(v).ok())
            .and_then(|s| s.parse::<f64>().ok())
    };
    let parse_bool_attr = |attr: &[u8]| -> Option<bool> {
        extract_attr_value_in_range(element, attr)
            .map(|v| !v.is_empty() && (v[0] == b'1' || v[0] == b't' || v[0] == b'T'))
    };
    let parse_str_attr = |attr: &[u8]| -> Option<String> {
        extract_attr_value_in_range(element, attr)
            .and_then(|v| std::str::from_utf8(v).ok())
            .map(|s| s.to_string())
    };

    // Parse all CT_CalcPr attributes
    let calc_id = parse_u32_attr(b"calcId=\"");
    let calc_mode = parse_str_attr(b"calcMode=\"");
    let full_calc_on_load = parse_bool_attr(b"fullCalcOnLoad=\"").unwrap_or(false);
    let ref_mode = parse_str_attr(b"refMode=\"");
    let iterate = parse_bool_attr(b"iterate=\"").unwrap_or(false);
    let iterate_count = parse_u32_attr(b"iterateCount=\"");
    let iterate_delta = parse_f64_attr(b"iterateDelta=\"");
    let full_precision = parse_bool_attr(b"fullPrecision=\"");
    let calc_completed = parse_bool_attr(b"calcCompleted=\"");
    let calc_on_save = parse_bool_attr(b"calcOnSave=\"");
    let concurrent_calc = parse_bool_attr(b"concurrentCalc=\"");
    let concurrent_manual_count = parse_u32_attr(b"concurrentManualCount=\"");
    let force_full_calc = parse_bool_attr(b"forceFullCalc=\"");

    CalcPrSettings {
        calc_id,
        calc_mode,
        full_calc_on_load,
        ref_mode,
        iterate,
        iterate_count,
        iterate_delta,
        full_precision,
        calc_completed,
        calc_on_save,
        concurrent_calc,
        concurrent_manual_count,
        force_full_calc,
    }
}

/// Parse all `<bookViews><workbookView .../>` elements from workbook.xml.
///
/// Loops over every `<workbookView>` tag, advancing past each one so that
/// multiple views survive round-trip.
pub fn parse_workbook_views(xml: &[u8]) -> Vec<crate::domain::workbook::write::WorkbookView> {
    let mut views = Vec::new();
    let mut offset = 0;

    while let Some(tag_start) = find_tag_simd(xml, b"workbookView", offset) {
        let tag_end = find_gt_simd(xml, tag_start)
            .map(|p| p + 1)
            .unwrap_or(xml.len());
        let elem = &xml[tag_start..tag_end];

        let parse_i32 = |attr: &[u8]| -> Option<i32> {
            find_attr_simd(elem, attr, 0).and_then(|p| {
                let vs = p + attr.len();
                extract_quoted_value(elem, vs)
                    .and_then(|(s, e)| std::str::from_utf8(&elem[s..e]).ok()?.parse().ok())
            })
        };
        let parse_u32 = |attr: &[u8]| -> Option<u32> {
            find_attr_simd(elem, attr, 0).and_then(|p| {
                let vs = p + attr.len();
                extract_quoted_value(elem, vs)
                    .and_then(|(s, e)| std::str::from_utf8(&elem[s..e]).ok()?.parse().ok())
            })
        };
        let parse_bool = |attr: &[u8], default: bool| -> bool {
            find_attr_simd(elem, attr, 0)
                .and_then(|p| {
                    let vs = p + attr.len();
                    extract_quoted_value(elem, vs)
                        .map(|(s, e)| elem[s..e] == *b"1" || elem[s..e] == *b"true")
                })
                .unwrap_or(default)
        };

        let mut view = crate::domain::workbook::write::WorkbookView::default();
        view.x_window = parse_i32(b"xWindow=\"");
        view.y_window = parse_i32(b"yWindow=\"");
        view.window_width = parse_u32(b"windowWidth=\"");
        view.window_height = parse_u32(b"windowHeight=\"");
        view.active_tab = parse_u32(b"activeTab=\"").unwrap_or(0);
        view.first_sheet = parse_u32(b"firstSheet=\"").unwrap_or(0);
        view.show_horizontal_scroll = parse_bool(b"showHorizontalScroll=\"", true);
        view.show_vertical_scroll = parse_bool(b"showVerticalScroll=\"", true);
        view.show_sheet_tabs = parse_bool(b"showSheetTabs=\"", true);
        view.tab_ratio = find_attr_simd(elem, b"tabRatio=\"", 0).and_then(|p| {
            let vs = p + b"tabRatio=\"".len();
            extract_quoted_value(elem, vs)
                .and_then(|(s, e)| std::str::from_utf8(&elem[s..e]).ok()?.parse::<f64>().ok())
        });
        view.xr_uid = find_attr_simd(elem, b"xr2:uid=\"", 0).and_then(|p| {
            let vs = p + b"xr2:uid=\"".len();
            extract_quoted_value(elem, vs)
                .and_then(|(s, e)| std::str::from_utf8(&elem[s..e]).ok().map(|s| s.to_string()))
        });
        view.auto_filter_date_grouping = parse_bool(b"autoFilterDateGrouping=\"", true);

        views.push(view);
        offset = tag_end;
    }

    views
}

/// Parse the `<workbookPr>` element from workbook.xml into `domain_types::WorkbookProperties`.
///
/// Constructs an `ooxml_types::workbook::WorkbookPr` from raw attributes, then
/// converts to `domain_types` via the existing `From` impl.
///
/// Returns `None` if no `<workbookPr>` element is found.
pub fn parse_workbook_properties(
    xml: &[u8],
) -> Option<domain_types::domain::workbook::WorkbookProperties> {
    let tag_start = find_tag_simd(xml, b"workbookPr", 0)?;
    let tag_end = find_gt_simd(xml, tag_start)
        .map(|p| p + 1)
        .unwrap_or(xml.len());
    let elem = &xml[tag_start..tag_end];

    let parse_bool = |attr: &[u8], default: bool| -> bool {
        extract_attr_value_in_range(elem, attr)
            .map(|v| !v.is_empty() && (v[0] == b'1' || v[0] == b't' || v[0] == b'T'))
            .unwrap_or(default)
    };
    let parse_str = |attr: &[u8]| -> Option<String> {
        extract_attr_value_in_range(elem, attr)
            .and_then(|v| std::str::from_utf8(v).ok())
            .map(|s| s.to_string())
    };
    let parse_u32 = |attr: &[u8]| -> Option<u32> {
        extract_attr_value_in_range(elem, attr)
            .and_then(|v| std::str::from_utf8(v).ok())
            .and_then(|s| s.parse::<u32>().ok())
    };

    let ooxml_pr = ooxml_types::workbook::WorkbookPr {
        date1904: parse_bool(b"date1904=\"", false),
        show_objects: extract_attr_value_in_range(elem, b"showObjects=\"")
            .map(ooxml_types::workbook::ObjectDisplayMode::from_bytes)
            .unwrap_or_default(),
        show_border_unselected_tables: parse_bool(b"showBorderUnselectedTables=\"", true),
        filter_privacy: parse_bool(b"filterPrivacy=\"", false),
        prompted_solutions: parse_bool(b"promptedSolutions=\"", false),
        show_ink_annotation: parse_bool(b"showInkAnnotation=\"", true),
        backup_file: parse_bool(b"backupFile=\"", false),
        save_external_link_values: parse_bool(b"saveExternalLinkValues=\"", true),
        update_links: extract_attr_value_in_range(elem, b"updateLinks=\"")
            .map(ooxml_types::workbook::UpdateLinks::from_bytes)
            .unwrap_or_default(),
        code_name: parse_str(b"codeName=\""),
        hide_pivot_field_list: parse_bool(b"hidePivotFieldList=\"", false),
        show_pivot_chart_filter: parse_bool(b"showPivotChartFilter=\"", false),
        allow_refresh_query: parse_bool(b"allowRefreshQuery=\"", false),
        publish_items: parse_bool(b"publishItems=\"", false),
        check_compatibility: parse_bool(b"checkCompatibility=\"", false),
        auto_compress_pictures: parse_bool(b"autoCompressPictures=\"", true),
        refresh_all_connections: parse_bool(b"refreshAllConnections=\"", false),
        default_theme_version: parse_u32(b"defaultThemeVersion=\""),
    };

    Some(ooxml_pr.into())
}

/// Parse the `<fileVersion>` element from workbook.xml into `domain_types::FileVersion`.
///
/// Returns `None` if no `<fileVersion>` element is found.
pub fn parse_file_version(xml: &[u8]) -> Option<domain_types::domain::workbook::FileVersion> {
    let tag_start = find_tag_simd(xml, b"fileVersion", 0)?;
    let tag_end = find_gt_simd(xml, tag_start)
        .map(|p| p + 1)
        .unwrap_or(xml.len());
    let elem = &xml[tag_start..tag_end];

    let parse_str = |attr: &[u8]| -> Option<String> {
        extract_attr_value_in_range(elem, attr)
            .and_then(|v| std::str::from_utf8(v).ok())
            .map(|s| s.to_string())
    };

    let ooxml_fv = ooxml_types::workbook::FileVersion {
        app_name: parse_str(b"appName=\""),
        last_edited: parse_str(b"lastEdited=\""),
        lowest_edited: parse_str(b"lowestEdited=\""),
        rup_build: parse_str(b"rupBuild=\""),
        code_name: parse_str(b"codeName=\""),
    };

    Some(ooxml_fv.into())
}

/// Parse the `<fileSharing>` element from workbook.xml into `domain_types::FileSharing`.
///
/// Returns `None` if no `<fileSharing>` element is found.
pub fn parse_file_sharing(xml: &[u8]) -> Option<domain_types::domain::workbook::FileSharing> {
    let tag_start = find_tag_simd(xml, b"fileSharing", 0)?;
    let tag_end = find_gt_simd(xml, tag_start)
        .map(|p| p + 1)
        .unwrap_or(xml.len());
    let elem = &xml[tag_start..tag_end];

    let parse_bool = |attr: &[u8], default: bool| -> bool {
        extract_attr_value_in_range(elem, attr)
            .map(|v| !v.is_empty() && (v[0] == b'1' || v[0] == b't' || v[0] == b'T'))
            .unwrap_or(default)
    };
    let parse_str = |attr: &[u8]| -> Option<String> {
        extract_attr_value_in_range(elem, attr)
            .and_then(|v| std::str::from_utf8(v).ok())
            .map(|s| s.to_string())
    };
    let parse_u32 = |attr: &[u8]| -> Option<u32> {
        extract_attr_value_in_range(elem, attr)
            .and_then(|v| std::str::from_utf8(v).ok())
            .and_then(|s| s.parse::<u32>().ok())
    };

    let ooxml_fs = ooxml_types::workbook::FileSharing {
        read_only_recommended: parse_bool(b"readOnlyRecommended=\"", false),
        user_name: parse_str(b"userName=\""),
        reservation_password: parse_str(b"reservationPassword=\""),
        algorithm_name: parse_str(b"algorithmName=\""),
        hash_value: parse_str(b"hashValue=\""),
        salt_value: parse_str(b"saltValue=\""),
        spin_count: parse_u32(b"spinCount=\""),
    };

    Some(ooxml_fs.into())
}

// ============================================================================
// Unit Tests
// ============================================================================

#[cfg(test)]
mod tests {
    use super::*;

    // -------------------------------------------------------------------------
    // parse_workbook tests
    // -------------------------------------------------------------------------

    #[test]
    fn test_parse_workbook_single_sheet() {
        let xml = br#"<?xml version="1.0"?>
<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">
  <sheets>
    <sheet name="Sheet1" sheetId="1" r:id="rId1"/>
  </sheets>
</workbook>"#;

        let sheets = parse_workbook(xml);
        assert_eq!(sheets.len(), 1);
        assert_eq!(sheets[0].name, "Sheet1");
        assert_eq!(sheets[0].sheet_id, 1);
        assert_eq!(sheets[0].r_id, "rId1");
    }

    #[test]
    fn test_parse_workbook_multiple_sheets() {
        let xml = br#"<?xml version="1.0"?>
<workbook>
  <sheets>
    <sheet name="Sheet1" sheetId="1" r:id="rId1"/>
    <sheet name="Data" sheetId="2" r:id="rId2"/>
    <sheet name="Summary" sheetId="3" r:id="rId3"/>
  </sheets>
</workbook>"#;

        let sheets = parse_workbook(xml);
        assert_eq!(sheets.len(), 3);

        assert_eq!(sheets[0].name, "Sheet1");
        assert_eq!(sheets[0].sheet_id, 1);
        assert_eq!(sheets[0].r_id, "rId1");

        assert_eq!(sheets[1].name, "Data");
        assert_eq!(sheets[1].sheet_id, 2);
        assert_eq!(sheets[1].r_id, "rId2");

        assert_eq!(sheets[2].name, "Summary");
        assert_eq!(sheets[2].sheet_id, 3);
        assert_eq!(sheets[2].r_id, "rId3");
    }

    #[test]
    fn test_parse_workbook_with_xml_entities() {
        let xml = br#"<workbook>
  <sheets>
    <sheet name="Q1 &amp; Q2" sheetId="1" r:id="rId1"/>
    <sheet name="Sales &lt;2024&gt;" sheetId="2" r:id="rId2"/>
  </sheets>
</workbook>"#;

        let sheets = parse_workbook(xml);
        assert_eq!(sheets.len(), 2);
        assert_eq!(sheets[0].name, "Q1 & Q2");
        assert_eq!(sheets[1].name, "Sales <2024>");
    }

    #[test]
    fn test_parse_workbook_empty_sheets() {
        let xml = br#"<workbook>
  <sheets>
  </sheets>
</workbook>"#;

        let sheets = parse_workbook(xml);
        assert_eq!(sheets.len(), 0);
    }

    #[test]
    fn test_parse_workbook_no_sheets_element() {
        let xml = br#"<workbook>
  <definedNames/>
</workbook>"#;

        let sheets = parse_workbook(xml);
        assert_eq!(sheets.len(), 0);
    }

    #[test]
    fn test_parse_workbook_with_state_attributes() {
        use crate::domain::workbook::write::SheetState;

        let xml = br#"<workbook>
  <sheets>
    <sheet name="Sheet1" sheetId="1" r:id="rId1" state="visible"/>
    <sheet name="Hidden" sheetId="2" r:id="rId2" state="hidden"/>
    <sheet name="VeryHidden" sheetId="3" r:id="rId3" state="veryHidden"/>
    <sheet name="Default" sheetId="4" r:id="rId4"/>
  </sheets>
</workbook>"#;

        let sheets = parse_workbook(xml);
        assert_eq!(sheets.len(), 4);
        assert_eq!(sheets[0].name, "Sheet1");
        assert_eq!(sheets[0].state, SheetState::Visible);
        assert_eq!(sheets[1].name, "Hidden");
        assert_eq!(sheets[1].state, SheetState::Hidden);
        assert_eq!(sheets[2].name, "VeryHidden");
        assert_eq!(sheets[2].state, SheetState::VeryHidden);
        assert_eq!(sheets[3].name, "Default");
        assert_eq!(sheets[3].state, SheetState::Visible);
    }

    #[test]
    fn test_parse_workbook_different_attribute_order() {
        let xml = br#"<workbook>
  <sheets>
    <sheet r:id="rId1" sheetId="1" name="Sheet1"/>
  </sheets>
</workbook>"#;

        let sheets = parse_workbook(xml);
        assert_eq!(sheets.len(), 1);
        assert_eq!(sheets[0].name, "Sheet1");
        assert_eq!(sheets[0].sheet_id, 1);
        assert_eq!(sheets[0].r_id, "rId1");
    }

    #[test]
    fn test_parse_workbook_unicode_names() {
        let xml = "<workbook>
  <sheets>
    <sheet name=\"\u{65E5}\u{672C}\u{8A9E}\" sheetId=\"1\" r:id=\"rId1\"/>
  </sheets>
</workbook>"
            .as_bytes();

        let sheets = parse_workbook(xml);
        assert_eq!(sheets.len(), 1);
        assert_eq!(sheets[0].name, "\u{65E5}\u{672C}\u{8A9E}"); // Japanese characters
    }

    // -------------------------------------------------------------------------
    // parse_workbook_rels tests
    // -------------------------------------------------------------------------

    #[test]
    fn test_parse_workbook_rels_single() {
        let xml = br#"<?xml version="1.0"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/>
</Relationships>"#;

        let rels = parse_workbook_rels(xml);
        assert_eq!(rels.len(), 1);
        assert_eq!(rels[0].0, "rId1");
        assert_eq!(rels[0].1, "worksheets/sheet1.xml");
    }

    #[test]
    fn test_parse_workbook_rels_multiple() {
        let xml = br#"<?xml version="1.0"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/>
  <Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet2.xml"/>
  <Relationship Id="rId3" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet3.xml"/>
</Relationships>"#;

        let rels = parse_workbook_rels(xml);
        assert_eq!(rels.len(), 3);
        assert_eq!(rels[0].0, "rId1");
        assert_eq!(rels[0].1, "worksheets/sheet1.xml");
        assert_eq!(rels[1].0, "rId2");
        assert_eq!(rels[1].1, "worksheets/sheet2.xml");
        assert_eq!(rels[2].0, "rId3");
        assert_eq!(rels[2].1, "worksheets/sheet3.xml");
    }

    #[test]
    fn test_parse_workbook_rels_filters_non_worksheet() {
        let xml = br#"<?xml version="1.0"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/>
  <Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/>
  <Relationship Id="rId3" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/sharedStrings" Target="sharedStrings.xml"/>
  <Relationship Id="rId4" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet2.xml"/>
</Relationships>"#;

        let rels = parse_workbook_rels(xml);
        assert_eq!(rels.len(), 2);
        assert_eq!(rels[0].0, "rId1");
        assert_eq!(rels[0].1, "worksheets/sheet1.xml");
        assert_eq!(rels[1].0, "rId4");
        assert_eq!(rels[1].1, "worksheets/sheet2.xml");
    }

    #[test]
    fn test_parse_workbook_rels_empty() {
        let xml = br#"<?xml version="1.0"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
</Relationships>"#;

        let rels = parse_workbook_rels(xml);
        assert_eq!(rels.len(), 0);
    }

    #[test]
    fn test_parse_workbook_rels_different_attribute_order() {
        let xml = br#"<Relationships>
  <Relationship Target="worksheets/sheet1.xml" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Id="rId1"/>
</Relationships>"#;

        let rels = parse_workbook_rels(xml);
        assert_eq!(rels.len(), 1);
        assert_eq!(rels[0].0, "rId1");
        assert_eq!(rels[0].1, "worksheets/sheet1.xml");
    }

    // -------------------------------------------------------------------------
    // Helper function tests
    // -------------------------------------------------------------------------

    #[test]
    fn test_decode_xml_entities() {
        assert_eq!(decode_xml_entities(b"Hello"), "Hello");
        assert_eq!(decode_xml_entities(b"A &amp; B"), "A & B");
        assert_eq!(decode_xml_entities(b"&lt;tag&gt;"), "<tag>");
        assert_eq!(decode_xml_entities(b"&quot;quoted&quot;"), "\"quoted\"");
        assert_eq!(decode_xml_entities(b"it&apos;s"), "it's");
        assert_eq!(decode_xml_entities(b"&amp;&lt;&gt;&quot;&apos;"), "&<>\"'");
    }

    #[test]
    fn test_extract_attr_value_in_range() {
        let element = b"<sheet name=\"Sheet1\" sheetId=\"1\"/>";

        let name = extract_attr_value_in_range(element, b"name=\"");
        assert_eq!(name, Some(&b"Sheet1"[..]));

        let sheet_id = extract_attr_value_in_range(element, b"sheetId=\"");
        assert_eq!(sheet_id, Some(&b"1"[..]));

        let missing = extract_attr_value_in_range(element, b"missing=\"");
        assert_eq!(missing, None);
    }

    #[test]
    fn test_find_closing_tag_simple() {
        let xml = b"<sheets><sheet/></sheets>";
        // Position: 0123456789012345678901234
        //                           ^ position 16 is where </sheets> starts
        let pos = find_closing_tag_simple(xml, b"sheets", 0);
        assert_eq!(pos, Some(16));
    }

    #[test]
    fn test_find_element_end_simple() {
        let xml = b"<sheet name=\"Test\" sheetId=\"1\"/>";
        let pos = find_element_end_simple(xml, 0);
        assert_eq!(pos, Some(31));

        // With > inside quotes
        let xml2 = b"<sheet name=\"A>B\" sheetId=\"1\"/>";
        let pos2 = find_element_end_simple(xml2, 0);
        assert_eq!(pos2, Some(30));
    }

    #[test]
    fn test_sheet_info_new() {
        let info = SheetInfo::new("Test".to_string(), 42, "rId5".to_string());
        assert_eq!(info.name, "Test");
        assert_eq!(info.sheet_id, 42);
        assert_eq!(info.r_id, "rId5");
    }

    // -------------------------------------------------------------------------
    // Integration tests
    // -------------------------------------------------------------------------

    #[test]
    fn test_workbook_and_rels_integration() {
        // Simulate parsing both workbook.xml and workbook.xml.rels
        let workbook_xml = br#"<workbook>
  <sheets>
    <sheet name="First" sheetId="1" r:id="rId1"/>
    <sheet name="Second" sheetId="2" r:id="rId2"/>
  </sheets>
</workbook>"#;

        let rels_xml = br#"<Relationships>
  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/>
  <Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet2.xml"/>
</Relationships>"#;

        let sheets = parse_workbook(workbook_xml);
        let rels = parse_workbook_rels(rels_xml);

        // Create a mapping from r:id to target path
        let rels_map: std::collections::HashMap<_, _> = rels.into_iter().collect();

        // Verify we can map sheets to their worksheet paths
        assert_eq!(sheets.len(), 2);

        let first_sheet = &sheets[0];
        assert_eq!(first_sheet.name, "First");
        assert_eq!(
            rels_map.get(&first_sheet.r_id),
            Some(&"worksheets/sheet1.xml".to_string())
        );

        let second_sheet = &sheets[1];
        assert_eq!(second_sheet.name, "Second");
        assert_eq!(
            rels_map.get(&second_sheet.r_id),
            Some(&"worksheets/sheet2.xml".to_string())
        );
    }

    #[test]
    fn test_realistic_workbook_xml() {
        // More realistic XML with namespaces and extra elements
        let xml = br#"<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"
          xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">
  <fileVersion appName="xl" lastEdited="7" lowestEdited="7" rupBuild="27231"/>
  <workbookPr defaultThemeVersion="166925"/>
  <bookViews>
    <workbookView xWindow="0" yWindow="0" windowWidth="28800" windowHeight="12225" activeTab="0"/>
  </bookViews>
  <sheets>
    <sheet name="Sales Data" sheetId="1" r:id="rId1"/>
    <sheet name="Q1 Report" sheetId="2" r:id="rId2"/>
    <sheet name="Charts" sheetId="3" r:id="rId3"/>
  </sheets>
  <calcPr calcId="191029"/>
  <extLst>
    <ext uri="{140A7094-0E35-4892-8432-C4D2E57EDEB5}">
    </ext>
  </extLst>
</workbook>"#;

        let sheets = parse_workbook(xml);
        assert_eq!(sheets.len(), 3);
        assert_eq!(sheets[0].name, "Sales Data");
        assert_eq!(sheets[1].name, "Q1 Report");
        assert_eq!(sheets[2].name, "Charts");
    }
    // -------------------------------------------------------------------------
    // parse_calc_settings tests
    // -------------------------------------------------------------------------

    #[test]
    fn test_parse_calc_settings_default() {
        let xml = br#"<workbook><calcPr calcId="191029"/></workbook>"#;
        let settings = parse_calc_settings(xml);
        assert!(!settings.iterate);
        assert!(settings.iterate_count.is_none());
        assert!(settings.iterate_delta.is_none());
    }

    #[test]
    fn test_parse_calc_settings_no_calc_pr() {
        let xml = br#"<workbook><sheets><sheet name="Sheet1" sheetId="1" r:id="rId1"/></sheets></workbook>"#;
        let settings = parse_calc_settings(xml);
        assert!(!settings.iterate);
    }

    #[test]
    fn test_parse_calc_settings_iterative() {
        let xml = br#"<workbook><calcPr calcId="191029" iterate="1" iterateCount="100" iterateDelta="0.001"/></workbook>"#;
        let settings = parse_calc_settings(xml);
        assert!(settings.iterate);
        assert_eq!(settings.iterate_count, Some(100));
        assert!((settings.iterate_delta.unwrap() - 0.001).abs() < 1e-10);
    }

    #[test]
    fn test_parse_calc_settings_custom_values() {
        let xml = br#"<workbook><calcPr calcId="191029" iterate="1" iterateCount="200" iterateDelta="0.01"/></workbook>"#;
        let settings = parse_calc_settings(xml);
        assert!(settings.iterate);
        assert_eq!(settings.iterate_count, Some(200));
        assert!((settings.iterate_delta.unwrap() - 0.01).abs() < 1e-10);
    }

    #[test]
    fn test_parse_calc_settings_iterate_false() {
        let xml = br#"<workbook><calcPr calcId="191029" iterate="0"/></workbook>"#;
        let settings = parse_calc_settings(xml);
        assert!(!settings.iterate);
    }

    // -------------------------------------------------------------------------
    // parse_all_rels tests
    // -------------------------------------------------------------------------

    #[test]
    fn test_parse_all_rels_preserves_all_types() {
        let xml = br#"<?xml version="1.0"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId3" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/>
  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/>
  <Relationship Id="rId5" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/theme" Target="theme/theme1.xml"/>
</Relationships>"#;

        let rels = parse_all_rels(xml);
        assert_eq!(rels.len(), 3);
        // Preserves original order and IDs
        assert_eq!(rels[0].id, "rId3");
        assert!(rels[0].rel_type.contains("worksheet"));
        assert_eq!(rels[1].id, "rId1");
        assert!(rels[1].rel_type.contains("styles"));
        assert_eq!(rels[2].id, "rId5");
        assert!(rels[2].rel_type.contains("theme"));
    }

    #[test]
    fn test_parse_all_rels_external() {
        let xml = br#"<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/hyperlink" Target="https://example.com" TargetMode="External"/>
</Relationships>"#;

        let rels = parse_all_rels(xml);
        assert_eq!(rels.len(), 1);
        assert_eq!(rels[0].id, "rId1");
        assert_eq!(rels[0].target, "https://example.com");
        assert_eq!(rels[0].target_mode, Some("External".to_string()));
    }
}
