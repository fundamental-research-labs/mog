use domain_types::domain::floating_object::ChartDrawingFrameOoxmlProps;

pub(super) struct ChartFrameTransform {
    pub(super) has_xfrm: bool,
    pub(super) has_off: bool,
    pub(super) has_ext: bool,
    pub(super) off_x: i64,
    pub(super) off_y: i64,
    pub(super) ext_cx: i64,
    pub(super) ext_cy: i64,
    pub(super) rot: Option<i32>,
    pub(super) flip_h: Option<bool>,
    pub(super) flip_v: Option<bool>,
}

pub(super) fn from_frame_or_defaults(
    chart_frame: Option<&ChartDrawingFrameOoxmlProps>,
    default_off_x: i64,
    default_off_y: i64,
    default_ext_cx: i64,
    default_ext_cy: i64,
) -> ChartFrameTransform {
    let xfrm = chart_frame.and_then(|frame| {
        frame
            .graphic_frame
            .has_explicit_xfrm()
            .then_some(&frame.graphic_frame.xfrm)
    });

    ChartFrameTransform {
        has_xfrm: chart_frame
            .map(|frame| frame.graphic_frame.has_explicit_xfrm())
            .unwrap_or(true),
        has_off: xfrm
            .map(|xfrm| xfrm.offset.is_some())
            .unwrap_or(chart_frame.is_none()),
        has_ext: xfrm
            .map(|xfrm| xfrm.extent.is_some())
            .unwrap_or(chart_frame.is_none()),
        off_x: xfrm.map(|xfrm| xfrm.off_x()).unwrap_or(default_off_x),
        off_y: xfrm.map(|xfrm| xfrm.off_y()).unwrap_or(default_off_y),
        ext_cx: xfrm
            .map(|xfrm| xfrm.ext_cx() as i64)
            .unwrap_or(default_ext_cx),
        ext_cy: xfrm
            .map(|xfrm| xfrm.ext_cy() as i64)
            .unwrap_or(default_ext_cy),
        rot: xfrm.and_then(|xfrm| xfrm.rotation).map(|rot| rot.value()),
        flip_h: xfrm.and_then(|xfrm| xfrm.flip_h),
        flip_v: xfrm.and_then(|xfrm| xfrm.flip_v),
    }
}
