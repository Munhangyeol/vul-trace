# Fixtures

Minimal Spring Boot / Maven projects used as **static analysis targets** (CLAUDE.md §17).
They must never be built or executed by VulnTrace or its tests (CLAUDE.md §16).

Vulnerable dependency used across fixtures: `org.apache.commons:commons-text:1.9`
(CVE-2022-42889 / GHSA-599f-7c49-w659, fixed in 1.10.0). Vulnerable API:
`StringSubstitutor.createInterpolator()`.

| Fixture | Setup | Expected |
|---|---|---|
| `spring-safe-app` | No commons-text | no commons-text finding |
| `spring-vulnerable-unused` | commons-text declared, never imported | `used=false`, `reachable=false` |
| `spring-vulnerable-used` | `TemplateService` uses the vulnerable API, no controller calls it | `used=true`, `reachable=false` |
| `spring-vulnerable-reachable` | `POST /api/templates/render` → `TemplateController.render` → `TemplateService.render` → `StringSubstitutor.createInterpolator` | `used=true`, `reachable=true` |

Note: all fixtures inherit `spring-boot-starter-parent 3.5.6`. Findings against Spring's own
transitive dependencies depend on the live OSV database and are not part of these expectations.
