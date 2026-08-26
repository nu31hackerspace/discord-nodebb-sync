'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { createAssets, relativeUploadPath, isFileTooBigError } = require('../../lib/assets');

test('recognizes NodeBB file-too-big error', () => {
  assert.equal(isFileTooBigError(new Error('[[error:file-too-big, 2048]]')), true);
  assert.equal(isFileTooBigError(new Error('nope')), false);
});

test('extracts relative upload path', () => {
  assert.equal(relativeUploadPath('/assets/uploads/files/a.png'), 'files/a.png');
  assert.equal(relativeUploadPath('https://forum.test/assets/uploads/files/a.png'), 'files/a.png');
  assert.equal(relativeUploadPath('/other/a.png'), null);
});

test('oversized attachment retries upload as admin and associates original user', async () => {
  const originalFetch = global.fetch;
  global.fetch = async () => ({
    ok: true,
    arrayBuffer: async () => Buffer.from('abc'),
    headers: { get: () => 'image/png' },
  });

  const calls = [];
  const associated = [];
  const uploadsController = {
    async uploadFile(uid) {
      calls.push(uid);
      if (uid === 42) throw new Error('[[error:file-too-big, 2048]]');
      return { url: '/assets/uploads/files/imported.png', name: 'imported.png' };
    },
  };
  const User = {
    async getFirstAdminUid() { return 1; },
    async associateUpload(uid, rel) { associated.push([uid, rel]); },
  };
  const assets = createAssets({ uploadsController, User, log: { warn() {} } });

  try {
    const blocks = await assets.importPostAttachments(42, [{
      url: 'https://cdn.test/file.png',
      name: 'file.png',
      contentType: 'image/png',
    }]);
    assert.deepEqual(calls, [42, 1]);
    assert.deepEqual(associated, [[42, 'files/imported.png']]);
    assert.equal(blocks[0], '![file.png](/assets/uploads/files/imported.png)');
  } finally {
    global.fetch = originalFetch;
  }
});
