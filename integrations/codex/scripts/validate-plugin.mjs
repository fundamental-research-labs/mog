import { access, readFile, readdir, stat } from 'node:fs/promises';
import { join, resolve, sep } from 'node:path';

const repoRoot = resolve(import.meta.dirname, '../../..');
const pluginRoot = resolve(repoRoot, 'plugins/mog');
const marketplacePath = resolve(repoRoot, '.agents/plugins/marketplace.json');
const requireDist = process.argv.includes('--require-dist');

const failures = [];
const privateReferenceNeedles = [
  'mog' + '-internal',
  ['plans', 'active'].join('/'),
  ['private', 'agent'].join(' '),
];

function fail(message) {
  failures.push(message);
}

async function exists(path) {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}

async function readJson(path) {
  try {
    return JSON.parse(await readFile(path, 'utf8'));
  } catch (error) {
    fail(`${path} does not parse as JSON: ${error.message}`);
    return null;
  }
}

async function listFiles(root) {
  const entries = await readdir(root, { withFileTypes: true }).catch(() => []);
  const files = [];
  for (const entry of entries) {
    const path = join(root, entry.name);
    if (entry.isDirectory()) {
      files.push(...(await listFiles(path)));
    } else if (entry.isFile()) {
      files.push(path);
    }
  }
  return files;
}

function resolvePluginPath(path, label) {
  if (typeof path !== 'string') {
    fail(`${label} must be a string path`);
    return null;
  }
  if (!path.startsWith('./')) {
    fail(`${label} must start with ./`);
    return null;
  }
  const resolved = resolve(pluginRoot, path);
  if (resolved !== pluginRoot && !resolved.startsWith(`${pluginRoot}${sep}`)) {
    fail(`${label} must stay under plugins/mog`);
    return null;
  }
  return resolved;
}

function containsPrivateReference(text, needles = privateReferenceNeedles) {
  const normalized = text.toLowerCase();
  return needles.some((needle) => normalized.includes(needle.toLowerCase()));
}

async function validateManifest() {
  const manifestPath = resolve(pluginRoot, '.codex-plugin/plugin.json');
  const manifest = await readJson(manifestPath);
  if (!manifest) return;

  for (const field of ['name', 'version', 'description', 'homepage', 'repository', 'license']) {
    if (
      !manifest[field] ||
      String(manifest[field]).includes('TODO') ||
      String(manifest[field]).includes('example.com')
    ) {
      fail(`plugin.json ${field} is missing or placeholder`);
    }
  }
  if (manifest.name !== 'mog') fail('plugin.json name must be mog');
  if (!manifest.interface?.displayName) fail('plugin.json interface.displayName is required');
  if (!Array.isArray(manifest.keywords) || !manifest.keywords.includes('xlsx')) {
    fail('plugin.json keywords must include xlsx');
  }

  for (const [field, value] of Object.entries({
    skills: manifest.skills,
    mcpServers: manifest.mcpServers,
    composerIcon: manifest.interface?.composerIcon,
    logo: manifest.interface?.logo,
  })) {
    const resolved = resolvePluginPath(value, `plugin.json ${field}`);
    if (resolved && !(await exists(resolved))) {
      fail(`plugin.json ${field} points to missing path ${value}`);
    }
  }

  const artifactText = await readFile(manifestPath, 'utf8');
  if (containsPrivateReference(artifactText, privateReferenceNeedles.slice(0, 2))) {
    fail('plugin manifest contains private/internal references');
  }
}

async function validateMcp() {
  const mcpPath = resolve(pluginRoot, '.mcp.json');
  const mcp = await readJson(mcpPath);
  if (!mcp) return;
  const serverMap = mcp.mcp_servers ?? mcp.mcpServers ?? mcp;
  const server = serverMap.mog;
  if (!server) {
    fail('.mcp.json must expose a mog server');
    return;
  }
  if (server.command !== 'node') fail('.mcp.json mog.command must be node');
  if (!Array.isArray(server.args) || server.args[0] !== './dist/mcp/server.mjs') {
    fail('.mcp.json must launch ./dist/mcp/server.mjs');
  }
  const serialized = JSON.stringify(mcp);
  for (const forbidden of ['npx', '${PLUGIN_ROOT}', '${CLAUDE_PLUGIN_ROOT}']) {
    if (serialized.includes(forbidden)) fail(`.mcp.json must not contain ${forbidden}`);
  }
  if (requireDist && !(await exists(resolve(pluginRoot, 'dist/mcp/server.mjs')))) {
    fail('dist/mcp/server.mjs is missing; run pnpm --dir integrations/codex build');
  }
}

async function validateMarketplace() {
  const marketplace = await readJson(marketplacePath);
  if (!marketplace) return;
  const entry = marketplace.plugins?.find((plugin) => plugin.name === 'mog');
  if (!entry) {
    fail('marketplace is missing mog plugin entry');
    return;
  }
  if (entry.source?.path !== './plugins/mog')
    fail('marketplace mog source.path must be ./plugins/mog');
  if (entry.policy?.installation !== 'AVAILABLE')
    fail('marketplace mog installation policy must be AVAILABLE');
  if (entry.policy?.authentication !== 'ON_INSTALL')
    fail('marketplace mog authentication policy must be ON_INSTALL');
}

async function validateSkill() {
  const skillPath = resolve(pluginRoot, 'skills/mog-spreadsheet/SKILL.md');
  const skill = await readFile(skillPath, 'utf8').catch(() => null);
  if (!skill) {
    fail('mog-spreadsheet skill is missing');
    return;
  }
  if (!skill.startsWith('---\n')) fail('mog-spreadsheet skill must have YAML frontmatter');
  if (containsPrivateReference(skill)) {
    fail('mog-spreadsheet skill contains private/internal references');
  }
}

async function validateDist() {
  const distRoot = resolve(pluginRoot, 'dist');
  const browserIndex = resolve(pluginRoot, 'dist/browser/index.html');
  const browserJs = resolve(pluginRoot, 'dist/browser/assets/browser.js');
  const importMapPath = resolve(pluginRoot, 'dist/browser/assets/import-map.json');
  const distStats = await stat(distRoot).catch(() => null);
  if (!distStats?.isDirectory()) {
    if (requireDist) fail('plugins/mog/dist must be a directory');
    return;
  }

  if (requireDist) {
    for (const path of [browserIndex, browserJs, importMapPath]) {
      if (!(await exists(path))) fail(`Missing browser runtime artifact ${path}`);
    }
  }

  const distFiles = await listFiles(distRoot);
  const wasmFiles = distFiles.filter((path) => path.endsWith('.wasm'));
  if (wasmFiles.length > 0) {
    fail(
      `plugins/mog/dist must not vendor WASM files; use the published @mog-sdk/wasm package: ${wasmFiles.join(', ')}`,
    );
  }
  const fontFiles = distFiles.filter((path) => /\.(?:ttf|otf|woff2?)$/i.test(path));
  if (fontFiles.length > 0) {
    fail(
      `plugins/mog/dist must not vendor font files; use browser/system font fallback: ${fontFiles.join(', ')}`,
    );
  }

  if (!requireDist) return;

  const [manifest, wasmPackage, importMap] = await Promise.all([
    readJson(resolve(pluginRoot, '.codex-plugin/plugin.json')),
    readJson(resolve(repoRoot, 'compute/wasm/npm/package.json')),
    readJson(importMapPath),
  ]);
  if (manifest && wasmPackage && manifest.version !== wasmPackage.version) {
    fail(
      `plugin version ${manifest.version} must match @mog-sdk/wasm version ${wasmPackage.version}`,
    );
  }
  const expectedWasmModuleUrl = `https://cdn.jsdelivr.net/npm/@mog-sdk/wasm@${manifest?.version ?? wasmPackage?.version}/compute_core_wasm.js`;
  if (importMap?.imports?.['@mog-sdk/wasm'] !== expectedWasmModuleUrl) {
    fail(`import-map.json must map @mog-sdk/wasm to ${expectedWasmModuleUrl}`);
  }
  const browserIndexText = await readFile(browserIndex, 'utf8').catch(() => '');
  if (
    !browserIndexText.includes('<script type="importmap">') ||
    !browserIndexText.includes(expectedWasmModuleUrl)
  ) {
    fail('browser index must inline the @mog-sdk/wasm import map for Chrome compatibility');
  }
}

await validateManifest();
await validateMcp();
await validateMarketplace();
await validateSkill();
await validateDist();

if (failures.length > 0) {
  console.error(failures.map((failure) => `- ${failure}`).join('\n'));
  process.exit(1);
}

console.log('Mog Codex plugin validation passed');
