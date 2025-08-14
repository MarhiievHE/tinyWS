'use strict';

const test = require('node:test');
const assert = require('node:assert');
const { Connection } = require('../../lib/connection.js');
const { Frame } = require('../../lib/frame.js');
const { OPCODES } = require('../../lib/constants.js');
const { EventEmitter } = require('events');
const { FrameParser } = require('../../lib/frameParser.js');

class MockSocket extends EventEmitter {
  constructor() {
    super();
    this.writtenData = [];
    this.ended = false;
    this.destroyed = false;
  }
  write(data) {
    this.writtenData.push(data);
  }
  end() {
    this.ended = true;
    process.nextTick(() => this.emit('close'));
  }
  destroy() {
    this.destroyed = true;
    process.nextTick(() => this.emit('close'));
  }
}

test('Connection: should emit message on text frame', async () => {
  const socket = new MockSocket();
  const conn = new Connection(socket, Buffer.alloc(0), {});

  await new Promise((resolve) => {
    conn.on('message', (msg, isBinary) => {
      assert.strictEqual(msg, 'hello');
      assert.strictEqual(isBinary, false);
      resolve();
    });
    socket.emit('data', Frame.text('hello').toBuffer());
  });

  conn.terminate();
});

test('Connection: should send pong when ping received', () => {
  const socket = new MockSocket();
  const conn = new Connection(socket, Buffer.alloc(0), {});

  socket.emit('data', Frame.ping().toBuffer());

  const lastWrite = socket.writtenData[socket.writtenData.length - 1];
  const frame = FrameParser.parse(lastWrite).value.frame;
  assert.strictEqual(frame.opcode, OPCODES.PONG);
  conn.terminate();
});

test('Connection: should close on close frame', () => {
  const socket = new MockSocket();
  const conn = new Connection(socket, Buffer.alloc(0), {});

  return new Promise((resolve) => {
    conn.on('close', () => {
      assert.strictEqual(socket.ended, true);
      resolve();
    });
    socket.emit('data', Frame.close().toBuffer());
  });
});
