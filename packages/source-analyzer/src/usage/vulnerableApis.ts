import type { VulnerableApiRef, VulnerabilityFinding } from '@vulntrace/shared';

interface VulnerableApiEntry {
  /** Vulnerability id and aliases this entry applies to (matched against id + aliases). */
  ids: readonly string[];
  /** Advisory the API list was taken from — the evidence behind the entry. */
  reference: string;
  apis: readonly VulnerableApiRef[];
}

const methods = (type: string, names: readonly string[]): VulnerableApiRef[] =>
  names.map((method) => ({ type, method }));

/**
 * Log4j 2 lookups are evaluated on what gets logged. Calls usually go through the log4j-api
 * Logger (or SLF4J routed to Log4j 2), so those are the entry points that reach log4j-core.
 */
const LOG4J_LOGGING_CALLS: readonly VulnerableApiRef[] = [
  ...methods('org.apache.logging.log4j.Logger', [
    'trace',
    'debug',
    'info',
    'warn',
    'error',
    'fatal',
    'log',
    'printf',
  ]),
  ...methods('org.slf4j.Logger', ['trace', 'debug', 'info', 'warn', 'error']),
];

/** Context Lookup attacks need attacker data in the Thread Context Map (MDC). */
const LOG4J_THREAD_CONTEXT_WRITES: readonly VulnerableApiRef[] = [
  ...methods('org.apache.logging.log4j.ThreadContext', ['put', 'putAll', 'push']),
  ...methods('org.slf4j.MDC', ['put']),
];

/** Parsing untrusted YAML. `new Yaml(new SafeConstructor())` is safe for CVE-2022-1471 but cannot be told apart statically. */
const SNAKEYAML_PARSING: readonly VulnerableApiRef[] = methods('org.yaml.snakeyaml.Yaml', [
  'load',
  'loadAll',
  'loadAs',
  'compose',
  'composeAll',
  'parse',
]);

const SPEL_PARSING: readonly VulnerableApiRef[] = [
  ...methods('org.springframework.expression.ExpressionParser', ['parseExpression']),
  ...methods('org.springframework.expression.spel.standard.SpelExpressionParser', [
    'parseExpression',
    'parseRaw',
  ]),
];

/**
 * Hand-curated vulnerable APIs (phase-4 plan D3). OSV records for Maven carry no function-level
 * data, so each entry here is keyed by the exact advisory ids OSV returns and cites the advisory
 * it was taken from. A vulnerability without an entry yields `NO_API_INFO` — never a guess.
 *
 * "Vulnerable API used" means a known entry point of the vulnerable code path is called; it does
 * not prove the input is attacker-controlled or that a non-default configuration is in place.
 */
const VULNERABLE_APIS: readonly VulnerableApiEntry[] = [
  {
    // Text4Shell: the default interpolator enables the script, dns and url lookups.
    ids: ['CVE-2022-42889', 'GHSA-599f-7c49-w659'],
    reference: 'https://nvd.nist.gov/vuln/detail/CVE-2022-42889',
    apis: [
      { type: 'org.apache.commons.text.StringSubstitutor', method: 'createInterpolator' },
      { type: 'org.apache.commons.text.lookup.StringLookupFactory', method: 'interpolatorStringLookup' },
      { type: 'org.apache.commons.text.lookup.StringLookupFactory', method: 'scriptStringLookup' },
      { type: 'org.apache.commons.text.lookup.StringLookupFactory', method: 'dnsStringLookup' },
      { type: 'org.apache.commons.text.lookup.StringLookupFactory', method: 'urlStringLookup' },
    ],
  },
  {
    // Log4Shell: JNDI lookups in logged messages and parameters.
    ids: ['CVE-2021-44228', 'GHSA-jfh8-c2jp-5v3q'],
    reference: 'https://github.com/advisories/GHSA-jfh8-c2jp-5v3q',
    apis: LOG4J_LOGGING_CALLS,
  },
  {
    // Incomplete 2.15.0 fix: Context Lookup patterns with attacker-controlled Thread Context data.
    ids: ['CVE-2021-45046', 'GHSA-7rjr-3q55-vv33'],
    reference: 'https://github.com/advisories/GHSA-7rjr-3q55-vv33',
    apis: LOG4J_THREAD_CONTEXT_WRITES,
  },
  {
    // Uncontrolled recursion from self-referential lookups in Thread Context data.
    ids: ['CVE-2021-45105', 'GHSA-p6xc-xr62-6r2g'],
    reference: 'https://github.com/advisories/GHSA-p6xc-xr62-6r2g',
    apis: LOG4J_THREAD_CONTEXT_WRITES,
  },
  {
    // Default Constructor instantiates arbitrary types while loading YAML.
    ids: ['CVE-2022-1471', 'GHSA-mjmj-j48q-9wg2'],
    reference: 'https://github.com/advisories/GHSA-mjmj-j48q-9wg2',
    apis: SNAKEYAML_PARSING,
  },
  {
    ids: ['CVE-2017-18640', 'GHSA-rvwf-54qp-4r6v'],
    reference: 'https://github.com/advisories/GHSA-rvwf-54qp-4r6v',
    apis: SNAKEYAML_PARSING,
  },
  {
    ids: ['CVE-2022-25857', 'GHSA-3mc7-4q67-w48m'],
    reference: 'https://github.com/advisories/GHSA-3mc7-4q67-w48m',
    apis: SNAKEYAML_PARSING,
  },
  {
    ids: ['CVE-2022-38749', 'GHSA-c4r9-r8fh-9vj2'],
    reference: 'https://github.com/advisories/GHSA-c4r9-r8fh-9vj2',
    apis: SNAKEYAML_PARSING,
  },
  {
    ids: ['CVE-2022-38750', 'GHSA-hhhw-99gj-p3c3'],
    reference: 'https://github.com/advisories/GHSA-hhhw-99gj-p3c3',
    apis: SNAKEYAML_PARSING,
  },
  {
    ids: ['CVE-2022-38751', 'GHSA-98wm-3w3q-mw94'],
    reference: 'https://github.com/advisories/GHSA-98wm-3w3q-mw94',
    apis: SNAKEYAML_PARSING,
  },
  {
    ids: ['CVE-2022-38752', 'GHSA-9w3m-gqgf-c4p9'],
    reference: 'https://github.com/advisories/GHSA-9w3m-gqgf-c4p9',
    apis: SNAKEYAML_PARSING,
  },
  {
    ids: ['CVE-2022-41854', 'GHSA-w37g-rhq8-7m4j'],
    reference: 'https://github.com/advisories/GHSA-w37g-rhq8-7m4j',
    apis: SNAKEYAML_PARSING,
  },
  {
    // fastjson autoType: crafted JSON with @type instantiates arbitrary classes.
    ids: ['CVE-2017-18349', 'GHSA-xjrr-xv9m-4pw5'],
    reference: 'https://github.com/advisories/GHSA-xjrr-xv9m-4pw5',
    apis: methods('com.alibaba.fastjson.JSON', ['parse', 'parseObject']),
  },
  {
    // SpEL denial of service through user-supplied expressions.
    ids: ['CVE-2022-22950', 'GHSA-558x-2xjg-6232'],
    reference: 'https://github.com/advisories/GHSA-558x-2xjg-6232',
    apis: SPEL_PARSING,
  },
  {
    ids: ['CVE-2023-20861', 'GHSA-564r-hj7v-mcr5'],
    reference: 'https://github.com/advisories/GHSA-564r-hj7v-mcr5',
    apis: SPEL_PARSING,
  },
  {
    ids: ['CVE-2023-20863', 'GHSA-wxqc-pxw9-g2p8'],
    reference: 'https://github.com/advisories/GHSA-wxqc-pxw9-g2p8',
    apis: SPEL_PARSING,
  },
];

export function findVulnerableApis(finding: VulnerabilityFinding): VulnerableApiRef[] {
  const ids = new Set([finding.vulnerability.id, ...finding.vulnerability.aliases]);
  const entry = VULNERABLE_APIS.find((e) => e.ids.some((id) => ids.has(id)));
  return entry ? entry.apis.map((api) => ({ ...api })) : [];
}
