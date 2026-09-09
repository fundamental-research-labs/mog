//! Typed read/write support for workbook connections and table-owned query tables.

use domain_types::domain::connections::*;
use quick_xml::events::Event;
use quick_xml::name::{Namespace, ResolveResult};
use quick_xml::reader::NsReader;

use crate::infra::opc::{PackageOwner, parse_owned_relationships};
use crate::infra::scanner::{find_closing_tag, find_gt_simd, find_tag_simd};
use crate::infra::xml::{extract_direct_child_element_xml, parse_string_attr};
use crate::zip::XlsxArchive;

pub const REL_CONNECTIONS: &str =
    "http://schemas.openxmlformats.org/officeDocument/2006/relationships/connections";
pub const REL_QUERY_TABLE: &str =
    "http://schemas.openxmlformats.org/officeDocument/2006/relationships/queryTable";
pub const CT_CONNECTIONS: &str =
    "application/vnd.openxmlformats-officedocument.spreadsheetml.connections+xml";
pub const CT_QUERY_TABLE: &str =
    "application/vnd.openxmlformats-officedocument.spreadsheetml.queryTable+xml";
mod preservation;

pub fn parse_connections(archive: &XlsxArchive) -> WorkbookConnectionSet {
    archive
        .read_file("xl/connections.xml")
        .ok()
        .map(|xml| parse_connections_xml(&xml))
        .unwrap_or_default()
}

pub fn parse_connections_xml(xml: &[u8]) -> WorkbookConnectionSet {
    let mut connections = Vec::new();
    if let Some(root) = parse_xml_root(xml)
        .filter(|root| root.local == b"connections" && root.namespace == XmlNamespace::Main)
    {
        for (source_index, child) in root
            .children
            .iter()
            .filter(|child| child.namespace == XmlNamespace::Main && child.local == b"connection")
            .enumerate()
        {
            if let Some(mut connection) = parse_connection(xml, child) {
                connection.raw_source_index = Some(source_index);
                connections.push(connection);
            }
        }
    }
    WorkbookConnectionSet::from_imported_xml(connections, xml)
}

const MAIN_NS: &[u8] = b"http://schemas.openxmlformats.org/spreadsheetml/2006/main";

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
enum XmlNamespace {
    Main,
    Other,
    Unbound,
}

#[derive(Clone, Debug)]
struct XmlElement {
    name: Vec<u8>,
    local: Vec<u8>,
    namespace: XmlNamespace,
    start: usize,
    start_tag_end: usize,
    end: usize,
    children: Vec<XmlElement>,
}

/// Parse the document into a small element tree so typed projections can
/// resolve inherited namespace declarations and inspect direct children only.
/// The raw source remains owned by the preservation layer; this tree is only a
/// read-side projection and is deliberately conservative on malformed XML.
fn parse_xml_root(xml: &[u8]) -> Option<XmlElement> {
    let mut reader = NsReader::from_reader(xml);
    reader.config_mut().trim_text(false);
    reader.config_mut().expand_empty_elements = false;
    let mut buf = Vec::new();
    let mut stack = Vec::<XmlElement>::new();
    let mut root = None;

    loop {
        let start = usize::try_from(reader.buffer_position()).ok()?;
        let (namespace, event) = reader.read_resolved_event_into(&mut buf).ok()?;
        // Resolve the namespace before asking the reader for its post-event
        // position because `ResolveResult` borrows the reader's state.
        let namespace = xml_namespace(&namespace);
        let end = usize::try_from(reader.buffer_position()).ok()?;
        match event {
            Event::Start(element) => {
                stack.push(XmlElement {
                    name: element.name().as_ref().to_vec(),
                    local: element.local_name().as_ref().to_vec(),
                    namespace,
                    start,
                    start_tag_end: end,
                    end: 0,
                    children: Vec::new(),
                });
            }
            Event::Empty(element) => {
                append_xml_element(
                    XmlElement {
                        name: element.name().as_ref().to_vec(),
                        local: element.local_name().as_ref().to_vec(),
                        namespace,
                        start,
                        start_tag_end: end,
                        end,
                        children: Vec::new(),
                    },
                    &mut stack,
                    &mut root,
                )?;
            }
            Event::End(element) => {
                let end_name = element.name().as_ref().to_vec();
                let mut node = stack.pop()?;
                if node.name != end_name {
                    return None;
                }
                node.end = end;
                append_xml_element(node, &mut stack, &mut root)?;
            }
            Event::Eof => break,
            _ => {}
        }
        buf.clear();
    }

    if !stack.is_empty() {
        return None;
    }
    root
}

fn append_xml_element(
    element: XmlElement,
    stack: &mut [XmlElement],
    root: &mut Option<XmlElement>,
) -> Option<()> {
    if let Some(parent) = stack.last_mut() {
        parent.children.push(element);
        return Some(());
    }
    if root.is_some() {
        return None;
    }
    *root = Some(element);
    Some(())
}

fn xml_namespace(namespace: &ResolveResult<'_>) -> XmlNamespace {
    match namespace {
        ResolveResult::Bound(Namespace(uri)) if *uri == MAIN_NS => XmlNamespace::Main,
        ResolveResult::Bound(_) | ResolveResult::Unknown(_) => XmlNamespace::Other,
        // An unbound element is not a SpreadsheetML element. In particular it
        // must not acquire source provenance that the preservation tree cannot
        // resolve back to the main namespace.
        ResolveResult::Unbound => XmlNamespace::Unbound,
    }
}

impl XmlElement {
    fn direct_main_child(&self, local: &[u8]) -> Option<&XmlElement> {
        self.children
            .iter()
            .find(|child| child.namespace == XmlNamespace::Main && child.local == local)
    }
}

fn element_xml(xml: &[u8], node: &XmlElement) -> Option<String> {
    std::str::from_utf8(&xml[node.start..node.end])
        .ok()
        .map(ToOwned::to_owned)
}

fn parse_u32_attr_decoded(xml: &[u8], attr: &[u8]) -> Option<u32> {
    parse_string_attr(xml, attr)?.trim().parse().ok()
}

fn parse_i32_attr_decoded(xml: &[u8], attr: &[u8]) -> Option<i32> {
    parse_string_attr(xml, attr)?.trim().parse().ok()
}

fn parse_f64_attr_decoded(xml: &[u8], attr: &[u8]) -> Option<f64> {
    parse_string_attr(xml, attr)?.trim().parse().ok()
}

fn parse_bool_attr_decoded(xml: &[u8], attr: &[u8]) -> Option<bool> {
    match parse_string_attr(xml, attr)?.trim() {
        "true" | "1" => Some(true),
        "false" | "0" => Some(false),
        _ => None,
    }
}

pub fn parse_query_table_for_path(
    archive: &XlsxArchive,
    path: &str,
    relationship_id: Option<String>,
) -> Option<QueryTable> {
    let xml = archive.read_file(path).ok()?;
    let mut query_table = parse_query_table_xml(&xml)?;
    query_table.relationship_id = relationship_id;
    query_table.path_hint = Some(path.to_string());
    Some(query_table)
}

pub fn query_table_relationship_for_table(
    archive: &XlsxArchive,
    table_path: &str,
) -> Option<(String, String)> {
    let rels_path = table_relationships_path(table_path)?;
    let rels_xml = archive.read_file(&rels_path).ok()?;
    let relationships = parse_owned_relationships(
        PackageOwner::CustomPart {
            path: table_path.to_string(),
        },
        &rels_xml,
    );
    relationships.into_iter().find_map(|rel| {
        (rel.rel_type.uri() == REL_QUERY_TABLE)
            .then(|| rel.target.path().map(|path| (rel.id, path.to_string())))
            .flatten()
    })
}

pub fn parse_query_table_xml(xml: &[u8]) -> Option<QueryTable> {
    let start = find_tag_simd(xml, b"queryTable", 0)?;
    let tag_end = find_gt_simd(xml, start)?;
    let tag = &xml[start..tag_end];
    let query_table_xml = element_slice(xml, b"queryTable", start, tag_end)?;
    let refresh_xml =
        extract_direct_child_element_xml(query_table_xml, b"queryTable", b"queryTableRefresh");
    let refresh_bytes = refresh_xml.as_deref().map(str::as_bytes);
    let refresh_tag =
        refresh_bytes.and_then(|refresh| find_gt_simd(refresh, 0).map(|end| &refresh[..end]));

    let fields_xml = refresh_bytes.and_then(|refresh| {
        extract_direct_child_element_xml(refresh, b"queryTableRefresh", b"queryTableFields")
    });
    let deleted_fields_xml = refresh_bytes.and_then(|refresh| {
        extract_direct_child_element_xml(refresh, b"queryTableRefresh", b"queryTableDeletedFields")
    });

    let mut fields = Vec::new();
    let mut deleted_fields = Vec::new();
    if let Some(fields_xml) = fields_xml.as_deref() {
        let content = fields_xml.as_bytes();
        let content_start = find_gt_simd(content, 0).map_or(0, |end| end + 1);
        let content_end =
            find_closing_tag(content, b"queryTableFields", content_start).unwrap_or(content.len());
        let content = &content[content_start..content_end];
        let mut pos = 0;
        while let Some(s) = find_tag_simd(content, b"queryTableField", pos) {
            let Some(e) = find_gt_simd(content, s) else {
                break;
            };
            let Some(field_xml) = element_slice(content, b"queryTableField", s, e) else {
                break;
            };
            let field_tag = &field_xml[..e - s];
            fields.push(QueryTableField {
                id: parse_u32_attr_decoded(field_tag, b"id=\"").unwrap_or(0),
                name: parse_string_attr(field_tag, b"name=\""),
                table_column_id: parse_u32_attr_decoded(field_tag, b"tableColumnId=\""),
                data_bound: parse_bool_attr_decoded(field_tag, b"dataBound=\"").unwrap_or(false),
                row_numbers: parse_bool_attr_decoded(field_tag, b"rowNumbers=\"").unwrap_or(false),
                fill_formulas: parse_bool_attr_decoded(field_tag, b"fillFormulas=\"")
                    .unwrap_or(false),
                clipped: parse_bool_attr_decoded(field_tag, b"clipped=\"").unwrap_or(false),
                ext_lst_xml: extract_direct_child_element_xml(
                    field_xml,
                    b"queryTableField",
                    b"extLst",
                ),
            });
            pos = e + 1;
        }
    }
    if let Some(deleted_fields_xml) = deleted_fields_xml.as_deref() {
        let content = deleted_fields_xml.as_bytes();
        let content_start = find_gt_simd(content, 0).map_or(0, |end| end + 1);
        let content_end = find_closing_tag(content, b"queryTableDeletedFields", content_start)
            .unwrap_or(content.len());
        let content = &content[content_start..content_end];
        let mut pos = 0;
        while let Some(s) = find_tag_simd(content, b"deletedField", pos) {
            let Some(e) = find_gt_simd(content, s) else {
                break;
            };
            deleted_fields.push(QueryTableDeletedField {
                name: parse_string_attr(&content[s..e], b"name=\""),
            });
            pos = e + 1;
        }
    }

    Some(QueryTable {
        connection_id: parse_u32_attr_decoded(tag, b"connectionId=\""),
        name: parse_string_attr(tag, b"name=\""),
        auto_format_id: parse_u32_attr_decoded(tag, b"autoFormatId=\""),
        apply_number_formats: parse_bool_attr_decoded(tag, b"applyNumberFormats=\"")
            .unwrap_or(false),
        apply_border_formats: parse_bool_attr_decoded(tag, b"applyBorderFormats=\"")
            .unwrap_or(false),
        apply_font_formats: parse_bool_attr_decoded(tag, b"applyFontFormats=\"").unwrap_or(false),
        apply_pattern_formats: parse_bool_attr_decoded(tag, b"applyPatternFormats=\"")
            .unwrap_or(false),
        apply_alignment_formats: parse_bool_attr_decoded(tag, b"applyAlignmentFormats=\"")
            .unwrap_or(false),
        apply_width_height_formats: parse_bool_attr_decoded(tag, b"applyWidthHeightFormats=\"")
            .unwrap_or(false),
        refresh_on_load: parse_bool_attr_decoded(tag, b"refreshOnLoad=\"").unwrap_or(false),
        grow_shrink_type: parse_string_attr(tag, b"growShrinkType=\""),
        fill_formulas: parse_bool_attr_decoded(tag, b"fillFormulas=\"").unwrap_or(false),
        remove_data_on_save: parse_bool_attr_decoded(tag, b"removeDataOnSave=\"").unwrap_or(false),
        disable_edit: parse_bool_attr_decoded(tag, b"disableEdit=\"").unwrap_or(false),
        preserve_formatting: parse_bool_attr_decoded(tag, b"preserveFormatting=\"")
            .unwrap_or(false),
        adjust_column_width: parse_bool_attr_decoded(tag, b"adjustColumnWidth=\"").unwrap_or(false),
        intermediate: parse_bool_attr_decoded(tag, b"intermediate=\"").unwrap_or(false),
        connection_id_deleted: parse_bool_attr_decoded(tag, b"connectionIdDeleted=\"")
            .unwrap_or(false),
        headers: parse_bool_attr_decoded(tag, b"headers=\"").unwrap_or(true),
        row_numbers: parse_bool_attr_decoded(tag, b"rowNumbers=\"").unwrap_or(false),
        disable_refresh: parse_bool_attr_decoded(tag, b"disableRefresh=\"").unwrap_or(false),
        background_refresh: parse_bool_attr_decoded(tag, b"backgroundRefresh=\"").unwrap_or(false),
        first_background_refresh: parse_bool_attr_decoded(tag, b"firstBackgroundRefresh=\"")
            .unwrap_or(false),
        next_id: parse_u32_attr_decoded(tag, b"nextId=\"")
            .or_else(|| refresh_tag.and_then(|t| parse_u32_attr_decoded(t, b"nextId=\""))),
        minimum_version: refresh_tag.and_then(|t| parse_u32_attr_decoded(t, b"minimumVersion=\"")),
        refresh_present: refresh_bytes.is_some(),
        preserve_sort_filter_layout: refresh_tag
            .and_then(|t| parse_bool_attr_decoded(t, b"preserveSortFilterLayout=\""))
            .unwrap_or(false),
        field_id_wrapped: refresh_tag
            .and_then(|t| parse_bool_attr_decoded(t, b"fieldIdWrapped=\""))
            .unwrap_or(false),
        headers_in_last_refresh: refresh_tag
            .and_then(|t| parse_bool_attr_decoded(t, b"headersInLastRefresh=\""))
            .unwrap_or(false),
        unbound_columns_left: refresh_tag
            .and_then(|t| parse_u32_attr_decoded(t, b"unboundColumnsLeft=\"")),
        unbound_columns_right: refresh_tag
            .and_then(|t| parse_u32_attr_decoded(t, b"unboundColumnsRight=\"")),
        sort_state_xml: refresh_bytes.and_then(|refresh| {
            extract_direct_child_element_xml(refresh, b"queryTableRefresh", b"sortState")
        }),
        refresh_ext_lst_xml: refresh_bytes.and_then(|refresh| {
            extract_direct_child_element_xml(refresh, b"queryTableRefresh", b"extLst")
        }),
        fields,
        deleted_fields,
        ext_lst_xml: extract_direct_child_element_xml(query_table_xml, b"queryTable", b"extLst"),
        ..Default::default()
    })
}

pub fn write_connections_xml(connections: &[WorkbookConnection]) -> Vec<u8> {
    let mut xml = String::from(
        r#"<?xml version="1.0" encoding="UTF-8" standalone="yes"?><connections xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">"#,
    );
    for c in connections {
        xml.push_str("<connection");
        attr_u32(&mut xml, "id", Some(c.id));
        attr_opt(&mut xml, "name", c.name.as_deref());
        attr_opt(&mut xml, "description", c.description.as_deref());
        attr_u32(&mut xml, "type", c.connection_type);
        attr_u32(&mut xml, "refreshedVersion", c.refreshed_version);
        attr_u32(&mut xml, "minRefreshableVersion", c.min_refreshable_version);
        attr_bool(&mut xml, "saveData", c.save_data);
        attr_opt(&mut xml, "credentials", c.credentials.as_deref());
        attr_opt(&mut xml, "singleSignOnId", c.single_sign_on_id.as_deref());
        attr_bool(&mut xml, "background", c.background);
        attr_bool(&mut xml, "deleted", c.deleted);
        attr_bool(&mut xml, "keepAlive", c.keep_alive);
        attr_bool(&mut xml, "new", c.new_connection);
        attr_opt(&mut xml, "odcFile", c.odc_file.as_deref());
        attr_bool(
            &mut xml,
            "onlyUseConnectionFile",
            c.only_use_connection_file,
        );
        attr_u32(&mut xml, "reconnectionMethod", c.reconnection_method);
        attr_bool(&mut xml, "refreshOnLoad", c.refresh_on_load);
        attr_bool(&mut xml, "savePassword", c.save_password);
        attr_opt(&mut xml, "sourceFile", c.source_file.as_deref());
        attr_u32(&mut xml, "interval", c.interval);
        xml.push('>');
        if let Some(db) = &c.db_pr {
            write_db_pr(&mut xml, "dbPr", db);
        }
        if let Some(olap) = &c.olap_pr {
            xml.push_str("<olapPr");
            attr_bool(&mut xml, "local", olap.local);
            attr_opt(
                &mut xml,
                "localConnection",
                olap.local_connection.as_deref(),
            );
            attr_bool(&mut xml, "localRefresh", olap.local_refresh);
            attr_bool(&mut xml, "sendLocale", olap.send_locale);
            attr_u32(&mut xml, "rowDrillCount", olap.row_drill_count);
            attr_bool_opt(&mut xml, "serverFill", olap.server_fill);
            attr_bool_opt(&mut xml, "serverNumberFormat", olap.server_number_format);
            attr_bool_opt(&mut xml, "serverFont", olap.server_font);
            attr_bool_opt(&mut xml, "serverFontColor", olap.server_font_color);
            xml.push_str("/>");
        }
        if let Some(web) = &c.web_pr {
            write_web_pr(&mut xml, web);
        }
        if let Some(text) = &c.text_pr {
            write_text_pr(&mut xml, text);
        }
        if !c.parameters.is_empty() {
            xml.push_str(&format!(r#"<parameters count="{}">"#, c.parameters.len()));
            for p in &c.parameters {
                xml.push_str("<parameter");
                attr_opt(&mut xml, "name", p.name.as_deref());
                attr_i32(&mut xml, "sqlType", p.sql_type);
                attr_opt(&mut xml, "parameterType", p.parameter_type.as_deref());
                attr_bool(&mut xml, "refreshOnChange", p.refresh_on_change);
                attr_opt(&mut xml, "prompt", p.prompt.as_deref());
                attr_opt(&mut xml, "string", p.string.as_deref());
                attr_opt(&mut xml, "cell", p.cell.as_deref());
                if let Some(v) = p.boolean {
                    attr_bool(&mut xml, "boolean", v);
                }
                if let Some(v) = p.double {
                    xml.push_str(&format!(r#" double="{v}""#));
                }
                if let Some(v) = p.integer {
                    xml.push_str(&format!(r#" integer="{v}""#));
                }
                xml.push_str("/>");
            }
            xml.push_str("</parameters>");
        }
        if let Some(ext) = &c.ext_lst_xml {
            xml.push_str(ext);
        }
        xml.push_str("</connection>");
    }
    xml.push_str("</connections>");
    xml.into_bytes()
}

/// Serialize a workbook connection set, preserving authored XML metadata across typed edits.
pub fn write_connection_set_xml(connections: &WorkbookConnectionSet) -> Vec<u8> {
    preservation::write_connection_set_xml(connections)
}

pub fn write_query_table_xml(query_table: &QueryTable) -> Vec<u8> {
    let mut xml = String::from(
        r#"<?xml version="1.0" encoding="UTF-8" standalone="yes"?><queryTable xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main""#,
    );
    attr_opt(&mut xml, "name", query_table.name.as_deref());
    attr_u32(&mut xml, "connectionId", query_table.connection_id);
    attr_u32(&mut xml, "autoFormatId", query_table.auto_format_id);
    attr_bool(
        &mut xml,
        "applyNumberFormats",
        query_table.apply_number_formats,
    );
    attr_bool(
        &mut xml,
        "applyBorderFormats",
        query_table.apply_border_formats,
    );
    attr_bool(&mut xml, "applyFontFormats", query_table.apply_font_formats);
    attr_bool(
        &mut xml,
        "applyPatternFormats",
        query_table.apply_pattern_formats,
    );
    attr_bool(
        &mut xml,
        "applyAlignmentFormats",
        query_table.apply_alignment_formats,
    );
    attr_bool(
        &mut xml,
        "applyWidthHeightFormats",
        query_table.apply_width_height_formats,
    );
    attr_bool(&mut xml, "refreshOnLoad", query_table.refresh_on_load);
    attr_opt(
        &mut xml,
        "growShrinkType",
        query_table.grow_shrink_type.as_deref(),
    );
    attr_bool(&mut xml, "fillFormulas", query_table.fill_formulas);
    attr_bool(
        &mut xml,
        "removeDataOnSave",
        query_table.remove_data_on_save,
    );
    attr_bool(&mut xml, "disableEdit", query_table.disable_edit);
    attr_bool(
        &mut xml,
        "preserveFormatting",
        query_table.preserve_formatting,
    );
    attr_bool(
        &mut xml,
        "adjustColumnWidth",
        query_table.adjust_column_width,
    );
    attr_bool(&mut xml, "intermediate", query_table.intermediate);
    attr_bool(
        &mut xml,
        "connectionIdDeleted",
        query_table.connection_id_deleted,
    );
    if !query_table.headers {
        xml.push_str(r#" headers="0""#);
    }
    attr_bool(&mut xml, "rowNumbers", query_table.row_numbers);
    attr_bool(&mut xml, "disableRefresh", query_table.disable_refresh);
    attr_bool(
        &mut xml,
        "backgroundRefresh",
        query_table.background_refresh,
    );
    attr_bool(
        &mut xml,
        "firstBackgroundRefresh",
        query_table.first_background_refresh,
    );
    attr_u32(&mut xml, "nextId", query_table.next_id);
    xml.push('>');
    let write_refresh = query_table.refresh_present
        || query_table.next_id.is_some()
        || query_table.minimum_version.is_some()
        || query_table.preserve_sort_filter_layout
        || query_table.field_id_wrapped
        || query_table.headers_in_last_refresh
        || query_table.unbound_columns_left.is_some()
        || query_table.unbound_columns_right.is_some()
        || query_table.sort_state_xml.is_some()
        || query_table.refresh_ext_lst_xml.is_some()
        || !query_table.fields.is_empty()
        || !query_table.deleted_fields.is_empty();
    if write_refresh {
        xml.push_str("<queryTableRefresh");
        attr_bool(
            &mut xml,
            "preserveSortFilterLayout",
            query_table.preserve_sort_filter_layout,
        );
        attr_bool(&mut xml, "fieldIdWrapped", query_table.field_id_wrapped);
        attr_bool(
            &mut xml,
            "headersInLastRefresh",
            query_table.headers_in_last_refresh,
        );
        attr_u32(&mut xml, "nextId", query_table.next_id);
        attr_u32(&mut xml, "minimumVersion", query_table.minimum_version);
        attr_u32(
            &mut xml,
            "unboundColumnsLeft",
            query_table.unbound_columns_left,
        );
        attr_u32(
            &mut xml,
            "unboundColumnsRight",
            query_table.unbound_columns_right,
        );
        xml.push('>');
    }
    if !query_table.fields.is_empty() {
        xml.push_str(&format!(
            r#"<queryTableFields count="{}">"#,
            query_table.fields.len()
        ));
        for field in &query_table.fields {
            xml.push_str("<queryTableField");
            attr_u32(&mut xml, "id", Some(field.id));
            attr_opt(&mut xml, "name", field.name.as_deref());
            attr_u32(&mut xml, "tableColumnId", field.table_column_id);
            attr_bool(&mut xml, "dataBound", field.data_bound);
            attr_bool(&mut xml, "rowNumbers", field.row_numbers);
            attr_bool(&mut xml, "fillFormulas", field.fill_formulas);
            attr_bool(&mut xml, "clipped", field.clipped);
            if let Some(ext) = &field.ext_lst_xml {
                xml.push('>');
                xml.push_str(ext);
                xml.push_str("</queryTableField>");
            } else {
                xml.push_str("/>");
            }
        }
        xml.push_str("</queryTableFields>");
    }
    if !query_table.deleted_fields.is_empty() {
        xml.push_str(&format!(
            r#"<queryTableDeletedFields count="{}">"#,
            query_table.deleted_fields.len()
        ));
        for field in &query_table.deleted_fields {
            xml.push_str("<deletedField");
            attr_opt(&mut xml, "name", field.name.as_deref());
            xml.push_str("/>");
        }
        xml.push_str("</queryTableDeletedFields>");
    }
    if write_refresh {
        if let Some(sort_state_xml) = &query_table.sort_state_xml {
            xml.push_str(sort_state_xml);
        }
        if let Some(ext) = &query_table.refresh_ext_lst_xml {
            xml.push_str(ext);
        }
        xml.push_str("</queryTableRefresh>");
    }
    if let Some(ext) = &query_table.ext_lst_xml {
        xml.push_str(ext);
    }
    xml.push_str("</queryTable>");
    xml.into_bytes()
}

fn parse_connection(xml: &[u8], node: &XmlElement) -> Option<WorkbookConnection> {
    let tag = &xml[node.start..node.start_tag_end];
    let mut connection = WorkbookConnection {
        id: parse_u32_attr_decoded(tag, b"id=\"").unwrap_or(0),
        name: parse_string_attr(tag, b"name=\""),
        description: parse_string_attr(tag, b"description=\""),
        connection_type: parse_u32_attr_decoded(tag, b"type=\""),
        refreshed_version: parse_u32_attr_decoded(tag, b"refreshedVersion=\""),
        min_refreshable_version: parse_u32_attr_decoded(tag, b"minRefreshableVersion=\""),
        save_data: parse_bool_attr_decoded(tag, b"saveData=\"").unwrap_or(false),
        credentials: parse_string_attr(tag, b"credentials=\""),
        single_sign_on_id: parse_string_attr(tag, b"singleSignOnId=\""),
        background: parse_bool_attr_decoded(tag, b"background=\"").unwrap_or(false),
        deleted: parse_bool_attr_decoded(tag, b"deleted=\"").unwrap_or(false),
        keep_alive: parse_bool_attr_decoded(tag, b"keepAlive=\"").unwrap_or(false),
        new_connection: parse_bool_attr_decoded(tag, b"new=\"").unwrap_or(false),
        odc_file: parse_string_attr(tag, b"odcFile=\""),
        only_use_connection_file: parse_bool_attr_decoded(tag, b"onlyUseConnectionFile=\"")
            .unwrap_or(false),
        reconnection_method: parse_u32_attr_decoded(tag, b"reconnectionMethod=\""),
        refresh_on_load: parse_bool_attr_decoded(tag, b"refreshOnLoad=\"").unwrap_or(false),
        save_password: parse_bool_attr_decoded(tag, b"savePassword=\"").unwrap_or(false),
        source_file: parse_string_attr(tag, b"sourceFile=\""),
        interval: parse_u32_attr_decoded(tag, b"interval=\""),
        ext_lst_xml: node
            .direct_main_child(b"extLst")
            .filter(|child| child.name.as_slice() == b"extLst")
            .and_then(|child| element_xml(xml, child)),
        ..Default::default()
    };
    connection.db_pr = node
        .direct_main_child(b"dbPr")
        .and_then(|child| parse_db_pr(xml, child));
    connection.oledb_pr = node
        .direct_main_child(b"oledbPr")
        .and_then(|child| parse_db_pr(xml, child));
    connection.olap_pr = node
        .direct_main_child(b"olapPr")
        .and_then(|child| parse_olap_pr(xml, child));
    connection.web_pr = node
        .direct_main_child(b"webPr")
        .and_then(|child| parse_web_pr(xml, child));
    connection.text_pr = node
        .direct_main_child(b"textPr")
        .and_then(|child| parse_text_pr(xml, child));
    connection.parameters = node
        .direct_main_child(b"parameters")
        .map(|child| parse_parameters(xml, child))
        .unwrap_or_default();
    Some(connection)
}

fn parse_db_pr(xml: &[u8], node: &XmlElement) -> Option<DbConnectionProperties> {
    let tag = &xml[node.start..node.start_tag_end];
    Some(DbConnectionProperties {
        connection: parse_string_attr(tag, b"connection=\""),
        command: parse_string_attr(tag, b"command=\""),
        server_command: parse_string_attr(tag, b"serverCommand=\""),
        command_type: parse_u32_attr_decoded(tag, b"commandType=\""),
    })
}

fn parse_olap_pr(xml: &[u8], node: &XmlElement) -> Option<OlapConnectionProperties> {
    let tag = &xml[node.start..node.start_tag_end];
    Some(OlapConnectionProperties {
        local: parse_bool_attr_decoded(tag, b"local=\"").unwrap_or(false),
        local_connection: parse_string_attr(tag, b"localConnection=\""),
        local_refresh: parse_bool_attr_decoded(tag, b"localRefresh=\"").unwrap_or(false),
        send_locale: parse_bool_attr_decoded(tag, b"sendLocale=\"").unwrap_or(false),
        row_drill_count: parse_u32_attr_decoded(tag, b"rowDrillCount=\""),
        server_fill: parse_bool_attr_decoded(tag, b"serverFill=\""),
        server_number_format: parse_bool_attr_decoded(tag, b"serverNumberFormat=\""),
        server_font: parse_bool_attr_decoded(tag, b"serverFont=\""),
        server_font_color: parse_bool_attr_decoded(tag, b"serverFontColor=\""),
    })
}

fn parse_web_pr(xml: &[u8], node: &XmlElement) -> Option<WebConnectionProperties> {
    let tag = &xml[node.start..node.start_tag_end];
    Some(WebConnectionProperties {
        xml: parse_bool_attr_decoded(tag, b"xml=\"").unwrap_or(false),
        source_data: parse_bool_attr_decoded(tag, b"sourceData=\"").unwrap_or(false),
        parse_pre: parse_bool_attr_decoded(tag, b"parsePre=\"").unwrap_or(false),
        consecutive: parse_bool_attr_decoded(tag, b"consecutive=\"").unwrap_or(false),
        first_row: parse_bool_attr_decoded(tag, b"firstRow=\"").unwrap_or(false),
        xl97: parse_bool_attr_decoded(tag, b"xl97=\"").unwrap_or(false),
        text_dates: parse_bool_attr_decoded(tag, b"textDates=\"").unwrap_or(false),
        xl2000: parse_bool_attr_decoded(tag, b"xl2000=\"").unwrap_or(false),
        url: parse_string_attr(tag, b"url=\""),
        post: parse_string_attr(tag, b"post=\""),
        html_tables: parse_bool_attr_decoded(tag, b"htmlTables=\"").unwrap_or(false),
        html_format: parse_string_attr(tag, b"htmlFormat=\""),
        edit_page: parse_string_attr(tag, b"editPage=\""),
        tables: parse_connection_tables(xml, node),
    })
}

fn parse_text_pr(xml: &[u8], node: &XmlElement) -> Option<TextConnectionProperties> {
    let tag = &xml[node.start..node.start_tag_end];
    Some(TextConnectionProperties {
        prompt: parse_bool_attr_decoded(tag, b"prompt=\"").unwrap_or(false),
        file_type: parse_string_attr(tag, b"fileType=\""),
        code_page: parse_u32_attr_decoded(tag, b"codePage=\""),
        character_set: parse_string_attr(tag, b"characterSet=\""),
        first_row: parse_u32_attr_decoded(tag, b"firstRow=\""),
        source_file: parse_string_attr(tag, b"sourceFile=\""),
        delimited: parse_bool_attr_decoded(tag, b"delimited=\""),
        delimiter: parse_string_attr(tag, b"delimiter=\""),
        decimal: parse_string_attr(tag, b"decimal=\""),
        thousands: parse_string_attr(tag, b"thousands=\""),
        tab: parse_bool_attr_decoded(tag, b"tab=\"").unwrap_or(false),
        space: parse_bool_attr_decoded(tag, b"space=\"").unwrap_or(false),
        comma: parse_bool_attr_decoded(tag, b"comma=\"").unwrap_or(false),
        semicolon: parse_bool_attr_decoded(tag, b"semicolon=\"").unwrap_or(false),
        consecutive: parse_bool_attr_decoded(tag, b"consecutive=\"").unwrap_or(false),
        qualifier: parse_string_attr(tag, b"qualifier=\""),
        fields: parse_text_fields(xml, node),
    })
}

fn parse_parameters(xml: &[u8], node: &XmlElement) -> Vec<ConnectionParameter> {
    let mut source_index = 0;
    node.children
        .iter()
        .filter_map(|child| {
            if child.namespace != XmlNamespace::Main || child.local != b"parameter" {
                return None;
            }
            let raw_source_index = source_index;
            source_index += 1;
            let tag = &xml[child.start..child.start_tag_end];
            Some(ConnectionParameter {
                raw_source_index: Some(raw_source_index),
                name: parse_string_attr(tag, b"name=\""),
                sql_type: parse_i32_attr_decoded(tag, b"sqlType=\""),
                parameter_type: parse_string_attr(tag, b"parameterType=\""),
                refresh_on_change: parse_bool_attr_decoded(tag, b"refreshOnChange=\"")
                    .unwrap_or(false),
                prompt: parse_string_attr(tag, b"prompt=\""),
                boolean: parse_bool_attr_decoded(tag, b"boolean=\""),
                double: parse_f64_attr_decoded(tag, b"double=\""),
                integer: parse_i32_attr_decoded(tag, b"integer=\""),
                string: parse_string_attr(tag, b"string=\""),
                cell: parse_string_attr(tag, b"cell=\""),
            })
        })
        .collect()
}

fn parse_connection_tables(xml: &[u8], web_node: &XmlElement) -> Vec<ConnectionTableRef> {
    let Some(tables) = web_node.direct_main_child(b"tables") else {
        return Vec::new();
    };
    tables
        .children
        .iter()
        .filter(|child| child.namespace == XmlNamespace::Main)
        .filter_map(|child| {
            let tag = &xml[child.start..child.start_tag_end];
            match child.local.as_slice() {
                b"m" => Some(ConnectionTableRef::Missing),
                b"s" => parse_string_attr(tag, b"v=\"").map(ConnectionTableRef::Name),
                b"x" => parse_u32_attr_decoded(tag, b"v=\"").map(ConnectionTableRef::Index),
                _ => None,
            }
        })
        .collect()
}

fn parse_text_fields(xml: &[u8], text_node: &XmlElement) -> Vec<TextConnectionField> {
    let Some(fields) = text_node.direct_main_child(b"textFields") else {
        return Vec::new();
    };
    fields
        .children
        .iter()
        .filter(|child| child.namespace == XmlNamespace::Main && child.local == b"textField")
        .map(|child| {
            let tag = &xml[child.start..child.start_tag_end];
            TextConnectionField {
                field_type: parse_string_attr(tag, b"type=\""),
                position: parse_u32_attr_decoded(tag, b"position=\""),
            }
        })
        .collect()
}

fn element_slice<'a>(
    xml: &'a [u8],
    tag_name: &[u8],
    start: usize,
    tag_end: usize,
) -> Option<&'a [u8]> {
    let end = element_end(xml, start, tag_end)?;
    if tag_name.is_empty() {
        return None;
    }
    Some(&xml[start..end])
}

fn element_end(xml: &[u8], start: usize, tag_end: usize) -> Option<usize> {
    if tag_end > start && xml[tag_end - 1] == b'/' {
        return Some(tag_end + 1);
    }
    let name_start = start + 1;
    let name_end = tag_name_end(xml, name_start);
    let close_start = find_closing_tag(xml, &xml[name_start..name_end], tag_end)?;
    find_gt_simd(xml, close_start).map(|end| end + 1)
}

fn tag_name_end(xml: &[u8], mut pos: usize) -> usize {
    while pos < xml.len() {
        let b = xml[pos];
        if matches!(b, b'>' | b'/' | b' ' | b'\t' | b'\n' | b'\r') {
            break;
        }
        pos += 1;
    }
    pos
}

fn table_relationships_path(table_path: &str) -> Option<String> {
    let slash = table_path.rfind('/')?;
    Some(format!(
        "{}/_rels/{}.rels",
        &table_path[..slash],
        &table_path[slash + 1..]
    ))
}

fn write_db_pr(xml: &mut String, element: &str, db: &DbConnectionProperties) {
    xml.push('<');
    xml.push_str(element);
    attr_opt(xml, "connection", db.connection.as_deref());
    attr_opt(xml, "command", db.command.as_deref());
    attr_opt(xml, "serverCommand", db.server_command.as_deref());
    attr_u32(xml, "commandType", db.command_type);
    xml.push_str("/>");
}

fn write_web_pr(xml: &mut String, web: &WebConnectionProperties) {
    xml.push_str("<webPr");
    attr_bool(xml, "xml", web.xml);
    attr_bool(xml, "sourceData", web.source_data);
    attr_bool(xml, "parsePre", web.parse_pre);
    attr_bool(xml, "consecutive", web.consecutive);
    attr_bool(xml, "firstRow", web.first_row);
    attr_bool(xml, "xl97", web.xl97);
    attr_bool(xml, "textDates", web.text_dates);
    attr_bool(xml, "xl2000", web.xl2000);
    attr_opt(xml, "url", web.url.as_deref());
    attr_opt(xml, "post", web.post.as_deref());
    attr_bool(xml, "htmlTables", web.html_tables);
    attr_opt(xml, "htmlFormat", web.html_format.as_deref());
    attr_opt(xml, "editPage", web.edit_page.as_deref());
    if web.tables.is_empty() {
        xml.push_str("/>");
        return;
    }
    xml.push('>');
    xml.push_str(&format!(r#"<tables count="{}">"#, web.tables.len()));
    for table in &web.tables {
        match table {
            ConnectionTableRef::Missing => xml.push_str("<m/>"),
            ConnectionTableRef::Name(value) => {
                xml.push_str("<s");
                attr_opt(xml, "v", Some(value));
                xml.push_str("/>");
            }
            ConnectionTableRef::Index(value) => {
                xml.push_str("<x");
                attr_u32(xml, "v", Some(*value));
                xml.push_str("/>");
            }
        }
    }
    xml.push_str("</tables></webPr>");
}

fn write_text_pr(xml: &mut String, text_pr: &TextConnectionProperties) {
    xml.push_str("<textPr");
    attr_bool(xml, "prompt", text_pr.prompt);
    attr_opt(xml, "fileType", text_pr.file_type.as_deref());
    attr_u32(xml, "codePage", text_pr.code_page);
    attr_opt(xml, "characterSet", text_pr.character_set.as_deref());
    attr_u32(xml, "firstRow", text_pr.first_row);
    attr_opt(xml, "sourceFile", text_pr.source_file.as_deref());
    attr_bool_opt(xml, "delimited", text_pr.delimited);
    attr_opt(xml, "delimiter", text_pr.delimiter.as_deref());
    attr_opt(xml, "decimal", text_pr.decimal.as_deref());
    attr_opt(xml, "thousands", text_pr.thousands.as_deref());
    attr_bool(xml, "tab", text_pr.tab);
    attr_bool(xml, "space", text_pr.space);
    attr_bool(xml, "comma", text_pr.comma);
    attr_bool(xml, "semicolon", text_pr.semicolon);
    attr_bool(xml, "consecutive", text_pr.consecutive);
    attr_opt(xml, "qualifier", text_pr.qualifier.as_deref());
    if text_pr.fields.is_empty() {
        xml.push_str("/>");
        return;
    }
    xml.push('>');
    xml.push_str(&format!(r#"<textFields count="{}">"#, text_pr.fields.len()));
    for field in &text_pr.fields {
        xml.push_str("<textField");
        attr_opt(xml, "type", field.field_type.as_deref());
        attr_u32(xml, "position", field.position);
        xml.push_str("/>");
    }
    xml.push_str("</textFields></textPr>");
}

fn attr_opt(xml: &mut String, name: &str, value: Option<&str>) {
    if let Some(value) = value {
        xml.push(' ');
        xml.push_str(name);
        xml.push_str("=\"");
        attr_text(xml, value);
        xml.push('"');
    }
}

fn attr_u32(xml: &mut String, name: &str, value: Option<u32>) {
    if let Some(value) = value {
        xml.push_str(&format!(r#" {name}="{value}""#));
    }
}

fn attr_i32(xml: &mut String, name: &str, value: Option<i32>) {
    if let Some(value) = value {
        xml.push_str(&format!(r#" {name}="{value}""#));
    }
}

fn attr_bool(xml: &mut String, name: &str, value: bool) {
    if value {
        xml.push_str(&format!(r#" {name}="1""#));
    }
}

fn attr_bool_opt(xml: &mut String, name: &str, value: Option<bool>) {
    if let Some(value) = value {
        xml.push_str(&format!(r#" {name}="{}""#, if value { 1 } else { 0 }));
    }
}

fn attr_text(xml: &mut String, value: &str) {
    for c in value.chars() {
        match c {
            '&' => xml.push_str("&amp;"),
            '<' => xml.push_str("&lt;"),
            '>' => xml.push_str("&gt;"),
            '"' => xml.push_str("&quot;"),
            '\'' => xml.push_str("&apos;"),
            _ => xml.push(c),
        }
    }
}

#[cfg(test)]
mod tests;

#[cfg(test)]
mod namespace_tests;
