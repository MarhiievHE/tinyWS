import { Socket } from 'node:net';

export interface ConnectionOptions {
  isClient?: boolean;
  maxBuffer?: number;
  closeTimeout?: number;
}

export declare class Connection {
  constructor(socket: Socket, head: Buffer, options?: ConnectionOptions);

  send(data: string | Buffer): void;
  sendText(message: string): void;
  sendBinary(buffer: Buffer): void;
  sendPing(payload?: Buffer | string): void;
  sendPong(payload?: Buffer | string): void;
  sendClose(code?: number, reason?: string): void;
  terminate(): void;

  on(
    event: 'message',
    listener: (data: string | Buffer, isBinary: boolean) => void,
  ): this;
  on(event: 'error', listener: (error: Error) => void): this;
  on(event: 'close', listener: () => void): this;
  on(event: 'pong', listener: (payload: Buffer) => void): this;
}
