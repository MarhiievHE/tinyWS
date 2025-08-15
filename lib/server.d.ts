import type { Server as HttpServer, IncomingMessage } from 'http';
import type { Server as HttpSServer } from 'https';
import type { EventEmitter } from 'node:events';
import type { Connection } from './connection';

export interface WebsocketServerOptions {
  pingInterval?: number;
  maxBuffer?: number;
}

export declare class WebsocketServer extends EventEmitter {
  constructor(
    server: HttpServer | HttpSServer,
    options?: WebsocketServerOptions,
  );

  on(
    event: 'connection',
    listener: (ws: Connection, req: IncomingMessage) => void,
  ): this;

  on(event: 'error', listener: (err: Error) => void): this;
  on(event: 'close', listener: () => void): this;
  on(event: string | symbol, listener: (...args: any[]) => void): this;
}
