import { readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { AnalysisError, err, ok } from '@vulntrace/shared';
import type { Result } from '@vulntrace/shared';
import { LightweightJavaParser } from './parser/LightweightJavaParser.js';
import type { JavaSourceParser } from './parser/JavaSourceParser.js';
import { DEFAULT_SCAN_LIMITS, scanJavaFiles } from './scanner/JavaFileScanner.js';
import type { JavaFileScanLimits } from './scanner/JavaFileScanner.js';
import type { AnalyzedJavaFile, JavaAnalysisResult, SkippedJavaFile } from './types.js';

/**
 * Entry point for Java analysis (CLAUDE.md §14). Callers depend only on this
 * interface so a Stage B adapter (`java -jar java-analyzer.jar`) can replace
 * the TypeScript implementation without changing calling code.
 */
export interface JavaSourceAnalyzer {
  analyzeProject(projectPath: string): Promise<Result<JavaAnalysisResult, AnalysisError>>;
}

export interface LightweightJavaSourceAnalyzerOptions {
  parser?: JavaSourceParser;
  limits?: JavaFileScanLimits;
  /** Files larger than this are skipped and reported, never partially parsed. */
  maxFileBytes?: number;
}

const DEFAULT_MAX_FILE_BYTES = 1024 * 1024;

/** Phase 4 — Stage A, TypeScript-only analysis. Reads source files; never executes them. */
export class LightweightJavaSourceAnalyzer implements JavaSourceAnalyzer {
  private readonly parser: JavaSourceParser;
  private readonly limits: JavaFileScanLimits;
  private readonly maxFileBytes: number;

  constructor(options: LightweightJavaSourceAnalyzerOptions = {}) {
    this.parser = options.parser ?? new LightweightJavaParser();
    this.limits = options.limits ?? DEFAULT_SCAN_LIMITS;
    this.maxFileBytes = options.maxFileBytes ?? DEFAULT_MAX_FILE_BYTES;
  }

  async analyzeProject(projectPath: string): Promise<Result<JavaAnalysisResult, AnalysisError>> {
    try {
      if (!statSync(projectPath).isDirectory()) {
        return err(new AnalysisError('PROJECT_NOT_FOUND', `not a directory: ${projectPath}`));
      }
    } catch (cause) {
      return err(new AnalysisError('PROJECT_NOT_FOUND', `cannot access ${projectPath}`, { cause }));
    }

    const scan = scanJavaFiles(projectPath, this.limits);
    const files: AnalyzedJavaFile[] = [];
    const skippedFiles: SkippedJavaFile[] = [];

    for (const { filePath, sourceSet } of scan.files) {
      const absolutePath = join(projectPath, filePath);
      try {
        const size = statSync(absolutePath).size;
        if (size > this.maxFileBytes) {
          skippedFiles.push({ filePath, reason: `file larger than ${this.maxFileBytes} bytes (${size})` });
          continue;
        }
        const content = readFileSync(absolutePath, 'utf-8');
        files.push({ ...this.parser.parse(filePath, content), sourceSet });
      } catch (cause) {
        skippedFiles.push({ filePath, reason: `cannot analyze: ${(cause as Error).message}` });
      }
    }

    const warnings = [...scan.warnings];
    if (scan.files.length === 0) {
      warnings.push('no Java source files found under src/main/java or src/test/java');
    }
    warnings.push(...skippedFiles.map((s) => `Java file skipped: ${s.filePath} — ${s.reason}`));

    return ok({ projectPath, files, skippedFiles, warnings });
  }
}
