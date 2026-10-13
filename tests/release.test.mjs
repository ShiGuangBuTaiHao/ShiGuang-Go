import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import evidence from '../scripts/release/collect-license-evidence.cjs';

test('release evidence rejects traversal and absolute archive paths', () => {
  for (const entry of ['../LICENSE', 'package/../LICENSE', 'package\\..\\LICENSE', '/LICENSE', 'C:/LICENSE', 'C:LICENSE', '\\LICENSE']) {
    assert.throws(() => evidence.validateArchiveEntries([entry]), /Unsafe/);
  }
  assert.throws(() => evidence.validateArchiveEntries([]), /empty/);
  assert.doesNotThrow(() => evidence.validateArchiveEntries(['package/', 'package/LICENSE.txt']));
});

test('release evidence pins TensorRT vendor, version, filename and archive host', () => {
  const metadata = {
    info: { author: 'NVIDIA Corporation', version: '10.16.0.72' },
    urls: [{ filename: 'tensorrt_cu13_libs-10.16.0.72.tar.gz', url: 'https://files.pythonhosted.org/package.tar.gz', digests: { sha256: 'a'.repeat(64) } }],
  };
  assert.equal(evidence.selectTensorRTArchive(metadata), metadata.urls[0]);
  for (const [field, value] of [['author', 'Unknown'], ['version', '10.0.0']]) {
    assert.throws(() => evidence.selectTensorRTArchive({ ...metadata, info: { ...metadata.info, [field]: value } }), /Unexpected/);
  }
  assert.throws(() => evidence.selectTensorRTArchive({ ...metadata, urls: [{ ...metadata.urls[0], url: 'https://example.com/file.tar.gz' }] }), /Unexpected/);
});

test('release evidence verifies checksum before saving a download', async t => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'release-evidence-'));
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  const bytes = Buffer.from('license test');
  const fetcher = async () => new Response(bytes);
  await assert.rejects(evidence.fetchFile('https://example.com/LICENSE', 'LICENSE', '0'.repeat(64), fetcher, directory), /checksum mismatch/);
  assert.equal(fs.existsSync(path.join(directory, 'LICENSE')), false);
  const saved = await evidence.fetchFile('https://example.com/LICENSE', 'LICENSE', evidence.checksum(bytes), fetcher, directory);
  assert.equal(saved.sha256, evidence.checksum(bytes));
  assert.deepEqual(fs.readFileSync(path.join(directory, 'LICENSE')), bytes);
});

test('release evidence treats failed HTTP requests as errors', async () => {
  await assert.rejects(evidence.fetchFile('https://example.com/LICENSE', 'LICENSE', undefined, async () => new Response('missing', { status: 404 })), /HTTP 404/);
});
