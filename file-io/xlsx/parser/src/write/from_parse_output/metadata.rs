use domain_types::{ParseOutput, RoundTripContext};

pub(super) fn metadata_xml_for_export(
    _output: &ParseOutput,
    _round_trip_ctx: Option<&RoundTripContext>,
) -> Option<Vec<u8>> {
    // `xl/metadata.xml` can describe mutable cell/value metadata such as
    // dynamic-array properties. Until we have a modeled writer for those
    // records, raw bytes are stale authority and must not be replayed.
    None
}
