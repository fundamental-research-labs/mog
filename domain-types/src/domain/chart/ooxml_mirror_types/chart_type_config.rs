use serde::{Deserialize, Serialize};

use ooxml_types::charts as ocharts;

/// Chart-type variant discriminant (read-side mirror of OOXML element names).
///
/// Domain counterpart of `ooxml_types::charts::ChartType` — deliberately
/// kept distinct from `domain::chart::ChartType` (which is a lossier,
/// simpler enum for the UI wire).
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum OoxmlChartTypeKind {
    #[default]
    Unknown,
    Bar,
    Bar3D,
    Line,
    Line3D,
    Pie,
    Pie3D,
    Doughnut,
    Area,
    Area3D,
    Scatter,
    Bubble,
    Radar,
    Surface,
    Surface3D,
    Stock,
    OfPie,
    Combo,
}

impl From<ocharts::ChartType> for OoxmlChartTypeKind {
    fn from(v: ocharts::ChartType) -> Self {
        match v {
            ocharts::ChartType::Unknown => Self::Unknown,
            ocharts::ChartType::Bar => Self::Bar,
            ocharts::ChartType::Bar3D => Self::Bar3D,
            ocharts::ChartType::Line => Self::Line,
            ocharts::ChartType::Line3D => Self::Line3D,
            ocharts::ChartType::Pie => Self::Pie,
            ocharts::ChartType::Pie3D => Self::Pie3D,
            ocharts::ChartType::Doughnut => Self::Doughnut,
            ocharts::ChartType::Area => Self::Area,
            ocharts::ChartType::Area3D => Self::Area3D,
            ocharts::ChartType::Scatter => Self::Scatter,
            ocharts::ChartType::Bubble => Self::Bubble,
            ocharts::ChartType::Radar => Self::Radar,
            ocharts::ChartType::Surface => Self::Surface,
            ocharts::ChartType::Surface3D => Self::Surface3D,
            ocharts::ChartType::Stock => Self::Stock,
            ocharts::ChartType::OfPie => Self::OfPie,
            ocharts::ChartType::Combo => Self::Combo,
        }
    }
}

impl From<OoxmlChartTypeKind> for ocharts::ChartType {
    fn from(v: OoxmlChartTypeKind) -> Self {
        match v {
            OoxmlChartTypeKind::Unknown => Self::Unknown,
            OoxmlChartTypeKind::Bar => Self::Bar,
            OoxmlChartTypeKind::Bar3D => Self::Bar3D,
            OoxmlChartTypeKind::Line => Self::Line,
            OoxmlChartTypeKind::Line3D => Self::Line3D,
            OoxmlChartTypeKind::Pie => Self::Pie,
            OoxmlChartTypeKind::Pie3D => Self::Pie3D,
            OoxmlChartTypeKind::Doughnut => Self::Doughnut,
            OoxmlChartTypeKind::Area => Self::Area,
            OoxmlChartTypeKind::Area3D => Self::Area3D,
            OoxmlChartTypeKind::Scatter => Self::Scatter,
            OoxmlChartTypeKind::Bubble => Self::Bubble,
            OoxmlChartTypeKind::Radar => Self::Radar,
            OoxmlChartTypeKind::Surface => Self::Surface,
            OoxmlChartTypeKind::Surface3D => Self::Surface3D,
            OoxmlChartTypeKind::Stock => Self::Stock,
            OoxmlChartTypeKind::OfPie => Self::OfPie,
            OoxmlChartTypeKind::Combo => Self::Combo,
        }
    }
}

/// Chart-type configuration template (CT_*Chart choice of CT_PlotArea).
#[derive(Debug, Clone, Default, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
#[serde(default)]
pub struct ChartTypeConfig {
    /// Chart-type variant discriminant.
    pub kind: OoxmlChartTypeKind,
    /// Deep per-variant configuration serialized opaquely as JSON.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub inner: Option<String>,
}

impl From<&ocharts::ChartTypeConfig> for ChartTypeConfig {
    fn from(c: &ocharts::ChartTypeConfig) -> Self {
        let inner = match c {
            ocharts::ChartTypeConfig::Combo => None,
            other => serde_json::to_string(other).ok(),
        };
        Self {
            kind: c.chart_type().into(),
            inner,
        }
    }
}

impl From<ChartTypeConfig> for ocharts::ChartTypeConfig {
    fn from(c: ChartTypeConfig) -> Self {
        if matches!(c.kind, OoxmlChartTypeKind::Combo) {
            return Self::Combo;
        }
        if let Some(inner) = c.inner.as_deref()
            && let Ok(parsed) = serde_json::from_str::<ocharts::ChartTypeConfig>(inner)
        {
            return parsed;
        }
        default_config_for_kind(c.kind)
    }
}

fn default_config_for_kind(kind: OoxmlChartTypeKind) -> ocharts::ChartTypeConfig {
    use ocharts::*;
    match kind {
        OoxmlChartTypeKind::Bar => ChartTypeConfig::Bar(BarChartConfig::default()),
        OoxmlChartTypeKind::Bar3D => ChartTypeConfig::Bar3D(Bar3DChartConfig::default()),
        OoxmlChartTypeKind::Line => ChartTypeConfig::Line(LineChartConfig::default()),
        OoxmlChartTypeKind::Line3D => ChartTypeConfig::Line3D(Line3DChartConfig::default()),
        OoxmlChartTypeKind::Pie => ChartTypeConfig::Pie(PieChartConfig::default()),
        OoxmlChartTypeKind::Pie3D => ChartTypeConfig::Pie3D(Pie3DChartConfig::default()),
        OoxmlChartTypeKind::Doughnut => ChartTypeConfig::Doughnut(DoughnutChartConfig::default()),
        OoxmlChartTypeKind::Area => ChartTypeConfig::Area(AreaChartConfig::default()),
        OoxmlChartTypeKind::Area3D => ChartTypeConfig::Area3D(Area3DChartConfig::default()),
        OoxmlChartTypeKind::Scatter => ChartTypeConfig::Scatter(ScatterChartConfig::default()),
        OoxmlChartTypeKind::Bubble => ChartTypeConfig::Bubble(BubbleChartConfig::default()),
        OoxmlChartTypeKind::Radar => ChartTypeConfig::Radar(RadarChartConfig::default()),
        OoxmlChartTypeKind::Surface => ChartTypeConfig::Surface(SurfaceChartConfig::default()),
        OoxmlChartTypeKind::Surface3D => ChartTypeConfig::Surface3D(SurfaceChartConfig::default()),
        OoxmlChartTypeKind::Stock => ChartTypeConfig::Stock(StockChartConfig::default()),
        OoxmlChartTypeKind::OfPie => ChartTypeConfig::OfPie(OfPieChartConfig::default()),
        OoxmlChartTypeKind::Combo | OoxmlChartTypeKind::Unknown => ChartTypeConfig::Combo,
    }
}
