use super::*;

mod records {
    use super::*;

    #[test]
    fn test_content_type_default_new() {
        let default = ContentTypeDefault::new("xml", CT_XML);
        assert_eq!(default.extension, "xml");
        assert_eq!(default.content_type, CT_XML);
    }

    #[test]
    fn test_content_type_default_new_preserves_extension() {
        let default = ContentTypeDefault::new(".XML", CT_XML);
        assert_eq!(default.extension, ".XML");
    }

    #[test]
    fn test_content_type_override_new() {
        let over = ContentTypeOverride::new("/xl/workbook.xml", CT_WORKBOOK);
        assert_eq!(over.part_name, "/xl/workbook.xml");
        assert_eq!(over.content_type, CT_WORKBOOK);
    }

    #[test]
    fn test_content_type_override_auto_slash() {
        let over = ContentTypeOverride::new("xl/workbook.xml", CT_WORKBOOK);
        assert_eq!(over.part_name, "/xl/workbook.xml");
    }
}

mod manager {
    use super::*;

    #[test]
    fn test_manager_new() {
        let ct = ContentTypesManager::new();
        assert_eq!(ct.default_count(), 0);
        assert_eq!(ct.override_count(), 0);
    }

    #[test]
    fn test_manager_with_xlsx_defaults() {
        let ct = ContentTypesManager::with_xlsx_defaults();
        assert_eq!(ct.default_count(), 2);
        assert!(ct.has_default("rels"));
        assert!(ct.has_default("xml"));
    }

    #[test]
    fn test_default_impl() {
        let ct = ContentTypesManager::default();
        assert_eq!(ct.default_count(), 0);
        assert_eq!(ct.override_count(), 0);
    }

    #[test]
    fn test_add_default() {
        let mut ct = ContentTypesManager::new();
        ct.add_default("png", CT_PNG);
        assert_eq!(ct.default_count(), 1);
        assert!(ct.has_default("png"));
    }

    #[test]
    fn test_add_default_no_duplicates() {
        let mut ct = ContentTypesManager::new();
        ct.add_default("xml", CT_XML);
        ct.add_default("xml", CT_XML);
        assert_eq!(ct.default_count(), 1);
    }

    #[test]
    fn test_add_default_duplicate_extension_first_writer_wins() {
        let mut ct = ContentTypesManager::new();
        ct.add_default("xml", CT_XML);
        ct.add_default("xml", CT_WORKBOOK);
        assert_eq!(ct.default_count(), 1);
        assert_eq!(ct.defaults()[0].content_type, CT_XML);
    }

    #[test]
    fn test_prefer_existing_default_content_type_updates_case_insensitive() {
        let mut ct = ContentTypesManager::new();
        ct.add_default("PNG", CT_PNG);
        ct.prefer_existing_default_content_type("png", "image/x-png");
        assert_eq!(ct.default_count(), 1);
        assert_eq!(ct.defaults()[0].extension, "PNG");
        assert_eq!(ct.defaults()[0].content_type, "image/x-png");
    }

    #[test]
    fn test_prefer_existing_default_content_type_does_not_insert_missing() {
        let mut ct = ContentTypesManager::new();
        ct.prefer_existing_default_content_type("png", CT_PNG);
        assert_eq!(ct.default_count(), 0);
        assert!(!ct.has_default("png"));
    }

    #[test]
    fn test_add_override() {
        let mut ct = ContentTypesManager::new();
        ct.add_override("/xl/workbook.xml", CT_WORKBOOK);
        assert_eq!(ct.override_count(), 1);
        assert!(ct.has_override("/xl/workbook.xml"));
    }

    #[test]
    fn test_add_override_no_duplicates_without_then_with_slash() {
        let mut ct = ContentTypesManager::new();
        ct.add_override("xl/workbook.xml", CT_WORKBOOK);
        ct.add_override("/xl/workbook.xml", CT_STYLES);
        assert_eq!(ct.override_count(), 1);
        assert_eq!(ct.overrides()[0].content_type, CT_WORKBOOK);
    }

    #[test]
    fn test_add_override_no_duplicates_with_then_without_slash() {
        let mut ct = ContentTypesManager::new();
        ct.add_override("/xl/workbook.xml", CT_WORKBOOK);
        ct.add_override("xl/workbook.xml", CT_STYLES);
        assert_eq!(ct.override_count(), 1);
        assert_eq!(ct.overrides()[0].content_type, CT_WORKBOOK);
    }

    #[test]
    fn test_has_override_with_and_without_slash() {
        let mut ct = ContentTypesManager::new();
        ct.add_override("/xl/workbook.xml", CT_WORKBOOK);

        assert!(ct.has_override("/xl/workbook.xml"));
        assert!(ct.has_override("xl/workbook.xml"));
    }

    #[test]
    fn test_defaults_accessor() {
        let mut ct = ContentTypesManager::new();
        ct.add_default("xml", CT_XML);
        ct.add_default("rels", CT_RELATIONSHIPS);

        let defaults = ct.defaults();
        assert_eq!(defaults.len(), 2);
    }

    #[test]
    fn test_overrides_accessor() {
        let mut ct = ContentTypesManager::new();
        ct.add_workbook();
        ct.add_worksheet(1);

        let overrides = ct.overrides();
        assert_eq!(overrides.len(), 2);
    }
}

mod builders {
    use super::*;

    #[test]
    fn test_add_workbook() {
        let mut ct = ContentTypesManager::new();
        ct.add_workbook();
        assert!(ct.has_override("/xl/workbook.xml"));
    }

    #[test]
    fn test_add_worksheet() {
        let mut ct = ContentTypesManager::new();
        ct.add_worksheet(1);
        ct.add_worksheet(2);
        assert!(ct.has_override("/xl/worksheets/sheet1.xml"));
        assert!(ct.has_override("/xl/worksheets/sheet2.xml"));
        assert_eq!(ct.override_count(), 2);
    }

    #[test]
    fn test_add_styles() {
        let mut ct = ContentTypesManager::new();
        ct.add_styles();
        assert!(ct.has_override("/xl/styles.xml"));
    }

    #[test]
    fn test_add_shared_strings() {
        let mut ct = ContentTypesManager::new();
        ct.add_shared_strings();
        assert!(ct.has_override("/xl/sharedStrings.xml"));
    }

    #[test]
    fn test_add_theme() {
        let mut ct = ContentTypesManager::new();
        ct.add_theme();
        assert!(ct.has_override("/xl/theme/theme1.xml"));
    }

    #[test]
    fn test_add_table() {
        let mut ct = ContentTypesManager::new();
        ct.add_table(1);
        ct.add_table(2);
        assert!(ct.has_override("/xl/tables/table1.xml"));
        assert!(ct.has_override("/xl/tables/table2.xml"));
    }

    #[test]
    fn test_add_chart() {
        let mut ct = ContentTypesManager::new();
        ct.add_chart(1);
        assert!(ct.has_override("/xl/charts/chart1.xml"));
    }

    #[test]
    fn test_add_chart_ex() {
        let mut ct = ContentTypesManager::new();
        ct.add_chart_ex(1);
        assert!(ct.has_override("/xl/charts/chartEx1.xml"));
        assert_eq!(
            ct.overrides()[0].content_type,
            "application/vnd.ms-office.chartex+xml"
        );
    }

    #[test]
    fn test_add_chart_style_normalizes_leading_slash_and_suppresses_duplicates() {
        let mut ct = ContentTypesManager::new();
        ct.add_chart_style("xl/charts/style1.xml");
        ct.add_chart_style("/xl/charts/style1.xml");
        assert_eq!(ct.override_count(), 1);
        assert_eq!(ct.overrides()[0].part_name, "/xl/charts/style1.xml");
        assert_eq!(ct.overrides()[0].content_type, CT_CHART_STYLE);
    }

    #[test]
    fn test_add_chart_color_style_normalizes_leading_slash_and_suppresses_duplicates() {
        let mut ct = ContentTypesManager::new();
        ct.add_chart_color_style("/xl/charts/colors1.xml");
        ct.add_chart_color_style("xl/charts/colors1.xml");
        assert_eq!(ct.override_count(), 1);
        assert_eq!(ct.overrides()[0].part_name, "/xl/charts/colors1.xml");
        assert_eq!(ct.overrides()[0].content_type, CT_CHART_COLOR_STYLE);
    }

    #[test]
    fn test_add_drawing() {
        let mut ct = ContentTypesManager::new();
        ct.add_drawing(1);
        assert!(ct.has_override("/xl/drawings/drawing1.xml"));
    }

    #[test]
    fn test_add_comments() {
        let mut ct = ContentTypesManager::new();
        ct.add_comments(1);
        ct.add_comments(2);
        assert!(ct.has_override("/xl/comments1.xml"));
        assert!(ct.has_override("/xl/comments2.xml"));
    }

    #[test]
    fn test_add_comments_path_normalizes_leading_slash_and_suppresses_duplicates() {
        let mut ct = ContentTypesManager::new();
        ct.add_comments_path("xl/comments6.xml");
        ct.add_comments_path("/xl/comments6.xml");
        assert_eq!(ct.override_count(), 1);
        assert_eq!(ct.overrides()[0].part_name, "/xl/comments6.xml");
        assert_eq!(ct.overrides()[0].content_type, CT_COMMENTS);
    }

    #[test]
    fn test_add_core_properties() {
        let mut ct = ContentTypesManager::new();
        ct.add_core_properties();
        assert!(ct.has_override("/docProps/core.xml"));
    }

    #[test]
    fn test_add_extended_properties() {
        let mut ct = ContentTypesManager::new();
        ct.add_extended_properties();
        assert!(ct.has_override("/docProps/app.xml"));
    }

    #[test]
    fn test_add_custom_properties() {
        let mut ct = ContentTypesManager::new();
        ct.add_custom_properties();
        assert!(ct.has_override("/docProps/custom.xml"));
    }

    #[test]
    fn test_add_metadata() {
        let mut ct = ContentTypesManager::new();
        ct.add_metadata();
        assert!(ct.has_override("/xl/metadata.xml"));
    }

    #[test]
    fn test_add_calc_chain() {
        let mut ct = ContentTypesManager::new();
        ct.add_calc_chain();
        assert!(ct.has_override("/xl/calcChain.xml"));
    }

    #[test]
    fn test_add_doc_metadata_label_info() {
        let mut ct = ContentTypesManager::new();
        ct.add_doc_metadata_label_info();
        assert!(ct.has_override("/docMetadata/LabelInfo.xml"));
    }

    #[test]
    fn test_add_pivot_table() {
        let mut ct = ContentTypesManager::new();
        ct.add_pivot_table(1);
        assert!(ct.has_override("/xl/pivotTables/pivotTable1.xml"));
    }

    #[test]
    fn test_add_pivot_cache() {
        let mut ct = ContentTypesManager::new();
        ct.add_pivot_cache(1);
        assert!(ct.has_override("/xl/pivotCache/pivotCacheDefinition1.xml"));
    }

    #[test]
    fn test_add_slicer() {
        let mut ct = ContentTypesManager::new();
        ct.add_slicer(1);
        ct.add_slicer(2);
        assert!(ct.has_override("/xl/slicers/slicer1.xml"));
        assert!(ct.has_override("/xl/slicers/slicer2.xml"));
    }

    #[test]
    fn test_add_slicer_cache() {
        let mut ct = ContentTypesManager::new();
        ct.add_slicer_cache(1);
        ct.add_slicer_cache(2);
        assert!(ct.has_override("/xl/slicerCaches/slicerCache1.xml"));
        assert!(ct.has_override("/xl/slicerCaches/slicerCache2.xml"));
    }

    #[test]
    fn test_add_diagram_parts() {
        let mut ct = ContentTypesManager::new();
        ct.add_diagram_data(1)
            .add_diagram_layout(1)
            .add_diagram_colors(1)
            .add_diagram_style(1)
            .add_diagram_drawing(1);
        assert!(ct.has_override("/xl/diagrams/data1.xml"));
        assert!(ct.has_override("/xl/diagrams/layout1.xml"));
        assert!(ct.has_override("/xl/diagrams/colors1.xml"));
        assert!(ct.has_override("/xl/diagrams/quickStyles1.xml"));
        assert!(ct.has_override("/xl/diagrams/drawing1.xml"));
    }

    #[test]
    fn test_add_image_defaults() {
        let mut ct = ContentTypesManager::new();
        ct.add_png_default();
        ct.add_jpeg_default();
        ct.add_gif_default();
        assert!(ct.has_default("png"));
        assert!(ct.has_default("jpeg"));
        assert!(ct.has_default("jpg"));
        assert!(ct.has_default("gif"));
    }

    #[test]
    fn test_add_vba_default() {
        let mut ct = ContentTypesManager::new();
        ct.add_vba_default();
        assert!(ct.has_default("bin"));
    }

    #[test]
    fn test_builder_pattern_chaining() {
        let mut ct = ContentTypesManager::with_xlsx_defaults();
        ct.add_workbook()
            .add_worksheet(1)
            .add_worksheet(2)
            .add_styles()
            .add_shared_strings()
            .add_theme();

        assert_eq!(ct.default_count(), 2);
        assert_eq!(ct.override_count(), 6);
    }
}

mod xml {
    use super::*;

    #[test]
    fn test_to_xml_basic() {
        let mut ct = ContentTypesManager::with_xlsx_defaults();
        ct.add_workbook();
        ct.add_worksheet(1);

        let xml = ct.to_xml();
        let xml_str = String::from_utf8_lossy(&xml);

        assert!(
            xml_str.starts_with("<?xml version=\"1.0\" encoding=\"UTF-8\" standalone=\"yes\"?>")
        );
        assert!(
            xml_str
                .contains("xmlns=\"http://schemas.openxmlformats.org/package/2006/content-types\"")
        );
        assert!(xml_str.contains("<Default Extension=\"rels\""));
        assert!(xml_str.contains("<Default Extension=\"xml\""));
        assert!(xml_str.contains("<Override PartName=\"/xl/workbook.xml\""));
        assert!(xml_str.contains("<Override PartName=\"/xl/worksheets/sheet1.xml\""));
    }

    #[test]
    fn test_to_xml_content_types() {
        let mut ct = ContentTypesManager::with_xlsx_defaults();
        ct.add_workbook();

        let xml = ct.to_xml();
        let xml_str = String::from_utf8_lossy(&xml);

        assert!(xml_str.contains(CT_RELATIONSHIPS));
        assert!(xml_str.contains(CT_XML));
        assert!(xml_str.contains(CT_WORKBOOK));
    }

    #[test]
    fn test_to_xml_complete() {
        let mut ct = ContentTypesManager::with_xlsx_defaults();
        ct.add_workbook()
            .add_worksheet(1)
            .add_worksheet(2)
            .add_styles()
            .add_shared_strings()
            .add_theme();

        let xml = ct.to_xml();
        let xml_str = String::from_utf8_lossy(&xml);

        assert!(xml_str.contains(CT_STYLES));
        assert!(xml_str.contains(CT_SHARED_STRINGS));
        assert!(xml_str.contains(CT_THEME));
        assert!(xml_str.contains("/xl/worksheets/sheet2.xml"));
    }

    #[test]
    fn test_to_xml_preserves_group_and_insertion_order() {
        let mut ct = ContentTypesManager::new();
        ct.add_default("rels", CT_RELATIONSHIPS);
        ct.add_default("xml", CT_XML);
        ct.add_override("/xl/workbook.xml", CT_WORKBOOK);
        ct.add_override("/xl/worksheets/sheet1.xml", CT_WORKSHEET);

        let xml = ct.to_xml();
        let xml_str = String::from_utf8(xml).expect("content types XML is UTF-8");
        assert_eq!(
            xml_str,
            concat!(
                "<?xml version=\"1.0\" encoding=\"UTF-8\" standalone=\"yes\"?>",
                "<Types xmlns=\"http://schemas.openxmlformats.org/package/2006/content-types\">",
                "<Default Extension=\"rels\" ContentType=\"application/vnd.openxmlformats-package.relationships+xml\"/>",
                "<Default Extension=\"xml\" ContentType=\"application/xml\"/>",
                "<Override PartName=\"/xl/workbook.xml\" ContentType=\"application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml\"/>",
                "<Override PartName=\"/xl/worksheets/sheet1.xml\" ContentType=\"application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml\"/>",
                "</Types>"
            )
        );
    }

    #[test]
    fn test_xml_output_valid_xml() {
        let mut ct = ContentTypesManager::with_xlsx_defaults();
        ct.add_workbook()
            .add_worksheet(1)
            .add_styles()
            .add_shared_strings();

        let xml = ct.to_xml();
        let xml_str = String::from_utf8_lossy(&xml);

        assert!(xml_str.starts_with("<?xml"));
        assert!(xml_str.contains("<Types"));
        assert!(xml_str.contains("</Types>"));
        assert!(xml_str.contains("/>"));
    }
}

mod factory {
    use super::*;

    #[test]
    fn test_create_xlsx_content_types_basic() {
        let ct = create_xlsx_content_types(1, true, true, true, 0, 0);

        assert!(ct.has_default("rels"));
        assert!(ct.has_default("xml"));
        assert!(ct.has_override("/xl/workbook.xml"));
        assert!(ct.has_override("/xl/worksheets/sheet1.xml"));
        assert!(ct.has_override("/xl/styles.xml"));
        assert!(ct.has_override("/xl/sharedStrings.xml"));
        assert!(ct.has_override("/xl/theme/theme1.xml"));
    }

    #[test]
    fn test_create_xlsx_content_types_multiple_sheets() {
        let ct = create_xlsx_content_types(3, false, false, false, 0, 0);

        assert!(ct.has_override("/xl/worksheets/sheet1.xml"));
        assert!(ct.has_override("/xl/worksheets/sheet2.xml"));
        assert!(ct.has_override("/xl/worksheets/sheet3.xml"));
        assert!(!ct.has_override("/xl/styles.xml"));
        assert!(!ct.has_override("/xl/sharedStrings.xml"));
        assert!(!ct.has_override("/xl/theme/theme1.xml"));
    }

    #[test]
    fn test_create_xlsx_content_types_with_tables_and_charts() {
        let ct = create_xlsx_content_types(1, true, true, true, 2, 3);

        assert!(ct.has_override("/xl/tables/table1.xml"));
        assert!(ct.has_override("/xl/tables/table2.xml"));
        assert!(ct.has_override("/xl/charts/chart1.xml"));
        assert!(ct.has_override("/xl/charts/chart2.xml"));
        assert!(ct.has_override("/xl/charts/chart3.xml"));
    }

    #[test]
    fn test_create_xlsx_content_types_minimal() {
        let ct = create_xlsx_content_types(1, false, false, false, 0, 0);

        assert_eq!(ct.default_count(), 2);
        assert_eq!(ct.override_count(), 2);
    }

    #[test]
    fn test_create_xlsx_content_types_zero_counts() {
        let ct = create_xlsx_content_types(0, false, false, false, 0, 0);

        assert_eq!(ct.default_count(), 2);
        assert_eq!(ct.override_count(), 1);
        assert!(ct.has_override("/xl/workbook.xml"));
        assert!(!ct.has_override("/xl/worksheets/sheet1.xml"));
    }
}

mod constants {
    use super::*;

    #[test]
    fn test_constants() {
        assert!(CT_WORKBOOK.contains("spreadsheetml.sheet.main"));
        assert!(CT_WORKSHEET.contains("spreadsheetml.worksheet"));
        assert!(CT_STYLES.contains("spreadsheetml.styles"));
        assert!(CT_SHARED_STRINGS.contains("sharedStrings"));
        assert!(CT_THEME.contains("theme"));
        assert!(CT_RELATIONSHIPS.contains("relationships"));
        assert!(CT_DRAWING.contains("drawing"));
        assert!(CT_CHART.contains("chart"));
        assert!(CT_TABLE.contains("table"));
        assert!(CT_COMMENTS.contains("comments"));
        assert!(CT_PIVOT_TABLE.contains("pivotTable"));
        assert!(CT_PIVOT_CACHE.contains("pivotCacheDefinition"));
        assert!(CT_VBA.contains("vbaProject"));
        assert_eq!(CT_XML, "application/xml");
        assert_eq!(CT_PNG, "image/png");
        assert_eq!(CT_JPEG, "image/jpeg");
        assert_eq!(CT_GIF, "image/gif");
        assert_eq!(CT_CHART_STYLE, "application/vnd.ms-office.chartstyle+xml");
        assert_eq!(
            CT_CHART_COLOR_STYLE,
            "application/vnd.ms-office.chartcolorstyle+xml"
        );
        assert_eq!(
            CT_DIAGRAM_DRAWING,
            "application/vnd.ms-office.drawingml.diagramDrawing+xml"
        );
        assert_eq!(
            CT_METADATA,
            "application/vnd.openxmlformats-officedocument.spreadsheetml.sheetMetadata+xml"
        );
        assert_eq!(
            CT_CALC_CHAIN,
            "application/vnd.openxmlformats-officedocument.spreadsheetml.calcChain+xml"
        );
    }
}
