//! External link XML writer.
//!
//! Serializes `ExternalLink` domain types back to:
//! - `xl/externalLinks/externalLinkN.xml` — the main external link XML
//! - `xl/externalLinks/_rels/externalLinkN.xml.rels` — relationship file with target URLs

use domain_types::domain::external_link::{
    CachedValue, DdeItem, DdeValueType, ExternalCacheValue, ExternalLink, ExternalLinkType, OleItem,
};

/// Content type for external link parts.
pub const CT_EXTERNAL_LINK: &str =
    "application/vnd.openxmlformats-officedocument.spreadsheetml.externalLink+xml";

/// Relationship type for external link paths (used inside the external link's own .rels file).
pub use crate::infra::opc::REL_EXTERNAL_LINK_PATH;

// Namespace URIs
const NS_SPREADSHEETML: &str = "http://schemas.openxmlformats.org/spreadsheetml/2006/main";
const NS_MC: &str = "http://schemas.openxmlformats.org/markup-compatibility/2006";
const NS_R: &str = "http://schemas.openxmlformats.org/officeDocument/2006/relationships";
const NS_RELATIONSHIPS: &str = "http://schemas.openxmlformats.org/package/2006/relationships";

/// Write the externalLinkN.xml content from an `ExternalLink`.
///
/// Returns the XML bytes for the external link file.
pub fn write_external_link_xml(link: &ExternalLink) -> Vec<u8> {
    let mut xml = Vec::with_capacity(1024);

    xml.extend_from_slice(b"<?xml version=\"1.0\" encoding=\"UTF-8\" standalone=\"yes\"?>\r\n");

    match &link.link_type {
        ExternalLinkType::Workbook => write_external_book(&mut xml, link),
        ExternalLinkType::Dde {
            service,
            topic,
            items,
        } => {
            write_dde_link(&mut xml, link, service, topic, items);
        }
        ExternalLinkType::Ole {
            prog_id,
            r_id,
            items,
        } => {
            write_ole_link(&mut xml, link, prog_id, r_id.as_deref(), items);
        }
    }

    xml
}

/// Write the externalLinkN.xml.rels content from an `ExternalLink`.
///
/// Returns the XML bytes for the relationship file, or `None` if no rels are needed.
pub fn write_external_link_rels(link: &ExternalLink) -> Option<Vec<u8>> {
    // Only workbook links have rels (with file paths)
    if link.file_path.is_none()
        && link.alternate_url.is_none()
        && link.relative_url.is_none()
        && link.extra_rels.is_empty()
    {
        return None;
    }

    let mut xml = Vec::with_capacity(512);
    xml.extend_from_slice(b"<?xml version=\"1.0\" encoding=\"UTF-8\" standalone=\"yes\"?>\r\n");
    xml.extend_from_slice(b"<Relationships xmlns=\"");
    xml.extend_from_slice(NS_RELATIONSHIPS.as_bytes());
    xml.extend_from_slice(b"\">");

    // Build a list of (rId, target, rel_type) using original rIds when available
    let primary_rel_type = link
        .file_path_rel_type
        .as_deref()
        .unwrap_or(REL_EXTERNAL_LINK_PATH);

    let mut rels: Vec<(String, String, String)> = Vec::new();
    if let Some(ref path) = link.file_path {
        let rid = link
            .file_path_rid
            .clone()
            .unwrap_or_else(|| "rId1".to_string());
        rels.push((rid, path.clone(), primary_rel_type.to_string()));
    }
    if let Some(ref alt_url) = link.alternate_url {
        let rid = link
            .alternate_url_rid
            .clone()
            .unwrap_or_else(|| "rId2".to_string());
        rels.push((rid, alt_url.clone(), REL_EXTERNAL_LINK_PATH.to_string()));
    }
    if let Some(ref rel_url) = link.relative_url {
        let rid = link.relative_url_rid.clone().unwrap_or_else(|| {
            if link.alternate_url.is_some() {
                "rId3".to_string()
            } else {
                "rId2".to_string()
            }
        });
        rels.push((rid, rel_url.clone(), REL_EXTERNAL_LINK_PATH.to_string()));
    }
    // Include extra/unmatched relationships (e.g., externalLinkLongPath)
    for extra in &link.extra_rels {
        rels.push((
            extra.id.clone(),
            extra.target.clone(),
            extra.rel_type.clone(),
        ));
    }

    // Respect original ordering if available
    if let Some(ref order) = link.rels_id_order {
        rels.sort_by_key(|(id, _, _)| order.iter().position(|o| o == id).unwrap_or(usize::MAX));
    }

    for (id, target, rel_type) in &rels {
        xml.extend_from_slice(b"<Relationship Id=\"");
        xml.extend_from_slice(id.as_bytes());
        xml.extend_from_slice(b"\" Type=\"");
        xml.extend_from_slice(rel_type.as_bytes());
        xml.extend_from_slice(b"\" Target=\"");
        xml.extend_from_slice(&escape_xml_attr(target));
        xml.extend_from_slice(b"\" TargetMode=\"External\"/>");
    }

    xml.extend_from_slice(b"</Relationships>");
    Some(xml)
}

fn write_external_book(xml: &mut Vec<u8>, link: &ExternalLink) {
    // Open <externalLink> with namespace declarations
    xml.extend_from_slice(b"<externalLink xmlns=\"");
    xml.extend_from_slice(NS_SPREADSHEETML.as_bytes());
    xml.push(b'"');

    // Add mc:Ignorable and extension namespaces
    let has_alternate = link.alternate_url.is_some();
    let has_xxl21 = has_alternate || link.relative_url.is_some();
    if has_xxl21 {
        xml.extend_from_slice(b" xmlns:mc=\"");
        xml.extend_from_slice(NS_MC.as_bytes());
        xml.extend_from_slice(b"\" mc:Ignorable=\"x14 xxl21\"");
        xml.extend_from_slice(
            b" xmlns:x14=\"http://schemas.microsoft.com/office/spreadsheetml/2009/9/main\"",
        );
        xml.extend_from_slice(
            b" xmlns:xxl21=\"http://schemas.microsoft.com/office/spreadsheetml/2021/extlinks2021\"",
        );
    } else if let Some(ref mc_val) = link.mc_ignorable {
        // Preserve original mc:Ignorable for round-trip fidelity
        xml.extend_from_slice(b" xmlns:mc=\"");
        xml.extend_from_slice(NS_MC.as_bytes());
        xml.extend_from_slice(b"\" mc:Ignorable=\"");
        xml.extend_from_slice(mc_val.as_bytes());
        xml.push(b'"');
        // Emit xmlns for each prefix in mc:Ignorable
        for prefix in mc_val.split_whitespace() {
            if prefix == "x14" {
                xml.extend_from_slice(
                    b" xmlns:x14=\"http://schemas.microsoft.com/office/spreadsheetml/2009/9/main\"",
                );
            } else if prefix == "xxl21" {
                xml.extend_from_slice(b" xmlns:xxl21=\"http://schemas.microsoft.com/office/spreadsheetml/2021/extlinks2021\"");
            }
        }
    }
    xml.push(b'>');

    // <externalBook> carries r:id only when a matching externalLinkPath
    // relationship is emitted for the primary workbook target.
    xml.extend_from_slice(b"<externalBook");
    if link.file_path.is_some() || link.alternate_url.is_some() || link.relative_url.is_some() {
        xml.extend_from_slice(b" xmlns:r=\"");
        xml.extend_from_slice(NS_R.as_bytes());
        xml.extend_from_slice(b"\"");
    }
    if link.file_path.is_some() {
        xml.extend_from_slice(b" r:id=\"");
        xml.extend_from_slice(link.file_path_rid.as_deref().unwrap_or("rId1").as_bytes());
        xml.extend_from_slice(b"\"");
    }
    xml.extend_from_slice(b">");

    // Write alternateUrls extension if present
    if has_alternate || link.relative_url.is_some() {
        let has_drive_id = link.alternate_urls_drive_id.is_some();
        let has_item_id = link.alternate_urls_item_id.is_some();
        if has_drive_id || has_item_id {
            xml.extend_from_slice(b"<xxl21:alternateUrls");
            if let Some(ref drive_id) = link.alternate_urls_drive_id {
                xml.extend_from_slice(b" driveId=\"");
                xml.extend_from_slice(&escape_xml_attr(drive_id));
                xml.push(b'"');
            }
            if let Some(ref item_id) = link.alternate_urls_item_id {
                xml.extend_from_slice(b" itemId=\"");
                xml.extend_from_slice(&escape_xml_attr(item_id));
                xml.push(b'"');
            }
            xml.push(b'>');
        } else {
            xml.extend_from_slice(b"<xxl21:alternateUrls>");
        }
        if has_alternate {
            xml.extend_from_slice(b"<xxl21:absoluteUrl r:id=\"");
            xml.extend_from_slice(
                link.alternate_url_rid
                    .as_deref()
                    .unwrap_or("rId2")
                    .as_bytes(),
            );
            xml.extend_from_slice(b"\"/>");
        }
        if link.relative_url.is_some() {
            let default_rid = if has_alternate { "rId3" } else { "rId2" };
            let rid = link.relative_url_rid.as_deref().unwrap_or(default_rid);
            xml.extend_from_slice(b"<xxl21:relativeUrl r:id=\"");
            xml.extend_from_slice(rid.as_bytes());
            xml.extend_from_slice(b"\"/>");
        }
        xml.extend_from_slice(b"</xxl21:alternateUrls>");
    }

    // Write sheetNames
    if !link.sheet_names.is_empty() {
        xml.extend_from_slice(b"<sheetNames>");
        for name in &link.sheet_names {
            xml.extend_from_slice(b"<sheetName val=\"");
            xml.extend_from_slice(&escape_xstring_attr(name));
            xml.extend_from_slice(b"\"/>");
        }
        xml.extend_from_slice(b"</sheetNames>");
    }

    // Write definedNames
    if !link.defined_names.is_empty() {
        xml.extend_from_slice(b"<definedNames>");
        for dn in &link.defined_names {
            xml.extend_from_slice(b"<definedName name=\"");
            xml.extend_from_slice(&escape_xstring_attr(&dn.name));
            xml.push(b'"');
            if let Some(ref refers_to) = dn.refers_to {
                xml.extend_from_slice(b" refersTo=\"");
                xml.extend_from_slice(&escape_xml_attr(refers_to));
                xml.push(b'"');
            }
            if let Some(sheet_id) = dn.sheet_id {
                xml.extend_from_slice(b" sheetId=\"");
                xml.extend_from_slice(sheet_id.to_string().as_bytes());
                xml.push(b'"');
            }
            xml.extend_from_slice(b"/>");
        }
        xml.extend_from_slice(b"</definedNames>");
    }

    // Write sheetDataSet
    if !link.sheet_data_ids.is_empty() {
        xml.extend_from_slice(b"<sheetDataSet>");
        for &sid in &link.sheet_data_ids {
            // Collect cached values for this sheet
            let sheet_values: Vec<_> = link
                .cache_values
                .iter()
                .filter(|v| v.sheet_id == sid)
                .collect();

            let has_refresh_error = link.refresh_error_sheet_ids.contains(&sid);

            if sheet_values.is_empty() {
                // Self-closing <sheetData sheetId="N" [refreshError="1"]/>
                xml.extend_from_slice(b"<sheetData sheetId=\"");
                xml.extend_from_slice(sid.to_string().as_bytes());
                xml.push(b'"');
                if has_refresh_error {
                    xml.extend_from_slice(b" refreshError=\"1\"");
                }
                xml.extend_from_slice(b"/>");
            } else {
                xml.extend_from_slice(b"<sheetData sheetId=\"");
                xml.extend_from_slice(sid.to_string().as_bytes());
                xml.push(b'"');
                if has_refresh_error {
                    xml.extend_from_slice(b" refreshError=\"1\"");
                }
                xml.push(b'>');

                // Group values by row for proper <row> wrapper emission
                let has_rows = sheet_values.iter().any(|cv| cv.row.is_some());

                if has_rows {
                    // Group cells by row number, maintaining original order
                    let mut current_row: Option<u32> = None;
                    for cv in &sheet_values {
                        let cell_row = cv.row;
                        // Close previous row if we're starting a new one
                        if current_row.is_some() && current_row != cell_row {
                            xml.extend_from_slice(b"</row>");
                            current_row = None;
                        }
                        // Open new row if needed
                        if let Some(r) = cell_row {
                            if current_row != cell_row {
                                xml.extend_from_slice(b"<row r=\"");
                                xml.extend_from_slice(r.to_string().as_bytes());
                                xml.extend_from_slice(b"\">");
                                current_row = Some(r);
                            }
                        }
                        write_cell_element(xml, cv);
                    }
                    // Close final row if open
                    if current_row.is_some() {
                        xml.extend_from_slice(b"</row>");
                    }
                } else {
                    // No row wrappers — write cells directly
                    for cv in &sheet_values {
                        write_cell_element(xml, cv);
                    }
                }

                xml.extend_from_slice(b"</sheetData>");
            }
        }
        xml.extend_from_slice(b"</sheetDataSet>");
    }

    xml.extend_from_slice(b"</externalBook>");
    write_ext_lst_xml(xml, link);
    xml.extend_from_slice(b"</externalLink>");
}

/// Write a single `<cell>` element to the XML output.
fn write_cell_element(xml: &mut Vec<u8>, cv: &ExternalCacheValue) {
    xml.extend_from_slice(b"<cell r=\"");
    xml.extend_from_slice(cv.cell_ref.as_bytes());
    xml.push(b'"');

    // Write type attribute
    match &cv.value {
        CachedValue::String(_) => xml.extend_from_slice(b" t=\"str\""),
        CachedValue::Boolean(_) => xml.extend_from_slice(b" t=\"b\""),
        CachedValue::Error(_) => xml.extend_from_slice(b" t=\"e\""),
        _ => {}
    }

    // Write value
    match &cv.value {
        CachedValue::Empty => {
            xml.extend_from_slice(b"/>");
        }
        CachedValue::Number(n) => {
            xml.extend_from_slice(b"><v>");
            // Use raw string if available (preserves original precision)
            if let Some(ref raw_str) = cv.raw_value {
                xml.extend_from_slice(raw_str.as_bytes());
            } else if n == &((n.round() as i64) as f64) {
                xml.extend_from_slice((*n as i64).to_string().as_bytes());
            } else {
                xml.extend_from_slice(n.to_string().as_bytes());
            }
            xml.extend_from_slice(b"</v></cell>");
        }
        CachedValue::String(s) => {
            if cv.preserve_space {
                xml.extend_from_slice(b"><v xml:space=\"preserve\">");
            } else {
                xml.extend_from_slice(b"><v>");
            }
            xml.extend_from_slice(&escape_xml_content(s));
            xml.extend_from_slice(b"</v></cell>");
        }
        CachedValue::Boolean(b) => {
            xml.extend_from_slice(b"><v>");
            xml.extend_from_slice(if *b { b"1" } else { b"0" });
            xml.extend_from_slice(b"</v></cell>");
        }
        CachedValue::Error(e) => {
            xml.extend_from_slice(b"><v>");
            xml.extend_from_slice(&escape_xml_content(e));
            xml.extend_from_slice(b"</v></cell>");
        }
    }
}

fn write_dde_link(
    xml: &mut Vec<u8>,
    link: &ExternalLink,
    service: &str,
    topic: &str,
    items: &[DdeItem],
) {
    xml.extend_from_slice(b"<externalLink xmlns=\"");
    xml.extend_from_slice(NS_SPREADSHEETML.as_bytes());
    xml.extend_from_slice(b"\">");
    xml.extend_from_slice(b"<ddeLink ddeService=\"");
    xml.extend_from_slice(&escape_xml_attr(service));
    xml.extend_from_slice(b"\" ddeTopic=\"");
    xml.extend_from_slice(&escape_xml_attr(topic));
    xml.push(b'"');
    if items.is_empty() {
        xml.extend_from_slice(b"/>");
    } else {
        xml.extend_from_slice(b"><ddeItems>");
        for item in items {
            write_dde_item(xml, item);
        }
        xml.extend_from_slice(b"</ddeItems></ddeLink>");
    }
    write_ext_lst_xml(xml, link);
    xml.extend_from_slice(b"</externalLink>");
}

fn write_ole_link(
    xml: &mut Vec<u8>,
    link: &ExternalLink,
    prog_id: &str,
    r_id: Option<&str>,
    items: &[OleItem],
) {
    xml.extend_from_slice(b"<externalLink xmlns=\"");
    xml.extend_from_slice(NS_SPREADSHEETML.as_bytes());
    xml.push(b'"');
    if r_id.is_some() {
        xml.extend_from_slice(b" xmlns:r=\"");
        xml.extend_from_slice(NS_R.as_bytes());
        xml.push(b'"');
    }
    xml.push(b'>');
    xml.extend_from_slice(b"<oleLink progId=\"");
    xml.extend_from_slice(&escape_xml_attr(prog_id));
    xml.push(b'"');
    if let Some(r_id) = r_id {
        xml.extend_from_slice(b" r:id=\"");
        xml.extend_from_slice(&escape_xml_attr(r_id));
        xml.push(b'"');
    }
    if items.is_empty() {
        xml.extend_from_slice(b"/>");
    } else {
        xml.extend_from_slice(b"><oleItems>");
        for item in items {
            write_ole_item(xml, item);
        }
        xml.extend_from_slice(b"</oleItems></oleLink>");
    }
    write_ext_lst_xml(xml, link);
    xml.extend_from_slice(b"</externalLink>");
}

fn write_dde_item(xml: &mut Vec<u8>, item: &DdeItem) {
    xml.extend_from_slice(b"<ddeItem");
    if let Some(name) = &item.name {
        xml.extend_from_slice(b" name=\"");
        xml.extend_from_slice(&escape_xml_attr(name));
        xml.push(b'"');
    }
    write_bool_attr(xml, "ole", item.ole);
    write_bool_attr(xml, "advise", item.advise);
    write_bool_attr(xml, "preferPic", item.prefer_pic);
    if item.values.is_empty() && item.rows.is_none() && item.cols.is_none() {
        xml.extend_from_slice(b"/>");
        return;
    }
    xml.extend_from_slice(b"><values");
    if let Some(rows) = item.rows {
        xml.extend_from_slice(b" rows=\"");
        xml.extend_from_slice(rows.to_string().as_bytes());
        xml.push(b'"');
    }
    if let Some(cols) = item.cols {
        xml.extend_from_slice(b" cols=\"");
        xml.extend_from_slice(cols.to_string().as_bytes());
        xml.push(b'"');
    }
    xml.push(b'>');
    for value in &item.values {
        xml.extend_from_slice(b"<value t=\"");
        xml.extend_from_slice(dde_value_type_token(value.value_type).as_bytes());
        xml.extend_from_slice(b"\" val=\"");
        xml.extend_from_slice(&escape_xml_attr(&value.value));
        xml.extend_from_slice(b"\"/>");
    }
    xml.extend_from_slice(b"</values></ddeItem>");
}

fn write_ole_item(xml: &mut Vec<u8>, item: &OleItem) {
    xml.extend_from_slice(b"<oleItem name=\"");
    xml.extend_from_slice(&escape_xml_attr(&item.name));
    xml.push(b'"');
    write_bool_attr(xml, "icon", item.icon);
    write_bool_attr(xml, "advise", item.advise);
    write_bool_attr(xml, "preferPic", item.prefer_pic);
    xml.extend_from_slice(b"/>");
}

fn write_bool_attr(xml: &mut Vec<u8>, name: &str, value: bool) {
    if value {
        xml.push(b' ');
        xml.extend_from_slice(name.as_bytes());
        xml.extend_from_slice(b"=\"1\"");
    }
}

fn dde_value_type_token(value_type: DdeValueType) -> &'static str {
    match value_type {
        DdeValueType::Nil => "nil",
        DdeValueType::Boolean => "b",
        DdeValueType::Number => "n",
        DdeValueType::Error => "e",
        DdeValueType::String => "str",
    }
}

fn write_ext_lst_xml(xml: &mut Vec<u8>, link: &ExternalLink) {
    if let Some(ext_lst_xml) = &link.ext_lst_xml {
        xml.extend_from_slice(ext_lst_xml.as_bytes());
    }
}

/// Escape XML special characters in attribute values.
fn escape_xml_attr(s: &str) -> Vec<u8> {
    let mut result = Vec::with_capacity(s.len());
    for byte in s.bytes() {
        match byte {
            b'&' => result.extend_from_slice(b"&amp;"),
            b'<' => result.extend_from_slice(b"&lt;"),
            b'>' => result.extend_from_slice(b"&gt;"),
            b'"' => result.extend_from_slice(b"&quot;"),
            b'\'' => result.extend_from_slice(b"&apos;"),
            _ => result.push(byte),
        }
    }
    result
}

/// Escape OOXML ST_Xstring attribute values, including characters decoded from
/// `_xHHHH_` sequences during parse.
fn escape_xstring_attr(s: &str) -> Vec<u8> {
    let mut result = Vec::with_capacity(s.len());
    let bytes = s.as_bytes();
    let mut i = 0;

    while i < bytes.len() {
        let byte = bytes[i];
        if byte == b'_'
            && i + 6 < bytes.len()
            && bytes[i + 1] == b'x'
            && bytes[i + 6] == b'_'
            && bytes[i + 2..i + 6].iter().all(|b| b.is_ascii_hexdigit())
        {
            result.extend_from_slice(b"_x005f_");
            i += 1;
            continue;
        }

        match byte {
            b'\n' => result.extend_from_slice(b"_x000a_"),
            b'\r' => result.extend_from_slice(b"_x000d_"),
            b'\t' => result.extend_from_slice(b"_x0009_"),
            b'&' => result.extend_from_slice(b"&amp;"),
            b'<' => result.extend_from_slice(b"&lt;"),
            b'>' => result.extend_from_slice(b"&gt;"),
            b'"' => result.extend_from_slice(b"&quot;"),
            b'\'' => result.extend_from_slice(b"&apos;"),
            0x00..=0x08 | 0x0B | 0x0C | 0x0E..=0x1F => {
                use std::io::Write;
                write!(&mut result, "_x{byte:04x}_").ok();
            }
            _ => result.push(byte),
        }
        i += 1;
    }

    result
}

/// Escape XML content (text nodes — not attributes).
fn escape_xml_content(s: &str) -> Vec<u8> {
    let mut out = Vec::with_capacity(s.len());
    for b in s.bytes() {
        match b {
            b'&' => out.extend_from_slice(b"&amp;"),
            b'<' => out.extend_from_slice(b"&lt;"),
            b'>' => out.extend_from_slice(b"&gt;"),
            _ => out.push(b),
        }
    }
    out
}

#[cfg(test)]
mod tests {
    use super::super::read::ExternalLinks;
    use super::*;
    use domain_types::domain::external_link::{DdeValue, ExternalCacheValue, OleItem};

    #[test]
    fn test_write_external_book_basic() {
        let mut link = ExternalLink::workbook(
            "1".to_string(),
            Some("https://example.com/file.xlsx".to_string()),
        );
        link.sheet_names = vec!["Sheet1".to_string(), "Sheet2".to_string()];
        link.sheet_data_ids = vec![0, 1];

        let xml = write_external_link_xml(&link);
        let xml_str = String::from_utf8(xml).unwrap();

        assert!(xml_str.contains("<externalLink xmlns="));
        assert!(xml_str.contains("<externalBook"));
        assert!(xml_str.contains("r:id=\"rId1\""));
        assert!(xml_str.contains("<sheetName val=\"Sheet1\"/>"));
        assert!(xml_str.contains("<sheetName val=\"Sheet2\"/>"));
        assert!(xml_str.contains("<sheetData sheetId=\"0\"/>"));
        assert!(xml_str.contains("<sheetData sheetId=\"1\"/>"));
    }

    #[test]
    fn test_write_sheet_names_as_ooxml_xstring_attrs() {
        let mut link = ExternalLink::workbook("1".to_string(), Some("path".to_string()));
        link.sheet_names = vec!["JV\n".to_string(), "_x000a_".to_string()];

        let xml = write_external_link_xml(&link);
        let xml_str = String::from_utf8(xml).unwrap();

        assert!(xml_str.contains("<sheetName val=\"JV_x000a_\"/>"));
        assert!(xml_str.contains("<sheetName val=\"_x005f_x000a_\"/>"));
    }

    #[test]
    fn test_write_external_book_with_alternate_url() {
        let mut link = ExternalLink::workbook(
            "1".to_string(),
            Some("https://example.com/file.xlsx".to_string()),
        );
        link.alternate_url = Some("https://alt.example.com/file.xlsx".to_string());
        link.sheet_names = vec!["Sheet1".to_string()];
        link.sheet_data_ids = vec![0];

        let xml = write_external_link_xml(&link);
        let xml_str = String::from_utf8(xml).unwrap();

        assert!(xml_str.contains("mc:Ignorable=\"x14 xxl21\""));
        assert!(xml_str.contains("xmlns:xxl21="));
        assert!(xml_str.contains("<xxl21:alternateUrls>"));
        assert!(xml_str.contains("<xxl21:absoluteUrl r:id=\"rId2\"/>"));
    }

    #[test]
    fn test_write_external_link_rels() {
        let mut link = ExternalLink::workbook(
            "1".to_string(),
            Some("https://example.com/file.xlsx".to_string()),
        );
        link.alternate_url = Some("https://alt.example.com/file.xlsx".to_string());

        let rels = write_external_link_rels(&link).unwrap();
        let rels_str = String::from_utf8(rels).unwrap();

        assert!(rels_str.contains("Id=\"rId1\""));
        assert!(rels_str.contains("Target=\"https://example.com/file.xlsx\""));
        assert!(rels_str.contains("TargetMode=\"External\""));
        assert!(rels_str.contains("Id=\"rId2\""));
        assert!(rels_str.contains("Target=\"https://alt.example.com/file.xlsx\""));
    }

    #[test]
    fn test_write_external_link_rels_no_path() {
        let link = ExternalLink::new("1".to_string());
        assert!(write_external_link_rels(&link).is_none());
    }

    #[test]
    fn test_write_cached_values() {
        let mut link = ExternalLink::workbook("1".to_string(), Some("path".to_string()));
        link.sheet_names = vec!["Sheet1".to_string()];
        link.sheet_data_ids = vec![0];
        link.cache_values = vec![
            ExternalCacheValue::new(0, "A1".to_string(), CachedValue::Number(100.0)),
            ExternalCacheValue::new(
                0,
                "B1".to_string(),
                CachedValue::String("Hello".to_string()),
            ),
            ExternalCacheValue::new(0, "C1".to_string(), CachedValue::Boolean(true)),
            ExternalCacheValue::new(0, "D1".to_string(), CachedValue::Error("#REF!".to_string())),
        ];

        let xml = write_external_link_xml(&link);
        let xml_str = String::from_utf8(xml).unwrap();

        assert!(xml_str.contains("<cell r=\"A1\"><v>100</v></cell>"));
        assert!(xml_str.contains("<cell r=\"B1\" t=\"str\"><v>Hello</v></cell>"));
        assert!(xml_str.contains("<cell r=\"C1\" t=\"b\"><v>1</v></cell>"));
        assert!(xml_str.contains("<cell r=\"D1\" t=\"e\"><v>#REF!</v></cell>"));
    }

    #[test]
    fn test_roundtrip_parse_write() {
        let original_xml = br#"<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<externalLink xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:mc="http://schemas.openxmlformats.org/markup-compatibility/2006" mc:Ignorable="x14 xxl21" xmlns:x14="http://schemas.microsoft.com/office/spreadsheetml/2009/9/main" xmlns:xxl21="http://schemas.microsoft.com/office/spreadsheetml/2021/extlinks2021"><externalBook xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" r:id="rId1"><xxl21:alternateUrls><xxl21:absoluteUrl r:id="rId2"/></xxl21:alternateUrls><sheetNames><sheetName val="Loan Calculator"/><sheetName val="sheet1"/></sheetNames><sheetDataSet><sheetData sheetId="0"/><sheetData sheetId="1"/></sheetDataSet></externalBook></externalLink>"#;

        let rels_xml = br#"<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/externalLinkPath" Target="https://example.com/fixtures/excel-loan-calculator.xlsx" TargetMode="External"/><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/externalLinkPath" Target="https://example.com/fixtures/excel-loan-calculator.xlsx" TargetMode="External"/></Relationships>"#;

        // Parse
        let mut link = ExternalLinks::parse_external_link(original_xml, "1").unwrap();
        ExternalLinks::resolve_rels(&mut link, rels_xml, original_xml);

        // Verify parsing
        assert_eq!(link.sheet_names, vec!["Loan Calculator", "sheet1"]);
        assert!(link.file_path.is_some());
        assert!(link.alternate_url.is_some());
        assert_eq!(link.sheet_data_ids, vec![0, 1]);

        // Write back
        let written_xml = write_external_link_xml(&link);
        let written_xml_str = String::from_utf8(written_xml).unwrap();

        // Verify key structural elements are preserved
        assert!(written_xml_str.contains("mc:Ignorable=\"x14 xxl21\""));
        assert!(written_xml_str.contains("<xxl21:alternateUrls>"));
        assert!(written_xml_str.contains("<sheetName val=\"Loan Calculator\"/>"));
        assert!(written_xml_str.contains("<sheetName val=\"sheet1\"/>"));
        assert!(written_xml_str.contains("<sheetData sheetId=\"0\"/>"));
        assert!(written_xml_str.contains("<sheetData sheetId=\"1\"/>"));
    }

    #[test]
    fn test_write_dde_link() {
        let mut link = ExternalLink::dde(
            "1".to_string(),
            "Excel".to_string(),
            "[Book1.xlsx]Sheet1".to_string(),
        );
        if let ExternalLinkType::Dde { items, .. } = &mut link.link_type {
            items.push(DdeItem {
                name: Some("R1C1".to_string()),
                advise: true,
                rows: Some(1),
                cols: Some(1),
                values: vec![DdeValue {
                    value_type: DdeValueType::String,
                    value: "cached".to_string(),
                }],
                ..Default::default()
            });
        }
        let xml = write_external_link_xml(&link);
        let xml_str = String::from_utf8(xml).unwrap();

        assert!(xml_str.contains("<ddeLink ddeService=\"Excel\" ddeTopic=\"[Book1.xlsx]Sheet1\">"));
        assert!(xml_str.contains("<ddeItem name=\"R1C1\" advise=\"1\">"));
        assert!(
            xml_str.contains("<values rows=\"1\" cols=\"1\"><value t=\"str\" val=\"cached\"/>")
        );
    }

    #[test]
    fn test_write_ole_link() {
        let mut link = ExternalLink::ole("1".to_string(), "Excel.Sheet.12".to_string());
        link.link_type = ExternalLinkType::Ole {
            prog_id: "Excel.Sheet.12".to_string(),
            r_id: Some("rId1".to_string()),
            items: vec![OleItem {
                name: "Sheet1".to_string(),
                icon: true,
                advise: true,
                prefer_pic: false,
            }],
        };
        let xml = write_external_link_xml(&link);
        let xml_str = String::from_utf8(xml).unwrap();

        assert!(xml_str.contains("xmlns:r="));
        assert!(xml_str.contains("<oleLink progId=\"Excel.Sheet.12\" r:id=\"rId1\">"));
        assert!(xml_str.contains("<oleItem name=\"Sheet1\" icon=\"1\" advise=\"1\"/>"));
    }
}
