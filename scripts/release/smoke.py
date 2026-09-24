#!/usr/bin/env python3
"""Install packed npm artifacts offline and exercise the shipped executable."""
import argparse
import json
import os
from pathlib import Path
import shutil
import subprocess
import tempfile

from package import NAME, ROOT, TARGETS, VERSION


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--target', required=True, choices=[t['target'] for t in TARGETS])
    parser.add_argument('--artifacts', type=Path, default=ROOT / 'artifacts/release')
    args = parser.parse_args()
    target = next(t for t in TARGETS if t['target'] == args.target)
    suffix = f"{target['platform']}-{target['arch']}"
    artifacts = args.artifacts.resolve()
    with tempfile.TemporaryDirectory(prefix='mog npm smoke ') as temp:
        directory = Path(temp)
        (directory / 'package.json').write_text('{"private":true}')
        subprocess.run([
            shutil.which('npm'), 'install', '--offline', '--ignore-scripts', '--no-audit', '--no-fund',
            str(artifacts / f'mog-sdk-cli-{suffix}-{VERSION}.tgz'),
            str(artifacts / f'mog-sdk-cli-{VERSION}.tgz'),
        ], cwd=directory, check=True)
        launcher = directory / 'node_modules/@mog-sdk/cli/mog.cjs'
        manifest = json.loads(launcher.with_name('package.json').read_text())
        assert 'dependencies' not in manifest and 'scripts' not in manifest
        assert manifest['name'] == NAME and manifest['version'] == VERSION
        shim = subprocess.run([shutil.which('npm'), 'exec', '--offline', '--', 'mog', '--version'],
                              cwd=directory, text=True, capture_output=True, check=True)
        assert shim.stdout.strip() == f'mog {VERSION}'
        command = [shutil.which('node'), str(launcher)]

        def run(*args, success=True):
            result = subprocess.run(command + list(args), cwd=directory, text=True, capture_output=True)
            assert (result.returncode == 0) == success, (result.returncode, result.stdout, result.stderr)
            return result

        assert run('--version').stdout.strip() == f'mog {VERSION}'
        assert 'Usage: mog' in run('--help').stdout
        assert not list(directory.glob('*.xlsx'))
        assert 'unknown option' in run('--not-an-option', success=False).stderr
        assert 'script failure' in run('-e', 'throw new Error("script failure")',
                                       '-o', 'failed.xlsx', success=False).stderr
        assert not (directory / 'failed.xlsx').exists()
        script = directory / 'formula with spaces.js'
        shutil.copyfile(ROOT / 'compute/officejs/examples/formula.js', script)
        assert run('-f', str(script), '-o', 'output with spaces.xlsx').stdout.strip() == '20'
        assert (directory / 'output with spaces.xlsx').stat().st_size > 0
        # Sessions must survive the npm launcher and retain workbook changes.
        env_dir = directory / 'sessions'
        os.environ['MOG_SESSION_DIR'] = str(env_dir)
        session = run('-s', '-i', 'output with spaces.xlsx').stdout.strip()
        read_result = '''await Excel.run(async c => {
            const r = c.workbook.worksheets.getItem("Sheet1").getRange("A2");
            r.load("values");
            await c.sync();
            console.log(r.values[0][0]);
        });'''
        try:
            assert run('-s', session, '-e', read_result).stdout.strip() == '20'
            run('-s', session, '-e', '''await Excel.run(async c => {
                c.workbook.worksheets.getItem("Sheet1").getRange("A1").values = [[21]];
                await c.sync();
            });''')
            assert run('-s', session, '-e', read_result).stdout.strip() == '42'
            run('-s', session, '--close', '-o', 'session.xlsx')
            assert run('-i', 'session.xlsx', '-e', read_result).stdout.strip() == '42'
        finally:
            run('--close-all', '--discard')
        # Missing optional binaries fail clearly without downloading code.
        binary_package = directory / f'node_modules/{NAME}-{suffix}'
        binary_package.rename(binary_package.with_name('hidden-native-package'))
        assert 'optional dependencies enabled' in run('--version', success=False).stderr
    print(f'Packed npm CLI passed: {suffix} {VERSION}')


if __name__ == '__main__':
    main()
