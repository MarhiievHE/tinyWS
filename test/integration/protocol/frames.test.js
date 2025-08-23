'use strict';

const test = require('node:test');
const assert = require('node:assert');
const http = require('node:http');

const { WebsocketServer } = require('../../../lib/server.js');
const { ProtocolClient } = require('../../utils/protocolClient.js');
const { CLOSE_CODES } = require('../../../lib/constants.js');

async function startServer(onConn) {
  const httpServer = http.createServer();
  const tinyWsServer = new WebsocketServer(httpServer);
  if (onConn) tinyWsServer.on('connection', onConn);
  await new Promise((r) => httpServer.listen(0, r));
  const port = httpServer.address().port;
  return { httpServer, port };
}

test('frames: unmasked data frame from client -> close 1002 PROTOCOL_ERROR', async () => {
  const { httpServer, port } = await startServer((conn) =>
    conn.on('error', () => {}),
  );
  const client = new ProtocolClient(`ws://localhost:${port}`);

  const result = await new Promise((resolve) => {
    client.on('open', () => {
      // Send unmasked TEXT frame (protocol violation for client)
      client.sendText('oops', { mask: false });
    });
    client.on('close', (code, reason) => resolve({ code, reason }));
  });

  assert.strictEqual(result.code, CLOSE_CODES.PROTOCOL_ERROR);
  assert.ok(
    String(result.reason).toLowerCase().includes('unmasked'),
    `unexpected reason: ${result.reason}`,
  );

  await new Promise((r) => httpServer.close(r));
});

test('frames: RSV bits set -> close 1002 with RSV reason', async () => {
  const { httpServer, port } = await startServer((conn) =>
    conn.on('error', () => {}),
  );
  const client = new ProtocolClient(`ws://localhost:${port}`);

  const result = await new Promise((resolve) => {
    client.on('open', () => {
      // Craft a single masked TEXT frame with RSV bits set (0x70)
      const fin = 0x80;
      const rsv = 0x70;
      const opcode = 0x1; // TEXT
      const b0 = fin | rsv | opcode;
      const payload = Buffer.from([0x41]);
      const maskKey = Buffer.from([0, 0, 0, 0]); // trivial mask
      const b1 = 0x80 | payload.length; // masked + length
      const buf = Buffer.concat([Buffer.from([b0, b1]), maskKey, payload]);
      client.socket.write(buf);
    });
    client.on('close', (code, reason) => resolve({ code, reason }));
  });

  assert.strictEqual(result.code, CLOSE_CODES.PROTOCOL_ERROR);
  assert.ok(
    String(result.reason).toLowerCase().includes('rsv'),
    `unexpected reason: ${result.reason}`,
  );

  await new Promise((r) => httpServer.close(r));
});

test('frames: control frame too long (ping >125) -> close 1002', async () => {
  const { httpServer, port } = await startServer((conn) =>
    conn.on('error', () => {}),
  );
  const client = new ProtocolClient(`ws://localhost:${port}`);

  const result = await new Promise((resolve) => {
    client.on('open', () => {
      client.sendFrame(0x9, Buffer.alloc(126), { mask: true });
    });
    client.on('close', (code, reason) => resolve({ code, reason }));
  });

  assert.strictEqual(result.code, CLOSE_CODES.PROTOCOL_ERROR);
  assert.ok(
    String(result.reason).toLowerCase().includes('too long'),
    `unexpected reason: ${result.reason}`,
  );

  await new Promise((r) => httpServer.close(r));
});

test('frames: fragmented control (ping with FIN=0) -> close 1002', async () => {
  const { httpServer, port } = await startServer((conn) =>
    conn.on('error', () => {}),
  );
  const client = new ProtocolClient(`ws://localhost:${port}`);

  const result = await new Promise((resolve) => {
    client.on('open', () => {
      client.sendFrame(0x9, Buffer.from([0x01]), { fin: false, mask: true });
    });
    client.on('close', (code, reason) => resolve({ code, reason }));
  });

  assert.strictEqual(result.code, CLOSE_CODES.PROTOCOL_ERROR);
  assert.ok(
    String(result.reason).toLowerCase().includes('protocol error'),
    `unexpected reason: ${result.reason}`,
  );

  await new Promise((r) => httpServer.close(r));
});

test('frames: unknown data opcode (0x3) -> close 1002', async () => {
  const { httpServer, port } = await startServer((conn) =>
    conn.on('error', () => {}),
  );
  const client = new ProtocolClient(`ws://localhost:${port}`);

  const result = await new Promise((resolve) => {
    client.on('open', () => {
      client.sendFrame(0x3, Buffer.from([0x00]), { mask: true });
    });
    client.on('close', (code, reason) => resolve({ code, reason }));
  });

  assert.strictEqual(result.code, CLOSE_CODES.PROTOCOL_ERROR);
  await new Promise((r) => httpServer.close(r));
});

test('frames: invalid UTF-8 in single text frame -> close 1007 INVALID_PAYLOAD', async () => {
  const { httpServer, port } = await startServer((conn) =>
    conn.on('error', () => {}),
  );
  const client = new ProtocolClient(`ws://localhost:${port}`);

  const result = await new Promise((resolve) => {
    client.on('open', () => {
      // Overlong encoding for '/' (U+002F) could be 0xC0 0xAF (invalid)
      const invalid = Buffer.from([0xc0, 0xaf]);
      client.sendFrame(0x1, invalid, { mask: true });
    });
    client.on('close', (code, reason) => resolve({ code, reason }));
  });

  assert.strictEqual(result.code, CLOSE_CODES.INVALID_PAYLOAD);
  assert.ok(
    String(result.reason).toLowerCase().includes('invalid payload'),
    `unexpected reason: ${result.reason}`,
  );

  await new Promise((r) => httpServer.close(r));
});

test('frames: CLOSE with 1 byte payload -> close 1002', async () => {
  const { httpServer, port } = await startServer((conn) =>
    conn.on('error', () => {}),
  );
  const client = new ProtocolClient(`ws://localhost:${port}`);

  const result = await new Promise((resolve) => {
    client.on('open', () => {
      client.sendFrame(0x8, Buffer.from([0x03]), { mask: true });
    });
    client.on('close', (code, reason) => resolve({ code, reason }));
  });

  assert.strictEqual(result.code, CLOSE_CODES.PROTOCOL_ERROR);
  await new Promise((r) => httpServer.close(r));
});

test('frames: CLOSE with invalid code 999 -> close 1002', async () => {
  const { httpServer, port } = await startServer((conn) =>
    conn.on('error', () => {}),
  );
  const client = new ProtocolClient(`ws://localhost:${port}`);

  const result = await new Promise((resolve) => {
    client.on('open', () => {
      const payload = Buffer.alloc(2);
      payload.writeUInt16BE(999, 0);
      client.sendFrame(0x8, payload, { mask: true });
    });
    client.on('close', (code, reason) => resolve({ code, reason }));
  });

  assert.strictEqual(result.code, CLOSE_CODES.PROTOCOL_ERROR);
  await new Promise((r) => httpServer.close(r));
});

test('frames: CLOSE with invalid UTF-8 in reason -> close 1007', async () => {
  const { httpServer, port } = await startServer((conn) =>
    conn.on('error', () => {}),
  );
  const client = new ProtocolClient(`ws://localhost:${port}`);

  const result = await new Promise((resolve) => {
    client.on('open', () => {
      const reason = Buffer.from([0xc0, 0xaf]);
      const payload = Buffer.alloc(2 + reason.length);
      payload.writeUInt16BE(1000, 0);
      reason.copy(payload, 2);
      client.sendFrame(0x8, payload, { mask: true });
    });
    client.on('close', (code, reason) => resolve({ code, reason }));
  });

  assert.strictEqual(result.code, CLOSE_CODES.INVALID_PAYLOAD);
  await new Promise((r) => httpServer.close(r));
});

test('frames: CLOSE with empty payload -> client sees 1005 (no status)', async () => {
  const { httpServer, port } = await startServer((conn) =>
    conn.on('error', () => {}),
  );
  const client = new ProtocolClient(`ws://localhost:${port}`);

  const result = await new Promise((resolve) => {
    client.on('open', () => {
      client.sendFrame(0x8, Buffer.alloc(0), { mask: true });
    });
    client.on('close', (code, reason) => resolve({ code, reason }));
  });

  assert.strictEqual(result.code, 1005);
  await new Promise((r) => httpServer.close(r));
});

test('frames: fragmented text with invalid UTF-8 in continuation -> close 1007', async () => {
  const { httpServer, port } = await startServer((conn) =>
    conn.on('error', () => {}),
  );
  const client = new ProtocolClient(`ws://localhost:${port}`);

  const result = await new Promise((resolve) => {
    client.on('open', () => {
      // Start of a 3-byte sequence (E2 82 ..) but complete with invalid cont byte 0x20
      client.sendFrame(0x1, Buffer.from([0xe2, 0x82]), {
        fin: false,
        mask: true,
      });
      client.sendFrame(0x0, Buffer.from([0x20]), { fin: true, mask: true });
    });
    client.on('close', (code, reason) => resolve({ code, reason }));
  });

  assert.strictEqual(result.code, CLOSE_CODES.INVALID_PAYLOAD);
  await new Promise((r) => httpServer.close(r));
});

test('frames: send BINARY during TEXT fragmentation -> close 1002', async () => {
  const { httpServer, port } = await startServer((conn) =>
    conn.on('error', () => {}),
  );
  const client = new ProtocolClient(`ws://localhost:${port}`);

  const result = await new Promise((resolve) => {
    client.on('open', () => {
      client.sendFrame(0x1, Buffer.from([0x41]), { fin: false, mask: true });
      client.sendFrame(0x2, Buffer.from([0x00]), { fin: true, mask: true });
    });
    client.on('close', (code, reason) => resolve({ code, reason }));
  });

  assert.strictEqual(result.code, CLOSE_CODES.PROTOCOL_ERROR);
  await new Promise((r) => httpServer.close(r));
});

test('frames: reserved control opcode 0xB -> close 1002', async () => {
  const { httpServer, port } = await startServer((conn) =>
    conn.on('error', () => {}),
  );
  const client = new ProtocolClient(`ws://localhost:${port}`);

  const result = await new Promise((resolve) => {
    client.on('open', () => {
      // 0xB has control bit set but is not a valid control opcode
      client.sendFrame(0x0b, Buffer.alloc(0), { mask: true });
    });
    client.on('close', (code, reason) => resolve({ code, reason }));
  });

  assert.strictEqual(result.code, CLOSE_CODES.PROTOCOL_ERROR);
  await new Promise((r) => httpServer.close(r));
});

test('frames: normal close handshake (1000 "bye")', async () => {
  const { httpServer, port } = await startServer((conn) =>
    conn.on('error', () => {}),
  );
  const client = new ProtocolClient(`ws://localhost:${port}`);

  const result = await new Promise((resolve) => {
    client.on('open', () => {
      const reason = Buffer.from('bye');
      const payload = Buffer.alloc(2 + reason.length);
      payload.writeUInt16BE(1000, 0);
      reason.copy(payload, 2);
      client.sendFrame(0x8, payload, { mask: true });
    });
    client.on('close', (code, reason) => resolve({ code, reason }));
  });

  assert.strictEqual(result.code, 1000);
  assert.strictEqual(result.reason, 'bye');
  await new Promise((r) => httpServer.close(r));
});
