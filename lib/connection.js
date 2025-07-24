'use strict';

const { EventEmitter } = require('node:events');
const crypto = require('node:crypto');

const {
  OPCODES,
  PING_TIMEOUT,
  UPGRADE,
  MAGIC,
  EOL,
  MAX_BUFFER,
  CLOSE_TIMEOUT,
} = require('./constants');
const { Frame } = require('./frame.js');

class Connection extends EventEmitter {
  #socket;
  #key;
  #head;
  #pingInterval;
  #client;
  #recvBuffer;
  #maxBuffer;
  #closing = false;
  #fragments = null;

  constructor(socket, key, head, options) {
    super();
    this.#socket = socket;
    this.#key = key;
    this.#head = head;
    this.#recvBuffer = Buffer.alloc(0);

    const { client = false, maxBuffer } = options;
    this.#client = client;
    this.#maxBuffer = maxBuffer || MAX_BUFFER;
  }

  listen() {
    this.#accept();
    this.#socket.on('data', (data) => this.#receive(data));
    this.#socket.on('error', (error) => this.emit('error', error));
    this.#socket.on('close', () => this.emit('close'));

    // auto ping on server?
    if (!this.#client) {
      this.#pingInterval = setInterval(() => this.sendPing(), PING_TIMEOUT);
    }

    // receive data before upgrade?
    if (this.#head.length) this.#receive(this.#head);
  }

  #accept() {
    const hash = crypto.createHash('sha1');
    hash.update(this.#key + MAGIC);
    const packet = UPGRADE + hash.digest('base64');
    this.#socket.write(packet + EOL + EOL);
  }

  #receive(data) {
    this.#recvBuffer = Buffer.concat([this.#recvBuffer, data]);

    if (this.#recvBuffer.length > this.#maxBuffer) {
      this.emit('error', new Error('Buffer overflow, closing connection'));
      this.sendClose(1009, 'Message too big'); // 1009 = CLOSE_TOO_LARGE
      return;
    }

    while (true) {
      const result = Frame.tryParse(this.#recvBuffer);
      if (!result) break;

      const { frame, bytesUsed } = result;
      if (frame.masked) frame.unmaskPayload();
      this.#recvBuffer = this.#recvBuffer.subarray(bytesUsed);

      switch (frame.opcode) {
        case OPCODES.TEXT:
        case OPCODES.BINARY:
        case OPCODES.CONTINUATION:
          this.#handleDataFrame(frame);
          break;

        case OPCODES.PING:
          this.sendPong(frame.payload);
          break;

        case OPCODES.PONG:
          this.emit('pong');
          break;

        case OPCODES.CLOSE:
          if (!this.#closing) {
            this.#closing = true;
            clearInterval(this.#pingInterval);
            this.#socket.write(Frame.close().toBuffer());
          }
          this.#socket.end();
          return;

        default:
          // ignore unsupported
          break;
      }
    }
  }

  #handleDataFrame(frame) {
    // First fragment
    if (!this.#fragments && !frame.fin) {
      this.#fragments = {
        opcode: frame.opcode,
        payloads: [frame.payload],
      };
      return;
    }

    // continue fragments
    if (this.#fragments && frame.opcode === OPCODES.CONTINUATION) {
      this.#fragments.payloads.push(frame.payload);
      if (frame.fin) {
        const fullPayload = Buffer.concat(this.#fragments.payloads);
        const isBinary = this.#fragments.opcode === OPCODES.BINARY;
        this.emit(
          'message',
          isBinary ? fullPayload : fullPayload.toString(),
          isBinary,
        );
        this.#fragments = null;
      }
      return;
    }

    // single frame
    if (!this.#fragments && frame.fin) {
      if (frame.opcode === OPCODES.TEXT) {
        this.emit('message', frame.toString(), false);
      } else if (frame.opcode === OPCODES.BINARY) {
        this.emit('message', frame.payload, true);
      }
      return;
    }
  }

  send(data) {
    if (typeof data === 'string') {
      this.sendText(data);
    } else if (Buffer.isBuffer(data)) {
      this.sendBinary(data);
    } else {
      throw new TypeError('send() accepts only string or Buffer');
    }
  }

  sendText(message) {
    const frame = Frame.text(message);
    if (this.#client) frame.maskPayload();
    this.#socket.write(frame.toBuffer());
  }

  sendBinary(buffer) {
    const frame = Frame.binary(buffer);
    if (this.#client) frame.maskPayload();
    this.#socket.write(frame.toBuffer());
  }

  sendPing(payload = Buffer.alloc(0)) {
    const frame = Frame.ping(payload);
    this.#socket.write(frame.toBuffer());
  }

  sendPong(payload = Buffer.alloc(0)) {
    const frame = Frame.pong(payload);
    this.#socket.write(frame.toBuffer());
  }

  sendClose(code = 1000, reason = '') {
    if (this.#closing) return;
    this.#closing = true;

    clearInterval(this.#pingInterval);
    const frame = Frame.close(code, reason);
    this.#socket.write(frame.toBuffer());

    setTimeout(() => this.#socket.end(), CLOSE_TIMEOUT);
  }

  terminate() {
    clearInterval(this.#pingInterval);
    this.#socket.destroy();
  }

  static from(req, socket, head, options) {
    const key = req.headers['sec-websocket-key'];
    const ws = new Connection(socket, key, head, options);
    ws.listen();
    return ws;
  }
}

module.exports = { Connection };
