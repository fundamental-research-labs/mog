//! Preset shape geometry types (ECMA-376 ST_ShapeType).
//!
//! The canonical inventory contains the 187 OOXML `ST_ShapeType` values plus
//! Mog's `TextBox` extension. Historical read aliases, such as
//! `flowChartData`, are accepted separately and never serialize as canonical
//! preset tokens.

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
struct PresetEntry {
    preset: ShapePreset,
    token: &'static str,
}

macro_rules! shape_presets {
    (
        $(
            $(#[$attr:meta])*
            $variant:ident => $token:literal,
        )+
    ) => {
        /// Preset shape geometry (ECMA-376 ST_ShapeType).
        ///
        /// Contains the 187 OOXML `ST_ShapeType` values plus Mog's `TextBox`
        /// extension. Serde serializes to and from canonical OOXML tokens.
        #[derive(
            Debug, Clone, Copy, PartialEq, Eq, Hash, Default, serde::Serialize, serde::Deserialize,
        )]
        #[serde(rename_all = "camelCase")]
        pub enum ShapePreset {
            $(
                $(#[$attr])*
                $variant,
            )+
        }

        /// Total number of canonical shape preset variants.
        ///
        /// This is 187 OOXML `ST_ShapeType` values plus Mog's `TextBox` extension.
        pub const SHAPE_PRESET_COUNT: usize = <[()]>::len(&[$(shape_presets!(@unit $variant)),+]);

        static CANONICAL_PRESETS: [PresetEntry; SHAPE_PRESET_COUNT] = [
            $(
                PresetEntry {
                    preset: ShapePreset::$variant,
                    token: $token,
                },
            )+
        ];

        static ALL_SHAPE_PRESETS: [ShapePreset; SHAPE_PRESET_COUNT] = [
            $(ShapePreset::$variant,)+
        ];
    };
    (@unit $variant:ident) => { () };
}

shape_presets! {

    // -- Basic shapes --------------------------------------------------------
    /// Rectangle.
    #[default]
    Rect => "rect",
    /// Rounded rectangle.
    RoundRect => "roundRect",
    /// Ellipse / oval.
    Ellipse => "ellipse",
    /// Isosceles triangle.
    Triangle => "triangle",
    /// Right triangle (OOXML: `rtTriangle`).
    #[serde(rename = "rtTriangle")]
    RightTriangle => "rtTriangle",
    /// Diamond (rhombus).
    Diamond => "diamond",
    /// Parallelogram.
    Parallelogram => "parallelogram",
    /// Trapezoid.
    Trapezoid => "trapezoid",
    /// Non-isosceles trapezoid.
    NonIsoscelesTrapezoid => "nonIsoscelesTrapezoid",
    /// Pentagon.
    Pentagon => "pentagon",
    /// Hexagon.
    Hexagon => "hexagon",
    /// Heptagon.
    Heptagon => "heptagon",
    /// Octagon.
    Octagon => "octagon",
    /// Decagon.
    Decagon => "decagon",
    /// Dodecagon.
    Dodecagon => "dodecagon",
    /// Pie (sector).
    Pie => "pie",
    /// Chord.
    Chord => "chord",
    /// Teardrop.
    Teardrop => "teardrop",
    /// Plaque.
    Plaque => "plaque",
    /// Home plate.
    HomePlate => "homePlate",
    /// Chevron.
    Chevron => "chevron",
    /// Diagonal stripe.
    DiagStripe => "diagStripe",
    /// Corner.
    Corner => "corner",
    /// Plus / cross sign.
    Plus => "plus",

    // -- Rounded / snipped rectangles ----------------------------------------
    /// Round single-corner rectangle.
    Round1Rect => "round1Rect",
    /// Round two diagonal corners rectangle.
    Round2DiagRect => "round2DiagRect",
    /// Round two same-side corners rectangle.
    Round2SameRect => "round2SameRect",
    /// Snip single-corner rectangle.
    Snip1Rect => "snip1Rect",
    /// Snip two diagonal corners rectangle.
    Snip2DiagRect => "snip2DiagRect",
    /// Snip two same-side corners rectangle.
    Snip2SameRect => "snip2SameRect",
    /// Snip-and-round rectangle.
    SnipRoundRect => "snipRoundRect",

    // -- Lines and connectors ------------------------------------------------
    /// Straight line.
    Line => "line",
    /// Line inverse.
    LineInv => "lineInv",
    /// Straight connector (type 1).
    StraightConnector1 => "straightConnector1",
    /// Bent connector (type 2).
    BentConnector2 => "bentConnector2",
    /// Bent connector (type 3).
    BentConnector3 => "bentConnector3",
    /// Bent connector (type 4).
    BentConnector4 => "bentConnector4",
    /// Bent connector (type 5).
    BentConnector5 => "bentConnector5",
    /// Curved connector (type 2).
    CurvedConnector2 => "curvedConnector2",
    /// Curved connector (type 3).
    CurvedConnector3 => "curvedConnector3",
    /// Curved connector (type 4).
    CurvedConnector4 => "curvedConnector4",
    /// Curved connector (type 5).
    CurvedConnector5 => "curvedConnector5",

    // -- Arrows --------------------------------------------------------------
    /// Right arrow.
    RightArrow => "rightArrow",
    /// Left arrow.
    LeftArrow => "leftArrow",
    /// Up arrow.
    UpArrow => "upArrow",
    /// Down arrow.
    DownArrow => "downArrow",
    /// Left-right arrow.
    LeftRightArrow => "leftRightArrow",
    /// Up-down arrow.
    UpDownArrow => "upDownArrow",
    /// Bent arrow.
    BentArrow => "bentArrow",
    /// Bent-up arrow.
    BentUpArrow => "bentUpArrow",
    /// U-turn arrow (OOXML: `uturnArrow`).
    #[serde(rename = "uturnArrow")]
    UTurnArrow => "uturnArrow",
    /// Quad arrow.
    QuadArrow => "quadArrow",
    /// Left-right-up arrow.
    LeftRightUpArrow => "leftRightUpArrow",
    /// Left-up arrow.
    LeftUpArrow => "leftUpArrow",
    /// Circular arrow.
    CircularArrow => "circularArrow",
    /// Left circular arrow.
    LeftCircularArrow => "leftCircularArrow",
    /// Left-right circular arrow.
    LeftRightCircularArrow => "leftRightCircularArrow",
    /// Curved right arrow.
    CurvedRightArrow => "curvedRightArrow",
    /// Curved left arrow.
    CurvedLeftArrow => "curvedLeftArrow",
    /// Curved up arrow.
    CurvedUpArrow => "curvedUpArrow",
    /// Curved down arrow.
    CurvedDownArrow => "curvedDownArrow",
    /// Striped right arrow.
    StripedRightArrow => "stripedRightArrow",
    /// Notched right arrow.
    NotchedRightArrow => "notchedRightArrow",
    /// Swoosh arrow.
    SwooshArrow => "swooshArrow",

    // -- Arrow callouts ------------------------------------------------------
    /// Right arrow callout.
    RightArrowCallout => "rightArrowCallout",
    /// Left arrow callout.
    LeftArrowCallout => "leftArrowCallout",
    /// Up arrow callout.
    UpArrowCallout => "upArrowCallout",
    /// Down arrow callout.
    DownArrowCallout => "downArrowCallout",
    /// Left-right arrow callout.
    LeftRightArrowCallout => "leftRightArrowCallout",
    /// Up-down arrow callout.
    UpDownArrowCallout => "upDownArrowCallout",
    /// Quad arrow callout.
    QuadArrowCallout => "quadArrowCallout",

    // -- Flowchart -----------------------------------------------------------
    /// Flowchart process.
    FlowChartProcess => "flowChartProcess",
    /// Flowchart alternate process.
    FlowChartAlternateProcess => "flowChartAlternateProcess",
    /// Flowchart decision.
    FlowChartDecision => "flowChartDecision",
    /// Flowchart input/output (data).
    FlowChartInputOutput => "flowChartInputOutput",
    /// Flowchart predefined process.
    FlowChartPredefinedProcess => "flowChartPredefinedProcess",
    /// Flowchart internal storage.
    FlowChartInternalStorage => "flowChartInternalStorage",
    /// Flowchart document.
    FlowChartDocument => "flowChartDocument",
    /// Flowchart multidocument.
    FlowChartMultidocument => "flowChartMultidocument",
    /// Flowchart terminator.
    FlowChartTerminator => "flowChartTerminator",
    /// Flowchart preparation.
    FlowChartPreparation => "flowChartPreparation",
    /// Flowchart manual input.
    FlowChartManualInput => "flowChartManualInput",
    /// Flowchart manual operation.
    FlowChartManualOperation => "flowChartManualOperation",
    /// Flowchart connector.
    FlowChartConnector => "flowChartConnector",
    /// Flowchart off-page connector.
    FlowChartOffpageConnector => "flowChartOffpageConnector",
    /// Flowchart punched card.
    FlowChartPunchedCard => "flowChartPunchedCard",
    /// Flowchart punched tape.
    FlowChartPunchedTape => "flowChartPunchedTape",
    /// Flowchart summing junction.
    FlowChartSummingJunction => "flowChartSummingJunction",
    /// Flowchart OR.
    FlowChartOr => "flowChartOr",
    /// Flowchart collate.
    FlowChartCollate => "flowChartCollate",
    /// Flowchart sort.
    FlowChartSort => "flowChartSort",
    /// Flowchart extract.
    FlowChartExtract => "flowChartExtract",
    /// Flowchart merge.
    FlowChartMerge => "flowChartMerge",
    /// Flowchart online storage.
    FlowChartOnlineStorage => "flowChartOnlineStorage",
    /// Flowchart offline storage.
    FlowChartOfflineStorage => "flowChartOfflineStorage",
    /// Flowchart magnetic tape.
    FlowChartMagneticTape => "flowChartMagneticTape",
    /// Flowchart magnetic disk.
    FlowChartMagneticDisk => "flowChartMagneticDisk",
    /// Flowchart magnetic drum.
    FlowChartMagneticDrum => "flowChartMagneticDrum",
    /// Flowchart display.
    FlowChartDisplay => "flowChartDisplay",
    /// Flowchart delay.
    FlowChartDelay => "flowChartDelay",

    // -- Callouts ------------------------------------------------------------
    /// Callout 1 (line).
    Callout1 => "callout1",
    /// Callout 2 (elbow).
    Callout2 => "callout2",
    /// Callout 3 (double-elbow).
    Callout3 => "callout3",
    /// Accent callout 1.
    AccentCallout1 => "accentCallout1",
    /// Accent callout 2.
    AccentCallout2 => "accentCallout2",
    /// Accent callout 3.
    AccentCallout3 => "accentCallout3",
    /// Border callout 1.
    BorderCallout1 => "borderCallout1",
    /// Border callout 2.
    BorderCallout2 => "borderCallout2",
    /// Border callout 3.
    BorderCallout3 => "borderCallout3",
    /// Accent border callout 1.
    AccentBorderCallout1 => "accentBorderCallout1",
    /// Accent border callout 2.
    AccentBorderCallout2 => "accentBorderCallout2",
    /// Accent border callout 3.
    AccentBorderCallout3 => "accentBorderCallout3",
    /// Wedge rectangle callout.
    WedgeRectCallout => "wedgeRectCallout",
    /// Wedge round-rectangle callout.
    WedgeRoundRectCallout => "wedgeRoundRectCallout",
    /// Wedge ellipse callout.
    WedgeEllipseCallout => "wedgeEllipseCallout",
    /// Cloud callout.
    CloudCallout => "cloudCallout",

    // -- Stars and banners ---------------------------------------------------
    /// 4-pointed star.
    Star4 => "star4",
    /// 5-pointed star.
    Star5 => "star5",
    /// 6-pointed star.
    Star6 => "star6",
    /// 7-pointed star.
    Star7 => "star7",
    /// 8-pointed star.
    Star8 => "star8",
    /// 10-pointed star.
    Star10 => "star10",
    /// 12-pointed star.
    Star12 => "star12",
    /// 16-pointed star.
    Star16 => "star16",
    /// 24-pointed star.
    Star24 => "star24",
    /// 32-pointed star.
    Star32 => "star32",
    /// Ribbon (down).
    Ribbon => "ribbon",
    /// Ribbon 2 (up).
    Ribbon2 => "ribbon2",
    /// Ellipse ribbon.
    EllipseRibbon => "ellipseRibbon",
    /// Ellipse ribbon 2.
    EllipseRibbon2 => "ellipseRibbon2",
    /// Left-right ribbon.
    LeftRightRibbon => "leftRightRibbon",
    /// Vertical scroll.
    VerticalScroll => "verticalScroll",
    /// Horizontal scroll.
    HorizontalScroll => "horizontalScroll",
    /// Wave.
    Wave => "wave",
    /// Double wave.
    DoubleWave => "doubleWave",
    /// Irregular seal 1 (explosion 1).
    IrregularSeal1 => "irregularSeal1",
    /// Irregular seal 2 (explosion 2).
    IrregularSeal2 => "irregularSeal2",

    // -- Math operators ------------------------------------------------------
    /// Math plus.
    MathPlus => "mathPlus",
    /// Math divide.
    MathDivide => "mathDivide",
    /// Math equal.
    MathEqual => "mathEqual",
    /// Math not-equal.
    MathNotEqual => "mathNotEqual",
    /// Math minus.
    MathMinus => "mathMinus",
    /// Math multiply.
    MathMultiply => "mathMultiply",

    // -- Action buttons ------------------------------------------------------
    /// Action button: back/previous.
    ActionButtonBackPrevious => "actionButtonBackPrevious",
    /// Action button: forward/next.
    ActionButtonForwardNext => "actionButtonForwardNext",
    /// Action button: beginning.
    ActionButtonBeginning => "actionButtonBeginning",
    /// Action button: end.
    ActionButtonEnd => "actionButtonEnd",
    /// Action button: home.
    ActionButtonHome => "actionButtonHome",
    /// Action button: information.
    ActionButtonInformation => "actionButtonInformation",
    /// Action button: return.
    ActionButtonReturn => "actionButtonReturn",
    /// Action button: document.
    ActionButtonDocument => "actionButtonDocument",
    /// Action button: sound.
    ActionButtonSound => "actionButtonSound",
    /// Action button: movie.
    ActionButtonMovie => "actionButtonMovie",
    /// Action button: help.
    ActionButtonHelp => "actionButtonHelp",
    /// Action button: blank.
    ActionButtonBlank => "actionButtonBlank",

    // -- Tabs and braces -----------------------------------------------------
    /// Brace pair (OOXML: `bracePair`).
    #[serde(rename = "bracePair")]
    Brace => "bracePair",
    /// Bracket pair (OOXML: `bracketPair`).
    #[serde(rename = "bracketPair")]
    Bracket => "bracketPair",
    /// Left brace.
    LeftBrace => "leftBrace",
    /// Right brace.
    RightBrace => "rightBrace",
    /// Left bracket.
    LeftBracket => "leftBracket",
    /// Right bracket.
    RightBracket => "rightBracket",
    /// Corner tabs.
    CornerTabs => "cornerTabs",
    /// Square tabs.
    SquareTabs => "squareTabs",
    /// Plaque tabs.
    PlaqueTabs => "plaqueTabs",

    // -- Decorative / miscellaneous ------------------------------------------
    /// Heart.
    Heart => "heart",
    /// Lightning bolt (OOXML: `lightningBolt`).
    #[serde(rename = "lightningBolt")]
    Lightning => "lightningBolt",
    /// Sun.
    Sun => "sun",
    /// Moon.
    Moon => "moon",
    /// Cloud.
    Cloud => "cloud",
    /// Arc.
    Arc => "arc",
    /// Block arc.
    BlockArc => "blockArc",
    /// Folded corner.
    FoldedCorner => "foldedCorner",
    /// Smiley face.
    SmileyFace => "smileyFace",
    /// Donut.
    Donut => "donut",
    /// No smoking.
    NoSmoking => "noSmoking",
    /// Can / cylinder.
    Can => "can",
    /// Cube.
    Cube => "cube",
    /// Bevel.
    Bevel => "bevel",
    /// Frame.
    Frame => "frame",
    /// Half frame.
    HalfFrame => "halfFrame",
    /// Funnel.
    Funnel => "funnel",
    /// Gear (6 teeth).
    Gear6 => "gear6",
    /// Gear (9 teeth).
    Gear9 => "gear9",
    /// Pie wedge.
    PieWedge => "pieWedge",
    /// Chart plus.
    ChartPlus => "chartPlus",
    /// Chart star.
    ChartStar => "chartStar",
    /// Chart X.
    ChartX => "chartX",

    // -- Text box (special) --------------------------------------------------
    /// Text box (rendered as rectangle geometry).
    TextBox => "textBox",
}

const READ_ALIASES: &[PresetEntry] = &[PresetEntry {
    preset: ShapePreset::FlowChartInputOutput,
    token: "flowChartData",
}];

impl ShapePreset {
    /// Parse from an OOXML `prst` attribute value.
    ///
    /// Returns `None` for unrecognised strings. Callers that need a fallback
    /// can use `.unwrap_or(ShapePreset::Rect)` or similar. Historical read
    /// aliases are accepted here, but `to_ooxml()` always returns canonical
    /// OOXML tokens.
    #[must_use]
    pub fn from_ooxml(s: &str) -> Option<Self> {
        CANONICAL_PRESETS
            .iter()
            .chain(READ_ALIASES.iter())
            .find_map(|entry| (entry.token == s).then_some(entry.preset))
    }

    /// Serialize to the canonical OOXML `prst` attribute value.
    #[must_use]
    pub fn to_ooxml(&self) -> &'static str {
        CANONICAL_PRESETS
            .iter()
            .find_map(|entry| (entry.preset == *self).then_some(entry.token))
            .expect("every ShapePreset variant has a canonical OOXML token")
    }

    /// Returns all canonical variants in deterministic spec/category order.
    pub fn all_variants() -> &'static [ShapePreset; SHAPE_PRESET_COUNT] {
        &ALL_SHAPE_PRESETS
    }
}
