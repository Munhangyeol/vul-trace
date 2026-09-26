import type { SpringEndpoint } from '@vulntrace/shared';
import { NotImplementedError } from '@vulntrace/shared';
import type { JavaAnalysisResult } from '@vulntrace/source-analyzer';

/** Phase 5 */
export class SpringEndpointAnalyzer {
  analyze(_analysis: JavaAnalysisResult): SpringEndpoint[] {
    throw new NotImplementedError('SpringEndpointAnalyzer');
  }
}
