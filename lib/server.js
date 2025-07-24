'use strict';

const { EventEmitter } = require('node:events');
const { Connection } = require('./connection.js');

class Server extends EventEmitter {
  #httpServer;
  #options;

  constructor({ server, ...options }) {
    super();
    this.#httpServer = server;
    this.#options = options;

    server.on('upgrade', (req, socket, head) => {
      try {
        const ws = Connection.from(req, socket, head, this.#options);
        this.emit('connection', ws, req);
      } catch (err) {
        this.emit('error', err);
        socket.destroy();
      }
    });
  }
}

module.exports = {
  Server,
};
