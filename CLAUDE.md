# CLAUDE.md

## 1. Project Overview

### Project Name
VulnTrace

### Goal
VulnTrace is a vulnerability analysis and prioritization platform implemented primarily with TypeScript.

The platform itself should use the same language across frontend, backend, and CLI wherever practical.

Primary application stack:

- Frontend: React + TypeScript
- Backend: Node.js + TypeScript
- Backend Framework: Fastify
- Database: PostgreSQL
- ORM: Prisma
- CLI: TypeScript
- Vulnerability source: OSV
- SBOM: CycloneDX
- Initial analysis target: Java / Spring Boot / Maven projects

The implementation language of VulnTrace does NOT need to match the language of the project being analyzed.

The initial target is:

> Build VulnTrace in TypeScript while analyzing Java / Spring Boot / Maven applications.

### Core Goal
The project must go beyond listing CVEs.

The final system should answer:

> Which vulnerabilities are actually relevant to this application, which source files use them, whether they are reachable from an application entry point, and why they should be prioritized.

### Core Flow

```text
Java / Spring Boot Repository
        ↓
Project Detection
        ↓
Maven Dependency Extraction
        ↓
SBOM Generation
        ↓
OSV Vulnerability Matching
        ↓
Java Source Usage Analysis
        ↓
Spring Endpoint Analysis
        ↓
Reachability Analysis
        ↓
Risk Scoring
        ↓
React Dashboard / CLI Report
```

---

## 2. Architecture Direction

VulnTrace should be a TypeScript-first monorepo.

Recommended structure:

```text
vulntrace/
├── apps/
│   ├── web/
│   │   └── React + TypeScript
│   ├── api/
│   │   └── Node.js + TypeScript + Fastify
│   └── cli/
│       └── TypeScript
│
├── packages/
│   ├── core/
│   ├── dependency-analyzer/
│   ├── sbom/
│   ├── vulnerability/
│   ├── source-analyzer/
│   ├── spring-analyzer/
│   ├── reachability/
│   ├── risk/
│   └── shared/
│
├── prisma/
├── fixtures/
└── CLAUDE.md
```

Do not introduce multiple backend services at the beginning.

Start with a modular monolith.

---

## 3. Initial Technology Stack

### Frontend

```text
React
TypeScript
Vite
React Router
TanStack Query
```

Do not introduce Redux or Zustand unless real global client state is required.

Prefer server state management through TanStack Query.

UI library is optional.

Do not spend excessive time on visual design before the analysis engine works.

### Backend

```text
Node.js
TypeScript
Fastify
```

### Database

```text
PostgreSQL
Prisma
```

### CLI

Recommended:

```text
TypeScript
Commander.js
```

Example:

```bash
vulntrace scan ./sample-spring-project
```

### Security / Analysis

```text
OSV API
CycloneDX
Maven
Java source parser / analysis adapter
```

### Infrastructure

```text
Docker
Docker Compose
```

Do NOT introduce Redis, Kafka, queues, or microservices until a concrete need appears.

---

## 4. Important Architecture Principle

The implementation language and analysis target language are independent.

Example:

```text
VulnTrace implementation:
TypeScript

Analysis target:
Java / Spring Boot / Maven
```

Node.js may:

- read pom.xml
- execute Maven commands
- parse Maven output
- generate SBOM
- call OSV
- scan .java files
- parse Java syntax
- build internal call graphs
- run a dedicated Java analyzer process if advanced semantic analysis becomes necessary

Do not rewrite the entire application in Java only because the analysis target is Java.

---

## 5. Java Analysis Strategy

Java analysis should evolve in stages.

### Stage A — TypeScript Only

The first implementation should attempt as much as practical in TypeScript.

Supported analysis:

```text
pom.xml parsing
mvn dependency:tree execution
dependency extraction
Java file discovery
package parsing
import parsing
annotation detection
simple method detection
simple call relation detection
```

This is sufficient for the first MVP.

### Stage B — Dedicated Java Analyzer Adapter

If advanced Java analysis requires stronger semantic support, introduce a small dedicated analyzer.

Example:

```text
Node.js / TypeScript
        ↓
JavaAnalyzerAdapter
        ↓
java -jar java-analyzer.jar
        ↓
JSON result
```

The Java analyzer should be treated as an external analysis engine, not as the main backend.

Possible Java tools:

- JavaParser
- Symbol Solver
- call graph libraries

The TypeScript application remains responsible for:

- orchestration
- persistence
- vulnerability matching
- scoring
- API
- CLI
- frontend integration

---

## 6. Core Product Principles

### 6.1 CVE detection alone is not enough

Bad:

```text
log4j-core 2.14.1
→ CVE detected
→ Critical
```

Preferred:

```text
log4j-core 2.14.1
→ CVE detected
→ dependency exists
→ dependency is used by application source
→ vulnerable API is used
→ reachable from POST /api/login
→ risk reasons calculated
```

### 6.2 Evidence First

Every important security result should have supporting evidence.

Examples:

```text
Dependency source:
pom.xml

Usage evidence:
src/main/java/.../LoggingService.java:42

Reachability:
POST /api/login
→ LoginController.login
→ AuthService.login
→ LoggingService.write
```

Avoid storing only final booleans such as:

```text
reachable = true
```

Store why it is true.

### 6.3 Deterministic Analysis First

Do not use an LLM as the source of truth.

LLMs may be used later for:

- remediation summaries
- developer explanations
- report generation

LLMs must NOT determine whether a vulnerability exists.

---

## 7. Development Phases

Development must proceed incrementally.

### Phase 1 — Repository + Maven Dependency Analysis

Goal:

```text
Spring Boot Repository
→ Maven Detection
→ Dependency Extraction
```

Required:

- accept local project path
- detect pom.xml
- parse project metadata
- extract direct dependencies
- run Maven dependency tree when available
- extract transitive dependencies
- normalize dependency coordinates
- store results

Dependency model:

```text
groupId
artifactId
version
scope
direct
purl
```

### Phase 2 — SBOM + Vulnerability Matching

Goal:

```text
Dependencies
→ CycloneDX SBOM
→ OSV
→ Vulnerability Findings
```

Required:

- generate CycloneDX-compatible components
- generate Maven purl
- query OSV
- store vulnerability metadata
- map vulnerabilities to project dependencies

### Phase 3 — React Dashboard + CLI

The same analysis engine must be reusable from both web and CLI.

Example:

```bash
vulntrace scan ./demo-app
```

Output:

```text
Project: demo-app

Dependencies:      143
Vulnerabilities:    12
Critical:             2
High:                 4
```

Initial React dashboard:

```text
Projects
Dependencies
Vulnerabilities
Severity
Current Version
Fixed Version
```

Do not build advanced UI before the analysis engine works.

### Phase 4 — Java Source Usage Analysis

Goal:

```text
Vulnerable Dependency
→ Java Source
→ Actual Usage Evidence
```

Initial analysis may focus on:

- import statements
- package references
- object construction
- obvious method calls

Do not attempt perfect Java semantic resolution in the first implementation.

### Phase 5 — Spring Endpoint Analysis

Detect:

```text
@RestController
@Controller
@RequestMapping
@GetMapping
@PostMapping
@PutMapping
@DeleteMapping
@PatchMapping
```

Extract:

```text
HTTP Method
Path
Controller Class
Controller Method
```

### Phase 6 — Reachability Analysis

Goal:

```text
Spring Endpoint
→ Controller Method
→ Service Method
→ Internal Method
→ Vulnerable Dependency Usage
```

Store the full call path.

Distinguish:

```text
dependency exists
dependency is used
vulnerable API is used
vulnerable API is reachable
```

### Phase 7 — Risk Prioritization

Risk inputs may include:

```text
CVSS severity
direct / transitive dependency
actual source usage
vulnerable API usage
reachability
HTTP exposure
authentication requirement
known exploit availability
fixed version availability
```

The score must be explainable.

### Phase 8 — Remediation

Display:

```text
Current version
Affected version
Fixed version
Affected files
Affected methods
Reachable endpoints
Risk reasons
Recommended action
```

Optional LLM functionality may be added only after deterministic results are available.

---

## 8. Core Modules

### Project Module

Responsibilities:

- project registration
- scan lifecycle
- project metadata

### Dependency Analyzer

Responsibilities:

- detect Maven project
- parse pom.xml
- execute dependency tree
- normalize dependencies
- generate purl

Suggested name:

```text
MavenDependencyAnalyzer
```

### SBOM Module

Responsibilities:

- convert dependency data to normalized CycloneDX representation
- export SBOM if needed

### Vulnerability Module

Responsibilities:

- query vulnerability providers
- normalize external vulnerability data
- map findings to dependencies

Interface example:

```ts
export interface VulnerabilityProvider {
  findByPackage(input: PackageCoordinate): Promise<VulnerabilityFinding[]>;
}
```

Initial implementation:

```text
OsvVulnerabilityProvider
```

### Source Analyzer

Responsibilities:

- discover Java files
- detect packages
- detect imports
- identify source usages

### Spring Analyzer

Responsibilities:

- detect Spring Controllers
- detect endpoint annotations
- extract route metadata

### Reachability Analyzer

Responsibilities:

- build supported call relationships
- search paths from endpoint to vulnerable usage
- preserve call-path evidence

### Risk Module

Responsibilities:

- calculate score
- return score reasons
- never hide scoring logic

---

## 9. Data Model

Possible tables:

```text
projects
scan_jobs

dependencies
project_dependencies

vulnerabilities
project_vulnerabilities

source_usages

spring_endpoints

methods
method_calls

reachability_paths
```

Do not store only final conclusions.

Preserve evidence.

---

## 10. API Guidelines

Recommended endpoints:

```text
POST   /api/projects
GET    /api/projects
GET    /api/projects/:projectId

POST   /api/projects/:projectId/scans
GET    /api/projects/:projectId/scans

GET    /api/projects/:projectId/dependencies
GET    /api/projects/:projectId/vulnerabilities

GET    /api/findings/:findingId
GET    /api/findings/:findingId/usages
GET    /api/findings/:findingId/reachability
```

Do not expose Prisma models directly.

Use explicit application DTOs.

---

## 11. CLI Guidelines

CLI should call the same core modules as the API.

Do not duplicate analysis logic.

Examples:

```bash
vulntrace scan ./sample-app
vulntrace dependencies ./sample-app
vulntrace vulnerabilities ./sample-app
vulntrace report ./sample-app
```

---

## 12. Frontend Guidelines

Use:

```text
React
TypeScript
Vite
React Router
TanStack Query
```

Initial pages:

### Project List

```text
Project
Last Scan
Dependency Count
Vulnerability Count
```

### Project Dashboard

```text
Dependencies
Vulnerabilities
Critical
High
Used Vulnerabilities
Reachable Vulnerabilities
```

### Vulnerability List

```text
CVE
Dependency
Version
CVSS
Used
Reachable
Risk Score
```

### Vulnerability Detail

```text
CVE metadata
Dependency
Current version
Fixed version
Usage evidence
Reachability path
Risk reasons
Remediation
```

Keep frontend logic thin.

Security analysis belongs in core/backend modules.

---

## 13. Monorepo Rules

Prefer a workspace-based monorepo.

Possible choices:

- pnpm workspace
- npm workspace

Avoid adding Turborepo or Nx unless repository complexity justifies it.

Shared types may live in:

```text
packages/shared
```

Core analysis logic must not depend on React.

Recommended dependency direction:

```text
web
 ↓
shared

api
 ↓
core
 ↓
dependency-analyzer
vulnerability
source-analyzer
spring-analyzer
reachability
risk
```

---

## 14. Java Parsing Rules

Do not rely exclusively on regex.

Regex may be used for:

- project detection
- lightweight preprocessing
- simple fallback parsing

Preferred abstraction:

```text
JavaSourceAnalyzer
```

Example:

```ts
interface JavaSourceAnalyzer {
  analyzeProject(projectPath: string): Promise<JavaAnalysisResult>;
}
```

The first version may use a TypeScript-based parser strategy.

A future version may delegate to a Java process without changing calling code.

---

## 15. External Process Rules

Node.js is allowed to execute external tools when required.

Examples:

```text
mvn dependency:tree
mvn help:effective-pom
java -jar java-analyzer.jar
```

Rules:

- use `spawn` / `execFile` instead of unsafe shell string concatenation
- validate arguments
- enforce timeout
- capture stdout/stderr
- record failure reason
- do not execute arbitrary user-provided commands
- treat repository contents as untrusted input

---

## 16. Security Rules for the Scanner

VulnTrace is a defensive security tool.

The scanner must treat analyzed repositories as untrusted.

Do not:

- automatically execute application source code
- automatically run project startup scripts
- execute arbitrary shell scripts from the repository
- execute arbitrary Maven plugins without considering trust implications

Prefer static analysis.

---

## 17. Testing Strategy

### Unit Tests

Required for:

```text
pom.xml parsing
dependency normalization
purl generation
OSV response normalization
risk scoring
Spring route extraction
```

### Fixture Projects

Maintain test fixtures:

```text
fixtures/
├── spring-safe-app/
├── spring-vulnerable-unused/
├── spring-vulnerable-used/
└── spring-vulnerable-reachable/
```

Expected cases:

### Case A

```text
vulnerable dependency exists
but source does not use it
```

Result:

```text
used = false
reachable = false
```

### Case B

```text
vulnerable dependency is used
but no endpoint reaches it
```

Result:

```text
used = true
reachable = false
```

### Case C

```text
vulnerable dependency is used
and Spring endpoint reaches it
```

Result:

```text
used = true
reachable = true
```

---

## 18. Coding Rules

Use TypeScript strict mode.

Prefer:

```text
explicit domain types
small modules
dependency inversion
pure functions for analysis transformations
clear Result/Error models
```

Avoid:

```text
any
large service classes
CommonUtil
HelperManager
hidden global state
cross-module circular dependencies
```

Naming examples:

```text
MavenDependencyAnalyzer
CycloneDxBuilder
OsvVulnerabilityProvider
JavaSourceAnalyzer
SpringEndpointAnalyzer
ReachabilityAnalyzer
RiskScoreCalculator
```

---

## 19. Error Handling

Do not silently ignore analysis failures.

Use explicit scan states.

Example:

```text
PENDING
RUNNING
PARTIAL
COMPLETED
FAILED
```

Preserve successful stage results.

---

## 20. Logging

Suggested logs:

```text
[SCAN] scan started
[PROJECT] Maven project detected
[DEPENDENCY] 143 dependencies found
[SBOM] SBOM generated
[VULN] 12 vulnerable dependencies found
[SOURCE] 5 dependencies used by source
[SPRING] 18 endpoints discovered
[REACHABILITY] 2 reachable findings
[SCAN] scan completed
```

Never log secrets or repository credentials.

---

## 21. Claude Code Working Rules

Before changes:

1. Read this file.
2. Inspect the existing repository structure.
3. Identify the current development phase.
4. Do not implement future phases unless requested.
5. Identify affected files and tests.

Implementation rules:

1. Prefer the smallest working change.
2. Do not rewrite working modules without a reason.
3. Do not add dependencies unless necessary.
4. Do not invent external APIs.
5. Do not claim behavior without verification.
6. Keep frontend and analysis logic separated.
7. Keep analysis modules reusable from API and CLI.
8. Keep Java-specific logic behind an analyzer abstraction.
9. Do not migrate the backend to Java solely because Java is the analysis target.
10. Preserve evidence for all security findings.

After changes:

1. Run typecheck.
2. Run tests.
3. Run build where relevant.
4. Report failures.
5. Report known limitations.

---

## 22. Claude Code Task Format

For non-trivial tasks:

### PLAN

```text
Goal
Current phase
Affected modules
Current behavior
Target behavior
Implementation approach
Risks
Verification
```

### ACT

Implement only what is required for the current task.

### VERIFY

Report:

```text
Changed files
Typecheck result
Test result
Build result
Known limitations
Next recommended step
```

Do not modify unrelated code.

---

## 23. MVP Definition of Done

The first MVP is complete when this works end-to-end:

```text
1. User provides local Spring Boot Maven project path
2. VulnTrace detects pom.xml
3. Direct dependencies are extracted
4. Transitive dependencies are extracted
5. purl values are generated
6. CycloneDX SBOM is generated
7. OSV is queried
8. Vulnerability findings are stored
9. CLI can print vulnerability results
10. React dashboard can display vulnerability results
11. Basic Java import usage is detected
12. Source usage evidence is displayed
```

Reachability is NOT required for MVP 1.

---

## 24. Long-Term Goal

Final architecture:

```text
React Web
    │
    ├───────────────┐
    │               │
Node.js API      TypeScript CLI
    │               │
    └───────┬───────┘
            ↓
      VulnTrace Core
            ↓
 ┌──────────┼──────────┐
 ↓          ↓          ↓
Dependency  Vuln       Source
Analyzer    Matcher    Analyzer
            │
            ↓
      Spring Analyzer
            ↓
      Reachability
            ↓
       Risk Scoring
            ↓
       PostgreSQL

Optional future component:

TypeScript
    ↓
Java Analyzer Adapter
    ↓
Dedicated Java AST / Symbol Analyzer
```

The project should remain TypeScript-first even if specialized Java analysis is added later.

The final system should answer:

> Which vulnerability should be fixed first, what code uses it, how can an external request reach it, and what evidence supports that conclusion?
