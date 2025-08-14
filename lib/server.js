'use strict';

const crypto = require('node:crypto');
const { EventEmitter } = require('node:events');

const { Connection } = require('./connection.js');
const { MAGIC, EOL } = require('./constants.js');

const hasToken = (value, token) => {
  if (!value) return false;
  const t = String(token).toLowerCase();
  return value.split(',').some((v) => v.trim().toLowerCase() === t);
};

const writeResponse = (socket, headerLines) => {
  socket.write(headerLines.join(EOL) + EOL + EOL);
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

class Server extends EventEmitter {
  #options;

  constructor({ server, ...options }) {
    super();
    this.#options = options;
    server.on('upgrade', (req, socket, head) =>
      this.#handleUpgrade(req, socket, head),
    );
  }

  #handleUpgrade(req, socket, head) {
    try {
      // 1) Only GET
      if (req.method !== 'GET') {
        return void abort(socket, 405, 'Method Not Allowed');
      }

      // 2) Upgrade: websocket
      const upgrade = req.headers['upgrade'];
      if (!upgrade || upgrade.toLowerCase() !== 'websocket') {
        return void abort(socket, 400, 'Invalid Upgrade header');
      }

      // 3) Connection: Upgrade
      if (!hasToken(req.headers['connection'], 'upgrade')) {
        return void abort(socket, 400, 'Invalid Connection header');
      }

      // 4) Sec-WebSocket-Version: 13
      const version = req.headers['sec-websocket-version'];
      if (version !== '13') {
        return void abort(socket, 426, 'Upgrade Required', {
          extraHeaders: ['Sec-WebSocket-Version: 13'],
        });
      }

      // 5) Sec-WebSocket-Key (base64 на 16 байт)
      const key = req.headers['sec-websocket-key'];
      if (!key) {
        return void abort(socket, 400, 'Missing Sec-WebSocket-Key');
      }
      let nonce;
      try {
        nonce = Buffer.from(key, 'base64');
      } catch {
        nonce = null;
      }
      if (!nonce || nonce.length !== 16) {
        return void abort(socket, 400, 'Invalid Sec-WebSocket-Key');
      }

      // 6) Sec-WebSocket-Accept
      const accept = crypto
        .createHash('sha1')
        .update(key + MAGIC)
        .digest('base64');

      // 7) Response 101 Switching Protocols
      writeResponse(socket, [
        'HTTP/1.1 101 Switching Protocols',
        'Upgrade: websocket',
        'Connection: Upgrade',
        `Sec-WebSocket-Accept: ${accept}`,
      ]);

      // 8) Creating WebSocket-connection
      const ws = Connection.from(socket, head, {
        ...this.#options,
        isClient: false,
      });

      // 9) emitting connection
      this.emit('connection', ws, req);
    } catch (err) {
      this.emit('error', err);
      socket.destroy();
    }
  }
}

module.exports = {
  Server,
};
