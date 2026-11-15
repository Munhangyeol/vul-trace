import { describe, expect, it } from 'vitest';
import type { SourceSet } from '@vulntrace/shared';
import { applyApiImplementations } from './apiImplementations.js';
import type { DependencyRef, DependencyUsage, MatchedUsage } from './UsageMatcher.js';

const dep = (groupId: string, artifactId: string, version = '1.0'): DependencyRef => ({
  groupId,
  artifactId,
  purl: `pkg:maven/${groupId}/${artifactId}@${version}`,
});

const LOG4J_API = dep('org.apache.logging.log4j', 'log4j-api', '2.9.1');
const LOG4J_CORE = dep('org.apache.logging.log4j', 'log4j-core', '2.9.1');
const LOG4J_TO_SLF4J = dep('org.apache.logging.log4j', 'log4j-to-slf4j', '2.9.1');
const SLF4J_API = dep('org.slf4j', 'slf4j-api', '1.7.36');
const LOG4J_SLF4J_IMPL = dep('org.apache.logging.log4j', 'log4j-slf4j-impl', '2.9.1');
const LOGBACK_CLASSIC = dep('ch.qos.logback', 'logback-classic', '1.2.11');

function usage(owner: DependencyRef, symbol: string, sourceSet: SourceSet = 'MAIN'): MatchedUsage {
  return {
    kind: 'METHOD_CALL',
    symbol,
    dependencyPurl: owner.purl,
    sourceSet,
    evidence: {
      location: { filePath: 'src/main/java/App.java', line: 20 },
      snippet: 'logger.error(token);',
    },
  };
}

function usagesFor(entries: [DependencyRef, MatchedUsage[]][]): DependencyUsage[] {
  return entries.map(([d, usages]) => ({
    purl: d.purl,
    packageMapping: { packages: [d.groupId], basis: 'CURATED' },
    usages,
  }));
}

const byPurl = (result: DependencyUsage[], d: DependencyRef) =>
  result.find((u) => u.purl === d.purl);

describe('applyApiImplementations', () => {
  it('marks log4j-core used through log4j-api, with the API usages as evidence', () => {
    const apiCall = usage(LOG4J_API, 'org.apache.logging.log4j.Logger#error');
    const result = applyApiImplementations(
      usagesFor([
        [LOG4J_API, [apiCall]],
        [LOG4J_CORE, []],
      ]),
      [LOG4J_API, LOG4J_CORE],
    );

    const core = byPurl(result, LOG4J_CORE);
    expect(core?.usages).toEqual([apiCall]);
    expect(core?.viaApi?.path).toEqual([LOG4J_API.purl]);
    expect(core?.viaApi?.reason).toMatch(/log4j-core implements log4j-api/);
    expect(byPurl(result, LOG4J_API)?.viaApi).toBeUndefined();
  });

  it('follows SLF4J through the Log4j binding down to log4j-core', () => {
    const call = usage(SLF4J_API, 'org.slf4j.Logger#info');
    const deps = [SLF4J_API, LOG4J_SLF4J_IMPL, LOG4J_API, LOG4J_CORE];
    const result = applyApiImplementations(
      usagesFor([
        [SLF4J_API, [call]],
        [LOG4J_SLF4J_IMPL, []],
        [LOG4J_API, []],
        [LOG4J_CORE, []],
      ]),
      deps,
    );

    expect(byPurl(result, LOG4J_CORE)?.viaApi?.path).toEqual([
      SLF4J_API.purl,
      LOG4J_SLF4J_IMPL.purl,
      LOG4J_API.purl,
    ]);
    expect(byPurl(result, LOG4J_CORE)?.usages).toEqual([call]);
  });

  it('links logback-classic to SLF4J', () => {
    const result = applyApiImplementations(
      usagesFor([
        [SLF4J_API, [usage(SLF4J_API, 'org.slf4j.Logger#warn')]],
        [LOGBACK_CLASSIC, []],
      ]),
      [SLF4J_API, LOGBACK_CLASSIC],
    );
    expect(byPurl(result, LOGBACK_CLASSIC)?.viaApi?.path).toEqual([SLF4J_API.purl]);
  });

  it('keeps a dependency with its own MAIN usages as a direct use', () => {
    const own = usage(LOG4J_CORE, 'org.apache.logging.log4j.core.LoggerContext#getContext');
    const result = applyApiImplementations(
      usagesFor([
        [LOG4J_API, [usage(LOG4J_API, 'org.apache.logging.log4j.Logger#error')]],
        [LOG4J_CORE, [own]],
      ]),
      [LOG4J_API, LOG4J_CORE],
    );
    expect(byPurl(result, LOG4J_CORE)).toMatchObject({ usages: [own] });
    expect(byPurl(result, LOG4J_CORE)?.viaApi).toBeUndefined();
  });

  it('does not link when the API is only used from test sources', () => {
    const result = applyApiImplementations(
      usagesFor([
        [LOG4J_API, [usage(LOG4J_API, 'org.apache.logging.log4j.Logger#error', 'TEST')]],
        [LOG4J_CORE, []],
      ]),
      [LOG4J_API, LOG4J_CORE],
    );
    expect(byPurl(result, LOG4J_CORE)).toMatchObject({ usages: [] });
    expect(byPurl(result, LOG4J_CORE)?.viaApi).toBeUndefined();
  });

  it('does not link when the implementation is not a dependency of the project', () => {
    const result = applyApiImplementations(
      usagesFor([[LOG4J_API, [usage(LOG4J_API, 'org.apache.logging.log4j.Logger#error')]]]),
      [LOG4J_API],
    );
    expect(result).toHaveLength(1);
    expect(result[0]?.viaApi).toBeUndefined();
  });

  it('claims nothing for log4j-core when log4j-to-slf4j may receive the calls instead', () => {
    const result = applyApiImplementations(
      usagesFor([
        [LOG4J_API, [usage(LOG4J_API, 'org.apache.logging.log4j.Logger#error')]],
        [LOG4J_CORE, []],
        [LOG4J_TO_SLF4J, []],
      ]),
      [LOG4J_API, LOG4J_CORE, LOG4J_TO_SLF4J],
    );
    expect(byPurl(result, LOG4J_CORE)?.viaApi).toBeUndefined();
    expect(byPurl(result, LOG4J_CORE)?.usages).toEqual([]);
  });
});
