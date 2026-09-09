use super::fixtures::ZipBuilder;
use domain_types::chart::{ChartDataTableData, ChartLineSettingsData, UpDownBarsData};
use domain_types::ChartDefinition;
use xlsx_parser::domain::workbook::read::parse_all_rels;
use xlsx_parser::infra::opc::REL_IMAGE;
use xlsx_parser::infra::package_integrity::validate_archive_package_integrity;
use xlsx_parser::parse_xlsx_to_output;
use xlsx_parser::write::write_xlsx_from_parse_output;
use xlsx_parser::zip::XlsxArchive;

const CHART_IMAGE_PATH: &str = "xl/media/chart-picture.png";
const CHART_IMAGE_REL_ID: &str = "rIdChartImage";
const MATRIX_IMAGE_BYTES: &[u8] = b"\x89PNG\r\n\x1a\nmatrix";

/// Every relationship-backed picture-fill owner covered by the standard-chart
/// reconstruction path. The XML owner names are used in failure messages,
/// relationship IDs prove the fill remains bound to the original package
/// resource, and paths let the package-closure assertion check every payload.
const PICTURE_FILL_OWNERS: &[(&str, &str, &str)] = &[
    (
        "plot-area data table",
        "rIdDataTablePicture",
        "xl/media/data-table-picture.png",
    ),
    (
        "category-axis major gridlines",
        "rIdCategoryMajorGridlinesPicture",
        "xl/media/category-major-gridlines-picture.png",
    ),
    (
        "category-axis minor gridlines",
        "rIdCategoryMinorGridlinesPicture",
        "xl/media/category-minor-gridlines-picture.png",
    ),
    (
        "category-axis title",
        "rIdCategoryAxisTitlePicture",
        "xl/media/category-axis-title-picture.png",
    ),
    (
        "value-axis display-unit label",
        "rIdDisplayUnitLabelPicture",
        "xl/media/display-unit-label-picture.png",
    ),
    (
        "line-chart drop lines",
        "rIdDropLinesPicture",
        "xl/media/drop-lines-picture.png",
    ),
    (
        "line-chart high-low lines",
        "rIdHighLowLinesPicture",
        "xl/media/high-low-lines-picture.png",
    ),
    (
        "line-chart up bars",
        "rIdUpBarsPicture",
        "xl/media/up-bars-picture.png",
    ),
    (
        "line-chart down bars",
        "rIdDownBarsPicture",
        "xl/media/down-bars-picture.png",
    ),
    (
        "series trendline",
        "rIdTrendlinePicture",
        "xl/media/trendline-picture.png",
    ),
    (
        "series error bars",
        "rIdErrorBarsPicture",
        "xl/media/error-bars-picture.png",
    ),
    (
        "trendline label",
        "rIdTrendlineLabelPicture",
        "xl/media/trendline-label-picture.png",
    ),
];

/// A chart picture fill is not represented by the public chart-format fields.
/// Keep it in the imported ChartSpace, then exercise the reconstruction path by
/// editing the title before export. This catches the import-side Blip -> NoFill
/// lowering that a ChartSpec-only export test cannot see.
#[test]
fn imported_chart_picture_fill_survives_unrelated_edit_and_reparse() {
    let imported = chart_picture_fill_fixture();
    let (mut parsed, _diagnostics) =
        parse_xlsx_to_output(&imported).expect("synthetic chart fixture should parse");
    let chart = parsed.sheets[0]
        .charts
        .first()
        .expect("synthetic fixture should contain one chart");

    let definition = chart
        .definition
        .as_ref()
        .and_then(|definition| match definition {
            ChartDefinition::Chart(chart_space) => Some(chart_space),
            ChartDefinition::ChartEx(_) => None,
        })
        .expect("standard chart should retain its imported ChartSpace");
    let fill = definition
        .chart
        .plot_area
        .sp_pr
        .as_ref()
        .and_then(|shape_properties| shape_properties.fill.as_ref())
        .expect("imported plot-area picture fill should remain typed");
    let ooxml_types::drawings::DrawingFill::Blip(blip) = fill else {
        panic!("expected imported plot-area picture fill, got {fill:?}");
    };
    assert_eq!(blip.embed_id.as_deref(), Some(CHART_IMAGE_REL_ID));
    assert!(chart.chart_relationships.iter().any(|relationship| {
        relationship.r_id == CHART_IMAGE_REL_ID
            && relationship.target.as_deref() == Some("../media/chart-picture.png")
    }));
    assert!(chart
        .chart_auxiliary_files
        .iter()
        .any(|(path, bytes)| path == CHART_IMAGE_PATH && bytes == b"\x89PNG\r\n\x1a\nsynthetic"));

    // Changing the title invalidates the imported standard-chart authority and
    // requires ChartSpace reconstruction. The picture must therefore survive
    // through owner-aware shape-property merging, rather than replay masking a
    // reconstruction loss.
    parsed.sheets[0].charts[0].title = Some("Edited chart title".to_string());
    assert!(parsed.sheets[0].charts[0]
        .standard_chart_export_authority
        .as_ref()
        .is_some_and(|authority| {
            matches!(
                &authority.validity,
                domain_types::StandardChartAuthorityValidity::Current
            )
        }));

    let exported = write_xlsx_from_parse_output(&parsed).expect("edited chart should export");
    let archive = XlsxArchive::new(&exported).expect("edited chart should be a readable ZIP");
    let chart_xml = String::from_utf8(
        archive
            .read_file("xl/charts/chart1.xml")
            .expect("export should contain chart1.xml"),
    )
    .expect("chart XML should be UTF-8");
    assert!(
        chart_xml.contains("a:blip") && chart_xml.contains("r:embed=\"rIdChartImage\""),
        "reconstructed chart should retain plot-area picture fill: {chart_xml}"
    );
    assert!(
        chart_xml.contains("Edited chart title"),
        "the title edit should force ChartSpace reconstruction: {chart_xml}"
    );
    assert_eq!(
        archive
            .read_file(CHART_IMAGE_PATH)
            .expect("reconstructed chart should retain image bytes"),
        b"\x89PNG\r\n\x1a\nsynthetic"
    );
    validate_archive_package_integrity(&archive).expect("edited chart package should be valid");

    let (reparsed, _diagnostics) =
        parse_xlsx_to_output(&exported).expect("edited chart should parse after export");
    let reparsed_chart = reparsed.sheets[0]
        .charts
        .first()
        .expect("reparsed workbook should contain the chart");
    let reparsed_definition = reparsed_chart
        .definition
        .as_ref()
        .and_then(|definition| match definition {
            ChartDefinition::Chart(chart_space) => Some(chart_space),
            ChartDefinition::ChartEx(_) => None,
        })
        .expect("reparsed chart should retain its standard ChartSpace");
    let reparsed_fill = reparsed_definition
        .chart
        .plot_area
        .sp_pr
        .as_ref()
        .and_then(|shape_properties| shape_properties.fill.as_ref())
        .expect("reparsed chart should retain plot-area picture fill");
    let ooxml_types::drawings::DrawingFill::Blip(blip) = reparsed_fill else {
        panic!("expected reparsed plot-area picture fill, got {reparsed_fill:?}");
    };
    assert_eq!(blip.embed_id.as_deref(), Some(CHART_IMAGE_REL_ID));
}

/// Exercise every picture-fill owner that is projected into the public chart
/// model. The title edit makes the imported ChartSpace non-authoritative, so
/// this is a real parse -> model edit -> reconstruction -> parse path rather
/// than a ChartSpec-only writer test.
#[test]
fn imported_chart_picture_fill_owner_matrix_survives_unrelated_edit_and_reparse() {
    let imported = chart_picture_fill_owner_matrix_fixture();
    let (mut parsed, _diagnostics) =
        parse_xlsx_to_output(&imported).expect("picture-fill owner fixture should parse");
    {
        let chart = parsed.sheets[0]
            .charts
            .first()
            .expect("picture-fill owner fixture should contain one chart");
        assert_picture_fill_owner_matrix_imported(chart);
        for (_, relationship_id, media_path) in PICTURE_FILL_OWNERS {
            let media_name = media_path
                .strip_prefix("xl/media/")
                .expect("matrix media path should be under xl/media");
            let expected_target = format!("../media/{media_name}");
            assert!(
                chart.chart_relationships.iter().any(|relationship| {
                    relationship.r_id == *relationship_id
                        && relationship.target.as_deref() == Some(expected_target.as_str())
                }),
                "imported chart should retain relationship for {relationship_id}"
            );
            assert!(
                chart
                    .chart_auxiliary_files
                    .iter()
                    .any(|(path, bytes)| path == media_path && bytes == MATRIX_IMAGE_BYTES),
                "imported chart should retain media payload for {media_path}"
            );
        }
    }

    parsed.sheets[0].charts[0].title = Some("Edited matrix chart title".to_string());
    let exported =
        write_xlsx_from_parse_output(&parsed).expect("edited owner-matrix chart should export");
    let archive = XlsxArchive::new(&exported).expect("owner-matrix export should be readable");
    let chart_xml = String::from_utf8(
        archive
            .read_file("xl/charts/chart1.xml")
            .expect("owner-matrix export should contain chart1.xml"),
    )
    .expect("owner-matrix chart XML should be UTF-8");

    assert!(chart_xml.contains("Edited matrix chart title"));
    let chart_relationships = parse_all_rels(
        &archive
            .read_file("xl/charts/_rels/chart1.xml.rels")
            .expect("owner-matrix export should contain chart relationships"),
    );
    for (owner, relationship_id, media_path) in PICTURE_FILL_OWNERS {
        let media_name = media_path
            .strip_prefix("xl/media/")
            .expect("matrix media path should be under xl/media");
        let relationship = chart_relationships
            .iter()
            .find(|relationship| relationship.id == *relationship_id)
            .unwrap_or_else(|| panic!("reconstructed chart should retain {owner} relationship"));
        assert_eq!(relationship.rel_type, REL_IMAGE);
        assert_eq!(relationship.target, format!("../media/{media_name}"));
        assert!(
            chart_xml.contains(&format!("r:embed=\"{relationship_id}\"")),
            "reconstructed chart should retain {owner} picture fill: {chart_xml}"
        );
        assert_eq!(
            archive
                .read_file(media_path)
                .unwrap_or_else(|_| panic!("reconstructed chart should retain {media_path}")),
            MATRIX_IMAGE_BYTES,
            "reconstructed chart should retain {owner} media bytes"
        );
    }
    validate_archive_package_integrity(&archive)
        .expect("owner-matrix reconstructed package should be valid");

    let (reparsed, _diagnostics) =
        parse_xlsx_to_output(&exported).expect("owner-matrix export should parse again");
    let reparsed_chart = reparsed.sheets[0]
        .charts
        .first()
        .expect("reparsed owner-matrix workbook should contain one chart");
    assert_picture_fill_owner_matrix_imported(reparsed_chart);
}

/// Explicit owner edits must control the emitted chart. In particular, a
/// `Some(false)`/empty owner is an authored removal and cannot fall back to
/// the imported relationship-backed shape properties.
#[test]
fn explicit_chart_picture_owner_edits_do_not_replay_stale_fills() {
    let imported = chart_picture_fill_owner_matrix_fixture();
    let (mut parsed, _diagnostics) =
        parse_xlsx_to_output(&imported).expect("picture-fill owner fixture should parse");
    let chart = parsed.sheets[0]
        .charts
        .first_mut()
        .expect("picture-fill owner fixture should contain one chart");

    chart.title = Some("Edited after removing picture fills".to_string());
    chart.data_table = Some(ChartDataTableData {
        show_horz_border: Some(false),
        show_vert_border: Some(false),
        show_outline: Some(false),
        show_keys: Some(false),
        format: None,
        show_legend_key: Some(false),
        visible: Some(false),
    });
    let axes = chart
        .axes
        .as_mut()
        .expect("owner-matrix axes should be modeled");
    let category_axis = axes
        .category_axis
        .as_mut()
        .expect("owner-matrix category axis should be modeled");
    category_axis.title = None;
    category_axis.grid_lines = Some(false);
    category_axis.minor_grid_lines = Some(false);
    let value_axis = axes
        .value_axis
        .as_mut()
        .expect("owner-matrix value axis should be modeled");
    value_axis.display_unit = None;
    value_axis.custom_display_unit = None;
    value_axis.display_unit_label = None;
    value_axis.display_unit_label_layout = None;
    value_axis.display_unit_label_format = None;

    chart.drop_lines = Some(ChartLineSettingsData {
        visible: Some(false),
        format: None,
    });
    chart.high_low_lines = Some(ChartLineSettingsData {
        visible: Some(false),
        format: None,
    });
    chart.up_down_bars = Some(UpDownBarsData::default());
    let series = chart
        .series
        .first_mut()
        .expect("owner-matrix series should be modeled");
    series.trendlines = Some(Vec::new());
    series.error_bars = None;
    series.x_error_bars = None;
    series.y_error_bars = None;

    let exported =
        write_xlsx_from_parse_output(&parsed).expect("owner-removal chart should export");
    let archive = XlsxArchive::new(&exported).expect("owner-removal export should be readable");
    let chart_xml = String::from_utf8(
        archive
            .read_file("xl/charts/chart1.xml")
            .expect("owner-removal export should contain chart1.xml"),
    )
    .expect("owner-removal chart XML should be UTF-8");
    assert!(chart_xml.contains("Edited after removing picture fills"));
    for (owner, relationship_id, _) in PICTURE_FILL_OWNERS {
        assert!(
            !chart_xml.contains(&format!("r:embed=\"{relationship_id}\"")),
            "explicit owner edit must remove stale {owner} picture fill: {chart_xml}"
        );
    }
    validate_archive_package_integrity(&archive)
        .expect("owner-removal reconstructed package should be valid");
}

fn assert_picture_fill_owner_matrix_imported(chart: &domain_types::ChartSpec) {
    let definition = chart
        .definition
        .as_ref()
        .and_then(|definition| match definition {
            ChartDefinition::Chart(chart_space) => Some(chart_space),
            ChartDefinition::ChartEx(_) => None,
        })
        .expect("owner-matrix chart should retain standard ChartSpace");
    let plot_area = &definition.chart.plot_area;

    assert_picture_fill(
        plot_area
            .d_table
            .as_ref()
            .and_then(|data_table| data_table.sp_pr.as_ref()),
        "plot-area data table",
        "rIdDataTablePicture",
    );

    let category_axis = plot_area
        .axes
        .iter()
        .find(|axis| axis.ax_id == 1)
        .expect("owner-matrix category axis");
    assert_picture_fill(
        category_axis
            .major_gridlines
            .as_ref()
            .and_then(|lines| lines.sp_pr.as_ref()),
        "category-axis major gridlines",
        "rIdCategoryMajorGridlinesPicture",
    );
    assert_picture_fill(
        category_axis
            .minor_gridlines
            .as_ref()
            .and_then(|lines| lines.sp_pr.as_ref()),
        "category-axis minor gridlines",
        "rIdCategoryMinorGridlinesPicture",
    );
    assert_picture_fill(
        category_axis
            .title
            .as_ref()
            .and_then(|title| title.sp_pr.as_ref()),
        "category-axis title",
        "rIdCategoryAxisTitlePicture",
    );

    let value_axis = plot_area
        .axes
        .iter()
        .find(|axis| axis.ax_id == 2)
        .expect("owner-matrix value axis");
    assert_picture_fill(
        value_axis
            .disp_units
            .as_ref()
            .and_then(|units| units.disp_units_lbl.as_ref())
            .and_then(|label| label.sp_pr.as_ref()),
        "value-axis display-unit label",
        "rIdDisplayUnitLabelPicture",
    );

    let group = plot_area
        .chart_groups
        .first()
        .expect("owner-matrix line chart group");
    let ooxml_types::charts::ChartTypeConfig::Line(config) = &group.config else {
        panic!("owner-matrix chart should parse as a line chart");
    };
    assert_picture_fill(
        config
            .drop_lines
            .as_ref()
            .and_then(|lines| lines.sp_pr.as_ref()),
        "line-chart drop lines",
        "rIdDropLinesPicture",
    );
    assert_picture_fill(
        config
            .hi_low_lines
            .as_ref()
            .and_then(|lines| lines.sp_pr.as_ref()),
        "line-chart high-low lines",
        "rIdHighLowLinesPicture",
    );
    let up_down_bars = config
        .up_down_bars
        .as_ref()
        .expect("owner-matrix up/down bars");
    assert_picture_fill(
        up_down_bars.up_bars.as_ref(),
        "line-chart up bars",
        "rIdUpBarsPicture",
    );
    assert_picture_fill(
        up_down_bars.down_bars.as_ref(),
        "line-chart down bars",
        "rIdDownBarsPicture",
    );

    let series = group.series.first().expect("owner-matrix chart series");
    let trendline = series.trendline.first().expect("owner-matrix trendline");
    assert_picture_fill(
        trendline.sp_pr.as_ref(),
        "series trendline",
        "rIdTrendlinePicture",
    );
    assert_picture_fill(
        series
            .err_bars
            .first()
            .and_then(|error_bars| error_bars.sp_pr.as_ref()),
        "series error bars",
        "rIdErrorBarsPicture",
    );
    assert_picture_fill(
        trendline
            .trendline_lbl
            .as_ref()
            .and_then(|label| label.sp_pr.as_ref()),
        "trendline label",
        "rIdTrendlineLabelPicture",
    );
}

fn assert_picture_fill(
    shape_properties: Option<&ooxml_types::drawings::ShapeProperties>,
    owner: &str,
    relationship_id: &str,
) {
    let shape_properties =
        shape_properties.unwrap_or_else(|| panic!("imported {owner} should have shape properties"));
    let fill = shape_properties
        .fill
        .as_ref()
        .unwrap_or_else(|| panic!("imported {owner} should have a fill"));
    let ooxml_types::drawings::DrawingFill::Blip(blip) = fill else {
        panic!("imported {owner} should retain a picture fill, got {fill:?}");
    };
    assert_eq!(
        blip.embed_id.as_deref(),
        Some(relationship_id),
        "imported {owner} should retain its relationship ID"
    );
}

fn chart_picture_fill_fixture() -> Vec<u8> {
    let mut builder = ZipBuilder::new();
    builder
        .add_deflate("[Content_Types].xml", content_types_xml().as_bytes())
        .add_deflate("_rels/.rels", root_rels_xml().as_bytes())
        .add_deflate("xl/_rels/workbook.xml.rels", workbook_rels_xml().as_bytes())
        .add_deflate("xl/workbook.xml", workbook_xml().as_bytes())
        .add_deflate("xl/worksheets/sheet1.xml", worksheet_xml().as_bytes())
        .add_deflate(
            "xl/worksheets/_rels/sheet1.xml.rels",
            worksheet_rels_xml().as_bytes(),
        )
        .add_deflate("xl/drawings/drawing1.xml", drawing_xml().as_bytes())
        .add_deflate(
            "xl/drawings/_rels/drawing1.xml.rels",
            drawing_rels_xml().as_bytes(),
        )
        .add_deflate("xl/charts/chart1.xml", chart_xml().as_bytes())
        .add_deflate(
            "xl/charts/_rels/chart1.xml.rels",
            chart_rels_xml().as_bytes(),
        )
        .add_deflate(CHART_IMAGE_PATH, b"\x89PNG\r\n\x1a\nsynthetic");
    builder.build()
}

fn chart_picture_fill_owner_matrix_fixture() -> Vec<u8> {
    let mut builder = ZipBuilder::new();
    builder
        .add_deflate("[Content_Types].xml", content_types_xml().as_bytes())
        .add_deflate("_rels/.rels", root_rels_xml().as_bytes())
        .add_deflate("xl/_rels/workbook.xml.rels", workbook_rels_xml().as_bytes())
        .add_deflate("xl/workbook.xml", workbook_xml().as_bytes())
        .add_deflate("xl/worksheets/sheet1.xml", worksheet_xml().as_bytes())
        .add_deflate(
            "xl/worksheets/_rels/sheet1.xml.rels",
            worksheet_rels_xml().as_bytes(),
        )
        .add_deflate("xl/drawings/drawing1.xml", drawing_xml().as_bytes())
        .add_deflate(
            "xl/drawings/_rels/drawing1.xml.rels",
            drawing_rels_xml().as_bytes(),
        )
        .add_deflate(
            "xl/charts/chart1.xml",
            chart_picture_fill_owner_matrix_xml().as_bytes(),
        )
        .add_deflate(
            "xl/charts/_rels/chart1.xml.rels",
            chart_picture_fill_owner_matrix_rels_xml().as_bytes(),
        );

    for (_, _, media_path) in PICTURE_FILL_OWNERS {
        builder.add_deflate(media_path, MATRIX_IMAGE_BYTES);
    }
    builder.build()
}

fn picture_fill(rel_id: &str) -> String {
    format!(
        r#"<c:spPr><a:blipFill><a:blip r:embed="{rel_id}"/><a:stretch><a:fillRect/></a:stretch></a:blipFill></c:spPr>"#
    )
}

fn chart_picture_fill_owner_matrix_xml() -> String {
    let data_table = picture_fill("rIdDataTablePicture");
    let category_major_gridlines = picture_fill("rIdCategoryMajorGridlinesPicture");
    let category_minor_gridlines = picture_fill("rIdCategoryMinorGridlinesPicture");
    let category_axis_title = picture_fill("rIdCategoryAxisTitlePicture");
    let display_unit_label = picture_fill("rIdDisplayUnitLabelPicture");
    let drop_lines = picture_fill("rIdDropLinesPicture");
    let high_low_lines = picture_fill("rIdHighLowLinesPicture");
    let up_bars = picture_fill("rIdUpBarsPicture");
    let down_bars = picture_fill("rIdDownBarsPicture");
    let trendline = picture_fill("rIdTrendlinePicture");
    let error_bars = picture_fill("rIdErrorBarsPicture");
    let trendline_label = picture_fill("rIdTrendlineLabelPicture");

    format!(
        r##"<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<c:chartSpace xmlns:c="http://schemas.openxmlformats.org/drawingml/2006/chart" xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">
  <c:chart>
    <c:plotArea>
      <c:lineChart>
        <c:grouping val="standard"/>
        <c:ser>
          <c:idx val="0"/>
          <c:order val="0"/>
          <c:trendline>
            {trendline}
            <c:trendlineType val="linear"/>
            <c:trendlineLbl>
              <c:tx><c:rich><a:bodyPr/><a:lstStyle/><a:p><a:r><a:t>Trendline Label</a:t></a:r></a:p></c:rich></c:tx>
              {trendline_label}
            </c:trendlineLbl>
          </c:trendline>
          <c:errBars>
            <c:errDir val="y"/>
            <c:errBarType val="both"/>
            <c:errValType val="fixedVal"/>
            <c:val val="1"/>
            {error_bars}
          </c:errBars>
          <c:cat><c:numRef><c:f>Sheet1!$A$2:$A$3</c:f></c:numRef></c:cat>
          <c:val><c:numRef><c:f>Sheet1!$B$2:$B$3</c:f></c:numRef></c:val>
        </c:ser>
        <c:dropLines>{drop_lines}</c:dropLines>
        <c:hiLowLines>{high_low_lines}</c:hiLowLines>
        <c:upDownBars>
          <c:gapWidth val="150"/>
          <c:upBars>{up_bars}</c:upBars>
          <c:downBars>{down_bars}</c:downBars>
        </c:upDownBars>
        <c:axId val="1"/>
        <c:axId val="2"/>
      </c:lineChart>
      <c:catAx>
        <c:axId val="1"/>
        <c:scaling><c:orientation val="minMax"/></c:scaling>
        <c:delete val="0"/>
        <c:axPos val="b"/>
        <c:majorGridlines>{category_major_gridlines}</c:majorGridlines>
        <c:minorGridlines>{category_minor_gridlines}</c:minorGridlines>
        <c:title>
          <c:tx><c:rich><a:bodyPr/><a:lstStyle/><a:p><a:r><a:t>Category Axis</a:t></a:r></a:p></c:rich></c:tx>
          {category_axis_title}
        </c:title>
        <c:crossAx val="2"/>
        <c:crosses val="autoZero"/>
        <c:auto val="1"/>
        <c:lblPos val="nextTo"/>
      </c:catAx>
      <c:valAx>
        <c:axId val="2"/>
        <c:scaling><c:orientation val="minMax"/></c:scaling>
        <c:delete val="0"/>
        <c:axPos val="l"/>
        <c:crossAx val="1"/>
        <c:crosses val="autoZero"/>
        <c:crossBetween val="midCat"/>
        <c:dispUnits>
          <c:builtInUnit val="thousands"/>
          <c:dispUnitsLbl>
            <c:tx><c:rich><a:bodyPr/><a:lstStyle/><a:p><a:r><a:t>Display Units</a:t></a:r></a:p></c:rich></c:tx>
            {display_unit_label}
          </c:dispUnitsLbl>
        </c:dispUnits>
      </c:valAx>
      <c:dTable>
        <c:showHorzBorder val="1"/>
        <c:showVertBorder val="1"/>
        <c:showOutline val="1"/>
        <c:showKeys val="1"/>
        {data_table}
      </c:dTable>
    </c:plotArea>
    <c:plotVisOnly val="1"/>
  </c:chart>
</c:chartSpace>"##,
    )
}

fn chart_picture_fill_owner_matrix_rels_xml() -> String {
    let mut xml = String::from(
        r#"<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">"#,
    );
    for (_, relationship_id, media_path) in PICTURE_FILL_OWNERS {
        let media_name = media_path
            .strip_prefix("xl/media/")
            .expect("matrix media path should be under xl/media");
        xml.push_str(&format!(
            r#"
  <Relationship Id="{relationship_id}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/image" Target="../media/{media_name}"/>"#
        ));
    }
    xml.push_str("\n</Relationships>");
    xml
}

fn content_types_xml() -> String {
    r#"<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
  <Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
  <Default Extension="xml" ContentType="application/xml"/>
  <Default Extension="png" ContentType="image/png"/>
  <Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>
  <Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>
  <Override PartName="/xl/drawings/drawing1.xml" ContentType="application/vnd.openxmlformats-officedocument.drawing+xml"/>
  <Override PartName="/xl/charts/chart1.xml" ContentType="application/vnd.openxmlformats-officedocument.drawingml.chart+xml"/>
</Types>"#
        .to_string()
}

fn root_rels_xml() -> String {
    r#"<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rIdWorkbook" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/>
</Relationships>"#
        .to_string()
}

fn workbook_rels_xml() -> String {
    r#"<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rIdSheet1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/>
</Relationships>"#
        .to_string()
}

fn workbook_xml() -> String {
    r#"<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">
  <sheets>
    <sheet name="Sheet1" sheetId="1" r:id="rIdSheet1"/>
  </sheets>
</workbook>"#
        .to_string()
}

fn worksheet_xml() -> String {
    r#"<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">
  <sheetData/>
  <drawing r:id="rIdDrawing1"/>
</worksheet>"#
        .to_string()
}

fn worksheet_rels_xml() -> String {
    r#"<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rIdDrawing1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/drawing" Target="../drawings/drawing1.xml"/>
</Relationships>"#
        .to_string()
}

fn drawing_xml() -> String {
    r#"<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<xdr:wsDr xmlns:xdr="http://schemas.openxmlformats.org/drawingml/2006/spreadsheetDrawing" xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:c="http://schemas.openxmlformats.org/drawingml/2006/chart" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">
  <xdr:twoCellAnchor>
    <xdr:from><xdr:col>0</xdr:col><xdr:colOff>0</xdr:colOff><xdr:row>0</xdr:row><xdr:rowOff>0</xdr:rowOff></xdr:from>
    <xdr:to><xdr:col>8</xdr:col><xdr:colOff>0</xdr:colOff><xdr:row>15</xdr:row><xdr:rowOff>0</xdr:rowOff></xdr:to>
    <xdr:graphicFrame>
      <xdr:nvGraphicFramePr><xdr:cNvPr id="2" name="Chart 1"/><xdr:cNvGraphicFramePr/></xdr:nvGraphicFramePr>
      <xdr:xfrm><a:off x="0" y="0"/><a:ext cx="6096000" cy="4572000"/></xdr:xfrm>
      <a:graphic><a:graphicData uri="http://schemas.openxmlformats.org/drawingml/2006/chart"><c:chart r:id="rIdChart"/></a:graphicData></a:graphic>
    </xdr:graphicFrame>
    <xdr:clientData/>
  </xdr:twoCellAnchor>
</xdr:wsDr>"#
        .to_string()
}

fn drawing_rels_xml() -> String {
    r#"<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rIdChart" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/chart" Target="../charts/chart1.xml"/>
</Relationships>"#
        .to_string()
}

fn chart_xml() -> String {
    r#"<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<c:chartSpace xmlns:c="http://schemas.openxmlformats.org/drawingml/2006/chart" xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">
  <c:chart>
    <c:plotArea>
      <c:barChart>
        <c:barDir val="col"/>
        <c:grouping val="clustered"/>
        <c:varyColors val="0"/>
        <c:axId val="1"/>
        <c:axId val="2"/>
      </c:barChart>
      <c:catAx>
        <c:axId val="1"/>
        <c:scaling><c:orientation val="minMax"/></c:scaling>
        <c:delete val="0"/>
        <c:axPos val="b"/>
        <c:crossAx val="2"/>
        <c:crosses val="autoZero"/>
        <c:auto val="1"/>
        <c:lblPos val="nextTo"/>
      </c:catAx>
      <c:valAx>
        <c:axId val="2"/>
        <c:scaling><c:orientation val="minMax"/></c:scaling>
        <c:delete val="0"/>
        <c:axPos val="l"/>
        <c:crossAx val="1"/>
        <c:crosses val="autoZero"/>
        <c:crossBetween val="midCat"/>
      </c:valAx>
      <c:spPr>
        <a:blipFill>
          <a:blip r:embed="rIdChartImage"/>
          <a:stretch><a:fillRect/></a:stretch>
        </a:blipFill>
      </c:spPr>
    </c:plotArea>
    <c:plotVisOnly val="1"/>
  </c:chart>
</c:chartSpace>"#
        .to_string()
}

fn chart_rels_xml() -> String {
    r#"<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rIdChartImage" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/image" Target="../media/chart-picture.png"/>
</Relationships>"#
        .to_string()
}
