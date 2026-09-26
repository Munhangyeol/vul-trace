export type AnalysisErrorCode =
  | 'NOT_IMPLEMENTED'
  | 'PROJECT_NOT_FOUND'
  | 'UNSUPPORTED_PROJECT'
  | 'PARSE_ERROR'
  | 'EXTERNAL_PROCESS_FAILED'
  | 'EXTERNAL_SERVICE_FAILED';

export class AnalysisError extends Error {
  readonly code: AnalysisErrorCode;

  constructor(code: AnalysisErrorCode, message: string, options?: { cause?: unknown }) {
    super(message, options);
    this.name = 'AnalysisError';
    this.code = code;
  }
}

export class NotImplementedError extends AnalysisError {
  constructor(feature: string) {
    super('NOT_IMPLEMENTED', `${feature} is not implemented yet`);
    this.name = 'NotImplementedError';
  }
}
