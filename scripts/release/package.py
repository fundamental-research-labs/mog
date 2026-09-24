#!/usr/bin/env python3
"""Package already-built binaries. Cargo.toml is the only version source."""
import argparse
import json
from pathlib import Path
import shutil
import subprocess
import tarfile
import tempfile
import tomllib
import zipfile

ROOT = Path(__file__).resolve().parents[2]
TARGETS = json.loads((ROOT / 'scripts/release/targets.json').read_text())
PACKAGE = tomllib.loads((ROOT / 'compute/officejs/Cargo.toml').read_text())['package']
VERSION = PACKAGE['version']
NAME = '@mog-sdk/cli'


def metadata(name):
    return {
        'name': name,
        'version': VERSION,
        'description': 'Native spreadsheet CLI with the Office.js Excel API',
        'license': 'Apache-2.0',
        'homepage': 'https://sheetmog.ai',
        'repository': {
            'type': 'git',
            'url': 'https://github.com/fundamental-research-labs/mog.git',
            'directory': 'packaging/npm',
        },
        'publishConfig': {'access': 'public'},
    }


def pack(directory, manifest, output):
    (directory / 'package.json').write_text(json.dumps(manifest, indent=2) + '\n')
    shutil.copyfile(ROOT / 'LICENSE', directory / 'LICENSE')
    shutil.copyfile(ROOT / 'packaging/npm/README.md', directory / 'README.md')
    subprocess.run([shutil.which('npm'), 'pack', '--ignore-scripts',
                    '--pack-destination', str(output)], cwd=directory, check=True)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--target', choices=[t['target'] for t in TARGETS])
    parser.add_argument('--binary', type=Path)
    parser.add_argument('--output', type=Path, default=ROOT / 'artifacts/release')
    args = parser.parse_args()
    if bool(args.target) != bool(args.binary):
        parser.error('--target and --binary must be supplied together; omit both for the launcher')
    output = args.output.resolve()
    output.mkdir(parents=True, exist_ok=True)
    with tempfile.TemporaryDirectory(prefix='mog-package-') as temp:
        directory = Path(temp)
        if not args.target:
            manifest = metadata(NAME)
            manifest.update({
                'bin': {'mog': 'mog.cjs'},
                'files': ['mog.cjs'],
                'engines': {'node': '>=22'},
                'optionalDependencies': {
                    f"{NAME}-{t['platform']}-{t['arch']}": VERSION for t in TARGETS
                },
            })
            shutil.copyfile(ROOT / 'packaging/npm/mog.cjs', directory / 'mog.cjs')
            (directory / 'mog.cjs').chmod(0o755)
        else:
            target = next(t for t in TARGETS if t['target'] == args.target)
            suffix = f"{target['platform']}-{target['arch']}"
            executable = 'mog.exe' if target['platform'] == 'win32' else 'mog'
            manifest = metadata(f'{NAME}-{suffix}')
            manifest.update({'os': [target['platform']], 'cpu': [target['arch']], 'files': ['bin']})
            if target['platform'] == 'linux':
                manifest['libc'] = ['glibc']
            (directory / 'bin').mkdir()
            binary = directory / 'bin' / executable
            shutil.copyfile(args.binary, binary)
            binary.chmod(0o755)
            # Native archives and npm packages contain the very same executable.
            archive = output / f'mog-{VERSION}-{suffix}'
            if target['platform'] == 'win32':
                with zipfile.ZipFile(str(archive) + '.zip', 'w', zipfile.ZIP_DEFLATED) as dest:
                    dest.write(binary, executable)
                    dest.write(ROOT / 'LICENSE', 'LICENSE')
            else:
                with tarfile.open(str(archive) + '.tar.gz', 'w:gz') as dest:
                    dest.add(binary, arcname=executable)
                    dest.add(ROOT / 'LICENSE', arcname='LICENSE')
        pack(directory, manifest, output)


if __name__ == '__main__':
    main()
