import type { SourceLocation, SourceSet } from '@vulntrace/shared';

export interface JavaImport {
  /** e.g. org.apache.commons.text.StringSubstitutor, or org.apache.commons.text for `org.apache.commons.text.*` */
  name: string;
  isStatic: boolean;
  isWildcard: boolean;
  location: SourceLocation;
}

export interface JavaAnnotation {
  /** Simple or qualified name as written, without the leading at-sign. */
  name: string;
  /** Raw argument text, e.g. `"/api/login"` or `value = "/x", method = RequestMethod.POST`. */
  rawArguments?: string;
  location: SourceLocation;
}

export interface JavaMethod {
  name: string;
  annotations: JavaAnnotation[];
  location: SourceLocation;
}

export interface JavaType {
  name: string;
  qualifiedName: string;
  kind: 'class' | 'interface' | 'enum' | 'record' | 'annotation';
  annotations: JavaAnnotation[];
  methods: JavaMethod[];
  location: SourceLocation;
}

/** `new T(...)`; `typeName` is written as in source, possibly qualified. */
export interface JavaObjectCreation {
  typeName: string;
  location: SourceLocation;
}

/** `q.m(...)` / `m(...)` / `q::m`. */
export interface JavaMethodInvocation {
  name: string;
  /** Dotted name before the method, e.g. `StringSubstitutor`, `this.service`, `org.x.Util`. */
  qualifier?: string;
  /** True when the receiver is an expression (e.g. `a().m()`), whose type Stage A does not track. */
  chained: boolean;
  kind: 'CALL' | 'METHOD_REFERENCE';
  location: SourceLocation;
}

/** `T name` for fields, parameters, locals; also `var name = new T(...)`. */
export interface JavaVariableDeclaration {
  typeName: string;
  name: string;
  location: SourceLocation;
}

/** A dotted name of two or more segments not followed by `(`, e.g. `org.x.Foo.class` or `Foo.BAR`. */
export interface JavaNameReference {
  name: string;
  location: SourceLocation;
}

export interface JavaFileAnalysis {
  filePath: string;
  packageName?: string;
  imports: JavaImport[];
  types: JavaType[];
  objectCreations: JavaObjectCreation[];
  invocations: JavaMethodInvocation[];
  variables: JavaVariableDeclaration[];
  nameReferences: JavaNameReference[];
  /** 1-based source lines, used to build evidence snippets. */
  lines: string[];
}

export interface JavaSourceFile {
  /** Relative to the project root, forward slashes. */
  filePath: string;
  sourceSet: SourceSet;
}

export interface AnalyzedJavaFile extends JavaFileAnalysis {
  sourceSet: SourceSet;
}

export interface SkippedJavaFile {
  filePath: string;
  reason: string;
}

export interface JavaAnalysisResult {
  projectPath: string;
  files: AnalyzedJavaFile[];
  skippedFiles: SkippedJavaFile[];
  warnings: string[];
}
