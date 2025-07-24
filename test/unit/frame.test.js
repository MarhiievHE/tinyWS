'use strict';

const test = require('node:test');
const assert = require('node:assert');
const crypto = require('node:crypto');

const { Frame } = require('../../lib/frame.js');
const { OPCODES, FINAL_FRAME, LEN_64_BIT } = require('../../lib/constants.js');

test('Frame: create and parse text frame', () => {
  const message = 'Hello tinyWS';
  const frame = Frame.text(message);

  const buffer = frame.toBuffer();
  const parsed = Frame.from(buffer);

  assert.strictEqual(parsed.opcode, OPCODES.TEXT);
  assert.strictEqual(parsed.toString(), message);
});

test('Frame: mask and unmask payload', () => {
  const payload = Buffer.from('mask-test');
  const frame = Frame.text(payload);

  frame.maskPayload(Buffer.from([1, 2, 3, 4]));
  const maskedPayload = Buffer.from(frame.payload);

  frame.unmaskPayload();
  assert.strictEqual(frame.toString(), 'mask-test');

  assert.notDeepStrictEqual(maskedPayload, frame.payload);
});

test('Frame: create binary frame', () => {
  const data = crypto.randomBytes(10);
  const frame = Frame.binary(data);
  const buffer = frame.toBuffer();
  const parsed = Frame.from(buffer);

  assert.strictEqual(parsed.opcode, OPCODES.BINARY);
  assert.deepStrictEqual(parsed.payload, data);
});

test('Frame: extended 16-bit length', () => {
  const data = Buffer.alloc(200, 0x42); //B
  const frame = Frame.binary(data);
  const buffer = frame.toBuffer();
  const parsed = Frame.from(buffer);

  assert.strictEqual(parsed.payload.length, 200);
  assert.deepStrictEqual(parsed.payload, data);
});

test('Frame: extended 64-bit length', () => {
  const size = 70 * 1024;
  const data = Buffer.alloc(size, 0x42); //B
  const frame = Frame.binary(data);
  const buffer = frame.toBuffer();
  const parsed = Frame.from(buffer);

  assert.strictEqual(parsed.payload.length, size);
  assert.deepStrictEqual(parsed.payload, data);
});

test('Frame: throws error when payload length exceeds MAX_SAFE_INTEGER', () => {
  const buffer = Buffer.alloc(14);
  buffer[0] = FINAL_FRAME & OPCODES.BINARY;
  buffer[1] = LEN_64_BIT;

  const bigValue = BigInt(Number.MAX_SAFE_INTEGER) + 1n;
  buffer.writeUInt32BE(Number(bigValue >> 32n), 2);
  buffer.writeUInt32BE(Number(bigValue & 0xffffffffn), 6);

  buffer.writeUInt32BE(0, 10);

  assert.throws(() => Frame.from(buffer), {
    name: 'Error',
    message: 'Payload length exceeds MAX_SAFE_INTEGER',
  });
});
