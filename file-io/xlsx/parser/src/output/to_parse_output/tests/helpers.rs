use crate::domain::drawings::{Anchor, OneCellAnchor};
use crate::output::results::{
    CELL_TYPE_VAL_EMPTY as CELL_TYPE_EMPTY, CELL_TYPE_VAL_FORMULA as CELL_TYPE_FORMULA,
    CELL_TYPE_VAL_NUMBER as CELL_TYPE_NUMBER,
};
use crate::output::results::{
    CommentRunOutput, FullCellData, FullParseResult, FullParsedSheet, ParseStats,
    SmartArtPartsOutput, StylesOutput,
};
use domain_types::domain::comment::RichTextRun;
use domain_types::domain::drawings::{DrawingContent, GroupShapeData};

pub(super) fn extent_test_cell(row: u32, col: u32) -> FullCellData {
    FullCellData {
        row,
        col,
        cell_type: CELL_TYPE_NUMBER,
        style_idx: 0,
        value: Some("1".to_string()),
        formula: None,
        force_recalc: false,
        array_ref: None,
        cell_metadata_index: None,
        vm: None,
        phonetic: false,
        date_lexical_value: None,
        cached_value_type: 0,
        cell_formula: None,
        preserve_space_formula: false,
        preserve_space_value: false,
        sst_index: None,
        has_explicit_style: false,
    }
}

pub(super) fn test_cell(
    row: u32,
    col: u32,
    value: Option<&str>,
    formula: Option<&str>,
    array_ref: Option<&str>,
    cm: bool,
) -> FullCellData {
    FullCellData {
        row,
        col,
        cell_type: if formula.is_some() {
            CELL_TYPE_FORMULA
        } else {
            CELL_TYPE_NUMBER
        },
        style_idx: 0,
        value: value.map(str::to_string),
        formula: formula.map(str::to_string),
        force_recalc: false,
        array_ref: array_ref.map(str::to_string),
        cell_metadata_index: cm.then_some(1),
        vm: None,
        phonetic: false,
        date_lexical_value: None,
        cached_value_type: 0,
        cell_formula: None,
        preserve_space_formula: false,
        preserve_space_value: false,
        sst_index: None,
        has_explicit_style: false,
    }
}

pub(super) fn empty_style_cell(
    row: u32,
    col: u32,
    style_idx: u16,
    has_explicit_style: bool,
) -> FullCellData {
    FullCellData {
        row,
        col,
        cell_type: CELL_TYPE_EMPTY,
        style_idx,
        value: None,
        formula: None,
        force_recalc: false,
        array_ref: None,
        cell_metadata_index: None,
        vm: None,
        phonetic: false,
        date_lexical_value: None,
        cached_value_type: 0,
        cell_formula: None,
        preserve_space_formula: false,
        preserve_space_value: false,
        sst_index: None,
        has_explicit_style,
    }
}

pub(super) fn smartart_parts(anchor_index: usize) -> SmartArtPartsOutput {
    SmartArtPartsOutput {
        anchor_index,
        data_xml: None,
        layout_xml: None,
        colors_xml: None,
        style_xml: None,
        drawing_xml: None,
    }
}

pub(super) fn wordart_shape_anchor(from_word_art: bool) -> Anchor {
    let shape = wordart_shape(from_word_art);

    Anchor::OneCell(OneCellAnchor {
        from: ooxml_types::drawings::CellAnchor::default(),
        extent: ooxml_types::drawings::Extent::default(),
        content: DrawingContent::Shape(shape),
        client_data: ooxml_types::drawings::ClientData::default(),
        mc_alternate_content: None,
    })
}

pub(super) fn wordart_shape_content(from_word_art: bool) -> DrawingContent {
    DrawingContent::Shape(wordart_shape(from_word_art))
}

pub(super) fn wordart_shape(from_word_art: bool) -> ooxml_types::drawings::SpreadsheetShape {
    let mut shape = ooxml_types::drawings::SpreadsheetShape::default();
    shape.tx_body = Some(ooxml_types::drawings::TextBody {
        body_props: ooxml_types::drawings::TextBodyProperties {
            from_word_art: Some(from_word_art),
            ..ooxml_types::drawings::TextBodyProperties::default()
        },
        ..ooxml_types::drawings::TextBody::default()
    });
    shape
}

pub(super) fn group_shape_anchor(children: Vec<DrawingContent>) -> Anchor {
    Anchor::OneCell(OneCellAnchor {
        from: ooxml_types::drawings::CellAnchor::default(),
        extent: ooxml_types::drawings::Extent::default(),
        content: DrawingContent::GroupShape(GroupShapeData {
            children,
            ..GroupShapeData::default()
        }),
        client_data: ooxml_types::drawings::ClientData::default(),
        mc_alternate_content: None,
    })
}

pub(super) fn comment_run(text: &str) -> CommentRunOutput {
    CommentRunOutput {
        text: text.to_string(),
        font_name: Some("Tahoma".to_string()),
        font_size: Some(9.0),
        bold: false,
        italic: false,
        underline: false,
        strike: false,
        color: None,
        color_indexed: Some(81),
        color_theme: None,
        color_tint: None,
        font_family: Some(2),
        scheme: None,
        charset: Some(1),
        vert_align: None,
        preserve_space: false,
    }
}

pub(super) fn rich_run(text: &str) -> RichTextRun {
    RichTextRun {
        text: text.to_string(),
        font_name: Some("Tahoma".to_string()),
        font_size: Some(9.0),
        color_indexed: Some(81),
        charset: Some(1),
        family: Some(2),
        ..Default::default()
    }
}

pub(super) fn threaded_comments_xml() -> &'static [u8] {
    br#"<ThreadedComments>
    <threadedComment ref="B2" id="{THREAD-1}" personId="P1" dT="2026-05-20T01:02:03Z" done="1">
        <text>actual threaded root</text>
        <mentions><mention mentionpersonId="P2" startIndex="0" length="4"/></mentions>
        <extLst><ext uri="{x}"/></extLst>
    </threadedComment>
    <threadedComment ref="B2" id="{REPLY-1}" personId="P2" parentId="{THREAD-1}">
        <text>reply text</text>
    </threadedComment>
</ThreadedComments>"#
}

pub(super) fn threading_result(
    sheet: FullParsedSheet,
    raw_persons_xml: Option<Vec<u8>>,
    raw_threaded_comments: Vec<(String, Vec<u8>)>,
) -> FullParseResult {
    FullParseResult {
        sheets: vec![sheet],
        shared_strings: Vec::new(),
        shared_strings_rich_runs: Vec::new(),
        shared_strings_phonetic_xml: Vec::new(),
        shared_strings_declared_count: None,
        shared_strings_declared_unique_count: None,
        shared_strings_ext_lst_xml: None,
        styles: StylesOutput::from(&crate::domain::styles::types::Stylesheet::default()),
        theme: None,
        defined_names: Vec::new(),
        workbook_protection: None,
        errors: Vec::new(),
        stats: ParseStats::default(),
        calc_id: None,
        iterative_calc: false,
        max_iterations: None,
        max_change: None,
        calc_pr_settings: None,
        imported_calc_chain_entry_count: 0,
        pivot_caches: std::collections::HashMap::new(),
        pivot_cache_packages: Vec::new(),
        slicer_caches: Vec::new(),
        timeline_caches: Vec::new(),
        theme_part_path: None,
        theme_relationship_id_hint: None,
        theme_relationship_type: None,
        theme_name: None,
        theme_color_scheme: None,
        theme_font_scheme: None,
        theme_format_scheme: None,
        theme_object_defaults_xml: None,
        theme_extra_clr_scheme_lst_xml: None,
        theme_ext_lst_xml: None,
        theme_cust_clr_lst_xml: None,
        theme_root_sibling_order: None,
        styles_ext_lst_xml: None,
        styles_root_namespace_attrs: Vec::new(),
        parsed_stylesheet: None,
        doc_props_core: None,
        doc_props_app: None,
        doc_props_custom: None,
        raw_doc_props_core_xml: None,
        raw_doc_props_app_xml: None,
        raw_doc_props_custom_xml: None,
        metadata: None,
        rich_data: None,
        content_type_defaults: Vec::new(),
        content_type_overrides: Vec::new(),
        package_inventory: None,
        root_relationships: Vec::new(),
        workbook_relationships: Vec::new(),
        sheet_workbook_r_ids: Vec::new(),
        workbook_sheet_inventory: Vec::new(),
        imported_media_parts: Vec::new(),
        imported_ole_parts: Vec::new(),
        extensions: None,
        raw_metadata_xml: None,
        raw_doc_metadata_label_info: None,
        external_links: Vec::new(),
        connections: Default::default(),
        feature_properties: Default::default(),
        custom_xml_parts: Vec::new(),
        raw_persons_xml,
        raw_threaded_comments,
        workbook_views: Vec::new(),
        custom_workbook_views_xml: None,
        workbook_xml_fidelity: Default::default(),
        workbook_properties: None,
        file_version: None,
        file_sharing: None,
        web_publishing: None,
        workbook_conformance: None,
        unsupported_workbook_elements: Vec::new(),
        unsupported_workbook_mce: Vec::new(),
        volatile_dependency_part: None,
    }
}
