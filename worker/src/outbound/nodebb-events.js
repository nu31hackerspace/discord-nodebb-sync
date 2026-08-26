'use strict';
const { renderPostChunks } = require('./render-post');
const forum = require('../discord/forum');

function createNodeBBEventHandler({ client }) {
  async function handle(event) {
    const chunks = renderPostChunks(event.author, event.content);
    switch (event.type) {
      case 'topic.created': return forum.createTopic(client, event, chunks);
      case 'post.created': return forum.createReply(client, event, chunks);
      default: throw new Error(`unsupported NodeBB event type: ${event.type}`);
    }
  }
  return { handle };
}
module.exports = { createNodeBBEventHandler };
