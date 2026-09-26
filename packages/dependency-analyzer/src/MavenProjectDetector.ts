import { existsSync, statSync } from 'node:fs';
import { join, resolve } from 'node:path';
import type { AnalysisError, Result } from '@vulntrace/shared';
import { AnalysisError as AnalysisErrorClass, err, ok } from '@vulntrace/shared';

export interface MavenProjectDetectionResult {
  /** Resolved, absolute project root. */
  projectRoot: string;
  pomPath: string;
  /** Files that may cause `mvn` to execute repository-controlled code (CLAUDE.md §16). */
  warnings: string[];
}

const RISKY_MAVEN_FILES = ['.mvn/extensions.xml', '.mvn/maven.config', '.mvn/jvm.config'];
const MAVEN_WRAPPER_FILES = ['mvnw', 'mvnw.cmd'];

/** Detects a single-module Maven project at a given path. Does not descend into subdirectories. */
export class MavenProjectDetector {
  detect(projectPath: string): Result<MavenProjectDetectionResult, AnalysisError> {
    const projectRoot = resolve(projectPath);

    if (!existsSync(projectRoot) || !statSync(projectRoot).isDirectory()) {
      return err(
        new AnalysisErrorClass('PROJECT_NOT_FOUND', `Project path not found: ${projectRoot}`),
      );
    }

    const pomPath = join(projectRoot, 'pom.xml');
    if (!existsSync(pomPath) || !statSync(pomPath).isFile()) {
      return err(
        new AnalysisErrorClass('UNSUPPORTED_PROJECT', `No pom.xml found at: ${projectRoot}`),
      );
    }

    const warnings: string[] = [];
    for (const relativePath of [...RISKY_MAVEN_FILES, ...MAVEN_WRAPPER_FILES]) {
      if (existsSync(join(projectRoot, relativePath))) {
        warnings.push(
          `${relativePath} found — Maven execution may run repository-controlled build logic`,
        );
      }
    }

    return ok({ projectRoot, pomPath, warnings });
  }
}
