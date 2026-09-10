use super::{parse_connections_xml, write_connection_set_xml};
use domain_types::domain::connections::{
    ConnectionParameter, DbConnectionProperties, WorkbookConnection,
};

const IMPORTED_CONNECTIONS_XML: &[u8] = br#"<?xml version="1.0" encoding="UTF-8" standalone="yes"?><connections xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:mc="http://schemas.openxmlformats.org/markup-compatibility/2006" mc:Ignorable="xr16" xmlns:xr16="http://schemas.microsoft.com/office/spreadsheetml/2017/revision16"><connection id="1" xr16:uid="{CONNECTION-1}" sourceFile="C:\data\test.mdb" keepAlive="1" name="test" type="5" refreshedVersion="8" background="1"><dbPr connection="Provider=ACE" command="Office Address List" commandType="3"/></connection></connections>"#;

#[test]
fn imported_connections_replay_root_and_unknown_connection_metadata() {
    let set = parse_connections_xml(IMPORTED_CONNECTIONS_XML);

    assert_eq!(set.connections.len(), 1);
    assert_eq!(set.connections[0].id, 1);
    assert_eq!(set.connections[0].name.as_deref(), Some("test"));
    assert_eq!(
        set.connections[0].source_file.as_deref(),
        Some(r"C:\data\test.mdb")
    );
    assert_eq!(
        set.connections[0]
            .db_pr
            .as_ref()
            .and_then(|db| db.command.as_deref()),
        Some("Office Address List")
    );
    assert_eq!(
        set.raw_xml.as_deref(),
        std::str::from_utf8(IMPORTED_CONNECTIONS_XML).ok()
    );
    assert_eq!(write_connection_set_xml(&set), IMPORTED_CONNECTIONS_XML);

    let persisted = serde_json::to_string(&set).expect("connection set should serialize");
    let restored: domain_types::domain::connections::WorkbookConnectionSet =
        serde_json::from_str(&persisted).expect("connection set should deserialize");
    assert_eq!(
        write_connection_set_xml(&restored),
        IMPORTED_CONNECTIONS_XML
    );
}

#[test]
fn editing_typed_connection_state_invalidates_raw_replay() {
    let mut set = parse_connections_xml(IMPORTED_CONNECTIONS_XML);
    set.connections[0].name = Some("edited".to_string());

    let written = write_connection_set_xml(&set);
    let written = String::from_utf8(written).expect("typed connection XML is UTF-8");
    assert!(written.contains("name=\"edited\""));
    assert!(written.contains("xr16:uid=\"{CONNECTION-1}\""));
    assert!(written.contains("mc:Ignorable=\"xr16\""));
}

#[test]
fn editing_connection_id_keeps_source_extension_metadata() {
    let mut set = parse_connections_xml(IMPORTED_CONNECTIONS_XML);
    set.connections[0].id = 7;

    let written =
        String::from_utf8(write_connection_set_xml(&set)).expect("typed connection XML is UTF-8");
    assert!(written.contains("id=\"7\""));
    assert!(written.contains("xr16:uid=\"{CONNECTION-1}\""));
}

#[test]
fn edited_nested_typed_state_keeps_unknown_attributes_and_children() {
    let source = br#"<?xml version="1.0"?><connections xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:vendor="urn:vendor"><connection id="1" name="test"><dbPr connection="Provider=ACE" command="old"><vendor:futureDb marker="keep"/></dbPr><vendor:futureConnection marker="keep"/></connection><vendor:futureRoot marker="keep"/></connections>"#;
    let mut set = parse_connections_xml(source);
    set.connections[0]
        .db_pr
        .as_mut()
        .expect("dbPr should parse")
        .command = Some("new".to_string());

    let written =
        String::from_utf8(write_connection_set_xml(&set)).expect("typed connection XML is UTF-8");
    assert!(written.contains("command=\"new\""));
    assert!(written.contains("vendor:futureDb marker=\"keep\""));
    assert!(written.contains("vendor:futureConnection marker=\"keep\""));
    assert!(written.contains("vendor:futureRoot marker=\"keep\""));
}

#[test]
fn invalid_namespaced_raw_source_does_not_replay_even_with_matching_fingerprint() {
    let source =
        br#"<?xml version="1.0"?><connections><connection id="1" name="test"/></connections>"#;
    let set = parse_connections_xml(source);

    let written =
        String::from_utf8(write_connection_set_xml(&set)).expect("typed connection XML is UTF-8");
    assert!(written.contains(
        "<connections xmlns=\"http://schemas.openxmlformats.org/spreadsheetml/2006/main\">"
    ));
    assert_ne!(written.as_bytes(), source);
}

#[test]
fn unknown_only_connection_part_remains_owned() {
    let source = br#"<?xml version="1.0" encoding="UTF-8"?><connections xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:vendor="urn:vendor"><vendor:futureConnection/></connections>"#;
    let set = parse_connections_xml(source);

    assert!(set.connections.is_empty());
    assert!(!set.is_empty());
    assert_eq!(write_connection_set_xml(&set), source);
}

#[test]
fn source_connection_extensions_follow_reorder_delete_and_add() {
    let source = br#"<?xml version="1.0"?><connections xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:vendor="urn:vendor"><connection id="1" name="one"><vendor:futureOne/></connection><connection id="2" name="two"><vendor:futureTwo/></connection></connections>"#;

    let mut reordered = parse_connections_xml(source);
    reordered.connections.swap(0, 1);
    reordered.connections[0].id = 20;
    reordered.connections[1].id = 10;
    let reordered = String::from_utf8(write_connection_set_xml(&reordered))
        .expect("reordered connection XML is UTF-8");
    assert!(reordered.find("futureTwo").unwrap() < reordered.find("futureOne").unwrap());
    assert!(reordered.contains("<connection id=\"20\" name=\"two\"><vendor:futureTwo"));
    assert!(reordered.contains("<connection id=\"10\" name=\"one\"><vendor:futureOne"));

    let mut deleted = parse_connections_xml(source);
    deleted.connections.remove(0);
    let deleted = String::from_utf8(write_connection_set_xml(&deleted))
        .expect("deleted connection XML is UTF-8");
    assert!(!deleted.contains("futureOne"));
    assert!(deleted.contains("<connection id=\"2\" name=\"two\"><vendor:futureTwo"));

    let mut added = parse_connections_xml(source);
    added.connections.push(WorkbookConnection {
        id: 3,
        name: Some("three".to_string()),
        ..Default::default()
    });
    let added =
        String::from_utf8(write_connection_set_xml(&added)).expect("added connection XML is UTF-8");
    assert!(added.contains("futureOne"));
    assert!(added.contains("futureTwo"));
    assert!(added.contains("<connection id=\"3\" name=\"three\"></connection>"));
}

#[test]
fn foreign_ext_lst_stays_opaque_while_typed_child_changes() {
    let source = br#"<?xml version="1.0"?><connections xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:vendor="urn:vendor"><connection id="1" name="one"><vendor:extLst vendor:marker="keep"><vendor:future/></vendor:extLst><dbPr connection="old"/></connection></connections>"#;
    let mut set = parse_connections_xml(source);
    set.connections[0]
        .db_pr
        .as_mut()
        .expect("dbPr should parse")
        .connection = Some("new".to_string());

    let written =
        String::from_utf8(write_connection_set_xml(&set)).expect("foreign extension XML is UTF-8");
    assert!(
        written.contains("<vendor:extLst vendor:marker=\"keep\"><vendor:future/></vendor:extLst>")
    );
    assert!(written.contains("<dbPr connection=\"new\"/>"));
}

#[test]
fn new_modeled_child_is_inserted_before_authored_ext_lst() {
    let source = br#"<?xml version="1.0"?><connections xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><connection id="1" name="one"><extLst><ext uri="urn:future"/></extLst></connection></connections>"#;
    let mut set = parse_connections_xml(source);
    set.connections[0].db_pr = Some(DbConnectionProperties {
        connection: Some("new".to_string()),
        ..Default::default()
    });

    let written = String::from_utf8(write_connection_set_xml(&set))
        .expect("schema ordered connection XML is UTF-8");
    assert!(written.find("<dbPr").unwrap() < written.find("<extLst").unwrap());
    assert!(written.contains("<extLst><ext uri=\"urn:future\"/></extLst>"));
}

#[test]
fn prefixed_source_binds_generated_unprefixed_nodes() {
    let source = br#"<?xml version="1.0"?><x:connections xmlns:x="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:vendor="urn:vendor"><x:connection id="1" name="one"><x:extLst><x:ext uri="urn:future"/></x:extLst><vendor:future/></x:connection></x:connections>"#;
    let mut set = parse_connections_xml(source);
    set.connections[0].db_pr = Some(DbConnectionProperties {
        connection: Some("new".to_string()),
        ..Default::default()
    });
    set.connections.push(WorkbookConnection {
        id: 2,
        name: Some("two".to_string()),
        ..Default::default()
    });

    let written = String::from_utf8(write_connection_set_xml(&set))
        .expect("prefixed connection XML is UTF-8");
    assert!(written.contains("<dbPr connection=\"new\" xmlns=\"http://schemas.openxmlformats.org/spreadsheetml/2006/main\"/>"));
    assert!(written.contains(
        "<connection id=\"2\" name=\"two\" xmlns=\"http://schemas.openxmlformats.org/spreadsheetml/2006/main\">"
    ));
    assert!(written.contains("<x:extLst><x:ext uri=\"urn:future\"/></x:extLst>"));
    assert!(written.contains("vendor:future"));

    let reparsed = parse_connections_xml(written.as_bytes());
    assert_eq!(reparsed.connections.len(), 2);
    assert_eq!(reparsed.connections[0].id, 1);
    assert_eq!(
        reparsed.connections[0]
            .db_pr
            .as_ref()
            .and_then(|db| db.connection.as_deref()),
        Some("new")
    );
    assert_eq!(reparsed.connections[1].id, 2);
    assert_eq!(reparsed.connections[1].name.as_deref(), Some("two"));
}

#[test]
fn oledb_projection_remains_opaque_and_is_not_synthesized() {
    let source = br#"<?xml version="1.0"?><connections xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:vendor="urn:vendor"><connection id="1" name="one"><oledbPr connection="legacy" vendor:marker="keep"><vendor:future/></oledbPr><dbPr connection="current"/></connection></connections>"#;
    let mut set = parse_connections_xml(source);
    set.connections[0].name = Some("edited".to_string());

    let written =
        String::from_utf8(write_connection_set_xml(&set)).expect("opaque oledbPr XML is UTF-8");
    assert!(written.contains(
        r#"<oledbPr connection="legacy" vendor:marker="keep"><vendor:future/></oledbPr>"#
    ));
    assert_eq!(written.matches("<oledbPr").count(), 1);

    let generated = WorkbookConnection {
        id: 2,
        oledb_pr: Some(Default::default()),
        ..Default::default()
    };
    let generated_xml = String::from_utf8(write_connection_set_xml(
        &domain_types::domain::connections::WorkbookConnectionSet {
            connections: vec![generated],
            ..Default::default()
        },
    ))
    .expect("canonical connection XML is UTF-8");
    assert!(!generated_xml.contains("oledbPr"));
}

#[test]
fn parameter_extensions_follow_reorder_delete_rename_and_add() {
    let source = br#"<?xml version="1.0"?><connections xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:vendor="urn:vendor"><connection id="1" name="one"><parameters count="2"><parameter name="first" vendor:marker="first"><vendor:first/></parameter><vendor:between/><parameter name="second" vendor:marker="second"><vendor:second/></parameter></parameters></connection></connections>"#;

    let mut reordered = parse_connections_xml(source);
    assert_eq!(reordered.connections[0].parameters.len(), 2);
    assert_eq!(
        reordered.connections[0].parameters[0].raw_source_index,
        Some(0)
    );
    assert_eq!(
        reordered.connections[0].parameters[1].raw_source_index,
        Some(1)
    );
    reordered.connections[0].parameters.swap(0, 1);
    reordered.connections[0].parameters[0].name = Some("renamed-second".to_string());
    reordered.connections[0]
        .parameters
        .push(ConnectionParameter {
            name: Some("new".to_string()),
            ..Default::default()
        });
    let reordered = String::from_utf8(write_connection_set_xml(&reordered))
        .expect("reordered parameter XML is UTF-8");
    assert!(reordered.find("vendor:second").unwrap() < reordered.find("vendor:first").unwrap());
    assert!(reordered.contains(
        r#"<parameter name="renamed-second" vendor:marker="second"><vendor:second/></parameter>"#
    ));
    assert!(reordered
        .contains(r#"<parameter name="first" vendor:marker="first"><vendor:first/></parameter>"#));
    assert!(reordered.contains(r#"<parameter name="new"/>"#));
    assert!(reordered.contains("<vendor:between/>"));

    let mut deleted = parse_connections_xml(source);
    deleted.connections[0].parameters.remove(0);
    let deleted = String::from_utf8(write_connection_set_xml(&deleted))
        .expect("deleted parameter XML is UTF-8");
    assert!(!deleted.contains("vendor:first"));
    assert!(deleted.contains(
        r#"<parameter name="second" vendor:marker="second"><vendor:second/></parameter>"#
    ));

    let mut all_deleted = parse_connections_xml(source);
    all_deleted.connections[0].parameters.clear();
    let all_deleted = String::from_utf8(write_connection_set_xml(&all_deleted))
        .expect("all-deleted parameter XML is UTF-8");
    assert!(!all_deleted.contains("vendor:first"));
    assert!(!all_deleted.contains("vendor:second"));
    assert!(
        all_deleted.contains("<parameters count=\"0\">")
            || all_deleted.contains("<parameters count=\"0\"")
    );
    assert!(all_deleted.contains("<vendor:between/>"));
}
