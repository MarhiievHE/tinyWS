import type { Result } from './tools/result';
import type { Frame } from './frame';

export class ParseError extends Error {
  constructor(code: string, message?: string);
  name: 'ParseError';
  code: string;
}

export const PARSE_ERR_CODES: {
  LENGTH_EXCEEDS_SAFE: 'LENGTH_EXCEEDS_SAFE';
};

export class FrameParser {
  /**
   * Parses a buffer and returns a Result:
   * - an empty result if there's not enough data
   * - or an object { frame: Frame; bytesUsed: number }
   * - or a ParseError inside the Result (see PARSE_ERR_CODES)
   */
  static parse(buffer: Buffer): Result<{ frame: Frame; bytesUsed: number }>;
}
