'use strict';
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const crypto = require('node:crypto');

function safeName(name) {
  const base = path.basename(String(name || 'attachment')).replace(/[\x00-\x1f\x7f]/g, '_');
  return base.slice(0, 240) || 'attachment';
}
async function download(url, suggestedName) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`attachment download failed ${res.status}: ${url}`);
  const buf = Buffer.from(await res.arrayBuffer());
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'discord-nodebb-'));
  const filePath = path.join(dir, `${crypto.randomUUID()}-${safeName(suggestedName)}`);
  await fs.writeFile(filePath, buf);
  return { dir, path: filePath, size: buf.length, type: res.headers.get('content-type') || 'application/octet-stream', buffer: buf };
}
function markdownFor(stored, attachment) {
  const name = safeName(attachment.name);
  const type = attachment.contentType || '';
  return type.startsWith('image/') ? `![${name}](${stored.url})` : `[${name}](${stored.url})`;
}
function createAssets({ uploadsController, User }) {
  return {
    async importPostAttachments(uid, attachments = []) {
      const blocks = [];
      for (const a of attachments) {
        let temp;
        try {
          temp = await download(a.url, a.name);
          const stored = await uploadsController.uploadFile(uid, { name: safeName(a.name), path: temp.path, size: temp.size, type: a.contentType || temp.type });
          blocks.push(markdownFor(stored, a));
        } finally {
          if (temp?.dir) await fs.rm(temp.dir, { recursive: true, force: true });
        }
      }
      return blocks;
    },
    async importAvatar(uid, url) {
      if (!url) return null;
      let temp;
      try {
        temp = await download(url, 'avatar.png');
        const type = String(temp.type).split(';')[0];
        const imageData = `data:${type};base64,${temp.buffer.toString('base64')}`;
        return await User.uploadCroppedPicture({ callerUid: uid, uid, imageData });
      } finally {
        if (temp?.dir) await fs.rm(temp.dir, { recursive: true, force: true });
      }
    },
  };
}
module.exports = { safeName, markdownFor, createAssets };
