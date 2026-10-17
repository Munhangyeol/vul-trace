import type { VulnerableApiRef, VulnerabilityFinding } from '@vulntrace/shared';

interface VulnerableApiEntry {
  /** Vulnerability id and aliases this entry applies to (matched against id + aliases). */
  ids: readonly string[];
  /** Advisory the API list was taken from — the evidence behind the entry. */
  reference: string;
  apis: readonly VulnerableApiRef[];
}

/**
 * Hand-curated vulnerable APIs (plan D3). OSV records for Maven do not carry function-level data
 * (checked against the recorded GHSA-599f-7c49-w659 response), so this list is maintained here.
 * A vulnerability without an entry yields `NO_API_INFO` — never a guess.
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
];

export function findVulnerableApis(finding: VulnerabilityFinding): VulnerableApiRef[] {
  const ids = new Set([finding.vulnerability.id, ...finding.vulnerability.aliases]);
  const entry = VULNERABLE_APIS.find((e) => e.ids.some((id) => ids.has(id)));
  return entry ? entry.apis.map((api) => ({ ...api })) : [];
}
