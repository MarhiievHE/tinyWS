'use strict';

const net = require('net');
const crypto = require('crypto');
const http = require('node:http');

// Minimal mock WebSocket client sufficient for this integration test.
class MockWebSocketClient {
  constructor(url) {
    const u = new URL(url);
    const port = u.port || 80;
    const host = u.hostname || 'localhost';

    this._openCb = null;
    this._messageCb = null;
    this._closeCb = null;
    this._buffer = Buffer.alloc(0);
    this._opened = false;
    this._closeSent = false;

    this.socket = net.connect({ port, host }, () => {
      const key = crypto.randomBytes(16).toString('base64');
      const req = [
        `GET ${u.pathname || '/'} HTTP/1.1`,
        `Host: ${host}:${port}`,
        'Upgrade: websocket',
        'Connection: Upgrade',
        `Sec-WebSocket-Key: ${key}`,
        'Sec-WebSocket-Version: 13',
        '\r\n',
      ].join('\r\n');
      this.socket.write(req);
    });

    this.socket.on('data', (chunk) => {
      this._buffer = Buffer.concat([this._buffer, chunk]);

      if (!this._opened) {
        const idx = this._buffer.indexOf('\r\n\r\n');
        if (idx === -1) return; // wait for full headers
        const header = this._buffer.slice(0, idx).toString();
        // Simple check for successful upgrade
        if (!/101\s+Switching\s+Protocols/i.test(header)) {
          this.socket.destroy();
          return;
        }
        this._opened = true;
        this._buffer = this._buffer.slice(idx + 4);
        if (this._openCb) this._openCb();
      }

      // Try to parse one or more frames from buffer
      while (this._buffer.length >= 2) {
        const b0 = this._buffer[0];
        const b1 = this._buffer[1];
        const fin = (b0 & 0x80) !== 0;
        const opcode = b0 & 0x0f;
        const masked = (b1 & 0x80) !== 0;
        let len = b1 & 0x7f;
        let offset = 2;
        if (len === 126) {
          if (this._buffer.length < offset + 2) break;
          len = this._buffer.readUInt16BE(offset);
          offset += 2;
        } else if (len === 127) {
          if (this._buffer.length < offset + 8) break;
          const high = this._buffer.readUInt32BE(offset);
          const low = this._buffer.readUInt32BE(offset + 4);
          len = Number((BigInt(high) << 32n) | BigInt(low));
          offset += 8;
        }

        const maskLen = masked ? 4 : 0;
        if (this._buffer.length < offset + maskLen + len) break; // wait for full frame

        let payload = this._buffer.slice(
          offset + maskLen,
          offset + maskLen + len,
        );
        if (masked) {
          const mask = this._buffer.slice(offset, offset + 4);
          const un = Buffer.alloc(payload.length);
          for (let i = 0; i < payload.length; i++)
            un[i] = payload[i] ^ mask[i % 4];
          payload = un;
        }

        // slice consumed
        this._buffer = this._buffer.slice(offset + maskLen + len);

        // Handle opcodes
        if (opcode === 0x1) {
          // text
          if (this._messageCb) this._messageCb(payload);
        } else if (opcode === 0x8) {
          // close
          if (!this._closeSent) {
            // echo close per RFC 6455
            this._sendFrame(0x8, payload);
            this._closeSent = true;
          }
          this.socket.end();
          if (this._closeCb) this._closeCb();
        } else if (opcode === 0x9) {
          // ping -> pong with same payload
          this._sendFrame(0xa, payload);
        } else if (opcode === 0xa) {
          // pong -> ignore
        } else {
          // other opcodes not used in this mock
        }

        if (!fin) {
          // This mock doesn't support fragmented messages; ignore continuation for tests
        }
      }
    });

    this.socket.on('end', () => {
      if (this._closeCb) this._closeCb();
    });
    this.socket.on('close', () => {
      if (this._closeCb) this._closeCb();
    });
    this.socket.on('error', () => {
      this.socket.destroy();
      if (this._closeCb) this._closeCb();
    });
  }

  _sendFrame(opcode, payload) {
    const maskBit = 0x80;
    const finOp = 0x80 | (opcode & 0x0f);
    const len = payload.length;
    let header;

    if (len < 126) {
      header = Buffer.alloc(2 + 4);
      header[0] = finOp;
      header[1] = maskBit | len;
    } else if (len <= 0xffff) {
      header = Buffer.alloc(4 + 4);
      header[0] = finOp;
      header[1] = maskBit | 126;
      header.writeUInt16BE(len, 2);
    } else {
      header = Buffer.alloc(10 + 4);
      header[0] = finOp;
      header[1] = maskBit | 127;
      // write 64-bit length
      const big = BigInt(len);
      header.writeUInt32BE(Number((big >> 32n) & 0xffffffffn), 2);
      header.writeUInt32BE(Number(big & 0xffffffffn), 6);
    }

    const maskOffset = header.length - 4;
    const mask = crypto.randomBytes(4);
    mask.copy(header, maskOffset);

    const masked = Buffer.alloc(len);
    for (let i = 0; i < len; i++) masked[i] = payload[i] ^ mask[i % 4];

    this.socket.write(Buffer.concat([header, masked]));
  }

  send(msg) {
    const payload = Buffer.from(String(msg));
    this._sendFrame(0x1, payload);
  }

  close(code = 1000, reason = '') {
    if (!this.socket.destroyed && !this._closeSent) {
      const reasonBuf = Buffer.from(String(reason));
      const payload = Buffer.alloc(2 + reasonBuf.length);
      payload.writeUInt16BE(code, 0);
      reasonBuf.copy(payload, 2);
      this._sendFrame(0x8, payload);
      this._closeSent = true;
    }
    // Allow the server to reply with its own close; then end the TCP socket.
    // In tests this will complete quickly.
    this.socket.end();
  }

  on(event, cb) {
    if (event === 'open') this._openCb = cb;
    if (event === 'message') this._messageCb = (buf) => cb(buf);
    if (event === 'close') this._closeCb = cb;
  }
}

function wrapNativeWebSocket(wsInstance) {
  if (!wsInstance) return wsInstance;
  // If instance already implements the simple .on API, return as-is.
  if (typeof wsInstance.on === 'function') return wsInstance;

  return {
    on(event, cb) {
      if (event === 'open') wsInstance.addEventListener('open', cb);
      else if (event === 'message')
        wsInstance.addEventListener('message', (ev) =>
          cb(Buffer.from(ev.data)),
        );
      else if (event === 'close') wsInstance.addEventListener('close', cb);
    },
    send(msg) {
      wsInstance.send(msg);
    },
    close() {
      wsInstance.close();
    },
    // keep raw instance accessible for advanced tests/debugging
    raw: wsInstance,
  };
}

function getWebSocketClient(url) {
  let Native;
  try {
    Native = http && http.WebSocket ? http.WebSocket : undefined;
  } catch (e) {
    // ignore
  }
  if (!Native && typeof globalThis !== 'undefined' && globalThis.WebSocket)
    Native = globalThis.WebSocket;

  if (Native) {
    const inst = new Native(url);
    return wrapNativeWebSocket(inst);
  }

  return new MockWebSocketClient(url);
}

module.exports = {
  MockWebSocketClient,
  getWebSocketClient,
};
