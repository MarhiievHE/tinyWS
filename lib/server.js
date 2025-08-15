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
    this.#pingTimer = setInterval(() => {
      for (const ws of this.#connections) {
        const heartbeat = this.#heartbeats.get(ws);
        if (heartbeat.awaiting) {
          ws.terminate();
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
        abort(socket, 500, 'Internal Server Error');
      }
    });
    server.on('close', () => {
      clearInterval(this.#pingTimer);
      for (const ws of this.#connections) {
        ws.sendClose(1001, 'Server is closing');
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
    this.#heartbeats.set(ws, { awaiting: false });
    this.#connections.add(ws);
    ws.on('pong', () => {
      const heartbeat = this.#heartbeats.get(ws);
      heartbeat.awaiting = false;
    });
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
