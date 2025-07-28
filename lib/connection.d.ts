import { Socket } from 'node:net';
import { IncomingMessage } from 'node:http';

export interface ConnectionOptions {
  isClient?: boolean;
  maxBuffer?: number;
  pingInterval?: number;
}

export declare class Connection {
  constructor(
    socket: Socket,
    key: string,
    head: Buffer,
    options: ConnectionOptions,
  );

  init(): void;

  send(data: string | Buffer): void;
  sendText(message: string): void;
  sendBinary(buffer: Buffer): void;
  sendPing(payload?: Buffer | string): void;
  sendPong(payload?: Buffer | string): void;
  sendClose(code?: number, reason?: string): void;
  terminate(): void;

  static from(
    req: IncomingMessage,
    socket: Socket,
    head: Buffer,
    options: ConnectionOptions,
  ): Connection;

  on(
    event: 'message',
    listener: (data: string | Buffer, isBinary: boolean) => void,
  ): this;
  on(event: 'error', listener: (error: Error) => void): this;
  on(event: 'close', listener: () => void): this;
  on(event: 'pong', listener: () => void): this;
}
