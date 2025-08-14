'use strict';

const crypto = require('node:crypto');
const { EventEmitter } = require('node:events');

const { Connection } = require('./connection.js');
const { MAGIC, EOL, EOL2, UPGRADE } = require('./constants.js');

const hasToken = (value, token) => {
  return !!value && value.toLowerCase().includes(token);
};

const writeResponse = (socket, headerLines) => {
  socket.write(headerLines.join(EOL) + EOL2);
};

const sendUpgrade = (socket, accept) => {
  socket.write(UPGRADE + accept + EOL2);
};

const abort = (socket, code, message, { extraHeaders = [] } = {}) => {
  const lines = [
    `HTTP/1.1 ${code} ${message}`,
    'Connection: close',
    ...extraHeaders,
  ];
  writeResponse(socket, lines);
  socket.destroy();
};

const toBase64 = (key) => {
  try {
    return Buffer.from(key, 'base64');
  } catch {
    return null;
  }
};
class WebsocketServer extends EventEmitter {
  #options;
  // todo: use one timer for ping all connections
  constructor(server, options) {
    super();
    this.#options = options;
    server.on('upgrade', (req, socket, head) => {
      socket.on('error', () => {
        socket.destroy();
      });
      try {
        this.#handleUpgrade(req, socket, head);
      } catch (err) {
        console.error(err);
      }
    });
  }

  #handleUpgrade(req, socket, head) {
    if (req.method !== 'GET') {
      return void abort(socket, 405, 'Method Not Allowed');
    }
    const upgrade = req.headers['upgrade'];
    if (!upgrade || upgrade.toLowerCase() !== 'websocket') {
      return void abort(socket, 400, 'Invalid Upgrade header');
    }
    if (!hasToken(req.headers['connection'], 'upgrade')) {
      return void abort(socket, 400, 'Invalid Connection header');
    }
    const version = req.headers['sec-websocket-version'];
    if (version !== '13') {
      const options = { extraHeaders: ['Sec-WebSocket-Version: 13'] };
      return void abort(socket, 426, 'Upgrade Required', options);
    }
    const key = req.headers['sec-websocket-key'];
    if (!key) return void abort(socket, 400, 'Missing Sec-WebSocket-Key');
    const nonce = toBase64(key);
    if (!nonce || nonce.length !== 16) {
      return void abort(socket, 400, 'Invalid Sec-WebSocket-Key');
    }
    const accept = crypto
      .createHash('sha1')
      .update(key + MAGIC)
      .digest('base64');
    sendUpgrade(socket, accept);
    const ws = new Connection(socket, head, {
      ...this.#options,
      isClient: false,
    });
    this.emit('connection', ws, req);
  }
}

module.exports = {
  WebsocketServer,
};
