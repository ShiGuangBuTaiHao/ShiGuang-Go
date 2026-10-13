const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { spawnSync } = require('node:child_process');

const root = path.resolve(__dirname, '../..');
const destination = path.join(root, 'output/v1.0.0-full/release-compliance');
const metadataSource = 'https://pypi.org/pypi/tensorrt-cu13-libs/10.16.0.72/json';
const references = [
  ['https://docs.nvidia.com/deeplearning/tensorrt/10.x.x/reference/sla.html', 'TensorRT-10-series-license.html'],
  ['https://raw.githubusercontent.com/protocolbuffers/protobuf/v33.4/LICENSE', 'protobuf-33.4-LICENSE.txt'],
  ['https://raw.githubusercontent.com/madler/zlib/v1.3.2/LICENSE', 'zlib-1.3.2-LICENSE.txt'],
  ['https://raw.githubusercontent.com/nih-at/libzip/v1.11.4/LICENSE', 'libzip-1.11.4-LICENSE.txt'],
  ['https://gitlab.com/bzip2/bzip2/-/raw/bzip2-1.0.8/LICENSE', 'bzip2-1.0.8-LICENSE.txt'],
  ['https://learn.microsoft.com/en-us/visualstudio/releases/2022/redistribution', 'Visual-Studio-2022-REDIST.html'],
  ['https://learn.microsoft.com/en-us/cpp/windows/redistributing-visual-cpp-files?view=msvc-170', 'Visual-CPP-redistribution-guidance.html'],
];

function checksum(bytes) {
  return crypto.createHash('sha256').update(bytes).digest('hex');
}

function validateArchiveEntries(entries) {
  if (entries.length === 0 || entries.some(entry => !entry ||
    path.posix.isAbsolute(entry) || path.win32.isAbsolute(entry) ||
    /^[A-Za-z]:/.test(entry) || entry.split(/[\\/]/).includes('..'))) {
    throw new Error('Unsafe or empty archive listing');
  }
}

function selectTensorRTArchive(metadata) {
  const filename = 'tensorrt_cu13_libs-10.16.0.72.tar.gz';
  const archive = metadata.urls?.find(asset => asset.filename === filename);
  if (metadata.info?.author !== 'NVIDIA Corporation' ||
    metadata.info?.version !== '10.16.0.72' || !archive ||
    !/^[a-f0-9]{64}$/.test(archive.digests?.sha256 ?? '') ||
    new URL(archive.url).origin !== 'https://files.pythonhosted.org') {
    throw new Error('Unexpected TensorRT distribution metadata');
  }
  return archive;
}

async function fetchFile(url, file, expected, fetcher = fetch, directory = destination) {
  const response = await fetcher(url, { signal: AbortSignal.timeout(30000) });
  if (!response.ok) throw new Error(`HTTP ${response.status}: ${url}`);
  const bytes = Buffer.from(await response.arrayBuffer());
  const sha256 = checksum(bytes);
  if (expected && sha256 !== expected) throw new Error('Official source checksum mismatch');
  fs.mkdirSync(directory, { recursive: true });
  fs.writeFileSync(path.join(directory, file), bytes);
  return { source: url, file, sha256, bytes: bytes.length };
}

async function main() {
  fs.mkdirSync(destination, { recursive: true });
  // Replace a previous successful report before downloads so failures cannot look complete.
  const report = {
    checkedAt: new Date().toISOString(),
    collectionComplete: false,
    redistributionApproved: false,
    installedPackageUpdated: false,
    metadataSource,
    sources: [],
    failures: [],
  };
  const reportFile = path.join(destination, 'evidence.json');
  fs.writeFileSync(reportFile, JSON.stringify(report, null, 2));
  try {
    const response = await fetch(metadataSource, { signal: AbortSignal.timeout(30000) });
    if (!response.ok) throw new Error(`Metadata HTTP ${response.status}`);
    const metadata = await response.json();
    const archive = selectTensorRTArchive(metadata);
    report.sources.push(await fetchFile(archive.url, archive.filename, archive.digests.sha256));
    const archiveFile = path.join(destination, archive.filename);
    const listing = spawnSync('tar', ['-tf', archiveFile], { encoding: 'utf8', windowsHide: true });
    if (listing.status !== 0) throw new Error(`Cannot inspect archive: ${listing.error?.message ?? listing.stderr}`);
    const entries = listing.stdout.split(/\r?\n/).filter(Boolean);
    validateArchiveEntries(entries);
    const licenseEntry = 'tensorrt_cu13_libs-10.16.0.72/LICENSE.txt';
    if (!entries.includes(licenseEntry)) throw new Error('TensorRT package license is missing');
    // Read just the expected license, rather than extracting arbitrary archive entries.
    const license = spawnSync('tar', ['-xOf', archiveFile, licenseEntry], { windowsHide: true });
    if (license.status !== 0 || !license.stdout?.length) throw new Error('Cannot read TensorRT package license');
    fs.writeFileSync(path.join(destination, 'TensorRT-10.16.0.72-LICENSE.txt'), license.stdout);
    report.originalTensorRTFiles = entries;
    report.tensorRTLicense = { file: 'TensorRT-10.16.0.72-LICENSE.txt', sha256: checksum(license.stdout) };
  } catch (error) {
    report.failures.push({ source: metadataSource, error: error.message });
  }
  for (const [url, file] of references) {
    try {
      report.sources.push(await fetchFile(url, file));
    } catch (error) {
      report.failures.push({ source: url, error: error.message });
    }
  }
  report.collectionComplete = report.failures.length === 0;
  fs.writeFileSync(reportFile, JSON.stringify(report, null, 2));
  console.log(JSON.stringify({ collectionComplete: report.collectionComplete, sources: report.sources.length, failures: report.failures }));
  if (!report.collectionComplete) process.exitCode = 1;
}

module.exports = { checksum, fetchFile, selectTensorRTArchive, validateArchiveEntries };
if (require.main === module) main().catch(error => {
  console.error(error.message);
  process.exitCode = 1;
});
