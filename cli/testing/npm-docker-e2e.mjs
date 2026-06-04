import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, join, resolve } from 'node:path';

const repoRoot = resolve(import.meta.dirname, '..', '..');
const cliRoot = resolve(repoRoot, 'cli');
const tarballPath = latestCliTarball();
const root = mkdtempSync(join(tmpdir(), 'mog-cli-docker-e2e-'));
const workdir = join(root, 'work');
const image = process.env.MOG_CLI_DOCKER_IMAGE ?? 'node:22-bookworm';
const platformArgs = process.env.MOG_CLI_DOCKER_PLATFORM
  ? ['--platform', process.env.MOG_CLI_DOCKER_PLATFORM]
  : [];

try {
  mkdirSync(workdir, { recursive: true });

  const script = `
set -euo pipefail
mkdir -p /tmp/mog-prefix /work/workbooks
npm install --prefix /tmp/mog-prefix --global /artifacts/${basename(tarballPath)} >&2
MOG=/tmp/mog-prefix/bin/mog
test -x "$MOG"
"$MOG" --help >/dev/null
created="$("$MOG" create --name docker-smoke --path /work/workbooks)"
id="$(node -e 'console.log(JSON.parse(process.argv[1]).id)' "$created")"
test -n "$id"
executed="$("$MOG" execute --id "$id" --code 'await ws.setCell("A1", "docker ok"); await ws.setCell("B1", "=LEN(A1)"); return { a1: await ws.getValue("A1"), b1: await ws.getValue("B1") };')"
node -e 'const result = JSON.parse(process.argv[1]).result; if (result.a1 !== "docker ok" || result.b1 !== 9) throw new Error(JSON.stringify(result));' "$executed"
"$MOG" commit --id "$id" >/dev/null
"$MOG" unload --id "$id" >/dev/null
"$MOG" shutdown >/dev/null
test -f /work/workbooks/docker-smoke.xlsx
node -e 'console.log(JSON.stringify({ ok: true, workbookPath: "/work/workbooks/docker-smoke.xlsx" }, null, 2))'
`.trim();

  const output = execFileSync(
    'docker',
    [
      'run',
      '--rm',
      ...platformArgs,
      '-v',
      `${tarballPath}:/artifacts/${basename(tarballPath)}:ro`,
      '-v',
      `${workdir}:/work`,
      '-w',
      '/work',
      image,
      'bash',
      '-lc',
      script,
    ],
    { cwd: repoRoot, encoding: 'utf8', stdio: ['ignore', 'pipe', 'inherit'] },
  );

  console.log(
    JSON.stringify(
      {
        ok: true,
        image,
        platform: process.env.MOG_CLI_DOCKER_PLATFORM ?? null,
        tarballPath,
        containerResult: JSON.parse(output),
      },
      null,
      2,
    ),
  );
} finally {
  rmSync(root, { recursive: true, force: true });
}

function latestCliTarball() {
  const { version } = JSON.parse(readFileSync(resolve(cliRoot, 'package.json'), 'utf8'));
  const tarball = resolve(repoRoot, 'artifacts', 'npm', `mog-cli-${version}.tgz`);
  if (!existsSync(tarball)) throw new Error(`No @mog/cli npm tarball found at ${tarball}`);
  return tarball;
}
