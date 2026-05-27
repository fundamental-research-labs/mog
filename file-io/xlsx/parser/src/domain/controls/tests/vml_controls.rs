use crate::domain::controls::types::{FormControlProperties, FormControlType};
use crate::domain::controls::vml;

#[test]
fn parses_vml_client_data_control() {
    let xml = br##"<xml xmlns:v="urn:schemas-microsoft-com:vml" xmlns:x="urn:schemas-microsoft-com:office:excel">
        <v:shape id="_x0000_s1025" type="#_x0000_t201">
            <x:ClientData ObjectType="Checkbox">
                <x:Anchor>1,15,0,10,3,22,1,4</x:Anchor>
                <x:FmlaLink>$A$1</x:FmlaLink>
            </x:ClientData>
        </v:shape>
    </xml>"##;

    let mut controls = Vec::new();
    vml::parse_vml_drawing(xml, &mut controls);

    assert_eq!(controls.len(), 1);
    assert_eq!(controls[0].object_type, FormControlType::CheckBox);
    assert_eq!(controls[0].shape_id, Some(1025));
    assert_eq!(controls[0].properties.linked_cell.as_deref(), Some("$A$1"));
    assert_eq!(controls[0].anchor.from_col, 1);
}

#[test]
fn preserves_vml_only_client_data_extras() {
    let xml = br##"<xml xmlns:v="urn:schemas-microsoft-com:vml" xmlns:x="urn:schemas-microsoft-com:office:excel">
        <v:shape type="#_x0000_t201">
            <x:ClientData ObjectType="Drop">
                <x:Anchor>1,0,0,0,3,0,1,0</x:Anchor>
                <x:FmlaLink>$A$1</x:FmlaLink>
                <x:FmlaPict>$B$2</x:FmlaPict>
                <x:Accel>65</x:Accel>
                <x:Camera/>
                <x:Visible/>
            </x:ClientData>
        </v:shape>
    </xml>"##;

    let mut controls = Vec::new();
    vml::parse_vml_drawing(xml, &mut controls);

    assert_eq!(controls.len(), 1);
    assert_eq!(controls[0].object_type, FormControlType::ComboBox);
    assert_eq!(
        controls[0].properties.vml_extras.get("FmlaPict"),
        Some(&"$B$2".to_string())
    );
    assert_eq!(
        controls[0].properties.vml_extras.get("Accel"),
        Some(&"65".to_string())
    );
    assert_eq!(
        controls[0].properties.vml_extras.get("Camera"),
        Some(&String::new())
    );
    assert_eq!(
        controls[0].properties.vml_extras.get("Visible"),
        Some(&String::new())
    );
    assert!(controls[0].properties.vml_extras.get("FmlaLink").is_none());
}

#[test]
fn preserves_every_supported_vml_only_client_data_tag() {
    let vml_only_tags = [
        "FmlaPict",
        "Accel",
        "Accel2",
        "Row",
        "Column",
        "Visible",
        "RowHidden",
        "ColHidden",
        "Default",
        "Help",
        "Cancel",
        "Dismiss",
        "ValidIds",
        "MapOCX",
        "Camera",
        "AutoScale",
        "DDE",
        "ScriptText",
        "ScriptExtended",
        "ScriptLanguage",
        "ScriptLocation",
        "LCT",
    ];
    let mut client_data =
        String::from(r#"<x:ClientData ObjectType="Drop"><x:Anchor>1,0,0,0,3,0,1,0</x:Anchor>"#);
    for tag in vml_only_tags {
        client_data.push_str(&format!("<x:{tag}>{tag}-value</x:{tag}>"));
    }
    client_data.push_str("</x:ClientData>");
    let xml = format!(
        r##"<xml xmlns:v="urn:schemas-microsoft-com:vml" xmlns:x="urn:schemas-microsoft-com:office:excel">
            <v:shape type="#_x0000_t201">{client_data}</v:shape>
        </xml>"##
    );

    let mut controls = Vec::new();
    vml::parse_vml_drawing(xml.as_bytes(), &mut controls);

    assert_eq!(controls.len(), 1);
    for tag in vml_only_tags {
        let expected = format!("{tag}-value");
        assert_eq!(
            controls[0]
                .properties
                .vml_extras
                .get(tag)
                .map(String::as_str),
            Some(expected.as_str()),
            "{tag}"
        );
    }
}

#[test]
fn extracts_vml_image_relationship_ids_for_ole_previews() {
    let xml = br##"<xml xmlns:v="urn:schemas-microsoft-com:vml" xmlns:o="urn:schemas-microsoft-com:office:office">
        <v:shape id="_x0000_s1025" type="#_x0000_t75">
            <v:imagedata o:relid="rId1" o:title="preview"/>
        </v:shape>
        <v:shape id="_x0000_s1026" type="#_x0000_t75">
            <v:imagedata r:id="rId2"/>
        </v:shape>
        <v:shape id="_x0000_s1027" type="#_x0000_t201">
            <x:ClientData ObjectType="Checkbox"/>
        </v:shape>
    </xml>"##;

    let result = vml::parse_vml_imagedata(xml);

    assert_eq!(result.len(), 2);
    assert_eq!(result.get("_x0000_s1025"), Some(&"rId1".to_string()));
    assert_eq!(result.get("_x0000_s1026"), Some(&"rId2".to_string()));
    assert!(result.get("_x0000_s1027").is_none());
}

#[test]
fn extracts_numeric_vml_shape_ids() {
    assert_eq!(vml::extract_vml_shape_number("_x0000_s1025"), Some(1025));
    assert_eq!(vml::extract_vml_shape_number("_x0000_s2048"), Some(2048));
    assert_eq!(vml::extract_vml_shape_number("1025"), Some(1025));
    assert_eq!(vml::extract_vml_shape_number("invalid"), None);
}

#[test]
fn vml_extras_default_empty() {
    let props = FormControlProperties::default();
    assert!(props.vml_extras.is_empty());
}
