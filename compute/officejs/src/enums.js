// Generated file. Do not edit by hand.
// Source: @types/office-js@1.0.608 (MIT)
// Declaration SHA-256: fbdaf0ccec04ee8e310f9ba17599c18d70da538a27dc11be1e70c58a13be1095
// npm integrity: sha512-ik/H3UiuLCtLOm2NTQyN0kGmDPFO/VkXnqDvJ5JK3yTlxdZKLJy06G6h4GcgjWoy0190MuMiNDO501Ve20yIfw==
// Enum names and values are copied from the pinned OfficeJS declarations.
(function (global) {
  "use strict";

  function install(namespace, name, values) {
    var current = namespace[name];
    if (current === undefined || current === null) {
      current = {};
      namespace[name] = current;
    }
    // A runtime class may already use this name. Preserve its identity and
    // add enum members only when doing so is safe and non-destructive.
    if (typeof current !== "object" && typeof current !== "function") return;
    for (var member in values) {
      if (Object.prototype.hasOwnProperty.call(values, member) && !Object.prototype.hasOwnProperty.call(current, member)) {
        current[member] = values[member];
      }
    }
  }

  var Excel = global.Excel || (global.Excel = {});
  var OfficeExtension = global.OfficeExtension || (global.OfficeExtension = {});

  install(Excel, "AggregationFunction", {
    "unknown": "Unknown",
    "automatic": "Automatic",
    "sum": "Sum",
    "count": "Count",
    "average": "Average",
    "max": "Max",
    "min": "Min",
    "product": "Product",
    "countNumbers": "CountNumbers",
    "standardDeviation": "StandardDeviation",
    "standardDeviationP": "StandardDeviationP",
    "variance": "Variance",
    "varianceP": "VarianceP",
  });

  install(Excel, "ArrowheadLength", {
    "short": "Short",
    "medium": "Medium",
    "long": "Long",
  });

  install(Excel, "ArrowheadStyle", {
    "none": "None",
    "triangle": "Triangle",
    "stealth": "Stealth",
    "diamond": "Diamond",
    "oval": "Oval",
    "open": "Open",
  });

  install(Excel, "ArrowheadWidth", {
    "narrow": "Narrow",
    "medium": "Medium",
    "wide": "Wide",
  });

  install(Excel, "AutoFillType", {
    "fillDefault": "FillDefault",
    "fillCopy": "FillCopy",
    "fillSeries": "FillSeries",
    "fillFormats": "FillFormats",
    "fillValues": "FillValues",
    "fillDays": "FillDays",
    "fillWeekdays": "FillWeekdays",
    "fillMonths": "FillMonths",
    "fillYears": "FillYears",
    "linearTrend": "LinearTrend",
    "growthTrend": "GrowthTrend",
    "flashFill": "FlashFill",
  });

  install(Excel, "BindingType", {
    "range": "Range",
    "table": "Table",
    "text": "Text",
  });

  install(Excel, "BlockedErrorCellValueSubType", {
    "unknown": "Unknown",
    "dataTypeRestrictedDomain": "DataTypeRestrictedDomain",
    "dataTypePrivacySetting": "DataTypePrivacySetting",
    "dataTypeUnsupportedApp": "DataTypeUnsupportedApp",
    "externalLinksGeneric": "ExternalLinksGeneric",
    "richDataLinkDisabled": "RichDataLinkDisabled",
    "signInError": "SignInError",
    "noLicense": "NoLicense",
  });

  install(Excel, "BorderIndex", {
    "edgeTop": "EdgeTop",
    "edgeBottom": "EdgeBottom",
    "edgeLeft": "EdgeLeft",
    "edgeRight": "EdgeRight",
    "insideVertical": "InsideVertical",
    "insideHorizontal": "InsideHorizontal",
    "diagonalDown": "DiagonalDown",
    "diagonalUp": "DiagonalUp",
  });

  install(Excel, "BorderLineStyle", {
    "none": "None",
    "continuous": "Continuous",
    "dash": "Dash",
    "dashDot": "DashDot",
    "dashDotDot": "DashDotDot",
    "dot": "Dot",
    "double": "Double",
    "slantDashDot": "SlantDashDot",
  });

  install(Excel, "BorderWeight", {
    "hairline": "Hairline",
    "thin": "Thin",
    "medium": "Medium",
    "thick": "Thick",
  });

  install(Excel, "BuiltInStyle", {
    "normal": "Normal",
    "comma": "Comma",
    "currency": "Currency",
    "percent": "Percent",
    "wholeComma": "WholeComma",
    "wholeDollar": "WholeDollar",
    "hlink": "Hlink",
    "hlinkTrav": "HlinkTrav",
    "note": "Note",
    "warningText": "WarningText",
    "emphasis1": "Emphasis1",
    "emphasis2": "Emphasis2",
    "emphasis3": "Emphasis3",
    "sheetTitle": "SheetTitle",
    "heading1": "Heading1",
    "heading2": "Heading2",
    "heading3": "Heading3",
    "heading4": "Heading4",
    "input": "Input",
    "output": "Output",
    "calculation": "Calculation",
    "checkCell": "CheckCell",
    "linkedCell": "LinkedCell",
    "total": "Total",
    "good": "Good",
    "bad": "Bad",
    "neutral": "Neutral",
    "accent1": "Accent1",
    "accent1_20": "Accent1_20",
    "accent1_40": "Accent1_40",
    "accent1_60": "Accent1_60",
    "accent2": "Accent2",
    "accent2_20": "Accent2_20",
    "accent2_40": "Accent2_40",
    "accent2_60": "Accent2_60",
    "accent3": "Accent3",
    "accent3_20": "Accent3_20",
    "accent3_40": "Accent3_40",
    "accent3_60": "Accent3_60",
    "accent4": "Accent4",
    "accent4_20": "Accent4_20",
    "accent4_40": "Accent4_40",
    "accent4_60": "Accent4_60",
    "accent5": "Accent5",
    "accent5_20": "Accent5_20",
    "accent5_40": "Accent5_40",
    "accent5_60": "Accent5_60",
    "accent6": "Accent6",
    "accent6_20": "Accent6_20",
    "accent6_40": "Accent6_40",
    "accent6_60": "Accent6_60",
    "explanatoryText": "ExplanatoryText",
  });

  install(Excel, "BusyErrorCellValueSubType", {
    "unknown": "Unknown",
    "externalLinksGeneric": "ExternalLinksGeneric",
    "loadingImage": "LoadingImage",
  });

  install(Excel, "CalcErrorCellValueSubType", {
    "unknown": "Unknown",
    "arrayOfArrays": "ArrayOfArrays",
    "arrayOfRanges": "ArrayOfRanges",
    "emptyArray": "EmptyArray",
    "unsupportedLifting": "UnsupportedLifting",
    "dataTableReferencedPendingFormula": "DataTableReferencedPendingFormula",
    "tooManyCells": "TooManyCells",
    "lambdaInCell": "LambdaInCell",
    "tooDeeplyNested": "TooDeeplyNested",
    "textOverflow": "TextOverflow",
  });

  install(Excel, "CalculationMode", {
    "automatic": "Automatic",
    "automaticExceptTables": "AutomaticExceptTables",
    "manual": "Manual",
  });

  install(Excel, "CalculationState", {
    "done": "Done",
    "calculating": "Calculating",
    "pending": "Pending",
  });

  install(Excel, "CalculationType", {
    "recalculate": "Recalculate",
    "full": "Full",
    "fullRebuild": "FullRebuild",
  });

  install(Excel, "CellControlType", {
    "unknown": "Unknown",
    "empty": "Empty",
    "mixed": "Mixed",
    "checkbox": "Checkbox",
  });

  install(Excel, "CellValueType", {
    "array": "Array",
    "boolean": "Boolean",
    "double": "Double",
    "entity": "Entity",
    "empty": "Empty",
    "error": "Error",
    "formattedNumber": "FormattedNumber",
    "function": "Function",
    "linkedEntity": "LinkedEntity",
    "reference": "Reference",
    "string": "String",
    "notAvailable": "NotAvailable",
    "webImage": "WebImage",
  });

  install(Excel, "ChartAxisCategoryType", {
    "automatic": "Automatic",
    "textAxis": "TextAxis",
    "dateAxis": "DateAxis",
  });

  install(Excel, "ChartAxisDisplayUnit", {
    "none": "None",
    "hundreds": "Hundreds",
    "thousands": "Thousands",
    "tenThousands": "TenThousands",
    "hundredThousands": "HundredThousands",
    "millions": "Millions",
    "tenMillions": "TenMillions",
    "hundredMillions": "HundredMillions",
    "billions": "Billions",
    "trillions": "Trillions",
    "custom": "Custom",
  });

  install(Excel, "ChartAxisGroup", {
    "primary": "Primary",
    "secondary": "Secondary",
  });

  install(Excel, "ChartAxisPosition", {
    "automatic": "Automatic",
    "maximum": "Maximum",
    "minimum": "Minimum",
    "custom": "Custom",
  });

  install(Excel, "ChartAxisScaleType", {
    "linear": "Linear",
    "logarithmic": "Logarithmic",
  });

  install(Excel, "ChartAxisTickLabelPosition", {
    "nextToAxis": "NextToAxis",
    "high": "High",
    "low": "Low",
    "none": "None",
  });

  install(Excel, "ChartAxisTickMark", {
    "none": "None",
    "cross": "Cross",
    "inside": "Inside",
    "outside": "Outside",
  });

  install(Excel, "ChartAxisTimeUnit", {
    "days": "Days",
    "months": "Months",
    "years": "Years",
  });

  install(Excel, "ChartAxisType", {
    "invalid": "Invalid",
    "category": "Category",
    "value": "Value",
    "series": "Series",
  });

  install(Excel, "ChartBinType", {
    "category": "Category",
    "auto": "Auto",
    "binWidth": "BinWidth",
    "binCount": "BinCount",
  });

  install(Excel, "ChartBoxQuartileCalculation", {
    "inclusive": "Inclusive",
    "exclusive": "Exclusive",
  });

  install(Excel, "ChartColorScheme", {
    "colorfulPalette1": "ColorfulPalette1",
    "colorfulPalette2": "ColorfulPalette2",
    "colorfulPalette3": "ColorfulPalette3",
    "colorfulPalette4": "ColorfulPalette4",
    "monochromaticPalette1": "MonochromaticPalette1",
    "monochromaticPalette2": "MonochromaticPalette2",
    "monochromaticPalette3": "MonochromaticPalette3",
    "monochromaticPalette4": "MonochromaticPalette4",
    "monochromaticPalette5": "MonochromaticPalette5",
    "monochromaticPalette6": "MonochromaticPalette6",
    "monochromaticPalette7": "MonochromaticPalette7",
    "monochromaticPalette8": "MonochromaticPalette8",
    "monochromaticPalette9": "MonochromaticPalette9",
    "monochromaticPalette10": "MonochromaticPalette10",
    "monochromaticPalette11": "MonochromaticPalette11",
    "monochromaticPalette12": "MonochromaticPalette12",
    "monochromaticPalette13": "MonochromaticPalette13",
  });

  install(Excel, "ChartDataLabelPosition", {
    "invalid": "Invalid",
    "none": "None",
    "center": "Center",
    "insideEnd": "InsideEnd",
    "insideBase": "InsideBase",
    "outsideEnd": "OutsideEnd",
    "left": "Left",
    "right": "Right",
    "top": "Top",
    "bottom": "Bottom",
    "bestFit": "BestFit",
    "callout": "Callout",
  });

  install(Excel, "ChartDataSourceType", {
    "localRange": "LocalRange",
    "externalRange": "ExternalRange",
    "list": "List",
    "unknown": "Unknown",
  });

  install(Excel, "ChartDisplayBlanksAs", {
    "notPlotted": "NotPlotted",
    "zero": "Zero",
    "interplotted": "Interplotted",
  });

  install(Excel, "ChartErrorBarsInclude", {
    "both": "Both",
    "minusValues": "MinusValues",
    "plusValues": "PlusValues",
  });

  install(Excel, "ChartErrorBarsType", {
    "fixedValue": "FixedValue",
    "percent": "Percent",
    "stDev": "StDev",
    "stError": "StError",
    "custom": "Custom",
  });

  install(Excel, "ChartGradientStyle", {
    "twoPhaseColor": "TwoPhaseColor",
    "threePhaseColor": "ThreePhaseColor",
  });

  install(Excel, "ChartGradientStyleType", {
    "extremeValue": "ExtremeValue",
    "number": "Number",
    "percent": "Percent",
  });

  install(Excel, "ChartLegendPosition", {
    "invalid": "Invalid",
    "top": "Top",
    "bottom": "Bottom",
    "left": "Left",
    "right": "Right",
    "corner": "Corner",
    "custom": "Custom",
  });

  install(Excel, "ChartLineStyle", {
    "none": "None",
    "continuous": "Continuous",
    "dash": "Dash",
    "dashDot": "DashDot",
    "dashDotDot": "DashDotDot",
    "dot": "Dot",
    "grey25": "Grey25",
    "grey50": "Grey50",
    "grey75": "Grey75",
    "automatic": "Automatic",
    "roundDot": "RoundDot",
  });

  install(Excel, "ChartMapAreaLevel", {
    "automatic": "Automatic",
    "dataOnly": "DataOnly",
    "city": "City",
    "county": "County",
    "state": "State",
    "country": "Country",
    "continent": "Continent",
    "world": "World",
  });

  install(Excel, "ChartMapLabelStrategy", {
    "none": "None",
    "bestFit": "BestFit",
    "showAll": "ShowAll",
  });

  install(Excel, "ChartMapProjectionType", {
    "automatic": "Automatic",
    "mercator": "Mercator",
    "miller": "Miller",
    "robinson": "Robinson",
    "albers": "Albers",
  });

  install(Excel, "ChartMarkerStyle", {
    "invalid": "Invalid",
    "automatic": "Automatic",
    "none": "None",
    "square": "Square",
    "diamond": "Diamond",
    "triangle": "Triangle",
    "x": "X",
    "star": "Star",
    "dot": "Dot",
    "dash": "Dash",
    "circle": "Circle",
    "plus": "Plus",
    "picture": "Picture",
  });

  install(Excel, "ChartParentLabelStrategy", {
    "none": "None",
    "banner": "Banner",
    "overlapping": "Overlapping",
  });

  install(Excel, "ChartPlotAreaPosition", {
    "automatic": "Automatic",
    "custom": "Custom",
  });

  install(Excel, "ChartPlotBy", {
    "rows": "Rows",
    "columns": "Columns",
  });

  install(Excel, "ChartSeriesBy", {
    "auto": "Auto",
    "columns": "Columns",
    "rows": "Rows",
  });

  install(Excel, "ChartSeriesDimension", {
    "categories": "Categories",
    "values": "Values",
    "xvalues": "XValues",
    "yvalues": "YValues",
    "bubbleSizes": "BubbleSizes",
  });

  install(Excel, "ChartSplitType", {
    "splitByPosition": "SplitByPosition",
    "splitByValue": "SplitByValue",
    "splitByPercentValue": "SplitByPercentValue",
    "splitByCustomSplit": "SplitByCustomSplit",
  });

  install(Excel, "ChartTextHorizontalAlignment", {
    "center": "Center",
    "left": "Left",
    "right": "Right",
    "justify": "Justify",
    "distributed": "Distributed",
  });

  install(Excel, "ChartTextVerticalAlignment", {
    "center": "Center",
    "bottom": "Bottom",
    "top": "Top",
    "justify": "Justify",
    "distributed": "Distributed",
  });

  install(Excel, "ChartTickLabelAlignment", {
    "center": "Center",
    "left": "Left",
    "right": "Right",
  });

  install(Excel, "ChartTitlePosition", {
    "automatic": "Automatic",
    "top": "Top",
    "bottom": "Bottom",
    "left": "Left",
    "right": "Right",
  });

  install(Excel, "ChartTrendlineType", {
    "linear": "Linear",
    "exponential": "Exponential",
    "logarithmic": "Logarithmic",
    "movingAverage": "MovingAverage",
    "polynomial": "Polynomial",
    "power": "Power",
  });

  install(Excel, "ChartType", {
    "invalid": "Invalid",
    "columnClustered": "ColumnClustered",
    "columnStacked": "ColumnStacked",
    "columnStacked100": "ColumnStacked100",
    "_3DColumnClustered": "3DColumnClustered",
    "_3DColumnStacked": "3DColumnStacked",
    "_3DColumnStacked100": "3DColumnStacked100",
    "barClustered": "BarClustered",
    "barStacked": "BarStacked",
    "barStacked100": "BarStacked100",
    "_3DBarClustered": "3DBarClustered",
    "_3DBarStacked": "3DBarStacked",
    "_3DBarStacked100": "3DBarStacked100",
    "lineStacked": "LineStacked",
    "lineStacked100": "LineStacked100",
    "lineMarkers": "LineMarkers",
    "lineMarkersStacked": "LineMarkersStacked",
    "lineMarkersStacked100": "LineMarkersStacked100",
    "pieOfPie": "PieOfPie",
    "pieExploded": "PieExploded",
    "_3DPieExploded": "3DPieExploded",
    "barOfPie": "BarOfPie",
    "xyscatterSmooth": "XYScatterSmooth",
    "xyscatterSmoothNoMarkers": "XYScatterSmoothNoMarkers",
    "xyscatterLines": "XYScatterLines",
    "xyscatterLinesNoMarkers": "XYScatterLinesNoMarkers",
    "areaStacked": "AreaStacked",
    "areaStacked100": "AreaStacked100",
    "_3DAreaStacked": "3DAreaStacked",
    "_3DAreaStacked100": "3DAreaStacked100",
    "doughnutExploded": "DoughnutExploded",
    "radarMarkers": "RadarMarkers",
    "radarFilled": "RadarFilled",
    "surface": "Surface",
    "surfaceWireframe": "SurfaceWireframe",
    "surfaceTopView": "SurfaceTopView",
    "surfaceTopViewWireframe": "SurfaceTopViewWireframe",
    "bubble": "Bubble",
    "bubble3DEffect": "Bubble3DEffect",
    "stockHLC": "StockHLC",
    "stockOHLC": "StockOHLC",
    "stockVHLC": "StockVHLC",
    "stockVOHLC": "StockVOHLC",
    "cylinderColClustered": "CylinderColClustered",
    "cylinderColStacked": "CylinderColStacked",
    "cylinderColStacked100": "CylinderColStacked100",
    "cylinderBarClustered": "CylinderBarClustered",
    "cylinderBarStacked": "CylinderBarStacked",
    "cylinderBarStacked100": "CylinderBarStacked100",
    "cylinderCol": "CylinderCol",
    "coneColClustered": "ConeColClustered",
    "coneColStacked": "ConeColStacked",
    "coneColStacked100": "ConeColStacked100",
    "coneBarClustered": "ConeBarClustered",
    "coneBarStacked": "ConeBarStacked",
    "coneBarStacked100": "ConeBarStacked100",
    "coneCol": "ConeCol",
    "pyramidColClustered": "PyramidColClustered",
    "pyramidColStacked": "PyramidColStacked",
    "pyramidColStacked100": "PyramidColStacked100",
    "pyramidBarClustered": "PyramidBarClustered",
    "pyramidBarStacked": "PyramidBarStacked",
    "pyramidBarStacked100": "PyramidBarStacked100",
    "pyramidCol": "PyramidCol",
    "_3DColumn": "3DColumn",
    "line": "Line",
    "_3DLine": "3DLine",
    "_3DPie": "3DPie",
    "pie": "Pie",
    "xyscatter": "XYScatter",
    "_3DArea": "3DArea",
    "area": "Area",
    "doughnut": "Doughnut",
    "radar": "Radar",
    "histogram": "Histogram",
    "boxwhisker": "Boxwhisker",
    "pareto": "Pareto",
    "regionMap": "RegionMap",
    "treemap": "Treemap",
    "waterfall": "Waterfall",
    "sunburst": "Sunburst",
    "funnel": "Funnel",
  });

  install(Excel, "ChartUnderlineStyle", {
    "none": "None",
    "single": "Single",
  });

  install(Excel, "ClearApplyTo", {
    "all": "All",
    "formats": "Formats",
    "contents": "Contents",
    "hyperlinks": "Hyperlinks",
    "removeHyperlinks": "RemoveHyperlinks",
    "resetContents": "ResetContents",
  });

  install(Excel, "CloseBehavior", {
    "save": "Save",
    "skipSave": "SkipSave",
  });

  install(Excel, "CommentChangeType", {
    "commentEdited": "CommentEdited",
    "commentResolved": "CommentResolved",
    "commentReopened": "CommentReopened",
    "replyAdded": "ReplyAdded",
    "replyDeleted": "ReplyDeleted",
    "replyEdited": "ReplyEdited",
  });

  install(Excel, "ConditionalCellValueOperator", {
    "invalid": "Invalid",
    "between": "Between",
    "notBetween": "NotBetween",
    "equalTo": "EqualTo",
    "notEqualTo": "NotEqualTo",
    "greaterThan": "GreaterThan",
    "lessThan": "LessThan",
    "greaterThanOrEqual": "GreaterThanOrEqual",
    "lessThanOrEqual": "LessThanOrEqual",
  });

  install(Excel, "ConditionalDataBarAxisFormat", {
    "automatic": "Automatic",
    "none": "None",
    "cellMidPoint": "CellMidPoint",
  });

  install(Excel, "ConditionalDataBarDirection", {
    "context": "Context",
    "leftToRight": "LeftToRight",
    "rightToLeft": "RightToLeft",
  });

  install(Excel, "ConditionalFormatColorCriterionType", {
    "invalid": "Invalid",
    "lowestValue": "LowestValue",
    "highestValue": "HighestValue",
    "number": "Number",
    "percent": "Percent",
    "formula": "Formula",
    "percentile": "Percentile",
  });

  install(Excel, "ConditionalFormatDirection", {
    "top": "Top",
    "bottom": "Bottom",
  });

  install(Excel, "ConditionalFormatIconRuleType", {
    "invalid": "Invalid",
    "number": "Number",
    "percent": "Percent",
    "formula": "Formula",
    "percentile": "Percentile",
  });

  install(Excel, "ConditionalFormatPresetCriterion", {
    "invalid": "Invalid",
    "blanks": "Blanks",
    "nonBlanks": "NonBlanks",
    "errors": "Errors",
    "nonErrors": "NonErrors",
    "yesterday": "Yesterday",
    "today": "Today",
    "tomorrow": "Tomorrow",
    "lastSevenDays": "LastSevenDays",
    "lastWeek": "LastWeek",
    "thisWeek": "ThisWeek",
    "nextWeek": "NextWeek",
    "lastMonth": "LastMonth",
    "thisMonth": "ThisMonth",
    "nextMonth": "NextMonth",
    "aboveAverage": "AboveAverage",
    "belowAverage": "BelowAverage",
    "equalOrAboveAverage": "EqualOrAboveAverage",
    "equalOrBelowAverage": "EqualOrBelowAverage",
    "oneStdDevAboveAverage": "OneStdDevAboveAverage",
    "oneStdDevBelowAverage": "OneStdDevBelowAverage",
    "twoStdDevAboveAverage": "TwoStdDevAboveAverage",
    "twoStdDevBelowAverage": "TwoStdDevBelowAverage",
    "threeStdDevAboveAverage": "ThreeStdDevAboveAverage",
    "threeStdDevBelowAverage": "ThreeStdDevBelowAverage",
    "uniqueValues": "UniqueValues",
    "duplicateValues": "DuplicateValues",
  });

  install(Excel, "ConditionalFormatRuleType", {
    "invalid": "Invalid",
    "automatic": "Automatic",
    "lowestValue": "LowestValue",
    "highestValue": "HighestValue",
    "number": "Number",
    "percent": "Percent",
    "formula": "Formula",
    "percentile": "Percentile",
  });

  install(Excel, "ConditionalFormatType", {
    "custom": "Custom",
    "dataBar": "DataBar",
    "colorScale": "ColorScale",
    "iconSet": "IconSet",
    "topBottom": "TopBottom",
    "presetCriteria": "PresetCriteria",
    "containsText": "ContainsText",
    "cellValue": "CellValue",
  });

  install(Excel, "ConditionalIconCriterionOperator", {
    "invalid": "Invalid",
    "greaterThan": "GreaterThan",
    "greaterThanOrEqual": "GreaterThanOrEqual",
  });

  install(Excel, "ConditionalRangeBorderIndex", {
    "edgeTop": "EdgeTop",
    "edgeBottom": "EdgeBottom",
    "edgeLeft": "EdgeLeft",
    "edgeRight": "EdgeRight",
  });

  install(Excel, "ConditionalRangeBorderLineStyle", {
    "none": "None",
    "continuous": "Continuous",
    "dash": "Dash",
    "dashDot": "DashDot",
    "dashDotDot": "DashDotDot",
    "dot": "Dot",
  });

  install(Excel, "ConditionalRangeFontUnderlineStyle", {
    "none": "None",
    "single": "Single",
    "double": "Double",
  });

  install(Excel, "ConditionalTextOperator", {
    "invalid": "Invalid",
    "contains": "Contains",
    "notContains": "NotContains",
    "beginsWith": "BeginsWith",
    "endsWith": "EndsWith",
  });

  install(Excel, "ConditionalTopBottomCriterionType", {
    "invalid": "Invalid",
    "topItems": "TopItems",
    "topPercent": "TopPercent",
    "bottomItems": "BottomItems",
    "bottomPercent": "BottomPercent",
  });

  install(Excel, "ConnectErrorCellValueSubType", {
    "unknown": "Unknown",
    "serviceError": "ServiceError",
    "externalLinks": "ExternalLinks",
    "externalLinksNonCloudLocation": "ExternalLinksNonCloudLocation",
    "dataTypeNoConnection": "DataTypeNoConnection",
    "dataTypeServiceError": "DataTypeServiceError",
    "missingContent": "MissingContent",
    "requestThrottle": "RequestThrottle",
    "externalLinksFailedToRefresh": "ExternalLinksFailedToRefresh",
    "externalLinksAccessFailed": "ExternalLinksAccessFailed",
    "externalLinksServerError": "ExternalLinksServerError",
    "externalLinksInvalidRequest": "ExternalLinksInvalidRequest",
    "externalLinksUnAuthenticated": "ExternalLinksUnAuthenticated",
    "externalLinksThrottledByHost": "ExternalLinksThrottledByHost",
    "externalLinksFileTooLarge": "ExternalLinksFileTooLarge",
    "outdatedLinkedEntity": "OutdatedLinkedEntity",
    "genericServerError": "GenericServerError",
  });

  install(Excel, "ConnectorType", {
    "straight": "Straight",
    "elbow": "Elbow",
    "curve": "Curve",
  });

  install(Excel, "ContentType", {
    "plain": "Plain",
    "mention": "Mention",
  });

  install(Excel, "DataChangeType", {
    "unknown": "Unknown",
    "rangeEdited": "RangeEdited",
    "rowInserted": "RowInserted",
    "rowDeleted": "RowDeleted",
    "columnInserted": "ColumnInserted",
    "columnDeleted": "ColumnDeleted",
    "cellInserted": "CellInserted",
    "cellDeleted": "CellDeleted",
  });

  install(Excel, "DataSourceType", {
    "unknown": "Unknown",
    "localRange": "LocalRange",
    "localTable": "LocalTable",
  });

  install(Excel, "DataValidationAlertStyle", {
    "stop": "Stop",
    "warning": "Warning",
    "information": "Information",
  });

  install(Excel, "DataValidationOperator", {
    "between": "Between",
    "notBetween": "NotBetween",
    "equalTo": "EqualTo",
    "notEqualTo": "NotEqualTo",
    "greaterThan": "GreaterThan",
    "lessThan": "LessThan",
    "greaterThanOrEqualTo": "GreaterThanOrEqualTo",
    "lessThanOrEqualTo": "LessThanOrEqualTo",
  });

  install(Excel, "DataValidationType", {
    "none": "None",
    "wholeNumber": "WholeNumber",
    "decimal": "Decimal",
    "list": "List",
    "date": "Date",
    "time": "Time",
    "textLength": "TextLength",
    "custom": "Custom",
    "inconsistent": "Inconsistent",
    "mixedCriteria": "MixedCriteria",
  });

  install(Excel, "DateFilterCondition", {
    "unknown": "Unknown",
    "equals": "Equals",
    "before": "Before",
    "beforeOrEqualTo": "BeforeOrEqualTo",
    "after": "After",
    "afterOrEqualTo": "AfterOrEqualTo",
    "between": "Between",
    "tomorrow": "Tomorrow",
    "today": "Today",
    "yesterday": "Yesterday",
    "nextWeek": "NextWeek",
    "thisWeek": "ThisWeek",
    "lastWeek": "LastWeek",
    "nextMonth": "NextMonth",
    "thisMonth": "ThisMonth",
    "lastMonth": "LastMonth",
    "nextQuarter": "NextQuarter",
    "thisQuarter": "ThisQuarter",
    "lastQuarter": "LastQuarter",
    "nextYear": "NextYear",
    "thisYear": "ThisYear",
    "lastYear": "LastYear",
    "yearToDate": "YearToDate",
    "allDatesInPeriodQuarter1": "AllDatesInPeriodQuarter1",
    "allDatesInPeriodQuarter2": "AllDatesInPeriodQuarter2",
    "allDatesInPeriodQuarter3": "AllDatesInPeriodQuarter3",
    "allDatesInPeriodQuarter4": "AllDatesInPeriodQuarter4",
    "allDatesInPeriodJanuary": "AllDatesInPeriodJanuary",
    "allDatesInPeriodFebruary": "AllDatesInPeriodFebruary",
    "allDatesInPeriodMarch": "AllDatesInPeriodMarch",
    "allDatesInPeriodApril": "AllDatesInPeriodApril",
    "allDatesInPeriodMay": "AllDatesInPeriodMay",
    "allDatesInPeriodJune": "AllDatesInPeriodJune",
    "allDatesInPeriodJuly": "AllDatesInPeriodJuly",
    "allDatesInPeriodAugust": "AllDatesInPeriodAugust",
    "allDatesInPeriodSeptember": "AllDatesInPeriodSeptember",
    "allDatesInPeriodOctober": "AllDatesInPeriodOctober",
    "allDatesInPeriodNovember": "AllDatesInPeriodNovember",
    "allDatesInPeriodDecember": "AllDatesInPeriodDecember",
  });

  install(Excel, "DeleteShiftDirection", {
    "up": "Up",
    "left": "Left",
  });

  install(Excel, "DocumentPropertyItem", {
    "title": "Title",
    "subject": "Subject",
    "author": "Author",
    "keywords": "Keywords",
    "comments": "Comments",
    "template": "Template",
    "lastAuth": "LastAuth",
    "revision": "Revision",
    "appName": "AppName",
    "lastPrint": "LastPrint",
    "creation": "Creation",
    "lastSave": "LastSave",
    "category": "Category",
    "format": "Format",
    "manager": "Manager",
    "company": "Company",
  });

  install(Excel, "DocumentPropertyType", {
    "number": "Number",
    "boolean": "Boolean",
    "date": "Date",
    "string": "String",
    "float": "Float",
  });

  install(Excel, "DynamicFilterCriteria", {
    "unknown": "Unknown",
    "aboveAverage": "AboveAverage",
    "allDatesInPeriodApril": "AllDatesInPeriodApril",
    "allDatesInPeriodAugust": "AllDatesInPeriodAugust",
    "allDatesInPeriodDecember": "AllDatesInPeriodDecember",
    "allDatesInPeriodFebruray": "AllDatesInPeriodFebruray",
    "allDatesInPeriodJanuary": "AllDatesInPeriodJanuary",
    "allDatesInPeriodJuly": "AllDatesInPeriodJuly",
    "allDatesInPeriodJune": "AllDatesInPeriodJune",
    "allDatesInPeriodMarch": "AllDatesInPeriodMarch",
    "allDatesInPeriodMay": "AllDatesInPeriodMay",
    "allDatesInPeriodNovember": "AllDatesInPeriodNovember",
    "allDatesInPeriodOctober": "AllDatesInPeriodOctober",
    "allDatesInPeriodQuarter1": "AllDatesInPeriodQuarter1",
    "allDatesInPeriodQuarter2": "AllDatesInPeriodQuarter2",
    "allDatesInPeriodQuarter3": "AllDatesInPeriodQuarter3",
    "allDatesInPeriodQuarter4": "AllDatesInPeriodQuarter4",
    "allDatesInPeriodSeptember": "AllDatesInPeriodSeptember",
    "belowAverage": "BelowAverage",
    "lastMonth": "LastMonth",
    "lastQuarter": "LastQuarter",
    "lastWeek": "LastWeek",
    "lastYear": "LastYear",
    "nextMonth": "NextMonth",
    "nextQuarter": "NextQuarter",
    "nextWeek": "NextWeek",
    "nextYear": "NextYear",
    "thisMonth": "ThisMonth",
    "thisQuarter": "ThisQuarter",
    "thisWeek": "ThisWeek",
    "thisYear": "ThisYear",
    "today": "Today",
    "tomorrow": "Tomorrow",
    "yearToDate": "YearToDate",
    "yesterday": "Yesterday",
  });

  install(Excel, "EntityCardLayoutType", {
    "entity": "Entity",
  });

  install(Excel, "EntityCompactLayoutIcons", {
    "generic": "Generic",
    "accessibility": "Accessibility",
    "airplane": "Airplane",
    "airplaneTakeOff": "AirplaneTakeOff",
    "album": "Album",
    "alert": "Alert",
    "alertUrgent": "AlertUrgent",
    "animal": "Animal",
    "animalCat": "AnimalCat",
    "animalDog": "AnimalDog",
    "animalRabbit": "AnimalRabbit",
    "animalTurtle": "AnimalTurtle",
    "appFolder": "AppFolder",
    "appGeneric": "AppGeneric",
    "apple": "Apple",
    "approvalsApp": "ApprovalsApp",
    "archive": "Archive",
    "archiveMultiple": "ArchiveMultiple",
    "arrowTrendingLines": "ArrowTrendingLines",
    "art": "Art",
    "atom": "Atom",
    "attach": "Attach",
    "automobile": "Automobile",
    "autosum": "Autosum",
    "backpack": "Backpack",
    "badge": "Badge",
    "balloon": "Balloon",
    "bank": "Bank",
    "barcodeScanner": "BarcodeScanner",
    "basketball": "Basketball",
    "battery0": "Battery0",
    "battery10": "Battery10",
    "beach": "Beach",
    "beaker": "Beaker",
    "bed": "Bed",
    "binFull": "BinFull",
    "bird": "Bird",
    "bluetooth": "Bluetooth",
    "board": "Board",
    "boardGames": "BoardGames",
    "book": "Book",
    "bookmark": "Bookmark",
    "bookmarkMultiple": "BookmarkMultiple",
    "bot": "Bot",
    "bowlChopsticks": "BowlChopsticks",
    "box": "Box",
    "boxMultiple": "BoxMultiple",
    "brainCircuit": "BrainCircuit",
    "branch": "Branch",
    "branchFork": "BranchFork",
    "branchRequest": "BranchRequest",
    "bridge": "Bridge",
    "briefcase": "Briefcase",
    "briefcaseMedical": "BriefcaseMedical",
    "broadActivityFeed": "BroadActivityFeed",
    "broom": "Broom",
    "bug": "Bug",
    "building": "Building",
    "buildingBank": "BuildingBank",
    "buildingFactory": "BuildingFactory",
    "buildingGovernment": "BuildingGovernment",
    "buildingHome": "BuildingHome",
    "buildingLighthouse": "BuildingLighthouse",
    "buildingMultiple": "BuildingMultiple",
    "buildingRetail": "BuildingRetail",
    "buildingRetailMore": "BuildingRetailMore",
    "buildingRetailToolbox": "BuildingRetailToolbox",
    "buildingShop": "BuildingShop",
    "buildingSkyscraper": "BuildingSkyscraper",
    "calculator": "Calculator",
    "calendarLtr": "CalendarLtr",
    "calendarRtl": "CalendarRtl",
    "call": "Call",
    "calligraphyPen": "CalligraphyPen",
    "camera": "Camera",
    "cameraDome": "CameraDome",
    "car": "Car",
    "cart": "Cart",
    "cat": "Cat",
    "certificate": "Certificate",
    "chartMultiple": "ChartMultiple",
    "chat": "Chat",
    "chatMultiple": "ChatMultiple",
    "chatVideo": "ChatVideo",
    "check": "Check",
    "checkboxChecked": "CheckboxChecked",
    "checkboxUnchecked": "CheckboxUnchecked",
    "checkmark": "Checkmark",
    "chess": "Chess",
    "city": "City",
    "class": "Class",
    "classification": "Classification",
    "clipboard": "Clipboard",
    "clipboardDataBar": "ClipboardDataBar",
    "clipboardPulse": "ClipboardPulse",
    "clipboardTask": "ClipboardTask",
    "clock": "Clock",
    "clockAlarm": "ClockAlarm",
    "cloud": "Cloud",
    "cloudWords": "CloudWords",
    "code": "Code",
    "collections": "Collections",
    "comment": "Comment",
    "commentMultiple": "CommentMultiple",
    "communication": "Communication",
    "compassNorthwest": "CompassNorthwest",
    "conferenceRoom": "ConferenceRoom",
    "connector": "Connector",
    "constellation": "Constellation",
    "contactCard": "ContactCard",
    "cookies": "Cookies",
    "couch": "Couch",
    "creditCardPerson": "CreditCardPerson",
    "creditCardToolbox": "CreditCardToolbox",
    "cube": "Cube",
    "cubeMultiple": "CubeMultiple",
    "cubeTree": "CubeTree",
    "currencyDollarEuro": "CurrencyDollarEuro",
    "currencyDollarRupee": "CurrencyDollarRupee",
    "dataArea": "DataArea",
    "database": "Database",
    "databaseMultiple": "DatabaseMultiple",
    "dataFunnel": "DataFunnel",
    "dataHistogram": "DataHistogram",
    "dataLine": "DataLine",
    "dataPie": "DataPie",
    "dataScatter": "DataScatter",
    "dataSunburst": "DataSunburst",
    "dataTreemap": "DataTreemap",
    "dataWaterfall": "DataWaterfall",
    "dataWhisker": "DataWhisker",
    "dentist": "Dentist",
    "designIdeas": "DesignIdeas",
    "desktop": "Desktop",
    "desktopMac": "DesktopMac",
    "developerBoard": "DeveloperBoard",
    "deviceMeetingRoom": "DeviceMeetingRoom",
    "diagram": "Diagram",
    "dialpad": "Dialpad",
    "diamond": "Diamond",
    "dinosaur": "Dinosaur",
    "directions": "Directions",
    "disaster": "Disaster",
    "diversity": "Diversity",
    "dNA": "DNA",
    "doctor": "Doctor",
    "document": "Document",
    "documentData": "DocumentData",
    "documentLandscape": "DocumentLandscape",
    "documentMultiple": "DocumentMultiple",
    "documentPdf": "DocumentPdf",
    "documentQueue": "DocumentQueue",
    "documentText": "DocumentText",
    "dog": "Dog",
    "door": "Door",
    "doorTag": "DoorTag",
    "drafts": "Drafts",
    "drama": "Drama",
    "drinkBeer": "DrinkBeer",
    "drinkCoffee": "DrinkCoffee",
    "drinkMargarita": "DrinkMargarita",
    "drinkToGo": "DrinkToGo",
    "drinkWine": "DrinkWine",
    "driveTrain": "DriveTrain",
    "drop": "Drop",
    "dualScreen": "DualScreen",
    "dumbbell": "Dumbbell",
    "earth": "Earth",
    "emoji": "Emoji",
    "emojiAngry": "EmojiAngry",
    "emojiHand": "EmojiHand",
    "emojiLaugh": "EmojiLaugh",
    "emojiMeh": "EmojiMeh",
    "emojiMultiple": "EmojiMultiple",
    "emojiSad": "EmojiSad",
    "emojiSadSlight": "EmojiSadSlight",
    "emojiSmileSlight": "EmojiSmileSlight",
    "emojiSparkle": "EmojiSparkle",
    "emojiSurprise": "EmojiSurprise",
    "engine": "Engine",
    "eraser": "Eraser",
    "eye": "Eye",
    "eyedropper": "Eyedropper",
    "fax": "Fax",
    "fingerprint": "Fingerprint",
    "firstAid": "FirstAid",
    "flag": "Flag",
    "flash": "Flash",
    "flashlight": "Flashlight",
    "flow": "Flow",
    "flowchart": "Flowchart",
    "folder": "Folder",
    "folderOpen": "FolderOpen",
    "folderOpenVertical": "FolderOpenVertical",
    "folderPerson": "FolderPerson",
    "folderZip": "FolderZip",
    "food": "Food",
    "foodApple": "FoodApple",
    "foodCake": "FoodCake",
    "foodEgg": "FoodEgg",
    "foodGrains": "FoodGrains",
    "foodPizza": "FoodPizza",
    "foodToast": "FoodToast",
    "galaxy": "Galaxy",
    "games": "Games",
    "ganttChart": "GanttChart",
    "gas": "Gas",
    "gasPump": "GasPump",
    "gauge": "Gauge",
    "gavel": "Gavel",
    "gift": "Gift",
    "giftCard": "GiftCard",
    "glasses": "Glasses",
    "globe": "Globe",
    "globeSurface": "GlobeSurface",
    "grid": "Grid",
    "gridDots": "GridDots",
    "gridKanban": "GridKanban",
    "guardian": "Guardian",
    "guest": "Guest",
    "guitar": "Guitar",
    "handLeft": "HandLeft",
    "handRight": "HandRight",
    "handshake": "Handshake",
    "hardDrive": "HardDrive",
    "hatGraduation": "HatGraduation",
    "headphones": "Headphones",
    "headphonesSoundWave": "HeadphonesSoundWave",
    "headset": "Headset",
    "headsetVr": "HeadsetVr",
    "heart": "Heart",
    "heartBroken": "HeartBroken",
    "heartCircle": "HeartCircle",
    "heartHuman": "HeartHuman",
    "heartPulse": "HeartPulse",
    "history": "History",
    "home": "Home",
    "homeMore": "HomeMore",
    "homePerson": "HomePerson",
    "icons": "Icons",
    "image": "Image",
    "imageGlobe": "ImageGlobe",
    "imageMultiple": "ImageMultiple",
    "iot": "Iot",
    "joystick": "Joystick",
    "justice": "Justice",
    "key": "Key",
    "keyboard": "Keyboard",
    "keyboardLayoutSplit": "KeyboardLayoutSplit",
    "keyMultiple": "KeyMultiple",
    "languages": "Languages",
    "laptop": "Laptop",
    "lasso": "Lasso",
    "launcherSettings": "LauncherSettings",
    "layer": "Layer",
    "leaf": "Leaf",
    "leafOne": "LeafOne",
    "leafThree": "LeafThree",
    "leafTwo": "LeafTwo",
    "library": "Library",
    "lightbulb": "Lightbulb",
    "lightbulbFilament": "LightbulbFilament",
    "likert": "Likert",
    "link": "Link",
    "localLanguage": "LocalLanguage",
    "location": "Location",
    "lockClosed": "LockClosed",
    "lockMultiple": "LockMultiple",
    "lockOpen": "LockOpen",
    "lottery": "Lottery",
    "luggage": "Luggage",
    "mail": "Mail",
    "mailInbox": "MailInbox",
    "mailMultiple": "MailMultiple",
    "map": "Map",
    "mapPin": "MapPin",
    "markdown": "Markdown",
    "mathFormula": "MathFormula",
    "mathSymbols": "MathSymbols",
    "max": "Max",
    "megaphone": "Megaphone",
    "megaphoneLoud": "MegaphoneLoud",
    "mention": "Mention",
    "mic": "Mic",
    "microscope": "Microscope",
    "midi": "Midi",
    "molecule": "Molecule",
    "money": "Money",
    "moneyHand": "MoneyHand",
    "mountain": "Mountain",
    "movieCamera": "MovieCamera",
    "moviesAndTv": "MoviesAndTv",
    "musicNote": "MusicNote",
    "musicNote1": "MusicNote1",
    "musicNote2": "MusicNote2",
    "myLocation": "MyLocation",
    "nByN": "NByN",
    "nByOne": "NByOne",
    "news": "News",
    "notablePeople": "NotablePeople",
    "note": "Note",
    "notebook": "Notebook",
    "notepad": "Notepad",
    "notepadPerson": "NotepadPerson",
    "oneByN": "OneByN",
    "oneByOne": "OneByOne",
    "options": "Options",
    "organization": "Organization",
    "organizationHorizontal": "OrganizationHorizontal",
    "oval": "Oval",
    "paintBrush": "PaintBrush",
    "paintBucket": "PaintBucket",
    "partlySunnyWeather": "PartlySunnyWeather",
    "password": "Password",
    "patch": "Patch",
    "patient": "Patient",
    "payment": "Payment",
    "pen": "Pen",
    "pentagon": "Pentagon",
    "people": "People",
    "peopleAudience": "PeopleAudience",
    "peopleCall": "PeopleCall",
    "peopleCommunity": "PeopleCommunity",
    "peopleMoney": "PeopleMoney",
    "peopleQueue": "PeopleQueue",
    "peopleTeam": "PeopleTeam",
    "peopleToolbox": "PeopleToolbox",
    "person": "Person",
    "personBoard": "PersonBoard",
    "personCall": "PersonCall",
    "personChat": "PersonChat",
    "personFeedback": "PersonFeedback",
    "personSupport": "PersonSupport",
    "personVoice": "PersonVoice",
    "phone": "Phone",
    "phoneDesktop": "PhoneDesktop",
    "phoneLaptop": "PhoneLaptop",
    "phoneShake": "PhoneShake",
    "phoneTablet": "PhoneTablet",
    "phoneVibrate": "PhoneVibrate",
    "photoFilter": "PhotoFilter",
    "pi": "Pi",
    "pictureInPicture": "PictureInPicture",
    "pilates": "Pilates",
    "pill": "Pill",
    "pin": "Pin",
    "pipeline": "Pipeline",
    "planet": "Planet",
    "playingCards": "PlayingCards",
    "plugConnected": "PlugConnected",
    "plugDisconnected": "PlugDisconnected",
    "pointScan": "PointScan",
    "poll": "Poll",
    "power": "Power",
    "predictions": "Predictions",
    "premium": "Premium",
    "presenter": "Presenter",
    "previewLink": "PreviewLink",
    "print": "Print",
    "production": "Production",
    "prohibited": "Prohibited",
    "projectionScreen": "ProjectionScreen",
    "protocolHandler": "ProtocolHandler",
    "pulse": "Pulse",
    "pulseSquare": "PulseSquare",
    "puzzlePiece": "PuzzlePiece",
    "qrCode": "QrCode",
    "radar": "Radar",
    "ram": "Ram",
    "readingList": "ReadingList",
    "realEstate": "RealEstate",
    "receipt": "Receipt",
    "reward": "Reward",
    "rhombus": "Rhombus",
    "ribbon": "Ribbon",
    "ribbonStar": "RibbonStar",
    "roadCone": "RoadCone",
    "rocket": "Rocket",
    "router": "Router",
    "rss": "Rss",
    "ruler": "Ruler",
    "run": "Run",
    "running": "Running",
    "satellite": "Satellite",
    "save": "Save",
    "savings": "Savings",
    "scales": "Scales",
    "scan": "Scan",
    "scratchpad": "Scratchpad",
    "screenPerson": "ScreenPerson",
    "screenshot": "Screenshot",
    "search": "Search",
    "serialPort": "SerialPort",
    "server": "Server",
    "serverMultiple": "ServerMultiple",
    "serviceBell": "ServiceBell",
    "settings": "Settings",
    "shapes": "Shapes",
    "shield": "Shield",
    "shieldTask": "ShieldTask",
    "shoppingBag": "ShoppingBag",
    "signature": "Signature",
    "sim": "Sim",
    "sleep": "Sleep",
    "smartwatch": "Smartwatch",
    "soundSource": "SoundSource",
    "soundWaveCircle": "SoundWaveCircle",
    "sparkle": "Sparkle",
    "speaker0": "Speaker0",
    "speaker2": "Speaker2",
    "sport": "Sport",
    "sportAmericanFootball": "SportAmericanFootball",
    "sportBaseball": "SportBaseball",
    "sportBasketball": "SportBasketball",
    "sportHockey": "SportHockey",
    "sportSoccer": "SportSoccer",
    "squareMultiple": "SquareMultiple",
    "squareShadow": "SquareShadow",
    "squaresNested": "SquaresNested",
    "stack": "Stack",
    "stackStar": "StackStar",
    "star": "Star",
    "starFilled": "StarFilled",
    "starHalf": "StarHalf",
    "starLineHorizontal3": "StarLineHorizontal3",
    "starOneQuarter": "StarOneQuarter",
    "starThreeQuarter": "StarThreeQuarter",
    "status": "Status",
    "steps": "Steps",
    "stethoscope": "Stethoscope",
    "sticker": "Sticker",
    "storage": "Storage",
    "stream": "Stream",
    "streamInput": "StreamInput",
    "streamInputOutput": "StreamInputOutput",
    "streamOutput": "StreamOutput",
    "styleGuide": "StyleGuide",
    "subGrid": "SubGrid",
    "subtitles": "Subtitles",
    "surfaceEarbuds": "SurfaceEarbuds",
    "surfaceHub": "SurfaceHub",
    "symbols": "Symbols",
    "syringe": "Syringe",
    "system": "System",
    "tabDesktop": "TabDesktop",
    "tabInprivateAccount": "TabInprivateAccount",
    "table": "Table",
    "tableImage": "TableImage",
    "tableMultiple": "TableMultiple",
    "tablet": "Tablet",
    "tabs": "Tabs",
    "tag": "Tag",
    "tagCircle": "TagCircle",
    "tagMultiple": "TagMultiple",
    "target": "Target",
    "targetArrow": "TargetArrow",
    "teddy": "Teddy",
    "temperature": "Temperature",
    "tent": "Tent",
    "tetrisApp": "TetrisApp",
    "textbox": "Textbox",
    "textQuote": "TextQuote",
    "thinking": "Thinking",
    "thumbDislike": "ThumbDislike",
    "thumbLike": "ThumbLike",
    "ticketDiagonal": "TicketDiagonal",
    "ticketHorizontal": "TicketHorizontal",
    "timeAndWeather": "TimeAndWeather",
    "timeline": "Timeline",
    "timer": "Timer",
    "toolbox": "Toolbox",
    "topSpeed": "TopSpeed",
    "translate": "Translate",
    "transmission": "Transmission",
    "treeDeciduous": "TreeDeciduous",
    "treeEvergreen": "TreeEvergreen",
    "trophy": "Trophy",
    "tv": "Tv",
    "tvUsb": "TvUsb",
    "umbrella": "Umbrella",
    "usbPlug": "UsbPlug",
    "usbStick": "UsbStick",
    "vault": "Vault",
    "vehicleBicycle": "VehicleBicycle",
    "vehicleBus": "VehicleBus",
    "vehicleCab": "VehicleCab",
    "vehicleCar": "VehicleCar",
    "vehicleCarCollision": "VehicleCarCollision",
    "vehicleCarProfileLtr": "VehicleCarProfileLtr",
    "vehicleCarProfileRtl": "VehicleCarProfileRtl",
    "vehicleShip": "VehicleShip",
    "vehicleSubway": "VehicleSubway",
    "vehicleTruck": "VehicleTruck",
    "vehicleTruckBag": "VehicleTruckBag",
    "vehicleTruckCube": "VehicleTruckCube",
    "vehicleTruckProfile": "VehicleTruckProfile",
    "video": "Video",
    "video360": "Video360",
    "videoChat": "VideoChat",
    "videoClip": "VideoClip",
    "videoClipMultiple": "VideoClipMultiple",
    "videoPerson": "VideoPerson",
    "videoRecording": "VideoRecording",
    "videoSecurity": "VideoSecurity",
    "viewDesktop": "ViewDesktop",
    "viewDesktopMobile": "ViewDesktopMobile",
    "violin": "Violin",
    "virtualNetwork": "VirtualNetwork",
    "voicemail": "Voicemail",
    "vote": "Vote",
    "walkieTalkie": "WalkieTalkie",
    "wallet": "Wallet",
    "walletCreditCard": "WalletCreditCard",
    "wallpaper": "Wallpaper",
    "wand": "Wand",
    "warning": "Warning",
    "weatherBlowingSnow": "WeatherBlowingSnow",
    "weatherCloudy": "WeatherCloudy",
    "weatherDrizzle": "WeatherDrizzle",
    "weatherDuststorm": "WeatherDuststorm",
    "weatherFog": "WeatherFog",
    "weatherHailDay": "WeatherHailDay",
    "weatherHailNight": "WeatherHailNight",
    "weatherHaze": "WeatherHaze",
    "weatherMoon": "WeatherMoon",
    "weatherPartlyCloudyDay": "WeatherPartlyCloudyDay",
    "weatherPartlyCloudyNight": "WeatherPartlyCloudyNight",
    "weatherRain": "WeatherRain",
    "weatherRainShowersDay": "WeatherRainShowersDay",
    "weatherRainShowersNight": "WeatherRainShowersNight",
    "weatherRainSnow": "WeatherRainSnow",
    "weatherSnow": "WeatherSnow",
    "weatherSnowflake": "WeatherSnowflake",
    "weatherSnowShowerDay": "WeatherSnowShowerDay",
    "weatherSnowShowerNight": "WeatherSnowShowerNight",
    "weatherSqualls": "WeatherSqualls",
    "weatherSunnyHigh": "WeatherSunnyHigh",
    "weatherSunnyLow": "WeatherSunnyLow",
    "weatherThunderstorm": "WeatherThunderstorm",
    "webAsset": "WebAsset",
    "whiteboard": "Whiteboard",
    "wifi1": "Wifi1",
    "wifi2": "Wifi2",
    "window": "Window",
    "windowMultiple": "WindowMultiple",
    "windowWrench": "WindowWrench",
    "wrench": "Wrench",
    "wrenchScrewdriver": "WrenchScrewdriver",
    "xray": "Xray",
    "yoga": "Yoga",
  });

  install(Excel, "ErrorCellValueType", {
    "blocked": "Blocked",
    "busy": "Busy",
    "calc": "Calc",
    "connect": "Connect",
    "div0": "Div0",
    "external": "External",
    "field": "Field",
    "gettingData": "GettingData",
    "notAvailable": "NotAvailable",
    "name": "Name",
    "null": "Null",
    "num": "Num",
    "placeholder": "Placeholder",
    "ref": "Ref",
    "spill": "Spill",
    "value": "Value",
  });

  install(Excel, "ErrorCodes", {
    "accessDenied": "AccessDenied",
    "apiNotFound": "ApiNotFound",
    "conflict": "Conflict",
    "emptyChartSeries": "EmptyChartSeries",
    "filteredRangeConflict": "FilteredRangeConflict",
    "formulaLengthExceedsLimit": "FormulaLengthExceedsLimit",
    "generalException": "GeneralException",
    "inactiveWorkbook": "InactiveWorkbook",
    "insertDeleteConflict": "InsertDeleteConflict",
    "invalidArgument": "InvalidArgument",
    "invalidBinding": "InvalidBinding",
    "invalidOperation": "InvalidOperation",
    "invalidReference": "InvalidReference",
    "invalidSelection": "InvalidSelection",
    "itemAlreadyExists": "ItemAlreadyExists",
    "itemNotFound": "ItemNotFound",
    "mergedRangeConflict": "MergedRangeConflict",
    "nonBlankCellOffSheet": "NonBlankCellOffSheet",
    "notImplemented": "NotImplemented",
    "openWorkbookLinksBlocked": "OpenWorkbookLinksBlocked",
    "operationCellsExceedLimit": "OperationCellsExceedLimit",
    "pivotTableRangeConflict": "PivotTableRangeConflict",
    "powerQueryRefreshResourceChallenge": "PowerQueryRefreshResourceChallenge",
    "rangeExceedsLimit": "RangeExceedsLimit",
    "rangeImageExceedsLimit": "RangeImageExceedsLimit",
    "refreshWorkbookLinksBlocked": "RefreshWorkbookLinksBlocked",
    "requestAborted": "RequestAborted",
    "responsePayloadSizeLimitExceeded": "ResponsePayloadSizeLimitExceeded",
    "unsupportedFeature": "UnsupportedFeature",
    "unsupportedFillType": "UnsupportedFillType",
    "unsupportedOperation": "UnsupportedOperation",
    "unsupportedSheet": "UnsupportedSheet",
    "invalidOperationInCellEditMode": "InvalidOperationInCellEditMode",
  });

  install(Excel, "EventSource", {
    "local": "Local",
    "remote": "Remote",
  });

  install(Excel, "EventTriggerSource", {
    "unknown": "Unknown",
    "thisLocalAddin": "ThisLocalAddin",
  });

  install(Excel, "EventType", {
    "worksheetChanged": "WorksheetChanged",
    "worksheetSelectionChanged": "WorksheetSelectionChanged",
    "worksheetAdded": "WorksheetAdded",
    "worksheetActivated": "WorksheetActivated",
    "worksheetDeactivated": "WorksheetDeactivated",
    "tableChanged": "TableChanged",
    "tableSelectionChanged": "TableSelectionChanged",
    "worksheetDeleted": "WorksheetDeleted",
    "chartAdded": "ChartAdded",
    "chartActivated": "ChartActivated",
    "chartDeactivated": "ChartDeactivated",
    "chartDeleted": "ChartDeleted",
    "worksheetCalculated": "WorksheetCalculated",
    "visualSelectionChanged": "VisualSelectionChanged",
    "tableAdded": "TableAdded",
    "tableDeleted": "TableDeleted",
    "tableFiltered": "TableFiltered",
    "worksheetFiltered": "WorksheetFiltered",
    "shapeActivated": "ShapeActivated",
    "shapeDeactivated": "ShapeDeactivated",
    "visualChange": "VisualChange",
    "workbookAutoSaveSettingChanged": "WorkbookAutoSaveSettingChanged",
    "worksheetFormatChanged": "WorksheetFormatChanged",
    "ribbonCommandExecuted": "RibbonCommandExecuted",
    "worksheetRowSorted": "WorksheetRowSorted",
    "worksheetColumnSorted": "WorksheetColumnSorted",
    "worksheetSingleClicked": "WorksheetSingleClicked",
    "worksheetRowHiddenChanged": "WorksheetRowHiddenChanged",
    "commentAdded": "CommentAdded",
    "commentDeleted": "CommentDeleted",
    "commentChanged": "CommentChanged",
    "worksheetFormulaChanged": "WorksheetFormulaChanged",
    "workbookActivated": "WorkbookActivated",
    "linkedWorkbookWorkbookLinksChanged": "LinkedWorkbookWorkbookLinksChanged",
    "linkedWorkbookRefreshCompleted": "LinkedWorkbookRefreshCompleted",
    "worksheetProtectionChanged": "WorksheetProtectionChanged",
    "worksheetNameChanged": "WorksheetNameChanged",
    "worksheetVisibilityChanged": "WorksheetVisibilityChanged",
    "worksheetMoved": "WorksheetMoved",
    "linkedEntityDataDomainLinkedEntityDataDomainAdded": "LinkedEntityDataDomainLinkedEntityDataDomainAdded",
    "linkedEntityDataDomainRefreshCompleted": "LinkedEntityDataDomainRefreshCompleted",
    "linkedEntityDataDomainRefreshModeChanged": "LinkedEntityDataDomainRefreshModeChanged",
  });

  install(Excel, "ExternalErrorCellValueSubType", {
    "unknown": "Unknown",
  });

  install(Excel, "FieldErrorCellValueSubType", {
    "unknown": "Unknown",
    "webImageMissingFilePart": "WebImageMissingFilePart",
    "dataProviderError": "DataProviderError",
    "richValueRelMissingFilePart": "RichValueRelMissingFilePart",
  });

  install(Excel, "FillPattern", {
    "none": "None",
    "solid": "Solid",
    "gray50": "Gray50",
    "gray75": "Gray75",
    "gray25": "Gray25",
    "horizontal": "Horizontal",
    "vertical": "Vertical",
    "down": "Down",
    "up": "Up",
    "checker": "Checker",
    "semiGray75": "SemiGray75",
    "lightHorizontal": "LightHorizontal",
    "lightVertical": "LightVertical",
    "lightDown": "LightDown",
    "lightUp": "LightUp",
    "grid": "Grid",
    "crissCross": "CrissCross",
    "gray16": "Gray16",
    "gray8": "Gray8",
    "linearGradient": "LinearGradient",
    "rectangularGradient": "RectangularGradient",
  });

  install(Excel, "FilterDatetimeSpecificity", {
    "year": "Year",
    "month": "Month",
    "day": "Day",
    "hour": "Hour",
    "minute": "Minute",
    "second": "Second",
  });

  install(Excel, "FilterOn", {
    "bottomItems": "BottomItems",
    "bottomPercent": "BottomPercent",
    "cellColor": "CellColor",
    "dynamic": "Dynamic",
    "fontColor": "FontColor",
    "values": "Values",
    "topItems": "TopItems",
    "topPercent": "TopPercent",
    "icon": "Icon",
    "custom": "Custom",
  });

  install(Excel, "FilterOperator", {
    "and": "And",
    "or": "Or",
  });

  install(Excel, "FunctionCellValueType", {
    "javaScriptReference": "JavaScriptReference",
  });

  install(Excel, "GeometricShapeType", {
    "lineInverse": "LineInverse",
    "triangle": "Triangle",
    "rightTriangle": "RightTriangle",
    "rectangle": "Rectangle",
    "diamond": "Diamond",
    "parallelogram": "Parallelogram",
    "trapezoid": "Trapezoid",
    "nonIsoscelesTrapezoid": "NonIsoscelesTrapezoid",
    "pentagon": "Pentagon",
    "hexagon": "Hexagon",
    "heptagon": "Heptagon",
    "octagon": "Octagon",
    "decagon": "Decagon",
    "dodecagon": "Dodecagon",
    "star4": "Star4",
    "star5": "Star5",
    "star6": "Star6",
    "star7": "Star7",
    "star8": "Star8",
    "star10": "Star10",
    "star12": "Star12",
    "star16": "Star16",
    "star24": "Star24",
    "star32": "Star32",
    "roundRectangle": "RoundRectangle",
    "round1Rectangle": "Round1Rectangle",
    "round2SameRectangle": "Round2SameRectangle",
    "round2DiagonalRectangle": "Round2DiagonalRectangle",
    "snipRoundRectangle": "SnipRoundRectangle",
    "snip1Rectangle": "Snip1Rectangle",
    "snip2SameRectangle": "Snip2SameRectangle",
    "snip2DiagonalRectangle": "Snip2DiagonalRectangle",
    "plaque": "Plaque",
    "ellipse": "Ellipse",
    "teardrop": "Teardrop",
    "homePlate": "HomePlate",
    "chevron": "Chevron",
    "pieWedge": "PieWedge",
    "pie": "Pie",
    "blockArc": "BlockArc",
    "donut": "Donut",
    "noSmoking": "NoSmoking",
    "rightArrow": "RightArrow",
    "leftArrow": "LeftArrow",
    "upArrow": "UpArrow",
    "downArrow": "DownArrow",
    "stripedRightArrow": "StripedRightArrow",
    "notchedRightArrow": "NotchedRightArrow",
    "bentUpArrow": "BentUpArrow",
    "leftRightArrow": "LeftRightArrow",
    "upDownArrow": "UpDownArrow",
    "leftUpArrow": "LeftUpArrow",
    "leftRightUpArrow": "LeftRightUpArrow",
    "quadArrow": "QuadArrow",
    "leftArrowCallout": "LeftArrowCallout",
    "rightArrowCallout": "RightArrowCallout",
    "upArrowCallout": "UpArrowCallout",
    "downArrowCallout": "DownArrowCallout",
    "leftRightArrowCallout": "LeftRightArrowCallout",
    "upDownArrowCallout": "UpDownArrowCallout",
    "quadArrowCallout": "QuadArrowCallout",
    "bentArrow": "BentArrow",
    "uturnArrow": "UturnArrow",
    "circularArrow": "CircularArrow",
    "leftCircularArrow": "LeftCircularArrow",
    "leftRightCircularArrow": "LeftRightCircularArrow",
    "curvedRightArrow": "CurvedRightArrow",
    "curvedLeftArrow": "CurvedLeftArrow",
    "curvedUpArrow": "CurvedUpArrow",
    "curvedDownArrow": "CurvedDownArrow",
    "swooshArrow": "SwooshArrow",
    "cube": "Cube",
    "can": "Can",
    "lightningBolt": "LightningBolt",
    "heart": "Heart",
    "sun": "Sun",
    "moon": "Moon",
    "smileyFace": "SmileyFace",
    "irregularSeal1": "IrregularSeal1",
    "irregularSeal2": "IrregularSeal2",
    "foldedCorner": "FoldedCorner",
    "bevel": "Bevel",
    "frame": "Frame",
    "halfFrame": "HalfFrame",
    "corner": "Corner",
    "diagonalStripe": "DiagonalStripe",
    "chord": "Chord",
    "arc": "Arc",
    "leftBracket": "LeftBracket",
    "rightBracket": "RightBracket",
    "leftBrace": "LeftBrace",
    "rightBrace": "RightBrace",
    "bracketPair": "BracketPair",
    "bracePair": "BracePair",
    "callout1": "Callout1",
    "callout2": "Callout2",
    "callout3": "Callout3",
    "accentCallout1": "AccentCallout1",
    "accentCallout2": "AccentCallout2",
    "accentCallout3": "AccentCallout3",
    "borderCallout1": "BorderCallout1",
    "borderCallout2": "BorderCallout2",
    "borderCallout3": "BorderCallout3",
    "accentBorderCallout1": "AccentBorderCallout1",
    "accentBorderCallout2": "AccentBorderCallout2",
    "accentBorderCallout3": "AccentBorderCallout3",
    "wedgeRectCallout": "WedgeRectCallout",
    "wedgeRRectCallout": "WedgeRRectCallout",
    "wedgeEllipseCallout": "WedgeEllipseCallout",
    "cloudCallout": "CloudCallout",
    "cloud": "Cloud",
    "ribbon": "Ribbon",
    "ribbon2": "Ribbon2",
    "ellipseRibbon": "EllipseRibbon",
    "ellipseRibbon2": "EllipseRibbon2",
    "leftRightRibbon": "LeftRightRibbon",
    "verticalScroll": "VerticalScroll",
    "horizontalScroll": "HorizontalScroll",
    "wave": "Wave",
    "doubleWave": "DoubleWave",
    "plus": "Plus",
    "flowChartProcess": "FlowChartProcess",
    "flowChartDecision": "FlowChartDecision",
    "flowChartInputOutput": "FlowChartInputOutput",
    "flowChartPredefinedProcess": "FlowChartPredefinedProcess",
    "flowChartInternalStorage": "FlowChartInternalStorage",
    "flowChartDocument": "FlowChartDocument",
    "flowChartMultidocument": "FlowChartMultidocument",
    "flowChartTerminator": "FlowChartTerminator",
    "flowChartPreparation": "FlowChartPreparation",
    "flowChartManualInput": "FlowChartManualInput",
    "flowChartManualOperation": "FlowChartManualOperation",
    "flowChartConnector": "FlowChartConnector",
    "flowChartPunchedCard": "FlowChartPunchedCard",
    "flowChartPunchedTape": "FlowChartPunchedTape",
    "flowChartSummingJunction": "FlowChartSummingJunction",
    "flowChartOr": "FlowChartOr",
    "flowChartCollate": "FlowChartCollate",
    "flowChartSort": "FlowChartSort",
    "flowChartExtract": "FlowChartExtract",
    "flowChartMerge": "FlowChartMerge",
    "flowChartOfflineStorage": "FlowChartOfflineStorage",
    "flowChartOnlineStorage": "FlowChartOnlineStorage",
    "flowChartMagneticTape": "FlowChartMagneticTape",
    "flowChartMagneticDisk": "FlowChartMagneticDisk",
    "flowChartMagneticDrum": "FlowChartMagneticDrum",
    "flowChartDisplay": "FlowChartDisplay",
    "flowChartDelay": "FlowChartDelay",
    "flowChartAlternateProcess": "FlowChartAlternateProcess",
    "flowChartOffpageConnector": "FlowChartOffpageConnector",
    "actionButtonBlank": "ActionButtonBlank",
    "actionButtonHome": "ActionButtonHome",
    "actionButtonHelp": "ActionButtonHelp",
    "actionButtonInformation": "ActionButtonInformation",
    "actionButtonForwardNext": "ActionButtonForwardNext",
    "actionButtonBackPrevious": "ActionButtonBackPrevious",
    "actionButtonEnd": "ActionButtonEnd",
    "actionButtonBeginning": "ActionButtonBeginning",
    "actionButtonReturn": "ActionButtonReturn",
    "actionButtonDocument": "ActionButtonDocument",
    "actionButtonSound": "ActionButtonSound",
    "actionButtonMovie": "ActionButtonMovie",
    "gear6": "Gear6",
    "gear9": "Gear9",
    "funnel": "Funnel",
    "mathPlus": "MathPlus",
    "mathMinus": "MathMinus",
    "mathMultiply": "MathMultiply",
    "mathDivide": "MathDivide",
    "mathEqual": "MathEqual",
    "mathNotEqual": "MathNotEqual",
    "cornerTabs": "CornerTabs",
    "squareTabs": "SquareTabs",
    "plaqueTabs": "PlaqueTabs",
    "chartX": "ChartX",
    "chartStar": "ChartStar",
    "chartPlus": "ChartPlus",
  });

  install(Excel, "GroupOption", {
    "byRows": "ByRows",
    "byColumns": "ByColumns",
  });

  install(Excel, "HeaderFooterState", {
    "default": "Default",
    "firstAndDefault": "FirstAndDefault",
    "oddAndEven": "OddAndEven",
    "firstOddAndEven": "FirstOddAndEven",
  });

  install(Excel, "HorizontalAlignment", {
    "general": "General",
    "left": "Left",
    "center": "Center",
    "right": "Right",
    "fill": "Fill",
    "justify": "Justify",
    "centerAcrossSelection": "CenterAcrossSelection",
    "distributed": "Distributed",
  });

  install(Excel, "IconSet", {
    "invalid": "Invalid",
    "threeArrows": "ThreeArrows",
    "threeArrowsGray": "ThreeArrowsGray",
    "threeFlags": "ThreeFlags",
    "threeTrafficLights1": "ThreeTrafficLights1",
    "threeTrafficLights2": "ThreeTrafficLights2",
    "threeSigns": "ThreeSigns",
    "threeSymbols": "ThreeSymbols",
    "threeSymbols2": "ThreeSymbols2",
    "fourArrows": "FourArrows",
    "fourArrowsGray": "FourArrowsGray",
    "fourRedToBlack": "FourRedToBlack",
    "fourRating": "FourRating",
    "fourTrafficLights": "FourTrafficLights",
    "fiveArrows": "FiveArrows",
    "fiveArrowsGray": "FiveArrowsGray",
    "fiveRating": "FiveRating",
    "fiveQuarters": "FiveQuarters",
    "threeStars": "ThreeStars",
    "threeTriangles": "ThreeTriangles",
    "fiveBoxes": "FiveBoxes",
  });

  install(Excel, "ImageFittingMode", {
    "fit": "Fit",
    "fitAndCenter": "FitAndCenter",
    "fill": "Fill",
  });

  install(Excel, "InsertShiftDirection", {
    "down": "Down",
    "right": "Right",
  });

  install(Excel, "KeyboardDirection", {
    "left": "Left",
    "right": "Right",
    "up": "Up",
    "down": "Down",
  });

  install(Excel, "LabelFilterCondition", {
    "unknown": "Unknown",
    "equals": "Equals",
    "beginsWith": "BeginsWith",
    "endsWith": "EndsWith",
    "contains": "Contains",
    "greaterThan": "GreaterThan",
    "greaterThanOrEqualTo": "GreaterThanOrEqualTo",
    "lessThan": "LessThan",
    "lessThanOrEqualTo": "LessThanOrEqualTo",
    "between": "Between",
  });

  install(Excel, "LinkedDataTypeState", {
    "none": "None",
    "validLinkedData": "ValidLinkedData",
    "disambiguationNeeded": "DisambiguationNeeded",
    "brokenLinkedData": "BrokenLinkedData",
    "fetchingData": "FetchingData",
  });

  install(Excel, "LinkedEntityDataDomainRefreshMode", {
    "unknown": "Unknown",
    "manual": "Manual",
    "onLoad": "OnLoad",
    "periodic": "Periodic",
  });

  install(Excel, "LoadToType", {
    "connectionOnly": "ConnectionOnly",
    "table": "Table",
    "pivotTable": "PivotTable",
    "pivotChart": "PivotChart",
  });

  install(Excel, "NamedItemScope", {
    "worksheet": "Worksheet",
    "workbook": "Workbook",
  });

  install(Excel, "NamedItemType", {
    "string": "String",
    "integer": "Integer",
    "double": "Double",
    "boolean": "Boolean",
    "range": "Range",
    "error": "Error",
    "array": "Array",
  });

  install(Excel, "NumberFormatCategory", {
    "general": "General",
    "number": "Number",
    "currency": "Currency",
    "accounting": "Accounting",
    "date": "Date",
    "time": "Time",
    "percentage": "Percentage",
    "fraction": "Fraction",
    "scientific": "Scientific",
    "text": "Text",
    "special": "Special",
    "custom": "Custom",
  });

  install(Excel, "NumErrorCellValueSubType", {
    "unknown": "Unknown",
    "arrayTooLarge": "ArrayTooLarge",
  });

  install(Excel, "PageOrientation", {
    "portrait": "Portrait",
    "landscape": "Landscape",
  });

  install(Excel, "PaperType", {
    "letter": "Letter",
    "letterSmall": "LetterSmall",
    "tabloid": "Tabloid",
    "ledger": "Ledger",
    "legal": "Legal",
    "statement": "Statement",
    "executive": "Executive",
    "a3": "A3",
    "a4": "A4",
    "a4Small": "A4Small",
    "a5": "A5",
    "b4": "B4",
    "b5": "B5",
    "folio": "Folio",
    "quatro": "Quatro",
    "paper10x14": "Paper10x14",
    "paper11x17": "Paper11x17",
    "note": "Note",
    "envelope9": "Envelope9",
    "envelope10": "Envelope10",
    "envelope11": "Envelope11",
    "envelope12": "Envelope12",
    "envelope14": "Envelope14",
    "csheet": "Csheet",
    "dsheet": "Dsheet",
    "esheet": "Esheet",
    "envelopeDL": "EnvelopeDL",
    "envelopeC5": "EnvelopeC5",
    "envelopeC3": "EnvelopeC3",
    "envelopeC4": "EnvelopeC4",
    "envelopeC6": "EnvelopeC6",
    "envelopeC65": "EnvelopeC65",
    "envelopeB4": "EnvelopeB4",
    "envelopeB5": "EnvelopeB5",
    "envelopeB6": "EnvelopeB6",
    "envelopeItaly": "EnvelopeItaly",
    "envelopeMonarch": "EnvelopeMonarch",
    "envelopePersonal": "EnvelopePersonal",
    "fanfoldUS": "FanfoldUS",
    "fanfoldStdGerman": "FanfoldStdGerman",
    "fanfoldLegalGerman": "FanfoldLegalGerman",
  });

  install(Excel, "PictureColorType", {
    "mixed": "Mixed",
    "automatic": "Automatic",
    "grayScale": "GrayScale",
    "blackAndWhite": "BlackAndWhite",
    "watermark": "Watermark",
  });

  install(Excel, "PictureFormat", {
    "unknown": "UNKNOWN",
    "bmp": "BMP",
    "jpeg": "JPEG",
    "gif": "GIF",
    "png": "PNG",
    "svg": "SVG",
  });

  install(Excel, "PivotAxis", {
    "unknown": "Unknown",
    "row": "Row",
    "column": "Column",
    "data": "Data",
    "filter": "Filter",
  });

  install(Excel, "PivotFilterTopBottomCriterion", {
    "invalid": "Invalid",
    "topItems": "TopItems",
    "topPercent": "TopPercent",
    "topSum": "TopSum",
    "bottomItems": "BottomItems",
    "bottomPercent": "BottomPercent",
    "bottomSum": "BottomSum",
  });

  install(Excel, "PivotFilterType", {
    "unknown": "Unknown",
    "value": "Value",
    "manual": "Manual",
    "label": "Label",
    "date": "Date",
  });

  install(Excel, "PivotLayoutType", {
    "compact": "Compact",
    "tabular": "Tabular",
    "outline": "Outline",
  });

  install(Excel, "Placement", {
    "twoCell": "TwoCell",
    "oneCell": "OneCell",
    "absolute": "Absolute",
  });

  install(Excel, "PrintComments", {
    "noComments": "NoComments",
    "endSheet": "EndSheet",
    "inPlace": "InPlace",
  });

  install(Excel, "PrintErrorType", {
    "asDisplayed": "AsDisplayed",
    "blank": "Blank",
    "dash": "Dash",
    "notAvailable": "NotAvailable",
  });

  install(Excel, "PrintMarginUnit", {
    "points": "Points",
    "inches": "Inches",
    "centimeters": "Centimeters",
  });

  install(Excel, "PrintOrder", {
    "downThenOver": "DownThenOver",
    "overThenDown": "OverThenDown",
  });

  install(Excel, "ProtectionSelectionMode", {
    "normal": "Normal",
    "unlocked": "Unlocked",
    "none": "None",
  });

  install(Excel, "QueryError", {
    "unknown": "Unknown",
    "none": "None",
    "failedLoadToWorksheet": "FailedLoadToWorksheet",
    "failedLoadToDataModel": "FailedLoadToDataModel",
    "failedDownload": "FailedDownload",
    "failedToCompleteDownload": "FailedToCompleteDownload",
  });

  install(Excel, "RangeCopyType", {
    "all": "All",
    "formulas": "Formulas",
    "values": "Values",
    "formats": "Formats",
    "link": "Link",
  });

  install(Excel, "RangeUnderlineStyle", {
    "none": "None",
    "single": "Single",
    "double": "Double",
    "singleAccountant": "SingleAccountant",
    "doubleAccountant": "DoubleAccountant",
  });

  install(Excel, "RangeValueType", {
    "unknown": "Unknown",
    "empty": "Empty",
    "string": "String",
    "integer": "Integer",
    "double": "Double",
    "boolean": "Boolean",
    "error": "Error",
    "richValue": "RichValue",
  });

  install(Excel, "ReadingOrder", {
    "context": "Context",
    "leftToRight": "LeftToRight",
    "rightToLeft": "RightToLeft",
  });

  install(Excel, "ReferenceValueType", {
    "array": "Array",
    "entity": "Entity",
    "root": "Root",
    "double": "Double",
    "string": "String",
    "boolean": "Boolean",
  });

  install(Excel, "RefErrorCellValueSubType", {
    "unknown": "Unknown",
    "externalLinksStructuredRef": "ExternalLinksStructuredRef",
    "externalLinksCalculatedRef": "ExternalLinksCalculatedRef",
  });

  install(Excel, "RibbonTab", {
    "others": "Others",
    "home": "Home",
    "insert": "Insert",
    "draw": "Draw",
    "pageLayout": "PageLayout",
    "formulas": "Formulas",
    "data": "Data",
    "review": "Review",
    "view": "View",
    "developer": "Developer",
    "addIns": "AddIns",
    "help": "Help",
  });

  install(Excel, "RowHiddenChangeType", {
    "unhidden": "Unhidden",
    "hidden": "Hidden",
  });

  install(Excel, "SaveBehavior", {
    "save": "Save",
    "prompt": "Prompt",
  });

  install(Excel, "ScrollWorkbookTabPosition", {
    "first": "First",
    "last": "Last",
  });

  install(Excel, "SearchDirection", {
    "forward": "Forward",
    "backwards": "Backwards",
  });

  install(Excel, "ShapeAutoSize", {
    "autoSizeNone": "AutoSizeNone",
    "autoSizeTextToFitShape": "AutoSizeTextToFitShape",
    "autoSizeShapeToFitText": "AutoSizeShapeToFitText",
    "autoSizeMixed": "AutoSizeMixed",
  });

  install(Excel, "ShapeFillType", {
    "noFill": "NoFill",
    "solid": "Solid",
    "gradient": "Gradient",
    "pattern": "Pattern",
    "pictureAndTexture": "PictureAndTexture",
    "mixed": "Mixed",
  });

  install(Excel, "ShapeFontUnderlineStyle", {
    "none": "None",
    "single": "Single",
    "double": "Double",
    "heavy": "Heavy",
    "dotted": "Dotted",
    "dottedHeavy": "DottedHeavy",
    "dash": "Dash",
    "dashHeavy": "DashHeavy",
    "dashLong": "DashLong",
    "dashLongHeavy": "DashLongHeavy",
    "dotDash": "DotDash",
    "dotDashHeavy": "DotDashHeavy",
    "dotDotDash": "DotDotDash",
    "dotDotDashHeavy": "DotDotDashHeavy",
    "wavy": "Wavy",
    "wavyHeavy": "WavyHeavy",
    "wavyDouble": "WavyDouble",
  });

  install(Excel, "ShapeLineDashStyle", {
    "dash": "Dash",
    "dashDot": "DashDot",
    "dashDotDot": "DashDotDot",
    "longDash": "LongDash",
    "longDashDot": "LongDashDot",
    "roundDot": "RoundDot",
    "solid": "Solid",
    "squareDot": "SquareDot",
    "longDashDotDot": "LongDashDotDot",
    "systemDash": "SystemDash",
    "systemDot": "SystemDot",
    "systemDashDot": "SystemDashDot",
  });

  install(Excel, "ShapeLineStyle", {
    "single": "Single",
    "thickBetweenThin": "ThickBetweenThin",
    "thickThin": "ThickThin",
    "thinThick": "ThinThick",
    "thinThin": "ThinThin",
  });

  install(Excel, "ShapeScaleFrom", {
    "scaleFromTopLeft": "ScaleFromTopLeft",
    "scaleFromMiddle": "ScaleFromMiddle",
    "scaleFromBottomRight": "ScaleFromBottomRight",
  });

  install(Excel, "ShapeScaleType", {
    "currentSize": "CurrentSize",
    "originalSize": "OriginalSize",
  });

  install(Excel, "ShapeTextHorizontalAlignment", {
    "left": "Left",
    "center": "Center",
    "right": "Right",
    "justify": "Justify",
    "justifyLow": "JustifyLow",
    "distributed": "Distributed",
    "thaiDistributed": "ThaiDistributed",
  });

  install(Excel, "ShapeTextHorizontalOverflow", {
    "overflow": "Overflow",
    "clip": "Clip",
  });

  install(Excel, "ShapeTextOrientation", {
    "horizontal": "Horizontal",
    "vertical": "Vertical",
    "vertical270": "Vertical270",
    "wordArtVertical": "WordArtVertical",
    "eastAsianVertical": "EastAsianVertical",
    "mongolianVertical": "MongolianVertical",
    "wordArtVerticalRTL": "WordArtVerticalRTL",
  });

  install(Excel, "ShapeTextReadingOrder", {
    "leftToRight": "LeftToRight",
    "rightToLeft": "RightToLeft",
  });

  install(Excel, "ShapeTextVerticalAlignment", {
    "top": "Top",
    "middle": "Middle",
    "bottom": "Bottom",
    "justified": "Justified",
    "distributed": "Distributed",
  });

  install(Excel, "ShapeTextVerticalOverflow", {
    "overflow": "Overflow",
    "ellipsis": "Ellipsis",
    "clip": "Clip",
  });

  install(Excel, "ShapeType", {
    "unsupported": "Unsupported",
    "image": "Image",
    "geometricShape": "GeometricShape",
    "group": "Group",
    "line": "Line",
  });

  install(Excel, "ShapeZOrder", {
    "bringToFront": "BringToFront",
    "bringForward": "BringForward",
    "sendToBack": "SendToBack",
    "sendBackward": "SendBackward",
  });

  install(Excel, "SheetVisibility", {
    "visible": "Visible",
    "hidden": "Hidden",
    "veryHidden": "VeryHidden",
  });

  install(Excel, "ShowAsCalculation", {
    "unknown": "Unknown",
    "none": "None",
    "percentOfGrandTotal": "PercentOfGrandTotal",
    "percentOfRowTotal": "PercentOfRowTotal",
    "percentOfColumnTotal": "PercentOfColumnTotal",
    "percentOfParentRowTotal": "PercentOfParentRowTotal",
    "percentOfParentColumnTotal": "PercentOfParentColumnTotal",
    "percentOfParentTotal": "PercentOfParentTotal",
    "percentOf": "PercentOf",
    "runningTotal": "RunningTotal",
    "percentRunningTotal": "PercentRunningTotal",
    "differenceFrom": "DifferenceFrom",
    "percentDifferenceFrom": "PercentDifferenceFrom",
    "rankAscending": "RankAscending",
    "rankDecending": "RankDecending",
    "index": "Index",
  });

  install(Excel, "SlicerSortType", {
    "dataSourceOrder": "DataSourceOrder",
    "ascending": "Ascending",
    "descending": "Descending",
  });

  install(Excel, "SortBy", {
    "ascending": "Ascending",
    "descending": "Descending",
  });

  install(Excel, "SortDataOption", {
    "normal": "Normal",
    "textAsNumber": "TextAsNumber",
  });

  install(Excel, "SortMethod", {
    "pinYin": "PinYin",
    "strokeCount": "StrokeCount",
  });

  install(Excel, "SortOn", {
    "value": "Value",
    "cellColor": "CellColor",
    "fontColor": "FontColor",
    "icon": "Icon",
  });

  install(Excel, "SortOrientation", {
    "rows": "Rows",
    "columns": "Columns",
  });

  install(Excel, "SpecialCellType", {
    "conditionalFormats": "ConditionalFormats",
    "dataValidations": "DataValidations",
    "blanks": "Blanks",
    "constants": "Constants",
    "formulas": "Formulas",
    "sameConditionalFormat": "SameConditionalFormat",
    "sameDataValidation": "SameDataValidation",
    "visible": "Visible",
  });

  install(Excel, "SpecialCellValueType", {
    "all": "All",
    "errors": "Errors",
    "errorsLogical": "ErrorsLogical",
    "errorsNumbers": "ErrorsNumbers",
    "errorsText": "ErrorsText",
    "errorsLogicalNumber": "ErrorsLogicalNumber",
    "errorsLogicalText": "ErrorsLogicalText",
    "errorsNumberText": "ErrorsNumberText",
    "logical": "Logical",
    "logicalNumbers": "LogicalNumbers",
    "logicalText": "LogicalText",
    "logicalNumbersText": "LogicalNumbersText",
    "numbers": "Numbers",
    "numbersText": "NumbersText",
    "text": "Text",
  });

  install(Excel, "SpillErrorCellValueSubType", {
    "unknown": "Unknown",
    "collision": "Collision",
    "indeterminateSize": "IndeterminateSize",
    "worksheetEdge": "WorksheetEdge",
    "outOfMemoryWhileCalc": "OutOfMemoryWhileCalc",
    "table": "Table",
    "mergedCell": "MergedCell",
  });

  install(Excel, "SubtotalLocationType", {
    "atTop": "AtTop",
    "atBottom": "AtBottom",
    "off": "Off",
  });

  install(Excel, "TopBottomSelectionType", {
    "items": "Items",
    "percent": "Percent",
    "sum": "Sum",
  });

  install(Excel, "ValueErrorCellValueSubType", {
    "unknown": "Unknown",
    "vlookupColumnIndexLessThanOne": "VlookupColumnIndexLessThanOne",
    "vlookupResultNotFound": "VlookupResultNotFound",
    "hlookupRowIndexLessThanOne": "HlookupRowIndexLessThanOne",
    "hlookupResultNotFound": "HlookupResultNotFound",
    "coerceStringToNumberInvalid": "CoerceStringToNumberInvalid",
    "coerceStringToBoolInvalid": "CoerceStringToBoolInvalid",
    "coerceStringToInvalidType": "CoerceStringToInvalidType",
    "subArrayStartRowMissingEndRowNot": "SubArrayStartRowMissingEndRowNot",
    "subArrayStartColumnMissingEndColumnNot": "SubArrayStartColumnMissingEndColumnNot",
    "invalidImageUrl": "InvalidImageUrl",
    "stockHistoryNonTradingDays": "StockHistoryNonTradingDays",
    "stockHistoryNotAStock": "StockHistoryNotAStock",
    "stockHistoryInvalidDate": "StockHistoryInvalidDate",
    "stockHistoryEndBeforeStart": "StockHistoryEndBeforeStart",
    "stockHistoryStartInFuture": "StockHistoryStartInFuture",
    "stockHistoryInvalidEnum": "StockHistoryInvalidEnum",
    "stockHistoryOnlyDateRequested": "StockHistoryOnlyDateRequested",
    "stockHistoryNotFound": "StockHistoryNotFound",
    "lambdaWrongParamCount": "LambdaWrongParamCount",
  });

  install(Excel, "ValueFilterCondition", {
    "unknown": "Unknown",
    "equals": "Equals",
    "greaterThan": "GreaterThan",
    "greaterThanOrEqualTo": "GreaterThanOrEqualTo",
    "lessThan": "LessThan",
    "lessThanOrEqualTo": "LessThanOrEqualTo",
    "between": "Between",
    "topN": "TopN",
    "bottomN": "BottomN",
  });

  install(Excel, "VerticalAlignment", {
    "top": "Top",
    "center": "Center",
    "bottom": "Bottom",
    "justify": "Justify",
    "distributed": "Distributed",
  });

  install(Excel, "WindowState", {
    "maximized": "maximized",
    "minimized": "minimized",
    "normal": "normal",
  });

  install(Excel, "WindowType", {
    "chartAsWindow": "chartAsWindow",
    "chartInPlace": "chartInPlace",
    "clipboard": "clipboard",
    "workbook": "workbook",
  });

  install(Excel, "WindowView", {
    "normalView": "normalView",
    "pageBreakPreview": "pageBreakPreview",
    "pageLayoutView": "pageLayoutView",
  });

  install(Excel, "WorkbookLinksRefreshMode", {
    "manual": "Manual",
    "automatic": "Automatic",
  });

  install(Excel, "WorksheetPositionType", {
    "none": "None",
    "before": "Before",
    "after": "After",
    "beginning": "Beginning",
    "end": "End",
  });

})(typeof globalThis !== "undefined" ? globalThis : this);
