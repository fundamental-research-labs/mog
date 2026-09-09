use super::{parse_connections_xml, write_connection_set_xml};

const MAIN_NS: &str = "http://schemas.openxmlformats.org/spreadsheetml/2006/main";

#[test]
fn connection_projection_requires_main_namespace_and_direct_children() {
    let source = format!(
        r#"<connections xmlns="{MAIN_NS}" xmlns:v="urn:vendor">
            <connection id="1" name="one">
                <v:dbPr connection="foreign-direct"/>
                <v:wrapper><dbPr connection="foreign-nested"/></v:wrapper>
                <dbPr connection="main"/>
                <v:olapPr local="1"/>
                <v:webPr url="foreign-direct"/>
                <webPr url="main">
                    <v:tables><s v="foreign-wrapper"/></v:tables>
                    <tables><v:s v="foreign-child"/><s v="main"/><x v="7"/></tables>
                </webPr>
                <v:textPr fileType="foreign-direct"/>
                <textPr fileType="main">
                    <v:textFields><textField type="foreign-wrapper"/></v:textFields>
                    <textFields><v:textField type="foreign-child"/><textField type="main" position="2"/></textFields>
                </textPr>
                <v:parameters><parameter name="foreign-wrapper"/></v:parameters>
                <parameters><v:parameter name="foreign-child"/><parameter name="main"/></parameters>
                <v:extLst><v:future/></v:extLst>
            </connection>
        </connections>"#
    );

    let set = parse_connections_xml(source.as_bytes());
    assert_eq!(set.connections.len(), 1);
    let connection = &set.connections[0];

    assert_eq!(
        connection
            .db_pr
            .as_ref()
            .and_then(|properties| properties.connection.as_deref()),
        Some("main")
    );
    assert!(connection.olap_pr.is_none());
    assert_eq!(
        connection
            .web_pr
            .as_ref()
            .and_then(|properties| properties.url.as_deref()),
        Some("main")
    );
    assert_eq!(
        connection
            .web_pr
            .as_ref()
            .map(|properties| &properties.tables),
        Some(&vec![
            domain_types::domain::connections::ConnectionTableRef::Name("main".to_string()),
            domain_types::domain::connections::ConnectionTableRef::Index(7),
        ])
    );
    assert_eq!(
        connection
            .text_pr
            .as_ref()
            .and_then(|properties| properties.file_type.as_deref()),
        Some("main")
    );
    assert_eq!(
        connection
            .text_pr
            .as_ref()
            .map(|properties| properties.fields.len()),
        Some(1)
    );
    assert_eq!(
        connection
            .parameters
            .iter()
            .map(|parameter| parameter.name.as_deref())
            .collect::<Vec<_>>(),
        vec![Some("main")]
    );
    assert!(connection.ext_lst_xml.is_none());
}

#[test]
fn prefixed_main_connection_and_children_resolve_against_document_context() {
    let source = format!(
        r#"<x:connections xmlns:x="{MAIN_NS}">
            <x:connection id="1" name="one"><x:dbPr connection="main"/></x:connection>
        </x:connections>"#
    );

    let set = parse_connections_xml(source.as_bytes());
    assert_eq!(set.connections.len(), 1);
    assert_eq!(
        set.connections[0]
            .db_pr
            .as_ref()
            .and_then(|properties| properties.connection.as_deref()),
        Some("main")
    );
}

#[test]
fn unbound_and_foreign_connection_rows_do_not_receive_source_provenance() {
    let source = format!(
        r#"<connections xmlns="{MAIN_NS}" xmlns:v="urn:vendor">
            <connection xmlns="" id="1" name="unbound"><dbPr connection="unbound"/></connection>
            <v:connection id="2" name="foreign"><v:dbPr connection="foreign"/></v:connection>
        </connections>"#
    );

    let set = parse_connections_xml(source.as_bytes());
    assert!(set.connections.is_empty());
    assert!(set.raw_xml.is_some());
}

#[test]
fn unbound_root_does_not_project_unqualified_connection_rows() {
    let source = br#"<connections><connection id="1" name="unbound"><dbPr connection="unbound"/></connection></connections>"#;

    let set = parse_connections_xml(source);
    assert!(set.connections.is_empty());
}

#[test]
fn typed_connection_attributes_decode_xml_lexicals_before_roundtrip() {
    let source = br#"<connections xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:v="urn:vendor"><connection id = '&#49;' name = 'one' type = '&#53;' refreshedVersion='&#56;' minRefreshableVersion='&#52;' saveData='true' deleted='TRUE' keepAlive='&#49;' new='0' onlyUseConnectionFile='false' reconnectionMethod='&#50;' refreshOnLoad='true' savePassword='false' interval='&#55;'><dbPr commandType='&#51;'/><olapPr local='true' localRefresh='false' sendLocale='1' rowDrillCount='&#57;'/><webPr><tables><x v='&#55;'/></tables></webPr><textPr prompt='1' codePage='&#49;' firstRow='&#50;' delimited='false' tab='true'/><parameters><parameter sqlType='&#45;7' integer='&#52;' double='&#51;.5' boolean='true'/></parameters><v:future/></connection></connections>"#;

    let mut set = parse_connections_xml(source);
    let connection = &set.connections[0];
    assert_eq!(connection.id, 1);
    assert_eq!(connection.connection_type, Some(5));
    assert_eq!(connection.refreshed_version, Some(8));
    assert_eq!(connection.min_refreshable_version, Some(4));
    assert!(connection.save_data);
    assert!(!connection.deleted);
    assert!(connection.keep_alive);
    assert!(!connection.new_connection);
    assert!(!connection.only_use_connection_file);
    assert_eq!(connection.reconnection_method, Some(2));
    assert!(connection.refresh_on_load);
    assert!(!connection.save_password);
    assert_eq!(connection.interval, Some(7));
    assert_eq!(
        connection
            .db_pr
            .as_ref()
            .and_then(|properties| properties.command_type),
        Some(3)
    );
    assert_eq!(
        connection
            .olap_pr
            .as_ref()
            .and_then(|properties| properties.row_drill_count),
        Some(9)
    );
    assert_eq!(
        connection
            .web_pr
            .as_ref()
            .map(|properties| &properties.tables),
        Some(&vec![
            domain_types::domain::connections::ConnectionTableRef::Index(7),
        ])
    );
    assert_eq!(
        connection
            .text_pr
            .as_ref()
            .and_then(|properties| properties.code_page),
        Some(1)
    );
    assert_eq!(connection.parameters[0].sql_type, Some(-7));
    assert_eq!(connection.parameters[0].integer, Some(4));
    assert_eq!(connection.parameters[0].double, Some(3.5));
    assert_eq!(connection.parameters[0].boolean, Some(true));

    set.connections[0].name = Some("edited".to_string());
    let written = String::from_utf8(write_connection_set_xml(&set))
        .expect("decoded typed attributes should roundtrip");
    assert!(written.contains("id=\"1\""));
    assert!(!written.contains("id=\"0\""));
    assert!(written.contains("name=\"edited\""));
    assert!(written.contains("<v:future/>"));
}
