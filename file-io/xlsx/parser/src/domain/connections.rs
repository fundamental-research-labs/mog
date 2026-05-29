//! Typed read/write support for workbook connections and table-owned query tables.

use domain_types::domain::connections::*;

use crate::infra::opc::{PackageOwner, parse_owned_relationships};
use crate::infra::scanner::{find_closing_tag, find_gt_simd, find_tag_simd};
use crate::infra::xml::{
    extract_direct_child_element_xml, parse_bool_attr_opt, parse_i32_attr, parse_string_attr,
    parse_u32_attr,
};
use crate::zip::XlsxArchive;

pub const REL_CONNECTIONS: &str =
    "http://schemas.openxmlformats.org/officeDocument/2006/relationships/connections";
pub const REL_QUERY_TABLE: &str =
    "http://schemas.openxmlformats.org/officeDocument/2006/relationships/queryTable";
pub const CT_CONNECTIONS: &str =
    "application/vnd.openxmlformats-officedocument.spreadsheetml.connections+xml";
pub const CT_QUERY_TABLE: &str =
    "application/vnd.openxmlformats-officedocument.spreadsheetml.queryTable+xml";

pub fn parse_connections(archive: &XlsxArchive) -> WorkbookConnectionSet {
    archive
        .read_file("xl/connections.xml")
        .ok()
        .map(|xml| parse_connections_xml(&xml))
        .unwrap_or_default()
}

pub fn parse_connections_xml(xml: &[u8]) -> WorkbookConnectionSet {
    let mut connections = Vec::new();
    let mut pos = 0;
    while let Some(start) = find_tag_simd(xml, b"connection", pos) {
        let Some(tag_end) = find_gt_simd(xml, start) else {
            break;
        };
        let end = if xml[tag_end.saturating_sub(1)] == b'/' {
            tag_end + 1
        } else {
            find_closing_tag(xml, b"connection", tag_end)
                .map(|end| end + b"</connection>".len())
                .unwrap_or(tag_end + 1)
        };
        if let Some(connection) = parse_connection(&xml[start..end]) {
            connections.push(connection);
        }
        pos = end;
    }
    WorkbookConnectionSet { connections }
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
                id: parse_u32_attr(field_tag, b"id=\"").unwrap_or(0),
                name: parse_string_attr(field_tag, b"name=\""),
                table_column_id: parse_u32_attr(field_tag, b"tableColumnId=\""),
                data_bound: parse_bool_attr_opt(field_tag, b"dataBound=\"").unwrap_or(false),
                row_numbers: parse_bool_attr_opt(field_tag, b"rowNumbers=\"").unwrap_or(false),
                fill_formulas: parse_bool_attr_opt(field_tag, b"fillFormulas=\"").unwrap_or(false),
                clipped: parse_bool_attr_opt(field_tag, b"clipped=\"").unwrap_or(false),
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
        connection_id: parse_u32_attr(tag, b"connectionId=\""),
        name: parse_string_attr(tag, b"name=\""),
        auto_format_id: parse_u32_attr(tag, b"autoFormatId=\""),
        apply_number_formats: parse_bool_attr_opt(tag, b"applyNumberFormats=\"").unwrap_or(false),
        apply_border_formats: parse_bool_attr_opt(tag, b"applyBorderFormats=\"").unwrap_or(false),
        apply_font_formats: parse_bool_attr_opt(tag, b"applyFontFormats=\"").unwrap_or(false),
        apply_pattern_formats: parse_bool_attr_opt(tag, b"applyPatternFormats=\"").unwrap_or(false),
        apply_alignment_formats: parse_bool_attr_opt(tag, b"applyAlignmentFormats=\"")
            .unwrap_or(false),
        apply_width_height_formats: parse_bool_attr_opt(tag, b"applyWidthHeightFormats=\"")
            .unwrap_or(false),
        refresh_on_load: parse_bool_attr_opt(tag, b"refreshOnLoad=\"").unwrap_or(false),
        grow_shrink_type: parse_string_attr(tag, b"growShrinkType=\""),
        fill_formulas: parse_bool_attr_opt(tag, b"fillFormulas=\"").unwrap_or(false),
        remove_data_on_save: parse_bool_attr_opt(tag, b"removeDataOnSave=\"").unwrap_or(false),
        disable_edit: parse_bool_attr_opt(tag, b"disableEdit=\"").unwrap_or(false),
        preserve_formatting: parse_bool_attr_opt(tag, b"preserveFormatting=\"").unwrap_or(false),
        adjust_column_width: parse_bool_attr_opt(tag, b"adjustColumnWidth=\"").unwrap_or(false),
        intermediate: parse_bool_attr_opt(tag, b"intermediate=\"").unwrap_or(false),
        connection_id_deleted: parse_bool_attr_opt(tag, b"connectionIdDeleted=\"").unwrap_or(false),
        headers: parse_bool_attr_opt(tag, b"headers=\"").unwrap_or(true),
        row_numbers: parse_bool_attr_opt(tag, b"rowNumbers=\"").unwrap_or(false),
        disable_refresh: parse_bool_attr_opt(tag, b"disableRefresh=\"").unwrap_or(false),
        background_refresh: parse_bool_attr_opt(tag, b"backgroundRefresh=\"").unwrap_or(false),
        first_background_refresh: parse_bool_attr_opt(tag, b"firstBackgroundRefresh=\"")
            .unwrap_or(false),
        next_id: parse_u32_attr(tag, b"nextId=\"")
            .or_else(|| refresh_tag.and_then(|t| parse_u32_attr(t, b"nextId=\""))),
        minimum_version: refresh_tag.and_then(|t| parse_u32_attr(t, b"minimumVersion=\"")),
        refresh_present: refresh_bytes.is_some(),
        preserve_sort_filter_layout: refresh_tag
            .and_then(|t| parse_bool_attr_opt(t, b"preserveSortFilterLayout=\""))
            .unwrap_or(false),
        field_id_wrapped: refresh_tag
            .and_then(|t| parse_bool_attr_opt(t, b"fieldIdWrapped=\""))
            .unwrap_or(false),
        headers_in_last_refresh: refresh_tag
            .and_then(|t| parse_bool_attr_opt(t, b"headersInLastRefresh=\""))
            .unwrap_or(false),
        unbound_columns_left: refresh_tag.and_then(|t| parse_u32_attr(t, b"unboundColumnsLeft=\"")),
        unbound_columns_right: refresh_tag
            .and_then(|t| parse_u32_attr(t, b"unboundColumnsRight=\"")),
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
        if let Some(db) = &c.oledb_pr {
            write_db_pr(&mut xml, "oledbPr", db);
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

fn parse_connection(xml: &[u8]) -> Option<WorkbookConnection> {
    let tag_end = find_gt_simd(xml, 0)?;
    let tag = &xml[..tag_end];
    let mut connection = WorkbookConnection {
        id: parse_u32_attr(tag, b"id=\"").unwrap_or(0),
        name: parse_string_attr(tag, b"name=\""),
        description: parse_string_attr(tag, b"description=\""),
        connection_type: parse_u32_attr(tag, b"type=\""),
        refreshed_version: parse_u32_attr(tag, b"refreshedVersion=\""),
        min_refreshable_version: parse_u32_attr(tag, b"minRefreshableVersion=\""),
        save_data: parse_bool_attr_opt(tag, b"saveData=\"").unwrap_or(false),
        credentials: parse_string_attr(tag, b"credentials=\""),
        single_sign_on_id: parse_string_attr(tag, b"singleSignOnId=\""),
        background: parse_bool_attr_opt(tag, b"background=\"").unwrap_or(false),
        deleted: parse_bool_attr_opt(tag, b"deleted=\"").unwrap_or(false),
        keep_alive: parse_bool_attr_opt(tag, b"keepAlive=\"").unwrap_or(false),
        new_connection: parse_bool_attr_opt(tag, b"new=\"").unwrap_or(false),
        odc_file: parse_string_attr(tag, b"odcFile=\""),
        only_use_connection_file: parse_bool_attr_opt(tag, b"onlyUseConnectionFile=\"")
            .unwrap_or(false),
        reconnection_method: parse_u32_attr(tag, b"reconnectionMethod=\""),
        refresh_on_load: parse_bool_attr_opt(tag, b"refreshOnLoad=\"").unwrap_or(false),
        save_password: parse_bool_attr_opt(tag, b"savePassword=\"").unwrap_or(false),
        source_file: parse_string_attr(tag, b"sourceFile=\""),
        interval: parse_u32_attr(tag, b"interval=\""),
        ext_lst_xml: parse_ext_lst(xml),
        ..Default::default()
    };
    connection.db_pr = parse_db_pr(xml, b"dbPr");
    connection.oledb_pr = parse_db_pr(xml, b"oledbPr");
    connection.olap_pr = parse_olap_pr(xml);
    connection.web_pr = parse_web_pr(xml);
    connection.text_pr = parse_text_pr(xml);
    connection.parameters = parse_parameters(xml);
    Some(connection)
}

fn parse_db_pr(xml: &[u8], tag_name: &[u8]) -> Option<DbConnectionProperties> {
    let start = find_tag_simd(xml, tag_name, 0)?;
    let end = find_gt_simd(xml, start)?;
    let tag = &xml[start..end];
    Some(DbConnectionProperties {
        connection: parse_string_attr(tag, b"connection=\""),
        command: parse_string_attr(tag, b"command=\""),
        server_command: parse_string_attr(tag, b"serverCommand=\""),
        command_type: parse_u32_attr(tag, b"commandType=\""),
    })
}

fn parse_olap_pr(xml: &[u8]) -> Option<OlapConnectionProperties> {
    let start = find_tag_simd(xml, b"olapPr", 0)?;
    let end = find_gt_simd(xml, start)?;
    let tag = &xml[start..end];
    Some(OlapConnectionProperties {
        local: parse_bool_attr_opt(tag, b"local=\"").unwrap_or(false),
        local_connection: parse_string_attr(tag, b"localConnection=\""),
        local_refresh: parse_bool_attr_opt(tag, b"localRefresh=\"").unwrap_or(false),
        send_locale: parse_bool_attr_opt(tag, b"sendLocale=\"").unwrap_or(false),
        row_drill_count: parse_u32_attr(tag, b"rowDrillCount=\""),
        server_fill: parse_bool_attr_opt(tag, b"serverFill=\""),
        server_number_format: parse_bool_attr_opt(tag, b"serverNumberFormat=\""),
        server_font: parse_bool_attr_opt(tag, b"serverFont=\""),
        server_font_color: parse_bool_attr_opt(tag, b"serverFontColor=\""),
    })
}

fn parse_web_pr(xml: &[u8]) -> Option<WebConnectionProperties> {
    let start = find_tag_simd(xml, b"webPr", 0)?;
    let end = find_gt_simd(xml, start)?;
    let tag = &xml[start..end];
    let web_xml = element_slice(xml, b"webPr", start, end).unwrap_or(&xml[start..end + 1]);
    Some(WebConnectionProperties {
        xml: parse_bool_attr_opt(tag, b"xml=\"").unwrap_or(false),
        source_data: parse_bool_attr_opt(tag, b"sourceData=\"").unwrap_or(false),
        parse_pre: parse_bool_attr_opt(tag, b"parsePre=\"").unwrap_or(false),
        consecutive: parse_bool_attr_opt(tag, b"consecutive=\"").unwrap_or(false),
        first_row: parse_bool_attr_opt(tag, b"firstRow=\"").unwrap_or(false),
        xl97: parse_bool_attr_opt(tag, b"xl97=\"").unwrap_or(false),
        text_dates: parse_bool_attr_opt(tag, b"textDates=\"").unwrap_or(false),
        xl2000: parse_bool_attr_opt(tag, b"xl2000=\"").unwrap_or(false),
        url: parse_string_attr(tag, b"url=\""),
        post: parse_string_attr(tag, b"post=\""),
        html_tables: parse_bool_attr_opt(tag, b"htmlTables=\"").unwrap_or(false),
        html_format: parse_string_attr(tag, b"htmlFormat=\""),
        edit_page: parse_string_attr(tag, b"editPage=\""),
        tables: parse_connection_tables(web_xml),
    })
}

fn parse_text_pr(xml: &[u8]) -> Option<TextConnectionProperties> {
    let start = find_tag_simd(xml, b"textPr", 0)?;
    let end = find_gt_simd(xml, start)?;
    let tag = &xml[start..end];
    let text_xml = element_slice(xml, b"textPr", start, end).unwrap_or(&xml[start..end + 1]);
    Some(TextConnectionProperties {
        prompt: parse_bool_attr_opt(tag, b"prompt=\"").unwrap_or(false),
        file_type: parse_string_attr(tag, b"fileType=\""),
        code_page: parse_u32_attr(tag, b"codePage=\""),
        character_set: parse_string_attr(tag, b"characterSet=\""),
        first_row: parse_u32_attr(tag, b"firstRow=\""),
        source_file: parse_string_attr(tag, b"sourceFile=\""),
        delimited: parse_bool_attr_opt(tag, b"delimited=\""),
        delimiter: parse_string_attr(tag, b"delimiter=\""),
        decimal: parse_string_attr(tag, b"decimal=\""),
        thousands: parse_string_attr(tag, b"thousands=\""),
        tab: parse_bool_attr_opt(tag, b"tab=\"").unwrap_or(false),
        space: parse_bool_attr_opt(tag, b"space=\"").unwrap_or(false),
        comma: parse_bool_attr_opt(tag, b"comma=\"").unwrap_or(false),
        semicolon: parse_bool_attr_opt(tag, b"semicolon=\"").unwrap_or(false),
        consecutive: parse_bool_attr_opt(tag, b"consecutive=\"").unwrap_or(false),
        qualifier: parse_string_attr(tag, b"qualifier=\""),
        fields: parse_text_fields(text_xml),
    })
}

fn parse_parameters(xml: &[u8]) -> Vec<ConnectionParameter> {
    let Some(start) = find_tag_simd(xml, b"parameters", 0) else {
        return Vec::new();
    };
    let Some(end) = find_gt_simd(xml, start) else {
        return Vec::new();
    };
    let Some(close) = find_closing_tag(xml, b"parameters", end) else {
        return Vec::new();
    };
    let content = &xml[end + 1..close];
    let mut parameters = Vec::new();
    let mut pos = 0;
    while let Some(s) = find_tag_simd(content, b"parameter", pos) {
        let Some(e) = find_gt_simd(content, s) else {
            break;
        };
        let tag = &content[s..e];
        parameters.push(ConnectionParameter {
            name: parse_string_attr(tag, b"name=\""),
            sql_type: parse_i32_attr(tag, b"sqlType=\""),
            parameter_type: parse_string_attr(tag, b"parameterType=\""),
            refresh_on_change: parse_bool_attr_opt(tag, b"refreshOnChange=\"").unwrap_or(false),
            prompt: parse_string_attr(tag, b"prompt=\""),
            boolean: parse_bool_attr_opt(tag, b"boolean=\""),
            double: parse_string_attr(tag, b"double=\"").and_then(|v| v.parse().ok()),
            integer: parse_string_attr(tag, b"integer=\"").and_then(|v| v.parse().ok()),
            string: parse_string_attr(tag, b"string=\""),
            cell: parse_string_attr(tag, b"cell=\""),
        });
        pos = e + 1;
    }
    parameters
}

fn parse_connection_tables(web_xml: &[u8]) -> Vec<ConnectionTableRef> {
    let Some(tables_xml) = extract_direct_child_element_xml(web_xml, b"webPr", b"tables") else {
        return Vec::new();
    };
    let xml = tables_xml.as_bytes();
    let start = find_gt_simd(xml, 0).map_or(0, |end| end + 1);
    let end = find_closing_tag(xml, b"tables", start).unwrap_or(xml.len());
    let content = &xml[start..end];
    let mut tables = Vec::new();
    let mut pos = 0;
    while let Some(s) = next_child_tag(content, pos) {
        let Some(e) = find_gt_simd(content, s) else {
            break;
        };
        let tag = &content[s..e];
        match child_local_name(tag) {
            Some(name) if name == b"m" => tables.push(ConnectionTableRef::Missing),
            Some(name) if name == b"s" => {
                if let Some(value) = parse_string_attr(tag, b"v=\"") {
                    tables.push(ConnectionTableRef::Name(value));
                }
            }
            Some(name) if name == b"x" => {
                if let Some(value) = parse_u32_attr(tag, b"v=\"") {
                    tables.push(ConnectionTableRef::Index(value));
                }
            }
            _ => {}
        }
        pos = element_end(content, s, e).unwrap_or(e + 1);
    }
    tables
}

fn parse_text_fields(text_xml: &[u8]) -> Vec<TextConnectionField> {
    let Some(fields_xml) = extract_direct_child_element_xml(text_xml, b"textPr", b"textFields")
    else {
        return Vec::new();
    };
    let xml = fields_xml.as_bytes();
    let start = find_gt_simd(xml, 0).map_or(0, |end| end + 1);
    let end = find_closing_tag(xml, b"textFields", start).unwrap_or(xml.len());
    let content = &xml[start..end];
    let mut fields = Vec::new();
    let mut pos = 0;
    while let Some(s) = find_tag_simd(content, b"textField", pos) {
        let Some(e) = find_gt_simd(content, s) else {
            break;
        };
        let tag = &content[s..e];
        fields.push(TextConnectionField {
            field_type: parse_string_attr(tag, b"type=\""),
            position: parse_u32_attr(tag, b"position=\""),
        });
        pos = e + 1;
    }
    fields
}

fn parse_ext_lst(xml: &[u8]) -> Option<String> {
    let start = find_tag_simd(xml, b"extLst", 0)?;
    let end = find_closing_tag(xml, b"extLst", start)?;
    String::from_utf8(xml[start..end + b"</extLst>".len()].to_vec()).ok()
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

fn next_child_tag(xml: &[u8], mut pos: usize) -> Option<usize> {
    while pos < xml.len() {
        let start = memchr::memchr(b'<', &xml[pos..])? + pos;
        if start + 1 >= xml.len() {
            return None;
        }
        if matches!(xml[start + 1], b'/' | b'!' | b'?') {
            pos = find_gt_simd(xml, start).map_or(xml.len(), |end| end + 1);
            continue;
        }
        return Some(start);
    }
    None
}

fn child_local_name(tag: &[u8]) -> Option<&[u8]> {
    if tag.len() < 2 || tag[0] != b'<' {
        return None;
    }
    let name_end = tag_name_end(tag, 1);
    let name = &tag[1..name_end];
    Some(
        name.iter()
            .rposition(|b| *b == b':')
            .map_or(name, |idx| &name[idx + 1..]),
    )
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
