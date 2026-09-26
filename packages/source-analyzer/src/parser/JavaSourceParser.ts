import type { JavaFileAnalysis } from '../types.js';

/** Parsing strategy for a single Java file. */
export interface JavaSourceParser {
  parse(filePath: string, content: string): JavaFileAnalysis;
}
