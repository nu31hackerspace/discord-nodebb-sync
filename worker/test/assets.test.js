'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { createAssets, relativeUploadPath, isFileTooBigError, isInvalidFileTypeError } = require('../../lib/assets');

test('recognizes NodeBB file-too-big error', () => {
  assert.equal(isFileTooBigError(new Error('[[error:file-too-big, 2048]]')), true);
  assert.equal(isFileTooBigError(new Error('nope')), false);
});



test('recognizes NodeBB invalid-file-type error', () => {
  assert.equal(isInvalidFileTypeError(new Error('[[error:invalid-file-type, .csv, .png]]')), true);
  assert.equal(isInvalidFileTypeError(new Error('nope')), false);
});

test('attachment outside NodeBB allowlist is stored directly but blocked extensions stay blocked', async () => {
  const originalFetch = global.fetch;
  global.fetch = async () => ({
    ok: true,
    arrayBuffer: async () => Buffer.from('a,b\n1,2\n'),
    headers: { get: () => 'text/csv' },
  });

  const associated = [];
  const uploadsController = {
    async uploadFile() {
      throw new Error('[[error:invalid-file-type, .csv, .png&#44; .jpg]]');
    },
  };
  const User = {
    async associateUpload(uid, rel) { associated.push([uid, rel]); },
  };
  const File = {
    blockedExtensions() { return ['.exe']; },
    async saveFileToLocal(filename) {
      assert.match(filename, /\.csv$/);
      return { url: `/assets/uploads/files/${filename}`, path: `/tmp/${filename}` };
    },
  };
  const Plugins = { hooks: { async fire(_hook, data) { return data; } } };
  const assets = createAssets({ uploadsController, User, File, Plugins, log: { warn() {} } });

  try {
    const blocks = await assets.importPostAttachments(42, [{ url: 'https://cdn.test/data.csv', name: 'data.csv', contentType: 'text/csv' }]);
    assert.equal(blocks.length, 1);
    assert.match(blocks[0], /^\[data\.csv\]\(\/assets\/uploads\/files\/.+\.csv\)$/);
    assert.equal(associated.length, 1);
    assert.equal(associated[0][0], 42);
    assert.match(associated[0][1], /^files\/.+\.csv$/);
  } finally {
    global.fetch = originalFetch;
  }
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

test('attachment download retries transient 503 responses', async () => {
  const originalFetch = global.fetch;
  let calls = 0;
  global.fetch = async () => {
    calls += 1;
    if (calls < 3) {
      return {
        ok: false,
        status: 503,
        headers: { get: () => null },
      };
    }
    return {
      ok: true,
      status: 200,
      arrayBuffer: async () => Buffer.from('abc'),
      headers: { get: () => 'image/jpeg' },
    };
  };

  const uploadsController = {
    async uploadFile() {
      return { url: '/assets/uploads/files/retried.jpg' };
    },
  };
  const User = {};
  const assets = createAssets({
    uploadsController,
    User,
    log: { warn() {} },
    downloadOptions: { attempts: 4, baseDelayMs: 1, sleepFn: async () => {} },
  });

  try {
    const blocks = await assets.importPostAttachments(42, [{
      url: 'https://cdn.test/retry.jpg',
      name: 'retry.jpg',
      contentType: 'image/jpeg',
    }]);
    assert.equal(calls, 3);
    assert.equal(blocks[0], '![retry.jpg](/assets/uploads/files/retried.jpg)');
  } finally {
    global.fetch = originalFetch;
  }
});

test('attachment download does not retry a permanent 404', async () => {
  const originalFetch = global.fetch;
  let calls = 0;
  global.fetch = async () => {
    calls += 1;
    return { ok: false, status: 404, headers: { get: () => null } };
  };

  const assets = createAssets({
    uploadsController: {},
    User: {},
    log: { warn() {} },
    downloadOptions: { attempts: 4, baseDelayMs: 1, sleepFn: async () => {} },
  });

  try {
    await assert.rejects(
      () => assets.importPostAttachments(42, [{ url: 'https://cdn.test/missing.jpg', name: 'missing.jpg', contentType: 'image/jpeg' }]),
      /attachment download failed 404/,
    );
    assert.equal(calls, 1);
  } finally {
    global.fetch = originalFetch;
  }
});
