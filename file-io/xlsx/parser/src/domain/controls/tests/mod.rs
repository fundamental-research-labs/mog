use crate::write::zip_writer::{CompressionMethod, ZipWriter};

fn archive_with(entries: &[(&str, &[u8])]) -> Vec<u8> {
    let mut writer = ZipWriter::with_compression(CompressionMethod::Store);
    for (path, bytes) in entries {
        writer.add_file(path, bytes.to_vec());
    }
    writer.finish().expect("test zip should be valid")
}

mod anchors;
mod form_control_props;
mod ole;
mod ole_writer;
mod read_facade;
mod roundtrip;
mod vml_controls;
mod worksheet_controls;
mod writers;
