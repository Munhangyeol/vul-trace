import type { Command } from 'commander';
import type { DependencyAnalysisOptions } from '@vulntrace/core';

export interface MavenCliOptions {
  allowMaven?: boolean;
  mavenTimeout?: string;
}

const DEFAULT_MAVEN_TIMEOUT_SECONDS = '120';

export function addMavenOptions(command: Command): Command {
  return command
    .option(
      '--allow-maven',
      'allow running `mvn dependency:tree` to resolve transitive dependencies',
    )
    .option(
      '--maven-timeout <seconds>',
      'timeout for `mvn dependency:tree`, in seconds',
      DEFAULT_MAVEN_TIMEOUT_SECONDS,
    );
}

export function parseMavenOptions(options: MavenCliOptions): DependencyAnalysisOptions {
  const seconds = Number(options.mavenTimeout ?? DEFAULT_MAVEN_TIMEOUT_SECONDS);
  return {
    allowMaven: options.allowMaven ?? false,
    mavenTimeoutMs: Number.isFinite(seconds) ? seconds * 1000 : undefined,
  };
}
