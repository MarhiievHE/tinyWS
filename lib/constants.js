'use strict';

const FINAL_FRAME = 0x80;
const LEN_16_BIT = 126;
const LEN_64_BIT = 127;
const MAX_16_BIT = 65535;
const GUID = '258EAFA5-E914-47DA-95CA-C5AB0DC85B11';
const WS_KEY = 'dGhlIHNhbXBsZSBub25jZQ==';
const PING_TIMEOUT = 5000;
const EOL = '\r\n';
const UPGRADE = [
  'HTTP/1.1 101 Switching Protocols',
  'Upgrade: websocket',
  'Connection: Upgrade',
  'Sec-WebSocket-Accept: ',
].join(EOL);
const MAGIC = '258EAFA5-E914-47DA-95CA-C5AB0DC85B11';
const MAX_BUFFER = 1024 * 1024 * 100;
const CLOSE_TIMEOUT = 1000;

const OPCODE = 0x0f;
const MASK = 0x80;
const PAYLOAD_LEN = 0x7f;

const OPCODES = {
  CONTINUATION: 0x00,
  TEXT: 0x01,
  BINARY: 0x02,
  CLOSE: 0x08,
  PING: 0x09,
  PONG: 0x0a,
};

module.exports = {
  OPCODE,
  MASK,
  PAYLOAD_LEN,
  OPCODES,
  FINAL_FRAME,
  LEN_16_BIT,
  LEN_64_BIT,
  MAX_16_BIT,
  GUID,
  WS_KEY,
  PING_TIMEOUT,
  UPGRADE,
  MAGIC,
  EOL,
  MAX_BUFFER,
  CLOSE_TIMEOUT,
};
