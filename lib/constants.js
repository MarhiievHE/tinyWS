'use strict';

const FINAL_FRAME = 0x80;
const RSV = 0x00;
const LEN_16_BIT = 126;
const LEN_64_BIT = 127;
const MAX_16_BIT = 65535;
const MAGIC = '258EAFA5-E914-47DA-95CA-C5AB0DC85B11'; // WebSocket GUID
const PING_INTERVAL = 10000;
const EOL = '\r\n';
const EOL2 = '\r\n\r\n';
const ENCODING = 'utf8';
const UPGRADE = [
  'HTTP/1.1 101 Switching Protocols',
  'Upgrade: websocket',
  'Connection: Upgrade',
  'Sec-WebSocket-Accept: ',
].join(EOL);
const MAX_BUFFER = 1024 * 1024 * 100;
const CLOSE_TIMEOUT = 1000;

const FIN_MASK = 0x80;
const RSV_MASK = 0x70;
const OPCODE_MASK = 0x0f;
const MASK_MASK = 0x80;
const PAYLOAD_LEN_MASK = 0x7f;
const CONTROL_FRAME_MASK = 0x08;

const CLOSE_CODES = {
  NORMAL_CLOSE: 1000,
  GOING_AWAY: 1001,
  PROTOCOL_ERROR: 1002,
  UNSUPPORTED_DATA: 1003,
  RESERVED: 1004,
  NO_CODE_RECEIVED: 1005,
  CONNECTION_CLOSED_ABNORMALLY: 1006,
  INVALID_PAYLOAD: 1007,
  POLICY_VIOLATED: 1008,
  MESSAGE_TOO_BIG: 1009,
  MANDATORY_EXTENSION: 1010, //client
  INTERNAL_SERVER_ERROR: 1011,
  TLS_HANDSHAKE: 1015,
};
const VALID_CLOSE_CODES = new Set([
  CLOSE_CODES.NORMAL_CLOSE,
  CLOSE_CODES.GOING_AWAY,
  CLOSE_CODES.PROTOCOL_ERROR,
  CLOSE_CODES.UNSUPPORTED_DATA,
  CLOSE_CODES.INVALID_PAYLOAD,
  CLOSE_CODES.POLICY_VIOLATED,
  CLOSE_CODES.MESSAGE_TOO_BIG,
  CLOSE_CODES.MANDATORY_EXTENSION,
  CLOSE_CODES.INTERNAL_SERVER_ERROR,
]);
const VALID_USER_CLOSE_CODES = {
  MIN: 3000,
  MAX: 4999,
};

const OPCODES = {
  CONTINUATION: 0x00,
  TEXT: 0x01,
  BINARY: 0x02,
  CLOSE: 0x08,
  PING: 0x09,
  PONG: 0x0a,
};
const DATA_OPCODES = new Set([
  OPCODES.CONTINUATION,
  OPCODES.TEXT,
  OPCODES.BINARY,
]);
const CONTROL_OPCODES = new Set([OPCODES.CLOSE, OPCODES.PING, OPCODES.PONG]);

const EMPTY_PING = Buffer.from([0x89, 0x00]);
const EMPTY_PONG = Buffer.from([0x8a, 0x00]);
const CLIENT_EMPTY_PING = Buffer.from([0x89, 0x80, 0x00, 0x00, 0x00, 0x00]);
const CLIENT_EMPTY_PONG = Buffer.from([0x8a, 0x80, 0x00, 0x00, 0x00, 0x00]);
const EMPTY_BUFFER = Buffer.alloc(0);

const CLOSE_FRAMES = {
  NORMAL_CLOSE: {
    reason: '',
    buf: Buffer.from([0x88, 0x02, 0x03, 0xe8]),
  },
  GOING_AWAY: {
    reason: 'Going away',
    buf: Buffer.from([
      0x88, 0xc, 0x3, 0xe9, 0x47, 0x6f, 0x69, 0x6e, 0x67, 0x20, 0x61, 0x77,
      0x61, 0x79,
    ]),
  },
  PROTOCOL_ERROR: {
    COMMON: {
      reason: 'Protocol error',
      buf: Buffer.from([
        0x88, 0x10, 0x3, 0xea, 0x50, 0x72, 0x6f, 0x74, 0x6f, 0x63, 0x6f, 0x6c,
        0x20, 0x65, 0x72, 0x72, 0x6f, 0x72,
      ]),
    },
    UNMASKED: {
      reason: 'Unmasked frame from client',
      buf: Buffer.from([
        0x88, 0x1c, 0x3, 0xea, 0x55, 0x6e, 0x6d, 0x61, 0x73, 0x6b, 0x65, 0x64,
        0x20, 0x66, 0x72, 0x61, 0x6d, 0x65, 0x20, 0x66, 0x72, 0x6f, 0x6d, 0x20,
        0x63, 0x6c, 0x69, 0x65, 0x6e, 0x74,
      ]),
    },
    RSV: {
      reason: 'RSV bits must be 0',
      buf: Buffer.from([
        0x88, 0x14, 0x3, 0xea, 0x52, 0x53, 0x56, 0x20, 0x62, 0x69, 0x74, 0x73,
        0x20, 0x6d, 0x75, 0x73, 0x74, 0x20, 0x62, 0x65, 0x20, 0x30,
      ]),
    },
    CTRL_TOO_LONG: {
      reason: 'Control frame too long',
      buf: Buffer.from([
        0x88, 0x18, 0x3, 0xea, 0x43, 0x6f, 0x6e, 0x74, 0x72, 0x6f, 0x6c, 0x20,
        0x66, 0x72, 0x61, 0x6d, 0x65, 0x20, 0x74, 0x6f, 0x6f, 0x20, 0x6c, 0x6f,
        0x6e, 0x67,
      ]),
    },
  },
  INVALID_PAYLOAD: {
    reason: 'Invalid payload data',
    buf: Buffer.from([
      0x88, 0x16, 0x3, 0xef, 0x49, 0x6e, 0x76, 0x61, 0x6c, 0x69, 0x64, 0x20,
      0x70, 0x61, 0x79, 0x6c, 0x6f, 0x61, 0x64, 0x20, 0x64, 0x61, 0x74, 0x61,
    ]),
  },
  MESSAGE_TOO_BIG: {
    reason: 'Message too big',
    buf: Buffer.from([
      0x88, 0x11, 0x3, 0xf1, 0x4d, 0x65, 0x73, 0x73, 0x61, 0x67, 0x65, 0x20,
      0x74, 0x6f, 0x6f, 0x20, 0x62, 0x69, 0x67,
    ]),
  },
};

module.exports = {
  FIN_MASK,
  RSV_MASK,
  OPCODE_MASK,
  MASK_MASK,
  PAYLOAD_LEN_MASK,
  RSV,
  OPCODES,
  FINAL_FRAME,
  LEN_16_BIT,
  LEN_64_BIT,
  MAX_16_BIT,
  PING_INTERVAL,
  UPGRADE,
  MAGIC,
  EOL,
  MAX_BUFFER,
  CLOSE_TIMEOUT,
  CONTROL_FRAME_MASK,
  DATA_OPCODES,
  CONTROL_OPCODES,
  CLOSE_CODES,
  EMPTY_PING,
  EMPTY_PONG,
  EMPTY_BUFFER,
  CLIENT_EMPTY_PING,
  CLIENT_EMPTY_PONG,
  CLOSE_FRAMES,
  ENCODING,
  EOL2,
  VALID_CLOSE_CODES,
  VALID_USER_CLOSE_CODES,
};
