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
  EMPTY_PING,
  EMPTY_PONG,
  DATA_OPCODES,
  CLIENT_EMPTY_PONG,
  CLIENT_EMPTY_PING,
} = require('./constants');
const { Frame } = require('./frame.js');

class Connection extends EventEmitter {
  #socket;
  #key;
  #head;
  #pingTimer;
  #isClient;
  #recvBuffer;
  #maxBuffer;
  #closing = false;
  #fragments = null;

  constructor(socket, key, head, options) {
    super();
    this.#socket = socket;
    this.#key = key;
    this.#head = head;
    this.#recvBuffer = null;

    const { isClient = false, maxBuffer } = options;
    this.#isClient = isClient;
    this.#maxBuffer = maxBuffer || MAX_BUFFER;
  }

  init() {
    this.#accept();
    this.#socket.on('data', (data) => this.#receive(data));
    this.#socket.on('error', (error) => this.emit('error', error));
    this.#socket.on('close', () => this.emit('close'));

    if (!this.#isClient) {
      this.#pingTimer = setInterval(() => this.sendPing(), PING_TIMEOUT);
    }
    // receive data before upgrade
    if (this.#head.length) this.#receive(this.#head);
  }

  #accept() {
    const hash = crypto.createHash('sha1');
    hash.update(this.#key + MAGIC);
    const packet = UPGRADE + hash.digest('base64');
    this.#socket.write(packet + EOL + EOL);
  }

  #receive(data) {
    this.#recvBuffer = this.#recvBuffer
      ? Buffer.concat([this.#recvBuffer, data])
      : data;

    if (this.#recvBuffer.length > this.#maxBuffer) {
      this.emit('error', new Error('Buffer overflow, closing connection'));
      this.sendClose(1009, 'Message too big'); // 1009 = CLOSE_TOO_LARGE
      return;
    }

    this.#processFrame();
  }

  #processFrame() {
    while (true) {
      const result = Frame.tryParse(this.#recvBuffer);
      if (result.isEmpty()) break;

      const { frame, bytesUsed } = result.value;
      //client should mask data frames! Otherwise code 1002 (protocol error)
      // if (!this.#isClient && !frame.masked) {
      // }
      if (frame.masked) frame.unmaskPayload();
      this.#recvBuffer = this.#recvBuffer.subarray(bytesUsed);

      //add a header checking! code 1002 (protocol error)
      // if(frame.rsv !== 0) {
      // }

      if (frame.isControlFrame) this.#processControlFrame(frame);
      else this.#processDataFrame(frame);
    }
  }

  #processControlFrame(frame) {
    const { opcode } = frame;
    if (opcode === OPCODES.PING) {
      this.sendPong(frame.payload);
    } else if (opcode === OPCODES.PONG) {
      this.emit('pong');
    } else if (opcode === OPCODES.CLOSE) {
      if (!this.#closing) {
        this.#closing = true;
        clearInterval(this.#pingTimer);
        this.#socket.write(Frame.close().toBuffer());
      }
      this.#socket.end();
    } else {
      // reserved for further control frames => error code 1002 (protocol error)
    }
  }

  #processDataFrame(frame) {
    const { opcode } = frame;
    if (DATA_OPCODES.has(opcode)) {
      this.#handleDataFrame(frame);
    } else {
      // reserved for further non-control frames  => error code 1002 (protocol error)
    }
  }

  #handleDataFrame(frame) {
    const { opcode } = frame;
    if (!this.#fragments) {
      if (frame.fin) {
        // single frame
        const isBinary = opcode === OPCODES.BINARY;
        const data = isBinary ? frame.payload : frame.toString();
        this.emit('message', data, isBinary);
      } else {
        // First fragment
        this.#fragments = { opcode, payloads: [frame.payload] };
      }
    } else if (opcode === OPCODES.CONTINUATION) {
      // continue fragments
      this.#fragments.payloads.push(frame.payload);
      if (!frame.fin) return;
      const fullPayload = Buffer.concat(this.#fragments.payloads);
      const isBinary = this.#fragments.opcode === OPCODES.BINARY;
      const payload = isBinary ? fullPayload : fullPayload.toString();
      this.emit('message', payload, isBinary);
      this.#fragments = null;
    }
  }

  send(data) {
    if (typeof data === 'string') return void this.sendText(data);
    if (Buffer.isBuffer(data)) return void this.sendBinary(data);
    throw new TypeError('send() accepts only string or Buffer');
  }

  sendText(message) {
    const frame = Frame.text(message);
    if (this.#isClient) frame.maskPayload();
    this.#socket.write(frame.toBuffer());
  }

  sendBinary(buffer) {
    const frame = Frame.binary(buffer);
    if (this.#isClient) frame.maskPayload();
    this.#socket.write(frame.toBuffer());
  }

  sendPing(payload) {
    if (!payload) return void this.#fastPing();
    const frame = Frame.ping(payload);
    if (this.#isClient) frame.maskPayload();
    this.#socket.write(frame.toBuffer());
  }

  sendPong(payload) {
    if (!payload) return void this.#fastPong();
    const frame = Frame.pong(payload);
    if (this.#isClient) frame.maskPayload();
    this.#socket.write(frame.toBuffer());
  }

  #fastPing() {
    const pingFrame = this.#isClient ? CLIENT_EMPTY_PING : EMPTY_PING;
    if (this.#isClient) crypto.randomBytes(4).copy(pingFrame, 2);
    this.#socket.write(pingFrame);
  }

  #fastPong() {
    const pongFrame = this.#isClient ? CLIENT_EMPTY_PONG : EMPTY_PONG;
    if (this.#isClient) crypto.randomBytes(4).copy(pongFrame, 2);
    this.#socket.write(pongFrame);
  }

  sendClose(code = 1000, reason = '') {
    if (this.#closing) return;
    this.#closing = true;

    clearInterval(this.#pingTimer);
    const frame = Frame.close(code, reason);
    this.#socket.write(frame.toBuffer());

    setTimeout(() => this.#socket.end(), CLOSE_TIMEOUT);
  }

  terminate() {
    clearInterval(this.#pingTimer);
    this.#socket.destroy();
  }

  static from(req, socket, head, options) {
    const key = req.headers['sec-websocket-key'];
    const ws = new Connection(socket, key, head, options);
    ws.init();
    return ws;
  }
}

module.exports = { Connection };
