use crate::domain::drawings::write::Extent;
use domain_types::ChartSpec;

const EMU_PER_PIXEL: i64 = 9525;

pub(super) fn frame_extent(chart: &ChartSpec) -> Extent {
    Extent {
        cx: positive_i64(chart.xfrm_ext_cx)
            .or_else(|| chart.position.extent_cx.and_then(positive_i64))
            .unwrap_or_else(|| size_width_emu(chart)),
        cy: positive_i64(chart.xfrm_ext_cy)
            .or_else(|| chart.position.extent_cy.and_then(positive_i64))
            .unwrap_or_else(|| size_height_emu(chart)),
    }
}

pub(super) fn anchor_extent(chart: &ChartSpec) -> Extent {
    Extent {
        cx: chart
            .position
            .extent_cx
            .and_then(positive_i64)
            .or_else(|| positive_i64(chart.xfrm_ext_cx))
            .unwrap_or_else(|| size_width_emu(chart)),
        cy: chart
            .position
            .extent_cy
            .and_then(positive_i64)
            .or_else(|| positive_i64(chart.xfrm_ext_cy))
            .unwrap_or_else(|| size_height_emu(chart)),
    }
}

pub(super) fn positive_i64(value: i64) -> Option<i64> {
    (value > 0).then_some(value)
}

fn size_width_emu(chart: &ChartSpec) -> i64 {
    (chart.size.width as i64) * EMU_PER_PIXEL
}

fn size_height_emu(chart: &ChartSpec) -> i64 {
    (chart.size.height as i64) * EMU_PER_PIXEL
}
