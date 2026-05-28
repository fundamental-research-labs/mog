use super::super::convert_named_ranges;
use super::helpers::threading_result;
use crate::output::results::{DefinedNameOutput, FullParsedSheet};

#[test]
fn convert_named_ranges_preserves_ct_defined_name_metadata() {
    let mut result = threading_result(FullParsedSheet::default(), None, Vec::new());
    result.defined_names = vec![DefinedNameOutput {
        name: "MyRange".to_string(),
        refers_to: "Sheet1!$A$1".to_string(),
        local_sheet_id: Some(0),
        hidden: true,
        comment: Some("comment text".to_string()),
        custom_menu: Some("menu text".to_string()),
        description: Some("description text".to_string()),
        help: Some("help text".to_string()),
        status_bar: Some("status text".to_string()),
        function: true,
        vb_procedure: true,
        xlm: true,
        function_group_id: Some(6),
        shortcut_key: Some("K".to_string()),
        publish_to_server: true,
        workbook_parameter: true,
        xml_space_preserve: true,
    }];

    let named_ranges = convert_named_ranges(&result);
    let nr = named_ranges.first().expect("converted named range");
    assert_eq!(nr.name, "MyRange");
    assert_eq!(nr.local_sheet_id, Some(0));
    assert!(nr.hidden);
    assert_eq!(nr.comment.as_deref(), Some("comment text"));
    assert_eq!(nr.custom_menu.as_deref(), Some("menu text"));
    assert_eq!(nr.description.as_deref(), Some("description text"));
    assert_eq!(nr.help.as_deref(), Some("help text"));
    assert_eq!(nr.status_bar.as_deref(), Some("status text"));
    assert!(nr.function);
    assert!(nr.vb_procedure);
    assert!(nr.xlm);
    assert_eq!(nr.function_group_id, Some(6));
    assert_eq!(nr.shortcut_key.as_deref(), Some("K"));
    assert!(nr.publish_to_server);
    assert!(nr.workbook_parameter);
    assert!(nr.xml_space_preserve);
}
