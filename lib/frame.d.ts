import { Maybe } from './tools/maybe';

export interface FrameParseResult {
  frame: Frame;
  bytesUsed: number;
}

export declare class Frame {
  fin: boolean;
  rsv: number;
  opcode: number;
  masked: boolean;
  payload: Buffer;
  mask: Buffer | null;

  constructor(
    fin: boolean,
    rsv: number,
    opcode: number,
    masked: boolean,
    payload: Buffer,
    mask: Buffer | null,
  );

  static from(buffer: Buffer): Frame;

  static tryParse(buffer: Buffer): Maybe;

  static text(message: string, fin?: boolean, encoding?: BufferEncoding): Frame;

  static binary(
    buffer: Buffer | ArrayBuffer | ArrayBufferView,
    fin?: boolean,
  ): Frame;

  static ping(payload?: string | Buffer): Frame;

  static pong(payload?: string | Buffer): Frame;

  static close(code?: number, reason?: string): Frame;

  unmaskPayload(): void;

  maskPayload(mask?: Buffer | null): void;

  toString(): string;

  toBuffer(): Buffer;

  get isControlFrame(): boolean;
}
