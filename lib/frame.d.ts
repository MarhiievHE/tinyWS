export interface FrameParseResult {
  frame: Frame;
  bytesUsed: number;
}

export declare class Frame {
  fin: boolean;
  opcode: number;
  masked: boolean;
  payload: Buffer;
  mask: Buffer | null;
  rsv: number;

  constructor(
    fin: boolean,
    opcode: number,
    masked: boolean,
    payload: Buffer,
    mask: Buffer | null,
    rsv: number,
  );

  static text(message: string, fin?: boolean): Frame;

  static binary(
    buffer: Buffer | ArrayBuffer | ArrayBufferView,
    fin?: boolean,
  ): Frame;

  static ping(payload?: string | Buffer): Frame;

  static pong(payload?: string | Buffer): Frame;

  static emptyPingBuffer(isClient?: boolean): Buffer;

  static emptyPongBuffer(isClient?: boolean): Buffer;

  static close(code?: number, reason?: string): Frame;

  unmaskPayload(): void;

  maskPayload(): void;

  toString(): string;

  toBuffer(): Buffer;

  get isControlFrame(): boolean;
}
