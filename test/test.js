'use strict';

const http = require('http');
const { Server } = require('../lib/server.js');

const httpServer = http.createServer((req, res) => {
  res.writeHead(200);
  res.end('TinyWS server');
});

const wsServer = new Server({ server: httpServer });

wsServer.on('connection', (conn, req) => {
  console.log('New WebSocket connection from', req.socket.remoteAddress);

  conn.on('message', (msg, isBinary) => {
    console.log('Received:', isBinary ? msg : msg.toString());
    conn.send('Echo: ' + (isBinary ? msg.toString() : msg));
  });

  conn.on('close', () => console.log('Client disconnected'));
});

httpServer.listen(3000, () =>
  console.log('Listening on http://localhost:3000'),
);
