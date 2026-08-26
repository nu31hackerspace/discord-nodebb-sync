'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { waitForNodeBB } = require('../src/startup');

test('waitForNodeBB retries until NodeBB becomes ready', async () => {
  let calls = 0;
  let sleeps = 0;
  const nodebb = {
    async health() {
      calls += 1;
      if (calls < 3) throw new TypeError('fetch failed');
      return { ok: true };
    },
  };
  const log = { warn() {}, log() {} };
  await waitForNodeBB(nodebb, { retryMs: 1, sleep: async () => { sleeps += 1; }, log });
  assert.equal(calls, 3);
  assert.equal(sleeps, 2);
});
