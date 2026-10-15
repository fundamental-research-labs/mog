#!/usr/bin/env python3
"""Record actual native candidate preparation using only synthetic local files."""
import argparse
import datetime as dt
import hashlib
import json
import os
from pathlib import Path
import platform
import subprocess
import tempfile
import time
import uuid

ROOT = Path(__file__).resolve().parents[3]
parser = argparse.ArgumentParser()
parser.add_argument('--binary', type=Path, required=True)
parser.add_argument('--source', required=True)
parser.add_argument('--binary-sha256', required=True)
parser.add_argument('--result', type=Path, required=True)
args = parser.parse_args()
binary = args.binary.resolve(strict=True)
assert hashlib.sha256(binary.read_bytes()).hexdigest() == args.binary_sha256
subprocess.run(['git', 'merge-base', '--is-ancestor', args.source, 'HEAD'], cwd=ROOT, check=True)
paths = ['Cargo.lock', 'Cargo.toml', 'compute/api', 'compute/officejs/src', 'compute/officejs/Cargo.toml']
assert not subprocess.check_output(['git', 'diff', args.source, '--', *paths], cwd=ROOT)
assert not args.result.exists(), 'refusing to overwrite acceptance result'
steps = []
started = dt.datetime.now(dt.timezone.utc).isoformat()


def step(message):
    print(message, flush=True)
    steps.append(message)
    time.sleep(1.5)  # Presentation hold after assertions; never correctness synchronization.


with tempfile.TemporaryDirectory(prefix='mog-candidate-acceptance-') as folder:
    workspace = Path(folder).resolve()
    environment = dict(os.environ, MOG_SESSION_DIR=str(workspace / 'sessions'))

    def run(*arguments, failure=None):
        result = subprocess.run([str(binary), *arguments], cwd=workspace, env=environment,
                                capture_output=True, text=True, timeout=15)
        if failure is not None:
            assert result.returncode != 0 and failure in result.stderr, result.stderr
        else:
            assert result.returncode == 0, result.stderr
        return result.stdout.strip()

    def new_id():
        return uuid.uuid4().hex

    def prepare(task, request):
        return json.loads(run('--prepare-output', task, '--output-request', request,
                              '--output-budget-ms', '10000'))

    print('NATIVE MOG | registered live workbook candidate acceptance', flush=True)
    print(f'Source {args.source}', flush=True)
    print(f'Binary SHA256 {args.binary_sha256}', flush=True)
    print('Synthetic local files; no model, database, remote service or Excel host.', flush=True)
    try:
        capabilities = json.loads(run('--output-capabilities'))
        assert capabilities == {'protocol': 1, 'live_registered_cell_candidates': True,
                                'publishes_final_output': False}
        task, request = new_id(), new_id()
        session = run('--session', '--output-task', task, '--intended-output', 'result.xlsx',
                      '--output', 'wrong.xlsx')
        assert not (workspace / 'result.xlsx').exists()
        step('PASS 1 | Explicit task/workbook registration; final result does not exist.')
        edit = """await Excel.run(async c => {
          const s=c.workbook.worksheets.getItem('Sheet1');
          s.getRange('A1').values=[[21]];
          s.getRange('B1').formulas=[['=A1*2']]; await c.sync();
        });"""
        run('--session', session, '--eval', edit)
        candidate = prepare(task, request)
        assert candidate['outcome'] == 'candidate_saved', candidate
        assert candidate['task_id'] == task and candidate['workbook_id'] == session
        assert candidate['request_id'] == request
        assert candidate['evidence']['status'] == 'net_cell_edit'
        path = Path(candidate['path'])
        assert path.parent == workspace and path != workspace / 'result.xlsx'
        assert hashlib.sha256(path.read_bytes()).hexdigest() == candidate['sha256']
        assert path.stat().st_size == candidate['size_bytes']
        step(f"PASS 2 | One separate atomic candidate: {candidate['size_bytes']} bytes; digest verified.")
        reader = run('--session', '--input', str(path))
        observed = json.loads(run('--session', reader, '--eval', """return await Excel.run(async c => {
          const r=c.workbook.worksheets.getItem('Sheet1').getRange('A1:B1');
          r.load('values,formulas'); await c.sync(); return {values:r.values,formulas:r.formulas};
        });"""))
        run('--session', reader, '--close', '--discard')
        assert observed['values'] == [[21, 42]] and observed['formulas'][0][1] == '=A1*2'
        assert hashlib.sha256(path.read_bytes()).hexdigest() == candidate['sha256']
        step('PASS 3 | Independent native reader sees A1=21, B1=42 and formula =A1*2.')
        assert prepare(task, request) == candidate
        run('--session', session, '--eval', edit, failure='frozen')
        run('--prepare-output', task, '--output-request', new_id(), '--output-budget-ms', '10000',
            failure='already_attempted')
        step('PASS 4 | Identical repeat receipt; late edits and second save attempt rejected.')
        unchanged = new_id()
        reverting = run('--session', '--output-task', unchanged, '--intended-output', 'reverted.xlsx')
        run('--session', reverting, '--eval', """await Excel.run(async c => {
          const r=c.workbook.worksheets.getItem('Sheet1').getRange('A1');
          r.values=[[99]]; await c.sync(); r.values=[['']]; await c.sync();
        });""")
        rejected = prepare(unchanged, new_id())
        assert rejected['outcome'] == 'unavailable' and rejected['reason'] == 'no_net_cell_edits'
        assert rejected['path'] is None
        step('PASS 5 | Edit then revert is unavailable; it cannot masquerade as completed work.')
        cancelled = new_id()
        cancel_session = run('--session', '--output-task', cancelled, '--intended-output', 'cancelled.xlsx')
        run('--session', cancel_session, '--eval', edit)
        run('--cancel-output', cancelled)
        run('--prepare-output', cancelled, '--output-request', new_id(), '--output-budget-ms', '10000',
            failure='output_cancelled')
        assert not any((workspace / name).exists() for name in ['result.xlsx', 'reverted.xlsx', 'cancelled.xlsx', 'wrong.xlsx'])
        step('PASS 6 | Cancelled work is rejected; no declared final output has been published.')
    finally:
        run('--close-all', '--discard')
        remaining = [p for p in (workspace / 'sessions').glob('*.json') if not p.name.startswith('output-')]
        assert not remaining, 'worker cleanup incomplete'
    result = {'source_commit': args.source, 'binary_sha256': args.binary_sha256,
              'platform': platform.system() + '/' + platform.machine(), 'started_at': started,
              'finished_at': dt.datetime.now(dt.timezone.utc).isoformat(), 'steps': steps,
              'native_reader_observed': observed, 'candidate_sha256': candidate['sha256'],
              'candidate_bytes': candidate['size_bytes'], 'remaining_native_workers': 0,
              'publishes_final_output': False, 'terminal_task_success': False,
              'coverage': 'Actual local native CLI; candidate staging only, no Excel or platform image claim.'}
assert not workspace.exists(), 'synthetic workspace cleanup incomplete'
step('PASS 7 | All task-owned native workers closed; synthetic files removed.')
args.result.parent.mkdir(parents=True, exist_ok=True)
args.result.write_text(json.dumps(result, indent=2) + '\n')
print('ACCEPTED | native candidate slice only; host validation/publication remains separate.', flush=True)
