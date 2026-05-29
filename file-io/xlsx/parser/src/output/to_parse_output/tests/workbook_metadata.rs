use super::super::full_parse_result_to_parse_output;
use super::helpers::threading_result;
use crate::output::results::FullParsedSheet;

#[test]
fn vba_project_active_content_is_quarantined_in_package_fidelity() {
    let mut result = threading_result(FullParsedSheet::default(), None, Vec::new());
    result
        .content_type_defaults
        .push(("bin".to_string(), crate::write::CT_VBA.to_string()));
    result.content_type_overrides.push((
        "/xl/vbaProject.bin".to_string(),
        crate::write::CT_VBA.to_string(),
    ));
    result
        .workbook_relationships
        .push(ooxml_types::shared::OpcRelationship {
            id: "rIdMacro".to_string(),
            rel_type: crate::infra::opc::REL_VBA_PROJECT.to_string(),
            target: "vbaProject.bin".to_string(),
            target_mode: None,
        });

    let mut extensions = crate::pipeline::import_extensions::ImportExtensionParts::new();
    extensions.imported_parts.record(
        "xl/vbaProject.bin".to_string(),
        vec![0xD0, 0xCF, 0x11, 0xE0],
    );
    result.extensions = Some(extensions);

    let (output, diagnostics) = full_parse_result_to_parse_output(&result);

    let package_fidelity = output.package_fidelity.unwrap_or_default();
    assert_eq!(package_fidelity.opaque_parts.len(), 1);
    assert_eq!(package_fidelity.opaque_parts[0].path, "xl/vbaProject.bin");
    assert_eq!(
        package_fidelity.opaque_parts[0].bytes,
        vec![0xD0, 0xCF, 0x11, 0xE0]
    );
    assert!(package_fidelity.workbook_relationships.iter().any(|hint| {
        hint.id == "rIdMacro"
            && hint.relationship_type == crate::infra::opc::REL_VBA_PROJECT
            && hint.target == "vbaProject.bin"
    }));

    let messages: Vec<_> = diagnostics
        .errors
        .iter()
        .map(|error| error.message.as_str())
        .collect();
    assert!(
        messages.iter().any(|message| message
            .contains("Preserved XLSX active content without interpretation or execution")),
        "expected VBA quarantine diagnostic, got {messages:?}"
    );
}

#[test]
fn typed_custom_doc_props_populate_parse_output() {
    let mut result = threading_result(FullParsedSheet::default(), None, Vec::new());
    result.doc_props_custom = Some(vec![
        domain_types::DocumentCustomProperty {
            fmtid: Some("{D5CDD505-2E9C-101B-9397-08002B2CF9AE}".to_string()),
            pid: Some(2),
            name: "Approved".to_string(),
            link_target: None,
            value: domain_types::DocumentCustomPropertyValue::Bool(true),
        },
        domain_types::DocumentCustomProperty {
            fmtid: Some("{D5CDD505-2E9C-101B-9397-08002B2CF9AE}".to_string()),
            pid: Some(3),
            name: "Revision".to_string(),
            link_target: None,
            value: domain_types::DocumentCustomPropertyValue::I4(7),
        },
        domain_types::DocumentCustomProperty {
            fmtid: Some("{D5CDD505-2E9C-101B-9397-08002B2CF9AE}".to_string()),
            pid: Some(4),
            name: "Confidence".to_string(),
            link_target: None,
            value: domain_types::DocumentCustomPropertyValue::R8(0.875),
        },
        domain_types::DocumentCustomProperty {
            fmtid: Some("{D5CDD505-2E9C-101B-9397-08002B2CF9AE}".to_string()),
            pid: Some(5),
            name: "ReviewedAt".to_string(),
            link_target: None,
            value: domain_types::DocumentCustomPropertyValue::Filetime(
                "2026-05-27T10:00:00Z".to_string(),
            ),
        },
    ]);

    let (output, _diagnostics) = full_parse_result_to_parse_output(&result);
    let props = output
        .properties
        .expect("custom properties should be modeled");

    assert_eq!(
        props.typed_custom,
        vec![
            domain_types::DocumentCustomProperty {
                fmtid: Some("{D5CDD505-2E9C-101B-9397-08002B2CF9AE}".to_string()),
                pid: Some(2),
                name: "Approved".to_string(),
                link_target: None,
                value: domain_types::DocumentCustomPropertyValue::Bool(true),
            },
            domain_types::DocumentCustomProperty {
                fmtid: Some("{D5CDD505-2E9C-101B-9397-08002B2CF9AE}".to_string()),
                pid: Some(3),
                name: "Revision".to_string(),
                link_target: None,
                value: domain_types::DocumentCustomPropertyValue::I4(7),
            },
            domain_types::DocumentCustomProperty {
                fmtid: Some("{D5CDD505-2E9C-101B-9397-08002B2CF9AE}".to_string()),
                pid: Some(4),
                name: "Confidence".to_string(),
                link_target: None,
                value: domain_types::DocumentCustomPropertyValue::R8(0.875),
            },
            domain_types::DocumentCustomProperty {
                fmtid: Some("{D5CDD505-2E9C-101B-9397-08002B2CF9AE}".to_string()),
                pid: Some(5),
                name: "ReviewedAt".to_string(),
                link_target: None,
                value: domain_types::DocumentCustomPropertyValue::Filetime(
                    "2026-05-27T10:00:00Z".to_string(),
                ),
            },
        ]
    );
    assert_eq!(
        props.custom,
        vec![
            ("Approved".to_string(), "true".to_string()),
            ("Revision".to_string(), "7".to_string()),
            ("Confidence".to_string(), "0.875".to_string()),
            ("ReviewedAt".to_string(), "2026-05-27T10:00:00Z".to_string()),
        ]
    );
}

#[test]
fn workbook_views_populate_parse_output() {
    let mut result = threading_result(FullParsedSheet::default(), None, Vec::new());
    result.workbook_views = vec![
        ooxml_types::workbook::BookView {
            active_tab: 2,
            first_sheet: 1,
            visibility: ooxml_types::workbook::Visibility::Hidden,
            minimized: true,
            show_horizontal_scroll: false,
            show_vertical_scroll: true,
            show_sheet_tabs: false,
            auto_filter_date_grouping: false,
            x_window: Some(120),
            y_window: Some(240),
            window_width: Some(14400),
            window_height: Some(9000),
            tab_ratio: Some(725.5),
            xr_uid: Some("{VIEW-1}".to_string()),
            ext_lst: None,
        },
        ooxml_types::workbook::BookView {
            active_tab: 0,
            first_sheet: 0,
            window_width: Some(8000),
            ..Default::default()
        },
    ];

    let (output, _diagnostics) = full_parse_result_to_parse_output(&result);

    assert_eq!(output.workbook_views.len(), 2);

    let primary = &output.workbook_views[0];
    assert_eq!(primary.active_tab, 2);
    assert_eq!(primary.first_sheet, 1);
    assert_eq!(
        primary.visibility,
        domain_types::domain::workbook::WorkbookViewVisibility::Hidden
    );
    assert!(primary.minimized);
    assert!(!primary.show_horizontal_scroll);
    assert!(primary.show_vertical_scroll);
    assert!(!primary.show_sheet_tabs);
    assert!(!primary.auto_filter_date_grouping);
    assert_eq!(primary.x_window, Some(120));
    assert_eq!(primary.y_window, Some(240));
    assert_eq!(primary.window_width, Some(14400));
    assert_eq!(primary.window_height, Some(9000));
    assert_eq!(primary.tab_ratio, Some(725.5));
    assert_eq!(primary.uid.as_deref(), Some("{VIEW-1}"));
    assert_eq!(output.workbook_views[1].window_width, Some(8000));
}
