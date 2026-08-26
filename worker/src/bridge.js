'use strict';
const { renderPostChunks } = require('./outbound/render-post');
const forum = require('./discord/forum');
const { createNodeBBEventHandler } = require('./outbound/nodebb-events');
const { startBridgeServer: startHttpBridge } = require('./http/bridge');

function splitContent(author, content) { return renderPostChunks(author, content); }
async function createTopic(client, payload) { return forum.createTopic(client, payload, renderPostChunks(payload.author, payload.content)); }
async function createReply(client, payload) { return forum.createReply(client, payload, renderPostChunks(payload.author, payload.content)); }
function startBridgeServer({ client, ...options }) { return startHttpBridge({ ...options, handler: createNodeBBEventHandler({ client }) }); }
module.exports = { splitContent, createTopic, createReply, startBridgeServer };
