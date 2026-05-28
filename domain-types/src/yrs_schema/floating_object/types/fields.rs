const COMMON_KEYS: &[&str] = &[
    "id",
    "sheetId",
    "type",
    "anchorRow",
    "anchorCol",
    "anchorRowOffsetEmu",
    "anchorColOffsetEmu",
    "anchorMode",
    "width",
    "height",
    "zIndex",
    "rotation",
    "flipH",
    "flipV",
    "locked",
    "visible",
    "printable",
    "opacity",
    "name",
    "createdAt",
    "updatedAt",
    "endRow",
    "endCol",
    "endRowOffsetEmu",
    "endColOffsetEmu",
    "extentCxEmu",
    "extentCyEmu",
    "absoluteXEmu",
    "absoluteYEmu",
    "groupId",
    "anchorCellId",
    "toAnchorCellId",
    "lockAspectRatio",
    "altTextTitle",
    "displayName",
];

pub fn known_fields(object_type: &str) -> (Vec<&'static str>, Vec<&'static str>) {
    let mut primitives: Vec<&str> = COMMON_KEYS.to_vec();
    let mut sub_objects: Vec<&str> = vec!["importStatus"];

    match object_type {
        "shape" => {
            primitives.push("shapeType");
            sub_objects.extend_from_slice(&[
                "fill",
                "outline",
                "text",
                "shadow",
                "adjustments",
                "scene3d",
                "sp3d",
                "ooxml",
            ]);
        }
        "connector" => {
            primitives.push("shapeType");
            sub_objects.extend_from_slice(&[
                "fill",
                "outline",
                "startConnection",
                "endConnection",
                "adjustments",
                "ooxml",
            ]);
        }
        "picture" => {
            primitives.extend_from_slice(&["src", "originalWidth", "originalHeight"]);
            sub_objects.extend_from_slice(&["crop", "adjustments", "border", "colorType", "ooxml"]);
        }
        "textbox" => {
            primitives.extend_from_slice(&["content", "verticalAlign"]);
            sub_objects.extend_from_slice(&[
                "defaultFormat",
                "fill",
                "border",
                "margins",
                "textEffects",
                "ooxml",
            ]);
        }
        "chart" => {
            primitives.extend_from_slice(&[
                "chartType",
                "subType",
                "seriesOrientation",
                "dataRange",
                "seriesRange",
                "categoryRange",
                "title",
                "subtitle",
                "sourceTableId",
                "tableCategoryColumn",
                "useTableColumnNamesAsLabels",
                "widthCells",
                "heightCells",
                "showLines",
                "smoothLines",
                "radarFilled",
                "radarMarkers",
                "displayBlanksAs",
                "plotVisibleOnly",
                "gapWidth",
                "overlap",
                "doughnutHoleSize",
                "firstSliceAngle",
                "bubbleScale",
                "splitType",
                "splitValue",
                "bubble3dEffect",
                "wireframe",
                "surfaceTopView",
                "colorScheme",
                "heightPt",
                "widthPt",
                "leftPt",
                "topPt",
                "style",
                "roundedCorners",
                "autoTitleDeleted",
                "showDataLabelsOverMax",
                "barShape",
                "titleFormula",
                "categoryLabelLevel",
                "seriesNameLevel",
                "showAllFieldButtons",
                "secondPlotSize",
                "varyByCategories",
                "titleHAlign",
                "titleVAlign",
                "titleShowShadow",
            ]);
            sub_objects.extend_from_slice(&[
                "dataRangeIdentity",
                "seriesRangeIdentity",
                "categoryRangeIdentity",
                "legend",
                "axis",
                "colors",
                "series",
                "dataLabels",
                "pieSlice",
                "trendline",
                "waterfall",
                "tableDataColumns",
                "tableColumnNames",
                "chartFormat",
                "plotFormat",
                "titleFormat",
                "dataTable",
                "view3d",
                "floorFormat",
                "sideWallFormat",
                "backWallFormat",
                "rt",
                "definition",
                "ooxml",
                "pivotOptions",
                "titleRichText",
            ]);
        }
        "camera" => {
            primitives.extend_from_slice(&["sourceRef", "error"]);
        }
        "equation" => {
            primitives.push("equation");
        }
        "diagram" => {
            primitives.push("category");
            sub_objects.push("definition");
        }
        "drawing" => {
            primitives.push("backgroundColor");
            sub_objects.extend_from_slice(&["toolState", "recognitions", "data"]);
        }
        "oleObject" => {
            primitives.extend_from_slice(&[
                "progId",
                "dvAspect",
                "isLinked",
                "isEmbedded",
                "previewImageSrc",
                "altText",
            ]);
            sub_objects.push("ooxml");
        }
        "formControl" => {
            primitives.extend_from_slice(&["controlType", "cellLink", "inputRange"]);
            sub_objects.push("ooxml");
        }
        "slicer" => {}
        _ => {}
    }

    (primitives, sub_objects)
}
