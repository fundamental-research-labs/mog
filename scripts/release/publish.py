#!/usr/bin/env python3
"""Publish checked packages, platform binaries before the launcher."""
import argparse
import base64
import hashlib
import json
import shutil
import subprocess

from check import check
from package import NAME, ROOT, TARGETS, VERSION

parser = argparse.ArgumentParser(description=__doc__)
parser.add_argument('--dry-run', action='store_true')
args = parser.parse_args()
artifacts = ROOT / 'artifacts/release'
check(artifacts)
packages = [f"{NAME}-{t['platform']}-{t['arch']}" for t in TARGETS] + [NAME]
for name in packages:
    tarball = artifacts / f"{name.removeprefix('@').replace('/', '-')}-{VERSION}.tgz"
    # Permit retrying a partially completed publication, but never replace an
    # existing version or silently accept different bytes under the same name.
    with tarball.open('rb') as packed:
        integrity = 'sha512-' + base64.b64encode(hashlib.file_digest(packed, 'sha512').digest()).decode()
    if args.dry_run:
        subprocess.run([shutil.which('npm'), 'publish', str(tarball), '--dry-run'], check=True)
        continue
    existing = subprocess.run([shutil.which('npm'), 'view', f'{name}@{VERSION}', 'dist.integrity', '--json'],
                              text=True, capture_output=True)
    if existing.returncode == 0:
        assert json.loads(existing.stdout) == integrity, f'{name}@{VERSION} already exists with different contents'
        print(f'Already published: {name}@{VERSION}')
    else:
        error = json.loads(existing.stdout).get('error', {})
        assert error.get('code') == 'E404', existing.stderr
        subprocess.run([shutil.which('npm'), 'publish', str(tarball), '--access', 'public', '--provenance'], check=True)
