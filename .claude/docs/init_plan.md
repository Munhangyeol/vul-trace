# VulnTrace 초기 구조 생성 계획 (init_plan)

작성일: 2026-09-26
대상 문서: `CLAUDE.md` (규범 문서, 본 계획보다 우선함)

---

## PLAN

### Goal

빈 리포지토리에서 **TypeScript-first 모노레포 골격**을 만든다.
`CLAUDE.md` §2 구조 / §3 스택 / §13 모노레포 규칙을 그대로 코드로 옮기는 것까지가 이 계획의 범위다.

완료 기준(이 계획의 DoD):

```text
pnpm install            → 성공
pnpm typecheck          → 성공 (strict)
pnpm test               → 성공 (스모크 테스트만 존재)
pnpm build              → 성공
pnpm --filter @vulntrace/cli dev -- --help  → CLI 도움말 출력
```

분석 로직은 **구현하지 않는다.** 각 패키지는 타입/인터페이스 + 미구현 스텁까지만 둔다.

### Current phase

Phase 0 (사전 단계). `CLAUDE.md` §7의 Phase 1 착수 직전 상태.

- 현재 존재: `CLAUDE.md`, `CLAUDE_KR.md`, 빈 `.claude/`
- git 리포지토리 아님 → 스캐폴딩 전에 `git init` 권장

### Current behavior

없음. 소스, 워크스페이스, 빌드 설정 모두 부재.

### Target behavior

- pnpm 워크스페이스 모노레포
- `apps/{web,api,cli}` + `packages/*` 9개 + `prisma/` + `fixtures/`
- 모든 패키지 TypeScript strict, ESM
- 패키지 간 의존 방향이 `CLAUDE.md` §13과 일치
- 도메인 타입은 `packages/shared`에 단일 정의
- 분석 모듈은 API/CLI 양쪽에서 재사용 가능한 형태

### Affected modules

신규 생성 전체. 기존 파일 수정 없음(`CLAUDE.md` 계열 파일은 건드리지 않는다).

---

## 1. 기술 선택 (확정안)

`CLAUDE.md`가 정한 것 외에 스캐폴딩에 필요한 최소 결정만 추가한다.

| 항목 | 선택 | 근거 |
|---|---|---|
| 패키지 매니저 | **pnpm** workspace | §13 권장. 심링크 격리로 의존 방향 위반을 조기 발견 |
| Node | **>= 20** | ESM + 내장 test 유틸 안정화 |
| 모듈 | **ESM** (`"type": "module"`, `moduleResolution: "NodeNext"`) | Fastify/Vite/Prisma 모두 지원 |
| 패키지 빌드 | **tsc + project references** (composite) | 번들러 추가 의존 없음 (§3 "불필요한 의존 추가 금지") |
| 테스트 | **Vitest** | Vite와 설정 공유, ESM 네이티브 |
| Lint/Format | **ESLint + Prettier** (최소 설정) | |
| CLI | **Commander.js** | §3 권장 |
| 개발 실행 | **tsx** | api/cli watch 실행 |
| 검증 | **zod** (`shared`에 한정) | 외부 입력(OSV 응답, Maven 출력, API body) 경계 검증 |

> Redis / Kafka / 큐 / Turborepo / Nx / Redux / Zustand 는 도입하지 않는다 (§3, §13).

`zod`는 §3에 없는 추가 의존이므로, 도입 시점에 "외부 신뢰불가 입력 경계 검증"(§15, §16) 근거를 커밋 메시지에 남긴다. 반대 의견이 있으면 수동 파싱 + 타입 가드로 대체 가능.

---

## 2. 목표 디렉터리 구조

```text
vul-trace/
├── package.json                  # 루트: 스크립트만, private
├── pnpm-workspace.yaml
├── tsconfig.base.json            # strict 공통 옵션
├── tsconfig.json                 # solution 파일 (references만)
├── vitest.workspace.ts
├── .eslintrc.cjs / .prettierrc / .editorconfig
├── .gitignore
├── .env.example                  # DATABASE_URL 등 (실제 .env는 커밋 금지)
├── docker-compose.yml            # postgres 단일 서비스
├── CLAUDE.md / CLAUDE_KR.md
│
├── .claude/
│   └── docs/
│       └── init_plan.md          # 이 문서
│
├── apps/
│   ├── api/                      # @vulntrace/api
│   │   ├── package.json
│   │   ├── tsconfig.json
│   │   └── src/
│   │       ├── main.ts                 # 부트스트랩
│   │       ├── server.ts               # Fastify 인스턴스 조립
│   │       ├── config/env.ts
│   │       ├── routes/
│   │       │   ├── health.route.ts
│   │       │   ├── projects.route.ts       # 스텁
│   │       │   ├── scans.route.ts          # 스텁
│   │       │   └── findings.route.ts       # 스텁
│   │       ├── dto/                    # Prisma 모델 직접 노출 금지 (§10)
│   │       │   └── .gitkeep
│   │       └── container.ts            # core 조립 (수동 DI)
│   │
│   ├── cli/                      # @vulntrace/cli
│   │   ├── package.json
│   │   ├── tsconfig.json
│   │   └── src/
│   │       ├── index.ts                # bin 엔트리
│   │       ├── commands/
│   │       │   ├── scan.command.ts
│   │       │   ├── dependencies.command.ts
│   │       │   ├── vulnerabilities.command.ts
│   │       │   └── report.command.ts
│   │       └── render/
│   │           └── text-report.ts      # 순수 함수 포매터
│   │
│   └── web/                      # @vulntrace/web
│       ├── package.json
│       ├── tsconfig.json
│       ├── vite.config.ts
│       ├── index.html
│       └── src/
│           ├── main.tsx
│           ├── App.tsx                 # Router + QueryClientProvider
│           ├── routes/
│           │   ├── ProjectListPage.tsx
│           │   ├── ProjectDashboardPage.tsx
│           │   ├── VulnerabilityListPage.tsx
│           │   └── VulnerabilityDetailPage.tsx
│           └── api/client.ts           # fetch + shared 타입
│
├── packages/
│   ├── shared/                   # @vulntrace/shared  (의존 없음)
│   ├── core/                     # @vulntrace/core     (오케스트레이션)
│   ├── dependency-analyzer/
│   ├── sbom/
│   ├── vulnerability/
│   ├── source-analyzer/
│   ├── spring-analyzer/
│   ├── reachability/
│   └── risk/
│
├── prisma/
│   ├── schema.prisma
│   └── migrations/               # 초기에는 비어 있음
│
└── fixtures/
    ├── spring-safe-app/
    ├── spring-vulnerable-unused/
    ├── spring-vulnerable-used/
    └── spring-vulnerable-reachable/
```

---

## 3. 패키지별 책임과 초기 산출물

각 패키지는 `src/index.ts`에서 공개 API만 re-export 한다. 내부 파일 직접 import 금지.

### `packages/shared` — 도메인 타입 + 결과 모델

의존: **없음** (React, Fastify, Prisma 모두 금지)

```text
src/
├── index.ts
├── types/
│   ├── project.ts          Project, ScanJob, ScanState
│   ├── dependency.ts       DependencyCoordinate, ProjectDependency
│   ├── vulnerability.ts    Vulnerability, VulnerabilityFinding, Severity
│   ├── source-usage.ts     SourceUsage, UsageEvidence
│   ├── spring.ts           SpringEndpoint, HttpMethod
│   ├── reachability.ts     CallPath, CallPathStep, ReachabilityResult
│   └── risk.ts             RiskScore, RiskReason
└── result/
    ├── result.ts           Result<T, E> = Ok | Err
    └── errors.ts           AnalysisError 계층
```

초기에 반드시 정의할 타입 (§9 "증거 보존" 반영):

```ts
export type ScanState =
  | 'PENDING' | 'RUNNING' | 'PARTIAL' | 'COMPLETED' | 'FAILED';

export interface DependencyCoordinate {
  groupId: string;
  artifactId: string;
  version: string;
  scope: string;
  direct: boolean;
  purl: string;
}

// boolean만 저장하지 않는다 (§6.2)
export interface ReachabilityResult {
  reachable: boolean;
  paths: CallPath[];        // 왜 reachable 인지
}

export interface RiskScore {
  score: number;
  reasons: RiskReason[];    // 점수 근거 (§8 Risk Module)
}
```

### `packages/dependency-analyzer` — Phase 1

의존: `shared`

```text
src/
├── index.ts
├── MavenProjectDetector.ts       # pom.xml 탐지
├── PomParser.ts                  # XML → 메타데이터/직접 의존
├── MavenDependencyTreeRunner.ts  # execFile('mvn', [...]) + timeout (§15)
├── DependencyTreeParser.ts       # 트리 텍스트 → 좌표 (순수 함수)
├── purl.ts                       # pkg:maven/... 생성 (순수 함수)
└── MavenDependencyAnalyzer.ts    # 위 조립
```

규칙: `spawn`/`execFile`만 사용, shell 문자열 결합 금지, 타임아웃 필수, stdout/stderr 및 실패 사유 기록(§15). Maven 미설치/실패 시 직접 의존만으로 `PARTIAL` 진행.

### `packages/sbom` — Phase 2

의존: `shared`

```text
src/
├── index.ts
├── CycloneDxBuilder.ts     # 의존 목록 → CycloneDX 컴포넌트 (순수 함수)
└── types.ts                # 최소 CycloneDX 표현
```

### `packages/vulnerability` — Phase 2

의존: `shared`

```text
src/
├── index.ts
├── VulnerabilityProvider.ts       # 인터페이스 (§8)
├── OsvVulnerabilityProvider.ts    # OSV /v1/querybatch 호출
├── osv-response.ts                # 외부 응답 정규화 (순수 함수 + 스키마 검증)
└── severity.ts                    # CVSS → Severity 매핑
```

```ts
export interface VulnerabilityProvider {
  findByPackage(input: PackageCoordinate): Promise<VulnerabilityFinding[]>;
}
```

OSV 엔드포인트/응답 필드는 실제 문서 확인 후 구현한다(§21 "외부 API 발명 금지"). 스캐폴딩 단계에서는 인터페이스 + `NotImplementedError` 스텁만 둔다.

### `packages/source-analyzer` — Phase 4

의존: `shared`

```text
src/
├── index.ts
├── JavaSourceAnalyzer.ts      # 인터페이스 (§14)
├── JavaFileScanner.ts         # .java 탐색
├── parser/
│   ├── JavaSourceParser.ts    # 파서 전략 추상화
│   └── LightweightJavaParser.ts   # Stage A 구현 (package/import/annotation/method)
└── UsageMatcher.ts            # 취약 패키지 ↔ import/참조 매칭 + 증거(파일:라인)
```

파서 전략을 인터페이스 뒤에 둬야 Stage B(`java -jar java-analyzer.jar`)로 교체 시 호출부가 바뀌지 않는다(§5, §14). 정규식은 전처리/폴백에만(§14).

### `packages/spring-analyzer` — Phase 5

의존: `shared`, `source-analyzer`(파싱 결과 소비)

```text
src/
├── index.ts
├── SpringEndpointAnalyzer.ts
└── annotations.ts        # @RestController, @*Mapping 매핑 테이블
```

### `packages/reachability` — Phase 6

의존: `shared`

```text
src/
├── index.ts
├── CallGraph.ts              # methods / method_calls 모델
├── ReachabilityAnalyzer.ts   # endpoint → usage 경로 탐색 (BFS)
└── path-evidence.ts          # CallPath 구성
```

### `packages/risk` — Phase 7

의존: `shared`

```text
src/
├── index.ts
├── RiskScoreCalculator.ts    # 순수 함수
└── rules.ts                  # 가중치 테이블 (설명 가능하도록 외부화)
```

### `packages/core` — 오케스트레이션

의존: 위 분석 패키지 전부 + `shared`
**금지**: React, Fastify 타입, HTTP 프레임워크

```text
src/
├── index.ts
├── ScanOrchestrator.ts       # Phase 파이프라인 실행, 단계별 상태 기록
├── ports/                    # 저장소 인터페이스 (의존 역전)
│   ├── ProjectRepository.ts
│   ├── ScanRepository.ts
│   └── FindingRepository.ts
├── adapters/prisma/          # Prisma 구현체
└── logging/ScanLogger.ts     # [SCAN] [DEPENDENCY] ... 태그 로그 (§20)
```

`ScanOrchestrator`가 §7의 단계 순서를 그대로 실행하고, 단계 실패 시 성공한 단계 결과를 보존한 채 `PARTIAL`로 남긴다(§19). CLI와 API는 둘 다 이 클래스만 호출한다(§11).

---

## 4. 의존 방향 강제

```text
web  ──► shared
api  ──► core ──► dependency-analyzer / sbom / vulnerability
                  source-analyzer / spring-analyzer / reachability / risk
cli  ──► core                        └──► shared
```

강제 수단:

1. 각 `package.json`의 `dependencies`에 허용된 워크스페이스 패키지만 나열 (pnpm이 나머지를 해석 실패시킴)
2. `tsconfig.json`의 `references`를 동일하게 유지
3. ESLint `no-restricted-imports`로 `packages/*` → `apps/*` 역방향 import 금지

---

## 5. Prisma 스키마 초안 (§9)

`prisma/schema.prisma`에 아래 모델을 선언한다. 결론만 저장하는 컬럼을 만들지 않고, 증거 테이블을 함께 둔다.

```text
projects              id, name, path, createdAt
scan_jobs             id, projectId, state, startedAt, finishedAt, failureReason, stageResults(Json)

dependencies          id, groupId, artifactId, version, purl
project_dependencies  id, projectId, scanId, dependencyId, scope, direct, source("pom.xml")

vulnerabilities       id, sourceId(CVE/GHSA), summary, severity, cvssVector, references(Json)
project_vulnerabilities id, scanId, projectDependencyId, vulnerabilityId, fixedVersion

source_usages         id, scanId, projectVulnerabilityId, filePath, line, snippet, usageKind
spring_endpoints      id, scanId, httpMethod, path, controllerClass, controllerMethod

methods               id, scanId, className, methodName, signature, filePath, line
method_calls          id, scanId, callerMethodId, calleeMethodId, line

reachability_paths    id, scanId, projectVulnerabilityId, endpointId, steps(Json)
risk_scores           id, scanId, projectVulnerabilityId, score, reasons(Json)
```

스캐폴딩 단계에서는 스키마 파일 작성 + `prisma generate`까지만 하고, 마이그레이션 적용은 Phase 1 착수 시점에 한다.

---

## 6. 픽스처 (§17)

각 픽스처는 최소 Maven 프로젝트(`pom.xml` + 1~3개 `.java`)로 만든다. **실행하지 않는다** (§16).

| 픽스처 | 구성 | 기대 결과 |
|---|---|---|
| `spring-safe-app` | 취약 의존 없음 | 취약점 0 |
| `spring-vulnerable-unused` | 취약 의존 O, 소스 미사용 | `used=false, reachable=false` |
| `spring-vulnerable-used` | 서비스 클래스에서 사용, 엔드포인트 연결 없음 | `used=true, reachable=false` |
| `spring-vulnerable-reachable` | `@PostMapping` → Service → 취약 API | `used=true, reachable=true` |

픽스처의 `pom.xml`은 고정된 취약 버전(예: 알려진 취약 버전의 로깅 라이브러리)을 명시해 OSV 매칭이 결정론적으로 재현되게 한다.

---

## 7. 실행 순서 (스캐폴딩 작업 단위)

한 단계가 끝날 때마다 `pnpm typecheck` 통과를 확인한다. 단계별로 커밋 가능한 크기다.

| # | 작업 | 산출물 | 검증 |
|---|---|---|---|
| 0 | `git init`, `.gitignore` | — | — |
| 1 | 루트 워크스페이스 + `tsconfig.base.json` + Prettier/ESLint | 루트 설정 파일 | `pnpm install` |
| 2 | `packages/shared` 타입/Result 모델 | 도메인 타입 | `pnpm typecheck` |
| 3 | 분석 패키지 7개 골격 (인터페이스 + 스텁) | `src/index.ts` + 인터페이스 | `pnpm typecheck` |
| 4 | `packages/core` 오케스트레이터 + ports | `ScanOrchestrator` | `pnpm typecheck` |
| 5 | `apps/cli` — `scan/dependencies/vulnerabilities/report` 커맨드 골격 | 동작하는 `--help` | `cli --help` |
| 6 | `apps/api` — Fastify + `/api/health` + 라우트 스텁 | 기동되는 서버 | `curl /api/health` |
| 7 | `prisma/schema.prisma` + `docker-compose.yml` | 스키마 | `prisma validate` |
| 8 | `apps/web` — Vite + Router + TanStack Query + 4개 페이지 골격 | 뜨는 화면 | `pnpm --filter web build` |
| 9 | Vitest 설정 + 순수 함수 스모크 테스트(`purl` 생성 등) | 통과하는 테스트 | `pnpm test` |
| 10 | 픽스처 4종 | Maven 픽스처 | 수동 확인 |

이 계획 이후 첫 기능 작업은 **Phase 1: `MavenDependencyAnalyzer` 구현** 이다.

---

## 8. 루트 스크립트

```json
{
  "scripts": {
    "typecheck": "tsc -b",
    "build": "pnpm -r build",
    "test": "vitest run",
    "lint": "eslint .",
    "dev:api": "pnpm --filter @vulntrace/api dev",
    "dev:web": "pnpm --filter @vulntrace/web dev",
    "db:up": "docker compose up -d postgres",
    "prisma:generate": "prisma generate"
  }
}
```

---

## Risks

| 위험 | 영향 | 완화 |
|---|---|---|
| 스캐폴딩 단계에서 미래 Phase를 과도하게 구현 | §21-4 위반, 낭비 | 인터페이스 + `NotImplementedError`까지만. 로직 없음 |
| Maven 미설치 환경 | 트랜지티브 의존 추출 불가 | `PARTIAL` 상태로 직접 의존만 처리, 실패 사유 기록 |
| OSV API 스펙 추정 | 잘못된 구현 | Phase 2에서 실제 문서 확인 후 구현. 지금은 인터페이스만 |
| ESM + Prisma + tsc project references 조합의 설정 마찰 | 초기 시간 소모 | 1단계에서 최소 설정으로 typecheck를 먼저 통과시키고 증분 확장 |
| 패키지 수(12개)가 초기 구현량 대비 과다 | 관리 비용 | 구조는 `CLAUDE.md` §2 고정. 각 패키지는 파일 2~4개로 얇게 시작 |
| Windows 환경의 경로/개행 | 테스트 불안정 | `path.join` 사용, `.gitattributes`로 개행 고정, 픽스처 경로 상대화 |
| `zod` 추가 의존 | §3 스택 이탈 | `shared`의 외부 입력 경계에만 사용. 불필요 판단 시 타입 가드로 대체 |

## Verification

스캐폴딩 완료 시 아래를 모두 실행해 결과를 보고한다(§21 after-changes).

```text
pnpm install
pnpm typecheck        # strict, 오류 0
pnpm test             # 스모크 테스트 통과
pnpm build            # 전체 빌드
pnpm --filter @vulntrace/cli dev -- --help
pnpm --filter @vulntrace/api dev   → GET /api/health → 200
pnpm --filter @vulntrace/web build
npx prisma validate
```

보고 항목: 변경 파일 / typecheck / test / build 결과 / 알려진 제약 / 다음 권장 단계.

### 알려진 제약 (스캐폴딩 완료 시점)

- 실제 분석 기능 없음. 모든 분석 진입점은 미구현 스텁
- DB 마이그레이션 미적용 (스키마 선언만)
- 웹 화면은 라우팅 골격만, 데이터 연동 없음
- 픽스처는 파싱 대상으로만 사용, 빌드/실행하지 않음

---

## 다음 권장 단계

Phase 1 착수: `packages/dependency-analyzer`의 `MavenProjectDetector` → `PomParser` → `purl` 생성 순서로 구현하고, 각 단계마다 `fixtures/spring-safe-app`을 대상으로 한 단위 테스트를 함께 작성한다.
