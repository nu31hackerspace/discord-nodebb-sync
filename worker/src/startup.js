'use strict';

const DEFAULT_RETRY_MS = 2000;

async function waitForNodeBB(nodebb, { retryMs = DEFAULT_RETRY_MS, sleep = ms => new Promise(resolve => setTimeout(resolve, ms)), log = console } = {}) {
  let attempt = 0;
  for (;;) {
    attempt += 1;
    try {
      await nodebb.health();
      if (attempt > 1) log.log('NodeBB is ready.');
      return;
    } catch (error) {
      const message = error?.message || String(error);
      log.warn(`NodeBB is not ready (${message}). Retrying in ${retryMs}ms...`);
      await sleep(retryMs);
    }
  }
}

module.exports = { waitForNodeBB, DEFAULT_RETRY_MS };
