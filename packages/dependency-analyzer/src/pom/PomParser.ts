import { XMLParser, XMLValidator } from 'fast-xml-parser';
import type { AnalysisError, Result } from '@vulntrace/shared';
import { AnalysisError as AnalysisErrorClass, err, ok } from '@vulntrace/shared';
import type { RawPom, RawPomDependency, RawPomParent } from './PomModel.js';

/** Guards against XML bombs / pathological input regardless of parser behavior. */
const MAX_POM_SIZE_BYTES = 5 * 1024 * 1024;

const xmlParser = new XMLParser({
  ignoreAttributes: true,
  parseTagValue: false,
  trimValues: true,
  isArray: (name) => name === 'dependency' || name === 'module',
});

function asString(value: unknown): string | undefined {
  if (typeof value === 'string') return value;
  if (typeof value === 'number' || typeof value === 'boolean') return String(value);
  return undefined;
}

function asRecord(value: unknown): Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function parseDependency(node: unknown): RawPomDependency | undefined {
  const record = asRecord(node);
  const groupId = asString(record.groupId);
  const artifactId = asString(record.artifactId);
  if (!groupId || !artifactId) return undefined;
  return {
    groupId,
    artifactId,
    version: asString(record.version),
    scope: asString(record.scope) ?? 'compile',
    type: asString(record.type),
    classifier: asString(record.classifier),
    optional: asString(record.optional) === 'true',
  };
}

function parseDependencyList(dependenciesNode: unknown): RawPomDependency[] {
  const list = asRecord(dependenciesNode).dependency;
  if (!Array.isArray(list)) return [];
  return list.map(parseDependency).filter((d): d is RawPomDependency => d !== undefined);
}

function parseModules(modulesNode: unknown): string[] {
  const list = asRecord(modulesNode).module;
  if (!Array.isArray(list)) return [];
  return list.map(asString).filter((m): m is string => m !== undefined);
}

function parseProperties(propertiesNode: unknown): Record<string, string> {
  const properties: Record<string, string> = {};
  for (const [key, value] of Object.entries(asRecord(propertiesNode))) {
    const stringValue = asString(value);
    if (stringValue !== undefined) properties[key] = stringValue;
  }
  return properties;
}

function parseParent(parentNode: unknown): RawPomParent | undefined {
  if (parentNode === undefined) return undefined;
  const record = asRecord(parentNode);
  const groupId = asString(record.groupId);
  const artifactId = asString(record.artifactId);
  const version = asString(record.version);
  if (!groupId || !artifactId || !version) return undefined;
  return { groupId, artifactId, version, relativePath: asString(record.relativePath) };
}

/** Parses pom.xml into a raw, unresolved model (CLAUDE.md §14 — no semantic resolution here). */
export class PomParser {
  parse(xml: string, filePath: string): Result<RawPom, AnalysisError> {
    if (xml.length > MAX_POM_SIZE_BYTES) {
      return err(new AnalysisErrorClass('PARSE_ERROR', `pom.xml exceeds size limit: ${filePath}`));
    }
    if (/<!DOCTYPE/i.test(xml) || /<!ENTITY/i.test(xml)) {
      return err(
        new AnalysisErrorClass(
          'PARSE_ERROR',
          `pom.xml contains a DOCTYPE/ENTITY declaration, refusing to parse: ${filePath}`,
        ),
      );
    }

    const validation = XMLValidator.validate(xml);
    if (validation !== true) {
      return err(
        new AnalysisErrorClass(
          'PARSE_ERROR',
          `Malformed pom.xml (${validation.err.msg}): ${filePath}`,
        ),
      );
    }

    let parsed: unknown;
    try {
      parsed = xmlParser.parse(xml);
    } catch (cause) {
      return err(
        new AnalysisErrorClass('PARSE_ERROR', `Failed to parse pom.xml: ${filePath}`, { cause }),
      );
    }

    const project = asRecord(asRecord(parsed).project);
    const artifactId = asString(project.artifactId);
    if (!artifactId) {
      return err(
        new AnalysisErrorClass('PARSE_ERROR', `pom.xml missing <artifactId>: ${filePath}`),
      );
    }

    return ok({
      groupId: asString(project.groupId),
      artifactId,
      version: asString(project.version),
      packaging: asString(project.packaging) ?? 'jar',
      parent: parseParent(project.parent),
      properties: parseProperties(project.properties),
      dependencies: parseDependencyList(project.dependencies),
      dependencyManagement: parseDependencyList(
        asRecord(project.dependencyManagement).dependencies,
      ),
      modules: parseModules(project.modules),
    });
  }
}
