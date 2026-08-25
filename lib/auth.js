'use strict';
const crypto = require('node:crypto');
function secureEqual(a, b) {
  const x = Buffer.from(String(a || '')); const y = Buffer.from(String(b || ''));
  return x.length === y.length && x.length > 0 && crypto.timingSafeEqual(x, y);
}
function createAuth(secretProvider = () => process.env.DISCORD_SYNC_SECRET) {
  return (req, res, next) => {
    if (!secureEqual(req.get('x-discord-sync-secret'), secretProvider())) return res.status(401).json({ error: 'unauthorized' });
    next();
  };
}
module.exports = { secureEqual, createAuth };
