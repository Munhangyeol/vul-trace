import type {
  FindingRepository,
  ProjectRepository,
  RepositoryScanRunner,
  ScanRepository,
} from '@vulntrace/core';
import { createConsoleScanLogger, createRepositoryScanRunner } from '@vulntrace/core';
import { createPrismaClient } from './persistence/prisma/client.js';
import { PrismaFindingRepository } from './persistence/prisma/FindingRepository.prisma.js';
import { PrismaProjectRepository } from './persistence/prisma/ProjectRepository.prisma.js';
import { PrismaScanRepository } from './persistence/prisma/ScanRepository.prisma.js';

/** Manual DI: everything the routes need, assembled once at startup. */
export interface Container {
  /** Local folders and GitHub repositories both go through this one pipeline entry point. */
  scanRunner: RepositoryScanRunner;
  projectRepository: ProjectRepository;
  scanRepository: ScanRepository;
  findingRepository: FindingRepository;
  /** When set, project paths must resolve inside this directory (CLAUDE.md §4.2). */
  scanRoot?: string;
}

export function createContainer(options: { scanRoot?: string } = {}): Container {
  const prisma = createPrismaClient();

  return {
    scanRunner: createRepositoryScanRunner({ logger: createConsoleScanLogger() }),
    projectRepository: new PrismaProjectRepository(prisma),
    scanRepository: new PrismaScanRepository(prisma),
    findingRepository: new PrismaFindingRepository(prisma),
    scanRoot: options.scanRoot,
  };
}
