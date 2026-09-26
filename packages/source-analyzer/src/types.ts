import type { SourceLocation } from '@vulntrace/shared';

export interface JavaImport {
  /** e.g. org.apache.commons.text.StringSubstitutor or org.apache.commons.text.* */
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
  kind: 'class' | 'interface' | 'enum' | 'record';
  annotations: JavaAnnotation[];
  methods: JavaMethod[];
  location: SourceLocation;
}

export interface JavaFileAnalysis {
  filePath: string;
  packageName?: string;
  imports: JavaImport[];
  types: JavaType[];
}

export interface JavaAnalysisResult {
  projectPath: string;
  files: JavaFileAnalysis[];
}
