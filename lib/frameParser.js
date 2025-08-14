'use strict';

const {
  OPCODE_MASK,
  MASK_MASK,
  PAYLOAD_LEN_MASK,
  LEN_16_BIT,
  LEN_64_BIT,
  FIN_MASK,
  RSV_MASK,
} = require('./constants');
const { Frame } = require('./frame.js');
const { Result } = require('./utils/result.js');

class ParseError extends Error {
  constructor(code, message) {
    super(message);
    this.name = 'ParseError';
    this.code = code;
  }
}

const PARSE_ERR_CODES = {
  LENGTH_EXCEEDS_SAFE: 'LENGTH_EXCEEDS_SAFE',
};

class FrameParser {
  static parse(buffer) {
    if (buffer.length < 2) return Result.empty();

    const fin = (buffer[0] & FIN_MASK) !== 0;
    const rsv = buffer[0] & RSV_MASK;
    const opcode = buffer[0] & OPCODE_MASK;
    const masked = (buffer[1] & MASK_MASK) !== 0;
    let length = buffer[1] & PAYLOAD_LEN_MASK;
    let offset = 2;

    if (length === LEN_16_BIT) {
      if (buffer.length < offset + 2) return Result.empty();
      length = buffer.readUInt16BE(offset);
      offset += 2;
    } else if (length === LEN_64_BIT) {
      if (buffer.length < offset + 8) return Result.empty();
      const high = buffer.readUInt32BE(offset);
      const low = buffer.readUInt32BE(offset + 4);
      offset += 8;
      const bigLen = (BigInt(high) << 32n) | BigInt(low);
      if (bigLen > BigInt(Number.MAX_SAFE_INTEGER)) {
        return Result.from(
          new ParseError(
            PARSE_ERR_CODES.LENGTH_EXCEEDS_SAFE,
            'Payload length exceeds MAX_SAFE_INTEGER',
          ),
        );
      }
      length = Number(bigLen);
    }

    let mask;
    if (masked) {
      if (buffer.length < offset + 4) return Result.empty();
      mask = buffer.subarray(offset, offset + 4);
      offset += 4;
    }

    if (buffer.length < offset + length) return Result.empty();
    const payload = buffer.subarray(offset, offset + length);
    const frame = new Frame(fin, opcode, masked, payload, mask, rsv);
    return Result.from({ frame, bytesUsed: offset + length });
  }
}

module.exports = {
  FrameParser,
  ParseError,
  PARSE_ERR_CODES,
};
