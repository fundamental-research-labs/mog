#!/usr/bin/env python3
"""Reject incomplete or inconsistent release artifacts before publication."""
import argparse
import hashlib
import json
from pathlib import Path
import tarfile
import zipfile

from package import NAME, ROOT, TARGETS, VERSION


def npm_manifest(path, executable, require_executable=True):
    with tarfile.open(path) as archive:
        files = {m.name: m for m in archive.getmembers() if m.isfile()}
        assert set(files) == {'package/package.json', 'package/LICENSE', 'package/README.md', f'package/{executable}'}, path
        manifest = json.load(archive.extractfile('package/package.json'))
        assert manifest['version'] == VERSION, path
        assert 'scripts' not in manifest and 'dependencies' not in manifest, path
        if require_executable:
            assert files[f'package/{executable}'].mode & 0o111, path
        digest = hashlib.file_digest(archive.extractfile(f'package/{executable}'), 'sha256').hexdigest()
    return manifest, digest


def check(directory):
    expected = {f'mog-sdk-cli-{VERSION}.tgz'}
    wrapper, _ = npm_manifest(directory / f'mog-sdk-cli-{VERSION}.tgz', 'mog.cjs')
    assert wrapper['name'] == NAME and wrapper['bin'] == {'mog': 'mog.cjs'}
    assert wrapper['optionalDependencies'] == {
        f"{NAME}-{t['platform']}-{t['arch']}": VERSION for t in TARGETS
    }
    for target in TARGETS:
        suffix = f"{target['platform']}-{target['arch']}"
        windows = target['platform'] == 'win32'
        executable = 'mog.exe' if windows else 'mog'
        npm = f'mog-sdk-cli-{suffix}-{VERSION}.tgz'
        native = f'mog-{VERSION}-{suffix}' + ('.zip' if windows else '.tar.gz')
        expected.update([npm, native])
        manifest, digest = npm_manifest(directory / npm, f'bin/{executable}', require_executable=not windows)
        assert manifest['name'] == f'{NAME}-{suffix}'
        assert manifest['os'] == [target['platform']] and manifest['cpu'] == [target['arch']]
        assert manifest.get('libc') == (['glibc'] if target['platform'] == 'linux' else None)
        if windows:
            with zipfile.ZipFile(directory / native) as archive:
                assert set(archive.namelist()) == {executable, 'LICENSE'}
                with archive.open(executable) as binary:
                    native_digest = hashlib.file_digest(binary, 'sha256').hexdigest()
        else:
            with tarfile.open(directory / native) as archive:
                assert set(archive.getnames()) == {executable, 'LICENSE'}
                assert archive.getmember(executable).mode & 0o111
                native_digest = hashlib.file_digest(archive.extractfile(executable), 'sha256').hexdigest()
        assert native_digest == digest, f'{suffix}: native and npm binaries differ'
    actual = {p.name for p in directory.iterdir() if p.name != 'SHA256SUMS'}
    assert actual == expected, f'Unexpected or missing artifacts: {actual ^ expected}'
    print(f'Checked {len(expected)} artifacts for Mog {VERSION}')


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--artifacts', type=Path, default=ROOT / 'artifacts/release')
    check(parser.parse_args().artifacts)
