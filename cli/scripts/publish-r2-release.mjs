import { createHash } from 'node:crypto';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const cliRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const repoRoot = resolve(cliRoot, '..');
const artifactsDir = resolve(repoRoot, 'artifacts');

const accountId = requiredEnv('CLOUDFLARE_ACCOUNT_ID');
const apiToken = requiredEnv('CLOUDFLARE_API_TOKEN');
const bucket = process.env.MOG_CLI_RELEASE_BUCKET || 'mog-cli-releases';
const prefix = trimSlashes(process.env.MOG_CLI_RELEASE_PREFIX || 'latest');
const platform = currentPlatform();
const apiBase = `https://api.cloudflare.com/client/v4/accounts/${accountId}`;

const assets = [
  asset('install-mog-cli.sh', 'text/x-shellscript'),
  asset('mog-cli-kernel.skill.zip', 'application/zip'),
  asset(`mog-cli-${platform}.tar.gz`, 'application/gzip'),
];

await ensureBucket();
const publicBaseUrl = await ensurePublicManagedDomain();
const releaseBaseUrl = `${publicBaseUrl}/${prefix}`;

writeChecksums(assets);
assets.push(asset('SHA256SUMS', 'text/plain'));

for (const entry of assets) {
  const key = `${prefix}/${entry.name}`;
  await putObject(key, entry.path, entry.contentType);
}

console.log(
  JSON.stringify(
    {
      ok: true,
      bucket,
      prefix,
      publicBaseUrl,
      releaseBaseUrl,
      installCommand: `curl -fsSL ${releaseBaseUrl}/install-mog-cli.sh | sh`,
      assets: assets.map((entry) => ({
        name: entry.name,
        url: `${releaseBaseUrl}/${entry.name}`,
        sha256: sha256(readFileSync(entry.path)),
      })),
    },
    null,
    2,
  ),
);

function asset(name, contentType) {
  const path = resolve(artifactsDir, name);
  if (!existsSync(path)) {
    throw new Error(
      `Missing release artifact: ${path}. Run pnpm --filter @mog/cli package:release first.`,
    );
  }
  return { name, path, contentType };
}

function writeChecksums(entries) {
  const lines = entries
    .map((entry) => `${sha256(readFileSync(entry.path))}  ${entry.name}`)
    .sort()
    .join('\n');
  writeFileSync(resolve(artifactsDir, 'SHA256SUMS'), `${lines}\n`);
}

async function ensureBucket() {
  const body = await cf('/r2/buckets');
  const buckets = Array.isArray(body.result?.buckets)
    ? body.result.buckets
    : Array.isArray(body.result)
      ? body.result
      : [];
  if (buckets.some((entry) => entry.name === bucket)) return;
  await cf('/r2/buckets', { method: 'POST', body: JSON.stringify({ name: bucket }) });
}

async function ensurePublicManagedDomain() {
  const body = await cf(`/r2/buckets/${encodeURIComponent(bucket)}/domains/managed`, {
    method: 'PUT',
    body: JSON.stringify({ enabled: true }),
  });
  const domain = body.result?.domain;
  if (!domain || body.result?.enabled !== true) {
    throw new Error(`R2 managed public domain was not enabled for bucket ${bucket}`);
  }
  return `https://${domain}`;
}

async function putObject(key, path, contentType) {
  const data = readFileSync(path);
  await cf(`/r2/buckets/${encodeURIComponent(bucket)}/objects/${encodeURIComponent(key)}`, {
    method: 'PUT',
    headers: {
      'Content-Type': contentType,
      'Cache-Control':
        key.startsWith('latest/') || key.includes('/latest/')
          ? 'public, max-age=60'
          : 'public, max-age=31536000, immutable',
    },
    body: data,
  });
}

async function cf(path, init = {}) {
  const headers = {
    Authorization: `Bearer ${apiToken}`,
    ...(init.body instanceof Uint8Array ? {} : { 'Content-Type': 'application/json' }),
    ...(init.headers || {}),
  };
  const res = await fetch(`${apiBase}${path}`, { ...init, headers });
  const text = await res.text();
  let body = null;
  try {
    body = text ? JSON.parse(text) : null;
  } catch {
    body = { text };
  }
  if (!res.ok || body?.success === false) {
    const errors = JSON.stringify(body?.errors || body);
    throw new Error(`${init.method || 'GET'} ${path}: ${res.status} ${res.statusText} ${errors}`);
  }
  return body;
}

function currentPlatform() {
  if (process.platform === 'darwin') return `darwin-${process.arch}`;
  if (process.platform === 'win32' && process.arch === 'x64') return 'win32-x64-msvc';
  if (process.platform === 'linux') {
    const glibc = process.report?.getReport?.().header?.glibcVersionRuntime;
    return `linux-${process.arch}-${glibc ? 'gnu' : 'musl'}`;
  }
  throw new Error(`Unsupported platform: ${process.platform}/${process.arch}`);
}

function requiredEnv(name) {
  const value = process.env[name];
  if (!value) throw new Error(`Missing required environment variable: ${name}`);
  return value;
}

function trimSlashes(value) {
  return value.replace(/^\/+|\/+$/g, '');
}

function sha256(data) {
  return createHash('sha256').update(data).digest('hex');
}
