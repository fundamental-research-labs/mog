import { deflateRawSync } from 'node:zlib';
import { mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const cliRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const repoRoot = resolve(cliRoot, '..');
const skillRoot = resolve(cliRoot, 'skill');
const artifactsDir = resolve(repoRoot, 'artifacts');
const zipPath = resolve(artifactsDir, 'mog-cli-kernel.skill.zip');
const crcTable = makeCrc32Table();
const packageVersion = releasePackageVersion();

mkdirSync(artifactsDir, { recursive: true });
rmSync(zipPath, { force: true });

const entries = collectFiles(skillRoot).map((path) => {
  const name = relative(skillRoot, path).split(sep).join('/');
  return { name, data: fileData(name, path) };
});

writeFileSync(zipPath, makeZip(entries));

console.log(
  JSON.stringify({ ok: true, zipPath, entries: entries.map((entry) => entry.name) }, null, 2),
);

function collectFiles(dir) {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = resolve(dir, entry.name);
    if (entry.isDirectory()) return collectFiles(path);
    if (entry.isFile()) return [path];
    return [];
  });
}

function fileData(name, path) {
  const data = readFileSync(path);
  if (name !== 'SKILL.md') return data;
  return Buffer.from(
    data
      .toString('utf8')
      .replace(
        /mog-cli-v[0-9]+\.[0-9]+\.[0-9]+(?:-[A-Za-z0-9_.-]+)?/g,
        `mog-cli-v${packageVersion}`,
      )
      .replace(
        /@mog\/cli@[0-9]+\.[0-9]+\.[0-9]+(?:-[A-Za-z0-9_.-]+)?/g,
        `@mog-sdk/cli@${packageVersion}`,
      ),
    'utf8',
  );
}

function releasePackageVersion() {
  const packageJson = JSON.parse(readFileSync(resolve(cliRoot, 'package.json'), 'utf8'));
  const sdkPackageJson = JSON.parse(
    readFileSync(resolve(repoRoot, 'runtime', 'sdk', 'package.json'), 'utf8'),
  );
  if (packageJson.version !== sdkPackageJson.version) {
    throw new Error(
      `@mog-sdk/cli version ${packageJson.version} must match @mog-sdk/sdk version ${sdkPackageJson.version}`,
    );
  }
  return packageJson.version;
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
