import type { ViaApiEvidence } from '@vulntrace/shared';
import type { DependencyRef, DependencyUsage } from './UsageMatcher.js';

interface ImplementationRelation {
  /** `groupId:artifactId` of the artifact whose code actually runs. */
  implementation: string;
  /** `groupId:artifactId` of the API artifact the calling code uses. */
  api: string;
  reference: string;
}

/**
 * Curated "calls to `api` execute code in `implementation`" relations. The relation is stored
 * with the conclusion as evidence (CLAUDE.md §6.2). Application code usually imports only the
 * facade, so without these the implementation — where vulnerabilities like Log4Shell live —
 * would be reported as unused.
 */
const RELATIONS: readonly ImplementationRelation[] = [
  {
    implementation: 'org.apache.logging.log4j:log4j-core',
    api: 'org.apache.logging.log4j:log4j-api',
    reference:
      'log4j-core implements log4j-api (https://logging.apache.org/log4j/2.x/manual/api.html)',
  },
  {
    implementation: 'ch.qos.logback:logback-classic',
    api: 'org.slf4j:slf4j-api',
    reference:
      'logback-classic natively implements SLF4J (https://logback.qos.ch/manual/introduction.html)',
  },
  {
    implementation: 'ch.qos.logback:logback-core',
    api: 'ch.qos.logback:logback-classic',
    reference:
      'logback-classic is built on logback-core (https://logback.qos.ch/manual/architecture.html)',
  },
  {
    implementation: 'org.apache.logging.log4j:log4j-slf4j-impl',
    api: 'org.slf4j:slf4j-api',
    reference: 'log4j-slf4j-impl binds SLF4J 1.x to Log4j 2',
  },
  {
    implementation: 'org.apache.logging.log4j:log4j-slf4j2-impl',
    api: 'org.slf4j:slf4j-api',
    reference: 'log4j-slf4j2-impl binds SLF4J 2.x to Log4j 2',
  },
  {
    implementation: 'org.apache.logging.log4j:log4j-api',
    api: 'org.apache.logging.log4j:log4j-slf4j-impl',
    reference: 'log4j-slf4j-impl forwards to the Log4j 2 API',
  },
  {
    implementation: 'org.apache.logging.log4j:log4j-api',
    api: 'org.apache.logging.log4j:log4j-slf4j2-impl',
    reference: 'log4j-slf4j2-impl forwards to the Log4j 2 API',
  },
];

/**
 * Artifacts that, when present, may receive the API's calls instead of `implementation`. With
 * `log4j-to-slf4j` present, log4j-api calls can go to SLF4J rather than log4j-core, so no link
 * is claimed: a wrong "used" is worse than a missed one.
 */
const COMPETING_PROVIDERS: Readonly<Record<string, readonly string[]>> = {
  'org.apache.logging.log4j:log4j-core': ['org.apache.logging.log4j:log4j-to-slf4j'],
};

const coordinateOf = (dep: DependencyRef): string => `${dep.groupId}:${dep.artifactId}`;

interface Resolution {
  /** purls from the directly used artifact to this one, inclusive. */
  chain: string[];
  reasons: string[];
  /** The directly used artifact's usage — its usages are the evidence for the whole chain. */
  root: DependencyUsage;
}

/**
 * Adds "used through an implemented API" conclusions. A dependency with its own MAIN usages is
 * left as is; otherwise, if a present API artifact it implements is used (directly or itself
 * through another API), it gets the directly used artifact's usages as evidence and the chain in
 * `viaApi`. Pure: the same input always gives the same output.
 */
export function applyApiImplementations(
  usages: readonly DependencyUsage[],
  dependencies: readonly DependencyRef[],
): DependencyUsage[] {
  const purlsByCoordinate = new Map<string, string[]>();
  for (const dep of dependencies) {
    const purls = purlsByCoordinate.get(coordinateOf(dep)) ?? [];
    purls.push(dep.purl);
    purlsByCoordinate.set(coordinateOf(dep), purls);
  }
  const coordinateByPurl = new Map(dependencies.map((d) => [d.purl, coordinateOf(d)]));

  const resolved = new Map<string, Resolution>();
  for (const usage of usages) {
    if (usage.usages.some((u) => u.sourceSet === 'MAIN')) {
      resolved.set(usage.purl, { chain: [usage.purl], reasons: [], root: usage });
    }
  }

  // Relations can chain (slf4j-api → binding → log4j-api → log4j-core): repeat until stable.
  let changed = true;
  while (changed) {
    changed = false;
    for (const target of usages) {
      if (resolved.has(target.purl)) continue;
      const coordinate = coordinateByPurl.get(target.purl);
      if (!coordinate) continue;
      const competing = COMPETING_PROVIDERS[coordinate] ?? [];
      if (competing.some((c) => purlsByCoordinate.has(c))) continue;

      for (const relation of RELATIONS) {
        if (relation.implementation !== coordinate) continue;
        const callerPurl = (purlsByCoordinate.get(relation.api) ?? []).find((p) => resolved.has(p));
        const caller = callerPurl ? resolved.get(callerPurl) : undefined;
        if (!caller) continue;
        resolved.set(target.purl, {
          chain: [...caller.chain, target.purl],
          reasons: [...caller.reasons, relation.reference],
          root: caller.root,
        });
        changed = true;
        break;
      }
    }
  }

  return usages.map((usage): DependencyUsage => {
    const resolution = resolved.get(usage.purl);
    if (!resolution || resolution.chain.length < 2) return usage;
    const viaApi: ViaApiEvidence = {
      path: resolution.chain.slice(0, -1),
      reason: resolution.reasons.join('; '),
    };
    return { ...usage, usages: resolution.root.usages.map((u) => ({ ...u })), viaApi };
  });
}
