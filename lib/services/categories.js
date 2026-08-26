'use strict';
const { categoryHandle } = require('../names');

function createCategoryService({ Categories, mappings }) {
  async function get(cid) {
    const categories = await Categories.getCategories([Number(cid)]);
    return categories[0] || null;
  }
  async function syncMetadata(cid, channelName, channelDescription) {
    const update = {};
    if (channelDescription !== undefined) update.description = channelDescription || '';
    if (channelName) {
      const desiredHandle = categoryHandle(channelName, cid);
      if (desiredHandle) {
        const existing = await Categories.getCategoryField?.(Number(cid), 'handle');
        if (existing !== desiredHandle) update.handle = Categories.generateHandle ? await Categories.generateHandle(desiredHandle) : desiredHandle;
      }
    }
    if (Object.keys(update).length && Categories.update) await Categories.update({ [Number(cid)]: update });
  }
  async function create(discordChannelId, channelName, channelDescription) {
    const category = await Categories.create({ name: channelName || `Discord ${discordChannelId}`, description: channelDescription || '' });
    const cid = Number(category.cid);
    await syncMetadata(cid, channelName, channelDescription);
    return cid;
  }
  async function ensure(payload) {
    let cid = await mappings.getChannelCid(payload.discordChannelId);
    if (cid) {
      const category = await get(cid);
      if (category) { await syncMetadata(cid, payload.channelName, payload.channelDescription); return cid; }
    }
    cid = await create(payload.discordChannelId, payload.channelName, payload.channelDescription);
    await mappings.linkChannel(payload.discordChannelId, cid, payload.channelName);
    return cid;
  }
  async function configure({ discordGuildId, discordChannelId, channelName, channelDescription = '', cid = null }) {
    if (!discordChannelId) throw new Error('discordChannelId is required');
    let resolvedCid = cid === null || cid === undefined || cid === '' ? null : Number(cid);
    if (resolvedCid !== null && (!Number.isInteger(resolvedCid) || resolvedCid <= 0)) throw new Error('invalid NodeBB category id');
    let category = null;
    if (resolvedCid !== null) {
      category = await get(resolvedCid);
      if (!category) throw new Error(`NodeBB category ${resolvedCid} does not exist`);
    } else {
      const existingCid = await mappings.getChannelCid(discordChannelId);
      if (existingCid) category = await get(existingCid);
      if (category) resolvedCid = existingCid;
      else { resolvedCid = await create(discordChannelId, channelName, channelDescription); category = await get(resolvedCid); }
    }
    await syncMetadata(resolvedCid, channelName, channelDescription);
    category = await get(resolvedCid);
    await mappings.linkChannel(discordChannelId, resolvedCid, channelName);
    await mappings.saveSubscription({ discordGuildId, discordChannelId, channelName, cid: resolvedCid, enabled: true });
    return { discordChannelId: String(discordChannelId), cid: resolvedCid, categoryName: category?.name || channelName || `Category ${resolvedCid}`, enabled: true };
  }
  async function list() {
    const categories = await Categories.getAllCategories();
    return categories.filter(Boolean).map(category => ({ cid: Number(category.cid), name: category.name || `Category ${category.cid}` })).sort((a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: 'base' }));
  }
  async function purge(cid) {
    if (!cid) return;
    const category = await get(cid);
    if (category) await Categories.purge(cid, 1);
  }
  return { get, syncMetadata, create, ensure, configure, list, purge };
}
module.exports = { createCategoryService };
