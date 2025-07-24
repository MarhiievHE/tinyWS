'use strict';
const test = require('node:test');
const assert = require('node:assert');
const http = require('node:http');
const WebSocket = require('ws');

const { Server } = require('../../lib/server.js');

test('should echo messages', async () => {
  const httpServer = http.createServer();
  const tinyWsServer = new Server({ server: httpServer });

  tinyWsServer.on('connection', (conn) => {
    conn.on('message', (msg) => conn.send(`Echo: ${msg}`));
  });

  await new Promise((resolve) => httpServer.listen(0, resolve));
  const port = httpServer.address().port;

  const ws = new WebSocket(`ws://localhost:${port}`);

  const received = await new Promise((resolve) => {
    ws.on('open', () => ws.send('Hello tinyWS'));
    ws.on('message', (msg) => {
      resolve(msg.toString());
      ws.close();
    });
  });

  assert.strictEqual(received, 'Echo: Hello tinyWS');

  await new Promise((resolve) => httpServer.close(resolve));
});
