import type { SourceLocation } from './source-usage.js';

/** Values of Spring's `RequestMethod` enum. */
export type HttpMethod = 'GET' | 'POST' | 'PUT' | 'DELETE' | 'PATCH' | 'HEAD' | 'OPTIONS' | 'TRACE';

/** `ANY` = the mapping has no HTTP method condition, so Spring accepts every method. */
export type EndpointHttpMethod = HttpMethod | 'ANY';

/** One Spring annotation as written in source, kept as evidence for the derived route. */
export interface SpringAnnotationEvidence {
  /** e.g. `@PostMapping("/render")`. */
  annotation: string;
  location: SourceLocation;
}

export interface SpringEndpointEvidence {
  /** `@RestController` / `@Controller` on the class. */
  controller: SpringAnnotationEvidence;
  /** Class-level `@RequestMapping`, when present. */
  classMapping?: SpringAnnotationEvidence;
  /** The handler method's mapping annotation. */
  methodMapping: SpringAnnotationEvidence;
}

/**
 * Phase 5: one (HTTP method, path) pair served by a controller method. A mapping with several
 * paths or methods yields one endpoint per combination.
 */
export interface SpringEndpoint {
  httpMethod: EndpointHttpMethod;
  /**
   * Class path + method path, normalized to start with `/`. Parts that are not string literals
   * (e.g. a constant) are kept as `${expression}` and listed in `unresolved`.
   */
  path: string;
  /** Fully qualified, e.g. `com.example.demo.TemplateController`. */
  controllerClass: string;
  controllerMethod: string;
  /** The handler method declaration. */
  location: SourceLocation;
  /** Annotation argument expressions that static analysis could not evaluate. Empty = fully resolved. */
  unresolved: string[];
  evidence: SpringEndpointEvidence;
  /**
   * Phase 7: Spring Security access annotations (@PreAuthorize, @Secured, @RolesAllowed) on the
   * handler method or its controller class, as written. Empty = none found (not proof of no security).
   */
  security?: SpringAnnotationEvidence[];
}
