import { createHash } from "node:crypto";
import {
  mkdir,
  readdir,
  readFile,
  rm,
  stat,
  writeFile,
} from "node:fs/promises";
import path from "node:path";
import { deflateRawSync } from "node:zlib";

const root = process.cwd();
const distDir = path.join(root, "extension-dist");
const releaseDir = path.join(root, "release");

function fail(message) {
  console.error(message);
  process.exit(1);
}

function crc32(buffer) {
  let crc = 0xffffffff;

  for (const byte of buffer) {
    crc ^= byte;
    for (let i = 0; i < 8; i += 1) {
      crc = (crc >>> 1) ^ (0xedb88320 & -(crc & 1));
    }
  }

  return (crc ^ 0xffffffff) >>> 0;
}

function dosDateTime(date) {
  const year = Math.max(date.getFullYear(), 1980);
  const dosTime =
    (date.getHours() << 11) |
    (date.getMinutes() << 5) |
    Math.floor(date.getSeconds() / 2);
  const dosDate =
    ((year - 1980) << 9) | ((date.getMonth() + 1) << 5) | date.getDate();

  return { dosDate, dosTime };
}

function writeUInt16(value) {
  const buffer = Buffer.allocUnsafe(2);
  buffer.writeUInt16LE(value);
  return buffer;
}

function writeUInt32(value) {
  const buffer = Buffer.allocUnsafe(4);
  buffer.writeUInt32LE(value);
  return buffer;
}

async function readJson(relPath) {
  const raw = await readFile(path.join(root, relPath), "utf8");
  return JSON.parse(raw);
}

async function collectFiles(dir, base = dir) {
  const entries = await readdir(dir, { withFileTypes: true });
  const files = [];

  for (const entry of entries) {
    const filePath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      files.push(...(await collectFiles(filePath, base)));
    } else if (entry.isFile()) {
      files.push(path.relative(base, filePath).split(path.sep).join("/"));
    }
  }

  return files.sort();
}

async function createZip(files, outputPath) {
  const chunks = [];
  const centralDirectory = [];
  let offset = 0;

  for (const relPath of files) {
    const absolutePath = path.join(distDir, relPath);
    const input = await readFile(absolutePath);
    const compressed = deflateRawSync(input);
    const name = Buffer.from(relPath);
    const fileStat = await stat(absolutePath);
    const { dosDate, dosTime } = dosDateTime(fileStat.mtime);
    const checksum = crc32(input);

    const localHeader = Buffer.concat([
      writeUInt32(0x04034b50),
      writeUInt16(20),
      writeUInt16(0x0800),
      writeUInt16(8),
      writeUInt16(dosTime),
      writeUInt16(dosDate),
      writeUInt32(checksum),
      writeUInt32(compressed.length),
      writeUInt32(input.length),
      writeUInt16(name.length),
      writeUInt16(0),
      name,
    ]);

    chunks.push(localHeader, compressed);

    const centralHeader = Buffer.concat([
      writeUInt32(0x02014b50),
      writeUInt16(20),
      writeUInt16(20),
      writeUInt16(0x0800),
      writeUInt16(8),
      writeUInt16(dosTime),
      writeUInt16(dosDate),
      writeUInt32(checksum),
      writeUInt32(compressed.length),
      writeUInt32(input.length),
      writeUInt16(name.length),
      writeUInt16(0),
      writeUInt16(0),
      writeUInt16(0),
      writeUInt16(0),
      writeUInt32(0),
      writeUInt32(offset),
      name,
    ]);

    centralDirectory.push(centralHeader);
    offset += localHeader.length + compressed.length;
  }

  const centralStart = offset;
  const centralBuffer = Buffer.concat(centralDirectory);
  const endRecord = Buffer.concat([
    writeUInt32(0x06054b50),
    writeUInt16(0),
    writeUInt16(0),
    writeUInt16(files.length),
    writeUInt16(files.length),
    writeUInt32(centralBuffer.length),
    writeUInt32(centralStart),
    writeUInt16(0),
  ]);

  const zip = Buffer.concat([...chunks, centralBuffer, endRecord]);
  await writeFile(outputPath, zip);
  return zip;
}

const pkg = await readJson("package.json");
const releaseTag = process.env.RELEASE_TAG || `v${pkg.version}`;
const assetName = `wild-punch-${releaseTag}.zip`;
const files = await collectFiles(distDir);
const requiredFiles = [
  "manifest.json",
  "ui/popup/index.html",
  "ui/options/index.html",
  "ui/index.html",
  "ui/styles.css",
  "extension/src/background.js",
];

for (const file of requiredFiles) {
  if (!files.includes(file)) {
    fail(`extension-dist/${file} is missing; run pnpm build first.`);
  }
}

if (files.some((file) => file.startsWith("extension-dist/"))) {
  fail("Refusing to create a zip with extension-dist/ nested inside it.");
}

await rm(releaseDir, { recursive: true, force: true });
await mkdir(releaseDir, { recursive: true });

const outputPath = path.join(releaseDir, assetName);
const zip = await createZip(files, outputPath);
const sha256 = createHash("sha256").update(zip).digest("hex");
await writeFile(path.join(releaseDir, "SHA256SUMS"), `${sha256}  ${assetName}\n`);

console.log(`Packaged ${files.length} files: ${outputPath}`);
console.log(`SHA256 ${sha256}`);
