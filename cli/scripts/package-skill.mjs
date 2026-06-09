import { deflateRawSync } from 'node:zlib';
import { mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const cliRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const repoRoot = resolve(cliRoot, '..');
const skillRoot = resolve(cliRoot, 'skill');
const skillApiSpecPath = resolve(skillRoot, 'references', 'api-spec.json');
const sdkApiSpecPath = resolve(repoRoot, 'runtime', 'sdk', 'src', 'generated', 'api-spec.json');
const artifactsDir = resolve(repoRoot, 'artifacts');
const zipPath = resolve(artifactsDir, 'mog-cli-kernel.skill.zip');
const allowedEntries = ['SKILL.md', 'references/api-spec.json'];
const crcTable = makeCrc32Table();
const packageVersion = releasePackageVersion();

const skillSource = readFileSync(resolve(skillRoot, 'SKILL.md'), 'utf8');
assertNoPinnedInstallVersions(skillSource, 'cli/skill/SKILL.md');
assertNoForbiddenInstallPaths(skillSource, 'cli/skill/SKILL.md');
assertSkillRootContract();
assertApiSpecSynced();

mkdirSync(artifactsDir, { recursive: true });
rmSync(zipPath, { force: true });

const entries = [
  {
    name: 'SKILL.md',
    data: Buffer.from(skillSource, 'utf8'),
  },
  {
    name: 'references/api-spec.json',
    data: readFileSync(skillApiSpecPath),
  },
];
assertEntriesExactly(entries.map((entry) => entry.name));
assertNoPinnedInstallVersions(entries[0].data.toString('utf8'), 'packaged SKILL.md');
assertNoForbiddenInstallPaths(entries[0].data.toString('utf8'), 'packaged SKILL.md');
assertPackagedApiSpecVersion(entries[1].data);

writeFileSync(zipPath, makeZip(entries));

console.log(
  JSON.stringify({ ok: true, zipPath, entries: entries.map((entry) => entry.name) }, null, 2),
);

function assertSkillRootContract() {
  const actual = collectFiles(skillRoot).map((path) => {
    return relative(skillRoot, path).split(sep).join('/');
  });
  assertEntriesExactly(actual);
}

function assertEntriesExactly(actual) {
  const expected = [...allowedEntries].sort();
  const sorted = [...actual].sort();
  if (JSON.stringify(sorted) !== JSON.stringify(expected)) {
    throw new Error(
      `mog-cli-kernel skill must contain exactly ${expected.join(', ')}; found ${sorted.join(', ')}`,
    );
  }
}

function assertApiSpecSynced() {
  const sdkSpec = readJson(sdkApiSpecPath);
  const skillSpec = readJson(skillApiSpecPath);
  assertApiSpecPackageVersion(sdkSpec, sdkApiSpecPath);
  assertApiSpecPackageVersion(skillSpec, skillApiSpecPath);
  if (JSON.stringify(skillSpec) !== JSON.stringify(sdkSpec)) {
    throw new Error(
      `cli/skill/references/api-spec.json is not synchronized with runtime/sdk/src/generated/api-spec.json. Run pnpm --filter @mog-sdk/sdk generate:api-spec and copy the generated spec into the CLI skill reference.`,
    );
  }
}

function assertPackagedApiSpecVersion(data) {
  assertApiSpecPackageVersion(
    JSON.parse(data.toString('utf8')),
    'packaged references/api-spec.json',
  );
}

function assertApiSpecPackageVersion(spec, label) {
  if (spec.package?.name !== '@mog-sdk/sdk' || spec.package?.version !== packageVersion) {
    throw new Error(
      `${label} must declare package metadata @mog-sdk/sdk@${packageVersion}; found ${JSON.stringify(spec.package)}`,
    );
  }
}

function assertNoPinnedInstallVersions(source, label) {
  const patterns = [
    /@mog-sdk\/cli@[0-9]+\.[0-9]+\.[0-9]+(?:-[A-Za-z0-9_.-]+)?/g,
    /@mog\/cli@[0-9]+\.[0-9]+\.[0-9]+(?:-[A-Za-z0-9_.-]+)?/g,
    /mog-cli-v[0-9]+\.[0-9]+\.[0-9]+(?:-[A-Za-z0-9_.-]+)?/g,
  ];
  const pinned = [];
  for (const pattern of patterns) {
    for (const match of source.matchAll(pattern)) {
      pinned.push(match[0]);
    }
  }
  if (pinned.length > 0) {
    throw new Error(
      `${label} must not pin CLI install versions; found ${pinned.join(', ')}`,
    );
  }
}

function assertNoForbiddenInstallPaths(source, label) {
  const forbidden = /raw\.githubusercontent|github\.com\/[^\s`'"]+\/releases|r2\.dev|\bcurl\b/i;
  if (forbidden.test(source)) {
    throw new Error(
      `${label} references a forbidden raw GitHub, GitHub Releases, R2, or curl install path`,
    );
  }
}

function collectFiles(dir) {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = resolve(dir, entry.name);
    if (entry.isDirectory()) return collectFiles(path);
    if (entry.isFile()) return [path];
    return [];
  });
}

function releasePackageVersion() {
  const packageJson = readJson(resolve(cliRoot, 'package.json'));
  const sdkPackageJson = readJson(resolve(repoRoot, 'runtime', 'sdk', 'package.json'));
  if (packageJson.version !== sdkPackageJson.version) {
    throw new Error(
      `@mog-sdk/cli version ${packageJson.version} must match @mog-sdk/sdk version ${sdkPackageJson.version}`,
    );
  }
  return packageJson.version;
}

function readJson(path) {
  return JSON.parse(readFileSync(path, 'utf8'));
}

function makeZip(files) {
  const localParts = [];
  const centralParts = [];
  let offset = 0;

  for (const file of files) {
    const name = Buffer.from(file.name, 'utf8');
    const compressed = deflateRawSync(file.data);
    const crc = crc32(file.data);
    const { dosTime, dosDate } = dosDateTime(new Date());

    const localHeader = Buffer.alloc(30);
    localHeader.writeUInt32LE(0x04034b50, 0);
    localHeader.writeUInt16LE(20, 4);
    localHeader.writeUInt16LE(0, 6);
    localHeader.writeUInt16LE(8, 8);
    localHeader.writeUInt16LE(dosTime, 10);
    localHeader.writeUInt16LE(dosDate, 12);
    localHeader.writeUInt32LE(crc, 14);
    localHeader.writeUInt32LE(compressed.length, 18);
    localHeader.writeUInt32LE(file.data.length, 22);
    localHeader.writeUInt16LE(name.length, 26);
    localHeader.writeUInt16LE(0, 28);

    localParts.push(localHeader, name, compressed);

    const centralHeader = Buffer.alloc(46);
    centralHeader.writeUInt32LE(0x02014b50, 0);
    centralHeader.writeUInt16LE(20, 4);
    centralHeader.writeUInt16LE(20, 6);
    centralHeader.writeUInt16LE(0, 8);
    centralHeader.writeUInt16LE(8, 10);
    centralHeader.writeUInt16LE(dosTime, 12);
    centralHeader.writeUInt16LE(dosDate, 14);
    centralHeader.writeUInt32LE(crc, 16);
    centralHeader.writeUInt32LE(compressed.length, 20);
    centralHeader.writeUInt32LE(file.data.length, 24);
    centralHeader.writeUInt16LE(name.length, 28);
    centralHeader.writeUInt16LE(0, 30);
    centralHeader.writeUInt16LE(0, 32);
    centralHeader.writeUInt16LE(0, 34);
    centralHeader.writeUInt16LE(0, 36);
    centralHeader.writeUInt32LE(0, 38);
    centralHeader.writeUInt32LE(offset, 42);
    centralParts.push(centralHeader, name);

    offset += localHeader.length + name.length + compressed.length;
  }

  const centralDirectory = Buffer.concat(centralParts);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(0, 4);
  end.writeUInt16LE(0, 6);
  end.writeUInt16LE(files.length, 8);
  end.writeUInt16LE(files.length, 10);
  end.writeUInt32LE(centralDirectory.length, 12);
  end.writeUInt32LE(offset, 16);
  end.writeUInt16LE(0, 20);

  return Buffer.concat([...localParts, centralDirectory, end]);
}

function dosDateTime(date) {
  const year = Math.max(date.getFullYear(), 1980);
  return {
    dosTime: (date.getHours() << 11) | (date.getMinutes() << 5) | Math.floor(date.getSeconds() / 2),
    dosDate: ((year - 1980) << 9) | ((date.getMonth() + 1) << 5) | date.getDate(),
  };
}

function crc32(data) {
  let crc = 0xffffffff;
  for (const byte of data) {
    crc = (crc >>> 8) ^ crcTable[(crc ^ byte) & 0xff];
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function makeCrc32Table() {
  const table = new Uint32Array(256);
  for (let i = 0; i < table.length; i += 1) {
    let value = i;
    for (let bit = 0; bit < 8; bit += 1) {
      value = value & 1 ? 0xedb88320 ^ (value >>> 1) : value >>> 1;
    }
    table[i] = value >>> 0;
  }
  return table;
}
