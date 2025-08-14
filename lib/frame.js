'use strict';

const crypto = require('node:crypto');

const {
  FINAL_FRAME,
  OPCODE_MASK,
  MASK_MASK,
  PAYLOAD_LEN_MASK,
  LEN_16_BIT,
  LEN_64_BIT,
  OPCODES,
  MAX_16_BIT,
  CONTROL_FRAME_MASK,
  EMPTY_BUFFER,
  FIN_MASK,
  RSV_MASK: RSV,
  CONTROL_OPCODES,
  DATA_OPCODES,
} = require('./constants');
const { Maybe } = require('./tools/maybe');

class Frame {
  constructor(fin, rsv = 0, opcode, masked, payload, mask) {
    this.fin = fin;
    this.rsv = rsv;
    this.opcode = opcode;
    this.masked = masked;
    this.payload = payload;
    this.mask = mask;
  }

  static from(buffer) {
    const fin = (buffer[0] & FIN_MASK) !== 0;
    const rsv = buffer[0] & RSV;
    const opcode = buffer[0] & OPCODE_MASK;
    const masked = (buffer[1] & MASK_MASK) !== 0;
    let length = buffer[1] & PAYLOAD_LEN_MASK;
    let offset = 2;

    if (length === LEN_16_BIT) {
      length = buffer.readUInt16BE(offset);
      offset += 2;
    }
    if (length === LEN_64_BIT) {
      const high = buffer.readUInt32BE(offset);
      const low = buffer.readUInt32BE(offset + 4);
      offset += 8;

      const bigLen = (BigInt(high) << 32n) | BigInt(low);
      if (bigLen > BigInt(Number.MAX_SAFE_INTEGER)) {
        throw new Error('Payload length exceeds MAX_SAFE_INTEGER');
      }
      length = Number(bigLen);
    }

    let mask;
    if (masked) {
      mask = buffer.subarray(offset, offset + 4);
      offset += 4;
    }

    const payload = buffer.subarray(offset, offset + length);
    return new Frame(fin, rsv, opcode, masked, payload, mask);
  }

  static tryParse(buffer) {
    if (buffer.length < 2) return new Maybe();

    const fin = (buffer[0] & FIN_MASK) !== 0;
    const rsv = buffer[0] & RSV;
    const opcode = buffer[0] & OPCODE_MASK;
    const masked = (buffer[1] & MASK_MASK) !== 0;
    let length = buffer[1] & PAYLOAD_LEN_MASK;
    let offset = 2;

    if (length === LEN_16_BIT) {
      if (buffer.length < offset + 2) new Maybe();
      length = buffer.readUInt16BE(offset);
      offset += 2;
    } else if (length === LEN_64_BIT) {
      if (buffer.length < offset + 8) new Maybe();
      const high = buffer.readUInt32BE(offset);
      const low = buffer.readUInt32BE(offset + 4);
      offset += 8;
      const bigLen = (BigInt(high) << 32n) | BigInt(low);
      if (bigLen > BigInt(Number.MAX_SAFE_INTEGER)) {
        throw new Error('Payload length exceeds MAX_SAFE_INTEGER');
      }
      length = Number(bigLen);
    }

    let mask;
    if (masked) {
      if (buffer.length < offset + 4) new Maybe();
      mask = buffer.subarray(offset, offset + 4);
      offset += 4;
    }

    if (buffer.length < offset + length) new Maybe();
    const payload = buffer.subarray(offset, offset + length);
    const frame = new Frame(fin, rsv, opcode, masked, payload, mask);
    return new Maybe({ frame, bytesUsed: offset + length });
  }

  static text(message, fin = true, encoding = 'utf8') {
    const payload = Buffer.from(message, encoding);
    return new Frame(fin, RSV, OPCODES.TEXT, false, payload, null);
  }

  static binary(buffer, fin = true) {
    if (!Buffer.isBuffer(buffer)) buffer = Buffer.from(buffer);
    return new Frame(fin, RSV, OPCODES.BINARY, false, buffer, null);
  }

  static ping(payload = EMPTY_BUFFER) {
    if (typeof payload === 'string') {
      payload = Buffer.from(payload);
    }
    return new Frame(true, RSV, OPCODES.PING, false, payload, null);
  }

  static pong(payload = EMPTY_BUFFER) {
    if (typeof payload === 'string') {
      payload = Buffer.from(payload);
    }
    return new Frame(true, RSV, OPCODES.PONG, false, payload, null);
  }

  static close(code = 1000, reason = '') {
    const payload = Buffer.alloc(2 + Buffer.byteLength(reason));
    payload.writeUInt16BE(code, 0);
    if (reason) payload.write(reason, 2);
    return new Frame(true, RSV, OPCODES.CLOSE, false, payload, null);
  }

  unmaskPayload() {
    if (!this.masked) return;
    for (let i = 0; i < this.payload.length; i++) {
      this.payload[i] ^= this.mask[i % 4];
    }
    this.masked = false;
  }

  maskPayload(mask = null) {
    if (this.masked) return;
    this.mask = mask || crypto.randomBytes(4);
    for (let i = 0; i < this.payload.length; i++) {
      this.payload[i] ^= this.mask[i % 4];
    }
    this.masked = true;
  }

  toString() {
    if (this.opcode === OPCODES.TEXT) {
      return this.payload.toString('utf8');
    }
    return null;
  }

  getCloseDetails() {
    if (this.opcode !== OPCODES.CLOSE) return null;

    const code = this.payload.length >= 2 ? this.payload.readUInt16BE(0) : null;

    const reason =
      this.payload.length > 2 ? this.payload.subarray(2).toString('utf8') : '';

    return { code, reason };
  }

  toBuffer() {
    const length = this.payload.length;
    let header;
    let lengthField;

    if (length < LEN_16_BIT) {
      header = Buffer.alloc(this.masked ? 6 : 2);
      header[0] = (this.fin ? FINAL_FRAME : 0) | this.opcode;
      header[1] = (this.masked ? MASK_MASK : 0) | length;
      lengthField = 2;
    } else if (length <= MAX_16_BIT) {
      header = Buffer.alloc(this.masked ? 8 : 4);
      header[0] = (this.fin ? FINAL_FRAME : 0) | this.opcode;
      header[1] = (this.masked ? MASK_MASK : 0) | LEN_16_BIT;
      header.writeUInt16BE(length, 2);
      lengthField = 4;
    } else {
      header = Buffer.alloc(this.masked ? 14 : 10);
      header[0] = (this.fin ? FINAL_FRAME : 0) | this.opcode;
      header[1] = (this.masked ? MASK_MASK : 0) | LEN_64_BIT;
      const bigLen = BigInt(length);
      header.writeUInt32BE(Number(bigLen >> 32n), 2);
      header.writeUInt32BE(Number(bigLen & 0xffffffffn), 6);
      lengthField = 10;
    }

    if (this.masked) {
      this.mask.copy(header, lengthField);
    }

    return Buffer.concat([header, this.payload]);
  }

  get isControlFrame() {
    return (this.opcode & CONTROL_FRAME_MASK) !== 0;
  }

  get isValidControlFrame() {
    return CONTROL_OPCODES.has(this.opcode);
  }

  get isValidDataFrame() {
    return DATA_OPCODES.has(this.opcode);
  }
}

module.exports = {
  Frame,
};
