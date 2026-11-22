import type { HttpMethod } from '@vulntrace/shared';
import type { JavaAnnotation, JavaImport } from '@vulntrace/source-analyzer';

const WEB_BIND_PACKAGE = 'org.springframework.web.bind.annotation';

/** Simple name → fully qualified name of the class-level annotations that make a controller. */
export const CONTROLLER_ANNOTATIONS: Readonly<Record<string, string>> = {
  RestController: `${WEB_BIND_PACKAGE}.RestController`,
  Controller: 'org.springframework.stereotype.Controller',
};

/** `null` means the HTTP method comes from the `method` attribute (@RequestMapping). */
export const MAPPING_ANNOTATIONS: Readonly<Record<string, HttpMethod | null>> = {
  RequestMapping: null,
  GetMapping: 'GET',
  PostMapping: 'POST',
  PutMapping: 'PUT',
  DeleteMapping: 'DELETE',
  PatchMapping: 'PATCH',
};

const MAPPING_QUALIFIED_NAMES: Readonly<Record<string, string>> = Object.fromEntries(
  Object.keys(MAPPING_ANNOTATIONS).map((name) => [name, `${WEB_BIND_PACKAGE}.${name}`]),
);

export const HTTP_METHODS: ReadonlySet<HttpMethod> = new Set<HttpMethod>([
  'GET', 'POST', 'PUT', 'DELETE', 'PATCH', 'HEAD', 'OPTIONS', 'TRACE',
]);

const REQUEST_METHOD_TYPE = `${WEB_BIND_PACKAGE}.RequestMethod`;

/**
 * Resolves an annotation as written (`GetMapping` or a qualified name) to the Spring annotation
 * it denotes, using the file's imports. Returns the simple name from `known`, or undefined when
 * the annotation is not (provably) that Spring annotation — e.g. a same-named custom one.
 */
function resolveAnnotation(
  annotation: JavaAnnotation,
  imports: readonly JavaImport[],
  known: Readonly<Record<string, string>>,
): string | undefined {
  const written = annotation.name;
  const simpleName = written.slice(written.lastIndexOf('.') + 1);
  const qualifiedName = known[simpleName];
  if (!qualifiedName) return undefined;
  if (written.includes('.')) return written === qualifiedName ? simpleName : undefined;

  const packageName = qualifiedName.slice(0, qualifiedName.lastIndexOf('.'));
  const imported = imports.some(
    (i) =>
      !i.isStatic &&
      ((!i.isWildcard && i.name === qualifiedName) || (i.isWildcard && i.name === packageName)),
  );
  return imported ? simpleName : undefined;
}

/** Simple name → qualified names of the access-control annotations that require an authenticated caller. */
const SECURITY_ANNOTATIONS: Readonly<Record<string, readonly string[]>> = {
  PreAuthorize: ['org.springframework.security.access.prepost.PreAuthorize'],
  Secured: ['org.springframework.security.access.annotation.Secured'],
  RolesAllowed: ['jakarta.annotation.security.RolesAllowed', 'javax.annotation.security.RolesAllowed'],
};

/** Expressions that grant access without authentication, so the annotation does not protect anything. */
const OPEN_ACCESS = /permitAll|isAnonymous|\banonymous\b|IS_AUTHENTICATED_ANONYMOUSLY/i;

/**
 * True when `annotation` is (provably, via imports) a Spring Security / Jakarta access annotation
 * that requires an authenticated caller. `@PreAuthorize("permitAll()")` and the like do not count.
 */
export function isSecurityAnnotation(annotation: JavaAnnotation, imports: readonly JavaImport[]): boolean {
  const written = annotation.name;
  const simpleName = written.slice(written.lastIndexOf('.') + 1);
  const qualifiedNames = SECURITY_ANNOTATIONS[simpleName];
  if (!qualifiedNames) return false;
  if (annotation.rawArguments && OPEN_ACCESS.test(annotation.rawArguments)) return false;
  if (written.includes('.')) return qualifiedNames.includes(written);
  return qualifiedNames.some((qualifiedName) => {
    const packageName = qualifiedName.slice(0, qualifiedName.lastIndexOf('.'));
    return imports.some(
      (i) =>
        !i.isStatic &&
        ((!i.isWildcard && i.name === qualifiedName) || (i.isWildcard && i.name === packageName)),
    );
  });
}

export function resolveControllerAnnotation(
  annotation: JavaAnnotation,
  imports: readonly JavaImport[],
): string | undefined {
  return resolveAnnotation(annotation, imports, CONTROLLER_ANNOTATIONS);
}

export function resolveMappingAnnotation(
  annotation: JavaAnnotation,
  imports: readonly JavaImport[],
): string | undefined {
  return resolveAnnotation(annotation, imports, MAPPING_QUALIFIED_NAMES);
}

/**
 * Resolves a `method = ...` element such as `RequestMethod.POST`, a fully qualified
 * `org.springframework.web.bind.annotation.RequestMethod.POST`, or `POST` with a static import.
 */
export function resolveRequestMethod(
  expression: string,
  imports: readonly JavaImport[],
): HttpMethod | undefined {
  const text = expression.replace(/\s+/g, '');
  const constant = text.slice(text.lastIndexOf('.') + 1) as HttpMethod;
  if (!HTTP_METHODS.has(constant)) return undefined;

  const qualifier = text.includes('.') ? text.slice(0, text.lastIndexOf('.')) : undefined;
  if (qualifier === REQUEST_METHOD_TYPE) return constant;
  if (qualifier === 'RequestMethod') {
    const imported = imports.some(
      (i) =>
        !i.isStatic &&
        ((!i.isWildcard && i.name === REQUEST_METHOD_TYPE) || (i.isWildcard && i.name === WEB_BIND_PACKAGE)),
    );
    return imported ? constant : undefined;
  }
  if (qualifier === undefined) {
    const imported = imports.some(
      (i) =>
        i.isStatic &&
        ((!i.isWildcard && i.name === `${REQUEST_METHOD_TYPE}.${constant}`) ||
          (i.isWildcard && i.name === REQUEST_METHOD_TYPE)),
    );
    return imported ? constant : undefined;
  }
  return undefined;
}
