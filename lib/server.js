'use strict';

const crypto = require('node:crypto');
const { EventEmitter } = require('node:events');

const { Connection } = require('./connection.js');
const {
  MAGIC,
  EOL,
  EOL2,
  UPGRADE,
  PING_INTERVAL,
  MAX_BUFFER,
  CLOSE_CODES,
} = require('./constants.js');

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

const isValidSecWebSocketKey = (key) => {
  return (
    typeof key === 'string' &&
    key.length === 24 &&
    Buffer.from(key, 'base64').length === 16
  );
};

class WebsocketServer extends EventEmitter {
  #options;
  #connections = new Set();
  #heartbeats = new Map(); // { awaiting: boolean }
  #pingTimer;
  // todo: use one timer for ping all connections
  constructor(server, options = {}) {
    super();
    this.#options = {
      pingInterval: PING_INTERVAL,
      maxBuffer: MAX_BUFFER,
      ...options,
    };
    this.#init(server);
  }

  #init(server) {
    const { pingInterval } = this.#options;
    // One heartbeat loop for all connections: if the previous ping wasn't answered, terminate.
    this.#pingTimer = setInterval(() => {
      for (const ws of this.#connections) {
        if (!this.#heartbeats.has(ws)) {
          this.#heartbeats.set(ws, { awaiting: true });
          ws.sendPing();
          continue;
        }
        const heartbeat = this.#heartbeats.get;
        if (heartbeat.awaiting) {
          ws.close(CLOSE_CODES.CONNECTION_CLOSED_ABNORMALLY);
          this.#heartbeats.delete(ws);
        } else {
          heartbeat.awaiting = true;
          ws.sendPing();
        }
      }
    }, pingInterval);
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
    server.on('close', () => {
      clearInterval(this.#pingTimer);
      for (const ws of this.#connections) {
        ws.close(1001, 'Server is closing');
      }
      this.#connections.clear();
      this.#heartbeats.clear();
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
    if (!isValidSecWebSocketKey(key)) {
      return void abort(socket, 400, 'Invalid Sec-WebSocket-Key');
    }
    const accept = crypto
      .createHash('sha1')
      .update(key)
      .update(MAGIC)
      .digest('base64');
    sendUpgrade(socket, accept);
    const ws = new Connection(socket, head, {
      ...this.#options,
      isClient: false,
    });
    this.#connections.add(ws);
    this.#heartbeats.set(ws, { awaiting: false });
    ws.on('close', () => {
      this.#connections.delete(ws);
      this.#heartbeats.delete(ws);
    });
    this.emit('connection', ws, req);
  }
}

module.exports = {
  WebsocketServer,
};
