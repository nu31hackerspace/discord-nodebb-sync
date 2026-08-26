'use strict';

function createOutboundSyncService({ mappings, users, workerClient, content, log = console }) {
  async function topicCreated({ topic, post, data }) {
    if (data?._discordSync) return;
    const cid = Number(topic?.cid ?? data?.cid);
    const tid = Number(topic?.tid ?? post?.tid);
    const pid = Number(post?.pid);
    if (!cid || !tid || !pid) return;
    const channel = await mappings.channelForCid(cid);
    if (!channel || await mappings.getDiscordThreadId(tid)) return;
    const author = await users.authorForUid(post.uid);
    const result = await workerClient.sendEvent({
      type: 'topic.created', ...channel, cid, tid, pid,
      title: topic?.title || data?.title || `Topic ${tid}`,
      content: await content.preparePost(pid, post?.content || data?.content || ''), author,
    });
    await mappings.linkThread({ discordThreadId: result.discordThreadId, tid, cid, discordChannelId: channel.discordChannelId });
    await mappings.linkMessage({ discordMessageIds: result.discordMessageIds || (result.discordMessageId ? [result.discordMessageId] : []), discordThreadId: result.discordThreadId, pid, tid, uid: post.uid });
  }

  async function replyCreated({ post, data }) {
    if (data?._discordSync) return;
    const cid = Number(post?.cid ?? data?.cid ?? post?.topic?.cid);
    const tid = Number(post?.tid ?? data?.tid);
    const pid = Number(post?.pid);
    if (!cid || !tid || !pid) return;
    const channel = await mappings.channelForCid(cid);
    if (!channel) return;
    const discordThreadId = await mappings.getDiscordThreadId(tid);
    if (!discordThreadId) {
      log.warn?.(`[discord-sync] NodeBB reply pid=${pid} belongs to tid=${tid}, but no Discord thread mapping exists`);
      return;
    }
    const author = await users.authorForUid(post.uid);
    const toPid = post?.toPid || data?.toPid || null;
    const discordReplyToMessageId = await mappings.getDiscordMessageId(toPid);
    const result = await workerClient.sendEvent({
      type: 'post.created', ...channel, cid, tid, pid, discordThreadId, discordReplyToMessageId,
      content: await content.preparePost(pid, post?.content || data?.content || ''), author,
    });
    await mappings.linkMessage({ discordMessageIds: result.discordMessageIds || (result.discordMessageId ? [result.discordMessageId] : []), discordThreadId, pid, tid, uid: post.uid });
  }

  async function safe(fn, payload) {
    try { await fn(payload); }
    catch (error) { log.error?.(`[discord-sync] NodeBB → Discord sync failed: ${error.stack || error}`); }
  }
  return {
    topicCreated: payload => safe(topicCreated, payload),
    replyCreated: payload => safe(replyCreated, payload),
  };
}
module.exports = { createOutboundSyncService };
