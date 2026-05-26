//! Preset shape geometry types (ECMA-376 ST_ShapeType).

/// Preset shape geometry (ECMA-376 ST_ShapeType).
///
/// All 186 unique shape presets from the OOXML spec. Serde serializes to/from
/// the OOXML camelCase name via `#[serde(rename_all = "camelCase")]` with
/// explicit `#[serde(rename = "...")]` on variants whose PascalCase->camelCase
/// conversion does not match the OOXML name.
#[derive(
    Debug, Clone, Copy, PartialEq, Eq, Hash, Default, serde::Serialize, serde::Deserialize,
)]
#[serde(rename_all = "camelCase")]
pub enum ShapePreset {
    // -- Basic shapes --------------------------------------------------------
    /// Rectangle.
    #[default]
    Rect,
    /// Rounded rectangle.
    RoundRect,
    /// Ellipse / oval.
    Ellipse,
    /// Isosceles triangle.
    Triangle,
    /// Right triangle (OOXML: `rtTriangle`).
    #[serde(rename = "rtTriangle")]
    RightTriangle,
    /// Diamond (rhombus).
    Diamond,
    /// Parallelogram.
    Parallelogram,
    /// Trapezoid.
    Trapezoid,
    /// Non-isosceles trapezoid.
    NonIsoscelesTrapezoid,
    /// Pentagon.
    Pentagon,
    /// Hexagon.
    Hexagon,
    /// Heptagon.
    Heptagon,
    /// Octagon.
    Octagon,
    /// Decagon.
    Decagon,
    /// Dodecagon.
    Dodecagon,
    /// Pie (sector).
    Pie,
    /// Chord.
    Chord,
    /// Teardrop.
    Teardrop,
    /// Plaque.
    Plaque,
    /// Home plate.
    HomePlate,
    /// Chevron.
    Chevron,
    /// Diagonal stripe.
    DiagStripe,
    /// Corner.
    Corner,
    /// Plus / cross sign.
    Plus,

    // -- Rounded / snipped rectangles ----------------------------------------
    /// Round single-corner rectangle.
    Round1Rect,
    /// Round two diagonal corners rectangle.
    Round2DiagRect,
    /// Round two same-side corners rectangle.
    Round2SameRect,
    /// Snip single-corner rectangle.
    Snip1Rect,
    /// Snip two diagonal corners rectangle.
    Snip2DiagRect,
    /// Snip two same-side corners rectangle.
    Snip2SameRect,
    /// Snip-and-round rectangle.
    SnipRoundRect,

    // -- Lines and connectors ------------------------------------------------
    /// Straight line.
    Line,
    /// Line inverse.
    LineInv,
    /// Straight connector (type 1).
    StraightConnector1,
    /// Bent connector (type 2).
    BentConnector2,
    /// Bent connector (type 3).
    BentConnector3,
    /// Bent connector (type 4).
    BentConnector4,
    /// Bent connector (type 5).
    BentConnector5,
    /// Curved connector (type 2).
    CurvedConnector2,
    /// Curved connector (type 3).
    CurvedConnector3,
    /// Curved connector (type 4).
    CurvedConnector4,
    /// Curved connector (type 5).
    CurvedConnector5,

    // -- Arrows --------------------------------------------------------------
    /// Right arrow.
    RightArrow,
    /// Left arrow.
    LeftArrow,
    /// Up arrow.
    UpArrow,
    /// Down arrow.
    DownArrow,
    /// Left-right arrow.
    LeftRightArrow,
    /// Up-down arrow.
    UpDownArrow,
    /// Bent arrow.
    BentArrow,
    /// Bent-up arrow.
    BentUpArrow,
    /// U-turn arrow (OOXML: `uturnArrow`).
    #[serde(rename = "uturnArrow")]
    UTurnArrow,
    /// Quad arrow.
    QuadArrow,
    /// Left-right-up arrow.
    LeftRightUpArrow,
    /// Left-up arrow.
    LeftUpArrow,
    /// Circular arrow.
    CircularArrow,
    /// Left circular arrow.
    LeftCircularArrow,
    /// Left-right circular arrow.
    LeftRightCircularArrow,
    /// Curved right arrow.
    CurvedRightArrow,
    /// Curved left arrow.
    CurvedLeftArrow,
    /// Curved up arrow.
    CurvedUpArrow,
    /// Curved down arrow.
    CurvedDownArrow,
    /// Striped right arrow.
    StripedRightArrow,
    /// Notched right arrow.
    NotchedRightArrow,
    /// Swoosh arrow.
    SwooshArrow,

    // -- Arrow callouts ------------------------------------------------------
    /// Right arrow callout.
    RightArrowCallout,
    /// Left arrow callout.
    LeftArrowCallout,
    /// Up arrow callout.
    UpArrowCallout,
    /// Down arrow callout.
    DownArrowCallout,
    /// Left-right arrow callout.
    LeftRightArrowCallout,
    /// Up-down arrow callout.
    UpDownArrowCallout,
    /// Quad arrow callout.
    QuadArrowCallout,

    // -- Flowchart -----------------------------------------------------------
    /// Flowchart process.
    FlowChartProcess,
    /// Flowchart alternate process.
    FlowChartAlternateProcess,
    /// Flowchart decision.
    FlowChartDecision,
    /// Flowchart input/output (data).
    FlowChartInputOutput,
    /// Flowchart predefined process.
    FlowChartPredefinedProcess,
    /// Flowchart internal storage.
    FlowChartInternalStorage,
    /// Flowchart document.
    FlowChartDocument,
    /// Flowchart multidocument.
    FlowChartMultidocument,
    /// Flowchart terminator.
    FlowChartTerminator,
    /// Flowchart preparation.
    FlowChartPreparation,
    /// Flowchart manual input.
    FlowChartManualInput,
    /// Flowchart manual operation.
    FlowChartManualOperation,
    /// Flowchart connector.
    FlowChartConnector,
    /// Flowchart off-page connector.
    FlowChartOffpageConnector,
    /// Flowchart punched card.
    FlowChartPunchedCard,
    /// Flowchart punched tape.
    FlowChartPunchedTape,
    /// Flowchart summing junction.
    FlowChartSummingJunction,
    /// Flowchart OR.
    FlowChartOr,
    /// Flowchart collate.
    FlowChartCollate,
    /// Flowchart sort.
    FlowChartSort,
    /// Flowchart extract.
    FlowChartExtract,
    /// Flowchart merge.
    FlowChartMerge,
    /// Flowchart online storage.
    FlowChartOnlineStorage,
    /// Flowchart offline storage.
    FlowChartOfflineStorage,
    /// Flowchart magnetic tape.
    FlowChartMagneticTape,
    /// Flowchart magnetic disk.
    FlowChartMagneticDisk,
    /// Flowchart magnetic drum.
    FlowChartMagneticDrum,
    /// Flowchart display.
    FlowChartDisplay,
    /// Flowchart delay.
    FlowChartDelay,

    // -- Callouts ------------------------------------------------------------
    /// Callout 1 (line).
    Callout1,
    /// Callout 2 (elbow).
    Callout2,
    /// Callout 3 (double-elbow).
    Callout3,
    /// Accent callout 1.
    AccentCallout1,
    /// Accent callout 2.
    AccentCallout2,
    /// Accent callout 3.
    AccentCallout3,
    /// Border callout 1.
    BorderCallout1,
    /// Border callout 2.
    BorderCallout2,
    /// Border callout 3.
    BorderCallout3,
    /// Accent border callout 1.
    AccentBorderCallout1,
    /// Accent border callout 2.
    AccentBorderCallout2,
    /// Accent border callout 3.
    AccentBorderCallout3,
    /// Wedge rectangle callout.
    WedgeRectCallout,
    /// Wedge round-rectangle callout.
    WedgeRoundRectCallout,
    /// Wedge ellipse callout.
    WedgeEllipseCallout,
    /// Cloud callout.
    CloudCallout,

    // -- Stars and banners ---------------------------------------------------
    /// 4-pointed star.
    Star4,
    /// 5-pointed star.
    Star5,
    /// 6-pointed star.
    Star6,
    /// 7-pointed star.
    Star7,
    /// 8-pointed star.
    Star8,
    /// 10-pointed star.
    Star10,
    /// 12-pointed star.
    Star12,
    /// 16-pointed star.
    Star16,
    /// 24-pointed star.
    Star24,
    /// 32-pointed star.
    Star32,
    /// Ribbon (down).
    Ribbon,
    /// Ribbon 2 (up).
    Ribbon2,
    /// Ellipse ribbon.
    EllipseRibbon,
    /// Ellipse ribbon 2.
    EllipseRibbon2,
    /// Left-right ribbon.
    LeftRightRibbon,
    /// Vertical scroll.
    VerticalScroll,
    /// Horizontal scroll.
    HorizontalScroll,
    /// Wave.
    Wave,
    /// Double wave.
    DoubleWave,
    /// Irregular seal 1 (explosion 1).
    IrregularSeal1,
    /// Irregular seal 2 (explosion 2).
    IrregularSeal2,

    // -- Math operators ------------------------------------------------------
    /// Math plus.
    MathPlus,
    /// Math divide.
    MathDivide,
    /// Math equal.
    MathEqual,
    /// Math not-equal.
    MathNotEqual,
    /// Math minus.
    MathMinus,
    /// Math multiply.
    MathMultiply,

    // -- Action buttons ------------------------------------------------------
    /// Action button: back/previous.
    ActionButtonBackPrevious,
    /// Action button: forward/next.
    ActionButtonForwardNext,
    /// Action button: beginning.
    ActionButtonBeginning,
    /// Action button: end.
    ActionButtonEnd,
    /// Action button: home.
    ActionButtonHome,
    /// Action button: information.
    ActionButtonInformation,
    /// Action button: return.
    ActionButtonReturn,
    /// Action button: document.
    ActionButtonDocument,
    /// Action button: sound.
    ActionButtonSound,
    /// Action button: movie.
    ActionButtonMovie,
    /// Action button: help.
    ActionButtonHelp,
    /// Action button: blank.
    ActionButtonBlank,

    // -- Tabs and braces -----------------------------------------------------
    /// Brace pair (OOXML: `bracePair`).
    #[serde(rename = "bracePair")]
    Brace,
    /// Bracket pair (OOXML: `bracketPair`).
    #[serde(rename = "bracketPair")]
    Bracket,
    /// Left brace.
    LeftBrace,
    /// Right brace.
    RightBrace,
    /// Left bracket.
    LeftBracket,
    /// Right bracket.
    RightBracket,
    /// Corner tabs.
    CornerTabs,
    /// Square tabs.
    SquareTabs,
    /// Plaque tabs.
    PlaqueTabs,

    // -- Decorative / miscellaneous ------------------------------------------
    /// Heart.
    Heart,
    /// Lightning bolt (OOXML: `lightningBolt`).
    #[serde(rename = "lightningBolt")]
    Lightning,
    /// Sun.
    Sun,
    /// Moon.
    Moon,
    /// Cloud.
    Cloud,
    /// Arc.
    Arc,
    /// Block arc.
    BlockArc,
    /// Folded corner.
    FoldedCorner,
    /// Smiley face.
    SmileyFace,
    /// Donut.
    Donut,
    /// No smoking.
    NoSmoking,
    /// Can / cylinder.
    Can,
    /// Cube.
    Cube,
    /// Bevel.
    Bevel,
    /// Frame.
    Frame,
    /// Half frame.
    HalfFrame,
    /// Funnel.
    Funnel,
    /// Gear (6 teeth).
    Gear6,
    /// Gear (9 teeth).
    Gear9,
    /// Pie wedge.
    PieWedge,
    /// Chart plus.
    ChartPlus,
    /// Chart star.
    ChartStar,
    /// Chart X.
    ChartX,

    // -- Text box (special) --------------------------------------------------
    /// Text box (rendered as rectangle geometry).
    TextBox,
}

/// Total number of shape preset variants (186 from OOXML spec + TextBox + Plus alias).
pub const SHAPE_PRESET_COUNT: usize = 188;

impl ShapePreset {
    /// Parse from an OOXML `prst` attribute value.
    ///
    /// Returns `None` for unrecognised strings. Callers that need a fallback
    /// can use `.unwrap_or(ShapePreset::Rect)` or similar.
    #[must_use]
    pub fn from_ooxml(s: &str) -> Option<Self> {
        match s {
            // Basic shapes
            "rect" => Some(Self::Rect),
            "roundRect" => Some(Self::RoundRect),
            "ellipse" => Some(Self::Ellipse),
            "triangle" => Some(Self::Triangle),
            "rtTriangle" => Some(Self::RightTriangle),
            "diamond" => Some(Self::Diamond),
            "parallelogram" => Some(Self::Parallelogram),
            "trapezoid" => Some(Self::Trapezoid),
            "nonIsoscelesTrapezoid" => Some(Self::NonIsoscelesTrapezoid),
            "pentagon" => Some(Self::Pentagon),
            "hexagon" => Some(Self::Hexagon),
            "heptagon" => Some(Self::Heptagon),
            "octagon" => Some(Self::Octagon),
            "decagon" => Some(Self::Decagon),
            "dodecagon" => Some(Self::Dodecagon),
            "pie" => Some(Self::Pie),
            "chord" => Some(Self::Chord),
            "teardrop" => Some(Self::Teardrop),
            "plaque" => Some(Self::Plaque),
            "homePlate" => Some(Self::HomePlate),
            "chevron" => Some(Self::Chevron),
            "diagStripe" => Some(Self::DiagStripe),
            "corner" => Some(Self::Corner),
            "plus" => Some(Self::Plus),

            // Rounded / snipped rectangles
            "round1Rect" => Some(Self::Round1Rect),
            "round2DiagRect" => Some(Self::Round2DiagRect),
            "round2SameRect" => Some(Self::Round2SameRect),
            "snip1Rect" => Some(Self::Snip1Rect),
            "snip2DiagRect" => Some(Self::Snip2DiagRect),
            "snip2SameRect" => Some(Self::Snip2SameRect),
            "snipRoundRect" => Some(Self::SnipRoundRect),

            // Lines and connectors
            "line" => Some(Self::Line),
            "lineInv" => Some(Self::LineInv),
            "straightConnector1" => Some(Self::StraightConnector1),
            "bentConnector2" => Some(Self::BentConnector2),
            "bentConnector3" => Some(Self::BentConnector3),
            "bentConnector4" => Some(Self::BentConnector4),
            "bentConnector5" => Some(Self::BentConnector5),
            "curvedConnector2" => Some(Self::CurvedConnector2),
            "curvedConnector3" => Some(Self::CurvedConnector3),
            "curvedConnector4" => Some(Self::CurvedConnector4),
            "curvedConnector5" => Some(Self::CurvedConnector5),

            // Arrows
            "rightArrow" => Some(Self::RightArrow),
            "leftArrow" => Some(Self::LeftArrow),
            "upArrow" => Some(Self::UpArrow),
            "downArrow" => Some(Self::DownArrow),
            "leftRightArrow" => Some(Self::LeftRightArrow),
            "upDownArrow" => Some(Self::UpDownArrow),
            "bentArrow" => Some(Self::BentArrow),
            "bentUpArrow" => Some(Self::BentUpArrow),
            "uturnArrow" => Some(Self::UTurnArrow),
            "quadArrow" => Some(Self::QuadArrow),
            "leftRightUpArrow" => Some(Self::LeftRightUpArrow),
            "leftUpArrow" => Some(Self::LeftUpArrow),
            "circularArrow" => Some(Self::CircularArrow),
            "leftCircularArrow" => Some(Self::LeftCircularArrow),
            "leftRightCircularArrow" => Some(Self::LeftRightCircularArrow),
            "curvedRightArrow" => Some(Self::CurvedRightArrow),
            "curvedLeftArrow" => Some(Self::CurvedLeftArrow),
            "curvedUpArrow" => Some(Self::CurvedUpArrow),
            "curvedDownArrow" => Some(Self::CurvedDownArrow),
            "stripedRightArrow" => Some(Self::StripedRightArrow),
            "notchedRightArrow" => Some(Self::NotchedRightArrow),
            "swooshArrow" => Some(Self::SwooshArrow),

            // Arrow callouts
            "rightArrowCallout" => Some(Self::RightArrowCallout),
            "leftArrowCallout" => Some(Self::LeftArrowCallout),
            "upArrowCallout" => Some(Self::UpArrowCallout),
            "downArrowCallout" => Some(Self::DownArrowCallout),
            "leftRightArrowCallout" => Some(Self::LeftRightArrowCallout),
            "upDownArrowCallout" => Some(Self::UpDownArrowCallout),
            "quadArrowCallout" => Some(Self::QuadArrowCallout),

            // Flowchart
            "flowChartProcess" => Some(Self::FlowChartProcess),
            "flowChartAlternateProcess" => Some(Self::FlowChartAlternateProcess),
            "flowChartDecision" => Some(Self::FlowChartDecision),
            "flowChartInputOutput" => Some(Self::FlowChartInputOutput),
            // Historical synonym: "flowChartData" also maps to FlowChartInputOutput.
            "flowChartData" => Some(Self::FlowChartInputOutput),
            "flowChartPredefinedProcess" => Some(Self::FlowChartPredefinedProcess),
            "flowChartInternalStorage" => Some(Self::FlowChartInternalStorage),
            "flowChartDocument" => Some(Self::FlowChartDocument),
            "flowChartMultidocument" => Some(Self::FlowChartMultidocument),
            "flowChartTerminator" => Some(Self::FlowChartTerminator),
            "flowChartPreparation" => Some(Self::FlowChartPreparation),
            "flowChartManualInput" => Some(Self::FlowChartManualInput),
            "flowChartManualOperation" => Some(Self::FlowChartManualOperation),
            "flowChartConnector" => Some(Self::FlowChartConnector),
            "flowChartOffpageConnector" => Some(Self::FlowChartOffpageConnector),
            "flowChartPunchedCard" => Some(Self::FlowChartPunchedCard),
            "flowChartPunchedTape" => Some(Self::FlowChartPunchedTape),
            "flowChartSummingJunction" => Some(Self::FlowChartSummingJunction),
            "flowChartOr" => Some(Self::FlowChartOr),
            "flowChartCollate" => Some(Self::FlowChartCollate),
            "flowChartSort" => Some(Self::FlowChartSort),
            "flowChartExtract" => Some(Self::FlowChartExtract),
            "flowChartMerge" => Some(Self::FlowChartMerge),
            "flowChartOnlineStorage" => Some(Self::FlowChartOnlineStorage),
            "flowChartOfflineStorage" => Some(Self::FlowChartOfflineStorage),
            "flowChartMagneticTape" => Some(Self::FlowChartMagneticTape),
            "flowChartMagneticDisk" => Some(Self::FlowChartMagneticDisk),
            "flowChartMagneticDrum" => Some(Self::FlowChartMagneticDrum),
            "flowChartDisplay" => Some(Self::FlowChartDisplay),
            "flowChartDelay" => Some(Self::FlowChartDelay),

            // Callouts
            "callout1" => Some(Self::Callout1),
            "callout2" => Some(Self::Callout2),
            "callout3" => Some(Self::Callout3),
            "accentCallout1" => Some(Self::AccentCallout1),
            "accentCallout2" => Some(Self::AccentCallout2),
            "accentCallout3" => Some(Self::AccentCallout3),
            "borderCallout1" => Some(Self::BorderCallout1),
            "borderCallout2" => Some(Self::BorderCallout2),
            "borderCallout3" => Some(Self::BorderCallout3),
            "accentBorderCallout1" => Some(Self::AccentBorderCallout1),
            "accentBorderCallout2" => Some(Self::AccentBorderCallout2),
            "accentBorderCallout3" => Some(Self::AccentBorderCallout3),
            "wedgeRectCallout" => Some(Self::WedgeRectCallout),
            "wedgeRoundRectCallout" => Some(Self::WedgeRoundRectCallout),
            "wedgeEllipseCallout" => Some(Self::WedgeEllipseCallout),
            "cloudCallout" => Some(Self::CloudCallout),

            // Stars, banners, seals, scrolls
            "star4" => Some(Self::Star4),
            "star5" => Some(Self::Star5),
            "star6" => Some(Self::Star6),
            "star7" => Some(Self::Star7),
            "star8" => Some(Self::Star8),
            "star10" => Some(Self::Star10),
            "star12" => Some(Self::Star12),
            "star16" => Some(Self::Star16),
            "star24" => Some(Self::Star24),
            "star32" => Some(Self::Star32),
            "ribbon" => Some(Self::Ribbon),
            "ribbon2" => Some(Self::Ribbon2),
            "ellipseRibbon" => Some(Self::EllipseRibbon),
            "ellipseRibbon2" => Some(Self::EllipseRibbon2),
            "leftRightRibbon" => Some(Self::LeftRightRibbon),
            "verticalScroll" => Some(Self::VerticalScroll),
            "horizontalScroll" => Some(Self::HorizontalScroll),
            "wave" => Some(Self::Wave),
            "doubleWave" => Some(Self::DoubleWave),
            "irregularSeal1" => Some(Self::IrregularSeal1),
            "irregularSeal2" => Some(Self::IrregularSeal2),

            // Math operators
            "mathPlus" => Some(Self::MathPlus),
            "mathDivide" => Some(Self::MathDivide),
            "mathEqual" => Some(Self::MathEqual),
            "mathNotEqual" => Some(Self::MathNotEqual),
            "mathMinus" => Some(Self::MathMinus),
            "mathMultiply" => Some(Self::MathMultiply),

            // Action buttons
            "actionButtonBackPrevious" => Some(Self::ActionButtonBackPrevious),
            "actionButtonForwardNext" => Some(Self::ActionButtonForwardNext),
            "actionButtonBeginning" => Some(Self::ActionButtonBeginning),
            "actionButtonEnd" => Some(Self::ActionButtonEnd),
            "actionButtonHome" => Some(Self::ActionButtonHome),
            "actionButtonInformation" => Some(Self::ActionButtonInformation),
            "actionButtonReturn" => Some(Self::ActionButtonReturn),
            "actionButtonDocument" => Some(Self::ActionButtonDocument),
            "actionButtonSound" => Some(Self::ActionButtonSound),
            "actionButtonMovie" => Some(Self::ActionButtonMovie),
            "actionButtonHelp" => Some(Self::ActionButtonHelp),
            "actionButtonBlank" => Some(Self::ActionButtonBlank),

            // Tabs and braces
            "bracePair" => Some(Self::Brace),
            "bracketPair" => Some(Self::Bracket),
            "leftBrace" => Some(Self::LeftBrace),
            "rightBrace" => Some(Self::RightBrace),
            "leftBracket" => Some(Self::LeftBracket),
            "rightBracket" => Some(Self::RightBracket),
            "cornerTabs" => Some(Self::CornerTabs),
            "squareTabs" => Some(Self::SquareTabs),
            "plaqueTabs" => Some(Self::PlaqueTabs),

            // Decorative / miscellaneous
            "heart" => Some(Self::Heart),
            "lightningBolt" => Some(Self::Lightning),
            "sun" => Some(Self::Sun),
            "moon" => Some(Self::Moon),
            "cloud" => Some(Self::Cloud),
            "arc" => Some(Self::Arc),
            "blockArc" => Some(Self::BlockArc),
            "foldedCorner" => Some(Self::FoldedCorner),
            "smileyFace" => Some(Self::SmileyFace),
            "donut" => Some(Self::Donut),
            "noSmoking" => Some(Self::NoSmoking),
            "can" => Some(Self::Can),
            "cube" => Some(Self::Cube),
            "bevel" => Some(Self::Bevel),
            "frame" => Some(Self::Frame),
            "halfFrame" => Some(Self::HalfFrame),
            "funnel" => Some(Self::Funnel),
            "gear6" => Some(Self::Gear6),
            "gear9" => Some(Self::Gear9),
            "pieWedge" => Some(Self::PieWedge),
            "chartPlus" => Some(Self::ChartPlus),
            "chartStar" => Some(Self::ChartStar),
            "chartX" => Some(Self::ChartX),

            // Text box
            "textBox" => Some(Self::TextBox),

            _ => None,
        }
    }

    /// Serialize to the OOXML `prst` attribute value.
    #[must_use]
    pub fn to_ooxml(&self) -> &'static str {
        match self {
            // Basic shapes
            Self::Rect => "rect",
            Self::RoundRect => "roundRect",
            Self::Ellipse => "ellipse",
            Self::Triangle => "triangle",
            Self::RightTriangle => "rtTriangle",
            Self::Diamond => "diamond",
            Self::Parallelogram => "parallelogram",
            Self::Trapezoid => "trapezoid",
            Self::NonIsoscelesTrapezoid => "nonIsoscelesTrapezoid",
            Self::Pentagon => "pentagon",
            Self::Hexagon => "hexagon",
            Self::Heptagon => "heptagon",
            Self::Octagon => "octagon",
            Self::Decagon => "decagon",
            Self::Dodecagon => "dodecagon",
            Self::Pie => "pie",
            Self::Chord => "chord",
            Self::Teardrop => "teardrop",
            Self::Plaque => "plaque",
            Self::HomePlate => "homePlate",
            Self::Chevron => "chevron",
            Self::DiagStripe => "diagStripe",
            Self::Corner => "corner",
            Self::Plus => "plus",

            // Rounded / snipped rectangles
            Self::Round1Rect => "round1Rect",
            Self::Round2DiagRect => "round2DiagRect",
            Self::Round2SameRect => "round2SameRect",
            Self::Snip1Rect => "snip1Rect",
            Self::Snip2DiagRect => "snip2DiagRect",
            Self::Snip2SameRect => "snip2SameRect",
            Self::SnipRoundRect => "snipRoundRect",

            // Lines and connectors
            Self::Line => "line",
            Self::LineInv => "lineInv",
            Self::StraightConnector1 => "straightConnector1",
            Self::BentConnector2 => "bentConnector2",
            Self::BentConnector3 => "bentConnector3",
            Self::BentConnector4 => "bentConnector4",
            Self::BentConnector5 => "bentConnector5",
            Self::CurvedConnector2 => "curvedConnector2",
            Self::CurvedConnector3 => "curvedConnector3",
            Self::CurvedConnector4 => "curvedConnector4",
            Self::CurvedConnector5 => "curvedConnector5",

            // Arrows
            Self::RightArrow => "rightArrow",
            Self::LeftArrow => "leftArrow",
            Self::UpArrow => "upArrow",
            Self::DownArrow => "downArrow",
            Self::LeftRightArrow => "leftRightArrow",
            Self::UpDownArrow => "upDownArrow",
            Self::BentArrow => "bentArrow",
            Self::BentUpArrow => "bentUpArrow",
            Self::UTurnArrow => "uturnArrow",
            Self::QuadArrow => "quadArrow",
            Self::LeftRightUpArrow => "leftRightUpArrow",
            Self::LeftUpArrow => "leftUpArrow",
            Self::CircularArrow => "circularArrow",
            Self::LeftCircularArrow => "leftCircularArrow",
            Self::LeftRightCircularArrow => "leftRightCircularArrow",
            Self::CurvedRightArrow => "curvedRightArrow",
            Self::CurvedLeftArrow => "curvedLeftArrow",
            Self::CurvedUpArrow => "curvedUpArrow",
            Self::CurvedDownArrow => "curvedDownArrow",
            Self::StripedRightArrow => "stripedRightArrow",
            Self::NotchedRightArrow => "notchedRightArrow",
            Self::SwooshArrow => "swooshArrow",

            // Arrow callouts
            Self::RightArrowCallout => "rightArrowCallout",
            Self::LeftArrowCallout => "leftArrowCallout",
            Self::UpArrowCallout => "upArrowCallout",
            Self::DownArrowCallout => "downArrowCallout",
            Self::LeftRightArrowCallout => "leftRightArrowCallout",
            Self::UpDownArrowCallout => "upDownArrowCallout",
            Self::QuadArrowCallout => "quadArrowCallout",

            // Flowchart
            Self::FlowChartProcess => "flowChartProcess",
            Self::FlowChartAlternateProcess => "flowChartAlternateProcess",
            Self::FlowChartDecision => "flowChartDecision",
            Self::FlowChartInputOutput => "flowChartInputOutput",
            Self::FlowChartPredefinedProcess => "flowChartPredefinedProcess",
            Self::FlowChartInternalStorage => "flowChartInternalStorage",
            Self::FlowChartDocument => "flowChartDocument",
            Self::FlowChartMultidocument => "flowChartMultidocument",
            Self::FlowChartTerminator => "flowChartTerminator",
            Self::FlowChartPreparation => "flowChartPreparation",
            Self::FlowChartManualInput => "flowChartManualInput",
            Self::FlowChartManualOperation => "flowChartManualOperation",
            Self::FlowChartConnector => "flowChartConnector",
            Self::FlowChartOffpageConnector => "flowChartOffpageConnector",
            Self::FlowChartPunchedCard => "flowChartPunchedCard",
            Self::FlowChartPunchedTape => "flowChartPunchedTape",
            Self::FlowChartSummingJunction => "flowChartSummingJunction",
            Self::FlowChartOr => "flowChartOr",
            Self::FlowChartCollate => "flowChartCollate",
            Self::FlowChartSort => "flowChartSort",
            Self::FlowChartExtract => "flowChartExtract",
            Self::FlowChartMerge => "flowChartMerge",
            Self::FlowChartOnlineStorage => "flowChartOnlineStorage",
            Self::FlowChartOfflineStorage => "flowChartOfflineStorage",
            Self::FlowChartMagneticTape => "flowChartMagneticTape",
            Self::FlowChartMagneticDisk => "flowChartMagneticDisk",
            Self::FlowChartMagneticDrum => "flowChartMagneticDrum",
            Self::FlowChartDisplay => "flowChartDisplay",
            Self::FlowChartDelay => "flowChartDelay",

            // Callouts
            Self::Callout1 => "callout1",
            Self::Callout2 => "callout2",
            Self::Callout3 => "callout3",
            Self::AccentCallout1 => "accentCallout1",
            Self::AccentCallout2 => "accentCallout2",
            Self::AccentCallout3 => "accentCallout3",
            Self::BorderCallout1 => "borderCallout1",
            Self::BorderCallout2 => "borderCallout2",
            Self::BorderCallout3 => "borderCallout3",
            Self::AccentBorderCallout1 => "accentBorderCallout1",
            Self::AccentBorderCallout2 => "accentBorderCallout2",
            Self::AccentBorderCallout3 => "accentBorderCallout3",
            Self::WedgeRectCallout => "wedgeRectCallout",
            Self::WedgeRoundRectCallout => "wedgeRoundRectCallout",
            Self::WedgeEllipseCallout => "wedgeEllipseCallout",
            Self::CloudCallout => "cloudCallout",

            // Stars, banners, seals, scrolls
            Self::Star4 => "star4",
            Self::Star5 => "star5",
            Self::Star6 => "star6",
            Self::Star7 => "star7",
            Self::Star8 => "star8",
            Self::Star10 => "star10",
            Self::Star12 => "star12",
            Self::Star16 => "star16",
            Self::Star24 => "star24",
            Self::Star32 => "star32",
            Self::Ribbon => "ribbon",
            Self::Ribbon2 => "ribbon2",
            Self::EllipseRibbon => "ellipseRibbon",
            Self::EllipseRibbon2 => "ellipseRibbon2",
            Self::LeftRightRibbon => "leftRightRibbon",
            Self::VerticalScroll => "verticalScroll",
            Self::HorizontalScroll => "horizontalScroll",
            Self::Wave => "wave",
            Self::DoubleWave => "doubleWave",
            Self::IrregularSeal1 => "irregularSeal1",
            Self::IrregularSeal2 => "irregularSeal2",

            // Math operators
            Self::MathPlus => "mathPlus",
            Self::MathDivide => "mathDivide",
            Self::MathEqual => "mathEqual",
            Self::MathNotEqual => "mathNotEqual",
            Self::MathMinus => "mathMinus",
            Self::MathMultiply => "mathMultiply",

            // Action buttons
            Self::ActionButtonBackPrevious => "actionButtonBackPrevious",
            Self::ActionButtonForwardNext => "actionButtonForwardNext",
            Self::ActionButtonBeginning => "actionButtonBeginning",
            Self::ActionButtonEnd => "actionButtonEnd",
            Self::ActionButtonHome => "actionButtonHome",
            Self::ActionButtonInformation => "actionButtonInformation",
            Self::ActionButtonReturn => "actionButtonReturn",
            Self::ActionButtonDocument => "actionButtonDocument",
            Self::ActionButtonSound => "actionButtonSound",
            Self::ActionButtonMovie => "actionButtonMovie",
            Self::ActionButtonHelp => "actionButtonHelp",
            Self::ActionButtonBlank => "actionButtonBlank",

            // Tabs and braces
            Self::Brace => "bracePair",
            Self::Bracket => "bracketPair",
            Self::LeftBrace => "leftBrace",
            Self::RightBrace => "rightBrace",
            Self::LeftBracket => "leftBracket",
            Self::RightBracket => "rightBracket",
            Self::CornerTabs => "cornerTabs",
            Self::SquareTabs => "squareTabs",
            Self::PlaqueTabs => "plaqueTabs",

            // Decorative / miscellaneous
            Self::Heart => "heart",
            Self::Lightning => "lightningBolt",
            Self::Sun => "sun",
            Self::Moon => "moon",
            Self::Cloud => "cloud",
            Self::Arc => "arc",
            Self::BlockArc => "blockArc",
            Self::FoldedCorner => "foldedCorner",
            Self::SmileyFace => "smileyFace",
            Self::Donut => "donut",
            Self::NoSmoking => "noSmoking",
            Self::Can => "can",
            Self::Cube => "cube",
            Self::Bevel => "bevel",
            Self::Frame => "frame",
            Self::HalfFrame => "halfFrame",
            Self::Funnel => "funnel",
            Self::Gear6 => "gear6",
            Self::Gear9 => "gear9",
            Self::PieWedge => "pieWedge",
            Self::ChartPlus => "chartPlus",
            Self::ChartStar => "chartStar",
            Self::ChartX => "chartX",

            // Text box
            Self::TextBox => "textBox",
        }
    }

    /// Returns an iterator over all 186 variants in spec order.
    pub fn all_variants() -> &'static [ShapePreset; SHAPE_PRESET_COUNT] {
        &ALL_SHAPE_PRESETS
    }
}

/// All 186 shape presets, ordered by category (same order as the enum definition).
static ALL_SHAPE_PRESETS: [ShapePreset; SHAPE_PRESET_COUNT] = [
    // Basic shapes
    ShapePreset::Rect,
    ShapePreset::RoundRect,
    ShapePreset::Ellipse,
    ShapePreset::Triangle,
    ShapePreset::RightTriangle,
    ShapePreset::Diamond,
    ShapePreset::Parallelogram,
    ShapePreset::Trapezoid,
    ShapePreset::NonIsoscelesTrapezoid,
    ShapePreset::Pentagon,
    ShapePreset::Hexagon,
    ShapePreset::Heptagon,
    ShapePreset::Octagon,
    ShapePreset::Decagon,
    ShapePreset::Dodecagon,
    ShapePreset::Pie,
    ShapePreset::Chord,
    ShapePreset::Teardrop,
    ShapePreset::Plaque,
    ShapePreset::HomePlate,
    ShapePreset::Chevron,
    ShapePreset::DiagStripe,
    ShapePreset::Corner,
    ShapePreset::Plus,
    // Rounded / snipped rectangles
    ShapePreset::Round1Rect,
    ShapePreset::Round2DiagRect,
    ShapePreset::Round2SameRect,
    ShapePreset::Snip1Rect,
    ShapePreset::Snip2DiagRect,
    ShapePreset::Snip2SameRect,
    ShapePreset::SnipRoundRect,
    // Lines and connectors
    ShapePreset::Line,
    ShapePreset::LineInv,
    ShapePreset::StraightConnector1,
    ShapePreset::BentConnector2,
    ShapePreset::BentConnector3,
    ShapePreset::BentConnector4,
    ShapePreset::BentConnector5,
    ShapePreset::CurvedConnector2,
    ShapePreset::CurvedConnector3,
    ShapePreset::CurvedConnector4,
    ShapePreset::CurvedConnector5,
    // Arrows
    ShapePreset::RightArrow,
    ShapePreset::LeftArrow,
    ShapePreset::UpArrow,
    ShapePreset::DownArrow,
    ShapePreset::LeftRightArrow,
    ShapePreset::UpDownArrow,
    ShapePreset::BentArrow,
    ShapePreset::BentUpArrow,
    ShapePreset::UTurnArrow,
    ShapePreset::QuadArrow,
    ShapePreset::LeftRightUpArrow,
    ShapePreset::LeftUpArrow,
    ShapePreset::CircularArrow,
    ShapePreset::LeftCircularArrow,
    ShapePreset::LeftRightCircularArrow,
    ShapePreset::CurvedRightArrow,
    ShapePreset::CurvedLeftArrow,
    ShapePreset::CurvedUpArrow,
    ShapePreset::CurvedDownArrow,
    ShapePreset::StripedRightArrow,
    ShapePreset::NotchedRightArrow,
    ShapePreset::SwooshArrow,
    // Arrow callouts
    ShapePreset::RightArrowCallout,
    ShapePreset::LeftArrowCallout,
    ShapePreset::UpArrowCallout,
    ShapePreset::DownArrowCallout,
    ShapePreset::LeftRightArrowCallout,
    ShapePreset::UpDownArrowCallout,
    ShapePreset::QuadArrowCallout,
    // Flowchart
    ShapePreset::FlowChartProcess,
    ShapePreset::FlowChartAlternateProcess,
    ShapePreset::FlowChartDecision,
    ShapePreset::FlowChartInputOutput,
    ShapePreset::FlowChartPredefinedProcess,
    ShapePreset::FlowChartInternalStorage,
    ShapePreset::FlowChartDocument,
    ShapePreset::FlowChartMultidocument,
    ShapePreset::FlowChartTerminator,
    ShapePreset::FlowChartPreparation,
    ShapePreset::FlowChartManualInput,
    ShapePreset::FlowChartManualOperation,
    ShapePreset::FlowChartConnector,
    ShapePreset::FlowChartOffpageConnector,
    ShapePreset::FlowChartPunchedCard,
    ShapePreset::FlowChartPunchedTape,
    ShapePreset::FlowChartSummingJunction,
    ShapePreset::FlowChartOr,
    ShapePreset::FlowChartCollate,
    ShapePreset::FlowChartSort,
    ShapePreset::FlowChartExtract,
    ShapePreset::FlowChartMerge,
    ShapePreset::FlowChartOnlineStorage,
    ShapePreset::FlowChartOfflineStorage,
    ShapePreset::FlowChartMagneticTape,
    ShapePreset::FlowChartMagneticDisk,
    ShapePreset::FlowChartMagneticDrum,
    ShapePreset::FlowChartDisplay,
    ShapePreset::FlowChartDelay,
    // Callouts
    ShapePreset::Callout1,
    ShapePreset::Callout2,
    ShapePreset::Callout3,
    ShapePreset::AccentCallout1,
    ShapePreset::AccentCallout2,
    ShapePreset::AccentCallout3,
    ShapePreset::BorderCallout1,
    ShapePreset::BorderCallout2,
    ShapePreset::BorderCallout3,
    ShapePreset::AccentBorderCallout1,
    ShapePreset::AccentBorderCallout2,
    ShapePreset::AccentBorderCallout3,
    ShapePreset::WedgeRectCallout,
    ShapePreset::WedgeRoundRectCallout,
    ShapePreset::WedgeEllipseCallout,
    ShapePreset::CloudCallout,
    // Stars, banners, seals, scrolls
    ShapePreset::Star4,
    ShapePreset::Star5,
    ShapePreset::Star6,
    ShapePreset::Star7,
    ShapePreset::Star8,
    ShapePreset::Star10,
    ShapePreset::Star12,
    ShapePreset::Star16,
    ShapePreset::Star24,
    ShapePreset::Star32,
    ShapePreset::Ribbon,
    ShapePreset::Ribbon2,
    ShapePreset::EllipseRibbon,
    ShapePreset::EllipseRibbon2,
    ShapePreset::LeftRightRibbon,
    ShapePreset::VerticalScroll,
    ShapePreset::HorizontalScroll,
    ShapePreset::Wave,
    ShapePreset::DoubleWave,
    ShapePreset::IrregularSeal1,
    ShapePreset::IrregularSeal2,
    // Math operators
    ShapePreset::MathPlus,
    ShapePreset::MathDivide,
    ShapePreset::MathEqual,
    ShapePreset::MathNotEqual,
    ShapePreset::MathMinus,
    ShapePreset::MathMultiply,
    // Action buttons
    ShapePreset::ActionButtonBackPrevious,
    ShapePreset::ActionButtonForwardNext,
    ShapePreset::ActionButtonBeginning,
    ShapePreset::ActionButtonEnd,
    ShapePreset::ActionButtonHome,
    ShapePreset::ActionButtonInformation,
    ShapePreset::ActionButtonReturn,
    ShapePreset::ActionButtonDocument,
    ShapePreset::ActionButtonSound,
    ShapePreset::ActionButtonMovie,
    ShapePreset::ActionButtonHelp,
    ShapePreset::ActionButtonBlank,
    // Tabs and braces
    ShapePreset::Brace,
    ShapePreset::Bracket,
    ShapePreset::LeftBrace,
    ShapePreset::RightBrace,
    ShapePreset::LeftBracket,
    ShapePreset::RightBracket,
    ShapePreset::CornerTabs,
    ShapePreset::SquareTabs,
    ShapePreset::PlaqueTabs,
    // Decorative / miscellaneous
    ShapePreset::Heart,
    ShapePreset::Lightning,
    ShapePreset::Sun,
    ShapePreset::Moon,
    ShapePreset::Cloud,
    ShapePreset::Arc,
    ShapePreset::BlockArc,
    ShapePreset::FoldedCorner,
    ShapePreset::SmileyFace,
    ShapePreset::Donut,
    ShapePreset::NoSmoking,
    ShapePreset::Can,
    ShapePreset::Cube,
    ShapePreset::Bevel,
    ShapePreset::Frame,
    ShapePreset::HalfFrame,
    ShapePreset::Funnel,
    ShapePreset::Gear6,
    ShapePreset::Gear9,
    ShapePreset::PieWedge,
    ShapePreset::ChartPlus,
    ShapePreset::ChartStar,
    ShapePreset::ChartX,
    // Text box
    ShapePreset::TextBox,
];
