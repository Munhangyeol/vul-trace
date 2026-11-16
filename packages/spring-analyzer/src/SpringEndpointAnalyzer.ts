import type {
  EndpointHttpMethod,
  HttpMethod,
  SpringAnnotationEvidence,
  SpringEndpoint,
} from '@vulntrace/shared';
import type {
  AnalyzedJavaFile,
  JavaAnalysisResult,
  JavaAnnotation,
  JavaImport,
} from '@vulntrace/source-analyzer';
import { parseAnnotationArguments } from './annotationArguments.js';
import type { ElementValue } from './annotationArguments.js';
import {
  MAPPING_ANNOTATIONS,
  resolveControllerAnnotation,
  resolveMappingAnnotation,
  resolveRequestMethod,
} from './annotations.js';

export interface SpringEndpointAnalysis {
  /** Sorted by path, HTTP method, then file and line. */
  endpoints: SpringEndpoint[];
  /** Controllers that were found but whose mappings could not be read as written. */
  warnings: string[];
}

/** A path or HTTP method part of a mapping, with what could not be resolved statically. */
interface MappingCondition {
  paths: string[];
  methods: HttpMethod[];
  unresolved: string[];
}

const PATH_ATTRIBUTES = ['value', 'path'] as const;

function toEvidence(annotation: JavaAnnotation): SpringAnnotationEvidence {
  // Multi-line arguments are folded onto one line so the evidence reads like the source.
  const args =
    annotation.rawArguments !== undefined ? `(${annotation.rawArguments.replace(/\s*\r?\n\s*/g, ' ')})` : '';
  return { annotation: `@${annotation.name}${args}`, location: annotation.location };
}

function pathOf(value: ElementValue): string {
  return value.kind === 'STRING' ? value.value : `\${${value.text}}`;
}

/** Reads paths and (for @RequestMapping) HTTP methods from one mapping annotation. */
function readMapping(
  annotation: JavaAnnotation,
  simpleName: string,
  imports: readonly JavaImport[],
): MappingCondition {
  const args = parseAnnotationArguments(annotation.rawArguments);
  const unresolved: string[] = [];

  const pathValues = PATH_ATTRIBUTES.flatMap((attribute) => args.get(attribute) ?? []);
  for (const value of pathValues) if (value.kind === 'EXPRESSION') unresolved.push(value.text);

  const fixedMethod = MAPPING_ANNOTATIONS[simpleName];
  const methods: HttpMethod[] = fixedMethod ? [fixedMethod] : [];
  if (!fixedMethod) {
    for (const value of args.get('method') ?? []) {
      const text = value.kind === 'EXPRESSION' ? value.text : JSON.stringify(value.value);
      const method = value.kind === 'EXPRESSION' ? resolveRequestMethod(text, imports) : undefined;
      if (method) methods.push(method);
      else unresolved.push(text);
    }
  }

  return { paths: pathValues.map(pathOf), methods, unresolved };
}

/**
 * Spring's path combination for the common cases: `/api` + `/render` → `/api/render`,
 * `/api` + `` → `/api`, a missing leading slash is added, duplicate slashes are collapsed.
 */
export function combinePaths(classPath: string, methodPath: string): string {
  const joined = [classPath, methodPath].filter((p) => p !== '').join('/');
  return `/${joined}`.replace(/\/{2,}/g, '/');
}

function findMapping(
  annotations: readonly JavaAnnotation[],
  imports: readonly JavaImport[],
): { annotation: JavaAnnotation; simpleName: string; extra: number } | undefined {
  const mappings = annotations.flatMap((annotation) => {
    const simpleName = resolveMappingAnnotation(annotation, imports);
    return simpleName ? [{ annotation, simpleName }] : [];
  });
  // Spring's merged-annotation lookup prefers a directly present @RequestMapping over the
  // shortcuts (@GetMapping, ...), which only carry it as a meta-annotation.
  const first = mappings.find((m) => m.simpleName === 'RequestMapping') ?? mappings[0];
  return first ? { ...first, extra: mappings.length - 1 } : undefined;
}

const unique = <T>(values: readonly T[]): T[] => [...new Set(values)];

function analyzeFile(file: AnalyzedJavaFile, endpoints: SpringEndpoint[], warnings: string[]): void {
  for (const type of file.types) {
    if (type.kind !== 'class') continue;
    const controller = type.annotations.find((a) => resolveControllerAnnotation(a, file.imports));
    if (!controller) continue;

    const classMapping = findMapping(type.annotations, file.imports);
    const classCondition: MappingCondition = classMapping
      ? readMapping(classMapping.annotation, classMapping.simpleName, file.imports)
      : { paths: [], methods: [], unresolved: [] };

    for (const method of type.methods) {
      const mapping = findMapping(method.annotations, file.imports);
      if (!mapping) continue;
      if (mapping.extra > 0) {
        warnings.push(
          `${file.filePath}:${method.location.line}: ${type.name}.${method.name} has ${mapping.extra + 1} mapping annotations; using ${toEvidence(mapping.annotation).annotation}`,
        );
      }

      const methodCondition = readMapping(mapping.annotation, mapping.simpleName, file.imports);
      // Spring unions class- and method-level method conditions; none at all means any method.
      const methods: EndpointHttpMethod[] = unique([...classCondition.methods, ...methodCondition.methods]);
      const unresolved = unique([...classCondition.unresolved, ...methodCondition.unresolved]);
      const classPaths = classCondition.paths.length > 0 ? classCondition.paths : [''];
      const methodPaths = methodCondition.paths.length > 0 ? methodCondition.paths : [''];

      const evidence = {
        controller: toEvidence(controller),
        ...(classMapping ? { classMapping: toEvidence(classMapping.annotation) } : {}),
        methodMapping: toEvidence(mapping.annotation),
      };

      for (const classPath of classPaths) {
        for (const methodPath of methodPaths) {
          for (const httpMethod of methods.length > 0 ? methods : (['ANY'] as const)) {
            endpoints.push({
              httpMethod,
              path: combinePaths(classPath, methodPath),
              controllerClass: type.qualifiedName,
              controllerMethod: method.name,
              location: method.location,
              unresolved,
              evidence,
            });
          }
        }
      }
    }
  }
}

/** Code-unit order, so the result does not depend on the host locale. */
const compareText = (a: string, b: string): number => (a < b ? -1 : a > b ? 1 : 0);

function compareEndpoints(a: SpringEndpoint, b: SpringEndpoint): number {
  return (
    compareText(a.path, b.path) ||
    compareText(a.httpMethod, b.httpMethod) ||
    compareText(a.location.filePath, b.location.filePath) ||
    a.location.line - b.location.line
  );
}

/**
 * Phase 5: Spring MVC endpoints from `@RestController` / `@Controller` classes and their
 * `@RequestMapping` / `@GetMapping` / ... methods. Static only — it reads the parsed source and
 * never loads or runs application code. Test sources are ignored: they are not served.
 */
export class SpringEndpointAnalyzer {
  analyze(analysis: JavaAnalysisResult): SpringEndpointAnalysis {
    const endpoints: SpringEndpoint[] = [];
    const warnings: string[] = [];
    for (const file of analysis.files) {
      if (file.sourceSet === 'MAIN') analyzeFile(file, endpoints, warnings);
    }
    return { endpoints: endpoints.sort(compareEndpoints), warnings };
  }
}
