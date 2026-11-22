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

/** A position inside one file (both 1-based). */
export interface SourcePosition {
  line: number;
  column: number;
}

/** Inclusive start/end of a declaration in its file. */
export interface SourceRange {
  start: SourcePosition;
  end: SourcePosition;
}

/** A method or constructor parameter; `typeName` is written as in source, without type arguments. */
export interface JavaParameter {
  typeName: string;
  name: string;
  location: SourceLocation;
}

export interface JavaMethod {
  name: string;
  annotations: JavaAnnotation[];
  location: SourceLocation;
  /** True when the name equals the enclosing type's simple name. */
  isConstructor: boolean;
  parameters: JavaParameter[];
  /** False for abstract / interface methods without a body. */
  hasBody: boolean;
  /** From the method name to the closing `}` of the body (or the `;` when there is no body). */
  range: SourceRange;
}

/** A member-level `Type name` declaration of a type; `typeName` is written as in source. */
export interface JavaField {
  typeName: string;
  name: string;
  location: SourceLocation;
}

export interface JavaType {
  name: string;
  qualifiedName: string;
  kind: 'class' | 'interface' | 'enum' | 'record' | 'annotation';
  annotations: JavaAnnotation[];
  methods: JavaMethod[];
  /** Member-level field declarations (Phase 6 call resolution). */
  fields: JavaField[];
  /** Names after `extends`, as written (classes: at most one; interfaces: super-interfaces). */
  extendsTypes: string[];
  /** Names after `implements`, as written. */
  implementsTypes: string[];
  location: SourceLocation;
  /** From the type name to the closing `}` of its body. */
  range: SourceRange;
}

/**
 * Where a reference occurs: inside a method of a type (`methodIndex` into `JavaType.methods` of the
 * type named `typeQualifiedName`) or at member level of the type (field initializer, initializer
 * block). Lambda and anonymous-class bodies count as part of the method that contains them.
 */
export interface JavaMemberScope {
  typeQualifiedName: string;
  methodIndex?: number;
}

/** `new T(...)`; `typeName` is written as in source, possibly qualified. */
export interface JavaObjectCreation {
  typeName: string;
  location: SourceLocation;
  /** Absent outside any type body. */
  scope?: JavaMemberScope;
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
  /** Number of top-level arguments for `CALL`; absent for method references. */
  argumentCount?: number;
  /** Absent outside any type body. */
  scope?: JavaMemberScope;
}

/** `T name` for fields, parameters, locals; also `var name = new T(...)`. */
export interface JavaVariableDeclaration {
  typeName: string;
  name: string;
  location: SourceLocation;
  /** Absent outside any type body. */
  scope?: JavaMemberScope;
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
