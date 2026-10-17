# DAILY_LOG

## 2026-09-26

### 완료

- VulnTrace TypeScript 모노레포 초기 스캐폴딩 (`1470308 feat: scaffold TypeScript monorepo for VulnTrace MVP`)
  - 변경 파일: `apps/{api,cli,web}`, `packages/{core,dependency-analyzer,sbom,vulnerability,source-analyzer,spring-analyzer,reachability,risk,shared}`, `prisma/schema.prisma`, `fixtures/spring-{safe-app,vulnerable-unused,vulnerable-used,vulnerable-reachable}`, 루트 설정(`pnpm-workspace.yaml`, `tsconfig.base.json`, `eslint.config.js`, `docker-compose.yml`, `.husky/*`)
  - 변경 이유: CLAUDE.md의 아키텍처 원칙(모듈러 모놀리스, pnpm workspace, api/core/analyzer 계층 분리)에 따라 Phase 1 착수 전 뼈대를 갖춤
  - 주요 변경 사항: Fastify API 서버, Commander 기반 CLI, React+Vite 웹, Prisma 스키마(projects/scan_jobs/dependencies/vulnerabilities/source_usages/spring_endpoints/methods/reachability_paths 등 증거 보존형 테이블), 4종 Spring Boot 테스트 픽스처(취약점 미사용/사용/도달가능 케이스) 구성

- Phase 1: Maven 의존성 분석 구현 (`3cce848 feat: implement Phase 1 Maven dependency analysis`)
  - 변경 파일: `packages/dependency-analyzer/src/{PomParser,PomModel,resolvePomDependencies,mergeDependencies,MavenProjectDetector,MavenDependencyAnalyzer}.ts`, `packages/dependency-analyzer/src/process/ProcessRunner.ts`, `packages/dependency-analyzer/src/tree/{DependencyTreeParser,MavenDependencyTreeRunner}.ts`, `apps/api/src/persistence/prisma/{ProjectRepository,ScanRepository,FindingRepository}.prisma.ts`, `apps/api/src/routes/{projects,scans}.route.ts`, `apps/cli/src/commands/*`, `prisma/migrations/20260926053607_init`
  - 변경 이유: CLAUDE.md Phase 1 요구사항(로컬 경로 입력 → pom.xml 탐지 → 직접/전이 의존성 추출 → purl 생성 → 저장)을 구현
  - 주요 변경 사항: `spawn` 기반 `ProcessRunner`로 `mvn dependency:tree` 안전 실행(`--allow-maven` 플래그로만 활성화, 타임아웃/실패 사유 기록), pom.xml 정적 파싱과 Maven 트리 결과 병합(`mergeDependencies`), 버전 미확정 의존성은 `VERSION_MANAGED_BY_PARENT` 등 사유와 함께 기록, `ScanOrchestrator`에 `DEPENDENCY`/`DEPENDENCY_TREE` 스테이지 추가, API/CLI에서 의존성 조회 연동

- Phase 2: SBOM 생성 및 OSV 취약점 매칭 구현 (`5bc7f58 feat: implement Phase 2 SBOM + OSV vulnerability matching`)
  - 변경 파일: `packages/sbom/src/{CycloneDxBuilder,scopeMapping}.ts`, `packages/vulnerability/src/{OsvVulnerabilityProvider,fixedVersions}.ts`, `packages/vulnerability/src/osv/{OsvClient,osvTypes,parseOsvResponse,normalizeOsvVulnerability}.ts`, `packages/vulnerability/src/severity/{cvss3,mapSeverity}.ts`, `apps/api/src/dto/vulnerability.dto.ts`, `apps/api/src/routes/findings.route.ts`, `apps/api/src/persistence/prisma/FindingRepository.prisma.ts`, `apps/cli/src/commands/vulnerabilities.command.ts`, `prisma/migrations/*`
  - 변경 이유: CLAUDE.md Phase 2 요구사항(CycloneDX SBOM 생성 → OSV 조회 → 취약점 저장/매핑)을 구현
  - 주요 변경 사항: 의존성 → CycloneDX 1.5 컴포넌트 변환기, OSV `querybatch`/개별 조회 클라이언트(네트워크 실패 시 `VULNERABILITY` 스테이지 FAILED+스캔 PARTIAL 처리, 이전 단계 결과 보존), CVSS v3 벡터 파싱 및 심각도 매핑, fixed version 추출, `ScanOrchestrator`에 `SBOM`/`VULNERABILITY` 스테이지 추가, CLI `vulnerabilities` 출력 및 API 취약점 조회 엔드포인트

### 문제 해결

- 문제: 신뢰할 수 없는 저장소(pom.xml)의 Maven 실행을 어떻게 안전하게 처리할지
  - 원인: CLAUDE.md 17장 규칙상 저장소 콘텐츠를 신뢰할 수 없는 입력으로 취급해야 하며, 임의 셸 실행은 금지됨
  - 해결 방법: `mvn dependency:tree`를 `spawn`(셸 문자열 조합 없이)으로 실행하고 `--allow-maven` 플래그가 있을 때만 활성화, 타임아웃과 stdout/stderr 캡처, 실패 시 `SKIPPED`/`FAILED` 사유를 스캔 결과에 보존

- 문제: 부모 POM이 관리하는 버전(Spring Boot 스타터 등)을 Maven 실행 없이 어떻게 다룰지
  - 원인: 정적 pom.xml 파싱만으로는 parent POM/BOM이 관리하는 버전을 알 수 없음
  - 해결 방법: 버전 미확정 의존성을 숨기지 않고 `VERSION_MANAGED_BY_PARENT` 등 명시적 사유로 기록하고, 취약점 검사 단계에서는 "미확인"으로 표시(6.2 Evidence First 원칙 준수)

- 문제: OSV 조회 실패 시 이전 단계(의존성/SBOM) 결과까지 유실되는 것을 방지
  - 원인: 스캔 파이프라인이 단일 실패로 전체를 FAILED 처리하면 부분 결과 활용 불가
  - 해결 방법: `VULNERABILITY` 스테이지만 FAILED로 표시하고 스캔 전체 상태는 `PARTIAL`로 유지, 이전 스테이지 결과는 그대로 보존 (CLAUDE.md 19장 Error Handling 준수)

### 미완료

- 부모 POM / import BOM 정적 해석 (Maven Central에서 POM만 내려받아 파싱, Phase 1/2 후속 검토 과제)
- OSV 조회 결과 영속 캐싱 (현재 스캔마다 재조회)
- Gradle 프로젝트 지원, 멀티모듈/profiles 해석
- CVSS v4 점수 계산
- OSV 외 취약점 공급자(NVD, GitHub Advisory) 연동
- 오늘 CLI로 `spring-vulnerable-used` 픽스처를 수동 스캔한 결과물(`result.json`, `sbom.json`, `scratch-sbom.json`)이 아직 미커밋 상태로 루트에 남아 있음 — 커밋 여부 결정 필요

### 다음 작업

- Phase 3: 동일한 `ScanOrchestrator`를 사용하는 `scan`/`report` CLI 요약 출력과 React 대시보드(프로젝트 목록, 대시보드, 취약점 목록) 연결
- Phase 4 착수 전 Java 소스 사용(usage) 분석 설계 검토

## 2026-10-03

### 완료

- Phase 3: CLI 리포트 + React 대시보드, DB 연동 (상세 계획 `.claude/docs/phase-3-dashboard-cli.md`, `7a11c4d feat: implement Phase 3 CLI report + React dashboard (DB-backed)`)
  - 변경 파일: `packages/core/src/summary/{summarizeScan,findingOrder}.ts`(+테스트), `packages/core/src/index.ts`, `packages/shared/src/api/{error,project,scan,dependency,vulnerability,summary,index}.ts`, `packages/shared/src/index.ts`, `apps/api/src/dto/*.dto.ts`, `apps/api/src/routes/{projects.route,notImplemented}.ts`, `apps/api/src/server.test.ts`, `apps/cli/src/render/text-report.ts`(+테스트), `apps/cli/src/commands/{scan,report}.command.ts`, `apps/web/src/api/{client,queries}.ts`, `apps/web/src/format/{severity,date,fixedVersions}.ts`(+테스트), `apps/web/src/routes/*.tsx`, `vitest.config.ts`, `README.md`, `.claude/docs/overview-plan.md`
  - 변경 이유: Phase 1/2 완료 후 남은 "같은 분석 엔진 결과를 CLI와 웹 양쪽에서 보여준다"(MVP §23 9·10항)는 요구를 채우기 위함. 집계·정렬 로직이 CLI와 API에 각각 따로 있던 것(중복)도 함께 해소
  - 주요 변경 사항:
    - core에 `summarizeScan`(의존성/취약점/심각도별 집계, coverage)과 `compareFindings`/`pickDisplayId`(정렬·표시 ID)를 순수 함수로 추가해 CLI·API가 공용으로 사용하도록 정리
    - CLI `scan`은 요약 블록(Project/State/Dependencies/Vulnerabilities/Critical/High)과 취약점 표만 출력하도록 재구성, `report`는 `--json` 옵션과 maven/vulnerability 옵션을 받아 전체 텍스트 리포트 또는 JSON을 출력
    - API DTO 타입(`ProjectDto`, `ScanJobDto`, `ProjectDependencyDto`, `VulnerabilityFindingDto`, `ErrorResponseDto`)을 `packages/shared/src/api/`로 옮기고 새 `ProjectListItemDto`(목록의 `latestScan` 집계), `ProjectSummaryDto`(대시보드 집계) 타입 추가. `apps/api/src/dto/*`는 매핑 함수만 유지
    - `GET /api/projects`가 각 프로젝트의 최근 스캔 집계(`latestScan`)를 포함하도록 확장, `GET /api/projects/:projectId/summary` 신규 추가(스캔 전이면 `latestScan: null`), `GET /projects/:id/vulnerabilities`가 core `compareFindings`로 정렬된 목록을 반환
    - 웹 4개 페이지(Project List/Dashboard/Vulnerability List/Detail)를 TanStack Query로 실제 API에 연동. 프로젝트 등록 폼과 스캔 실행 버튼 추가, Used/Reachable/Risk Score는 값을 지어내지 않고 `—` + 툴팁("Phase 4/6/7에서 분석")으로 표시
    - `pnpm typecheck && pnpm test && pnpm build && pnpm lint` 전부 통과 확인, CLI는 `fixtures/spring-vulnerable-used`·`spring-safe-app`에 대해 실제 OSV 네트워크 호출까지 포함해 수동 스모크 테스트

### 문제 해결

- 문제: `renderSummary`에 CLAUDE.md 형식의 숫자 요약 블록을 추가하면서 기존 "Project/Path/State/Stages/Warnings" 텍스트와 형식이 충돌
  - 원인: phase-3 계획의 `scan` 목표 출력에는 Stages 목록이 없고, Project/State/숫자 블록만 있음
  - 해결 방법: `renderSummary`를 숫자 요약 블록 중심으로 다시 쓰고, 각 스테이지 실패/스킵 사유는 그 스테이지와 관련된 섹션(`renderDependencies`, `renderVulnerabilities`, 그리고 새 `renderSummary`의 `Warning:` 줄)에서 맥락과 함께 보여주는 방식으로 변경 — Stages 전체 나열보다 근거 중심 표시가 CLAUDE.md §6.2(Evidence First)에 더 맞음

- 문제: `packages/shared/src/api/scan.ts`·`summary.ts`에서 `UnresolvedDependency`를 `types/project.ts`에서 import하면 "declares locally, but not exported" 타입 에러
  - 원인: `UnresolvedDependency`는 실제로 `types/dependency.ts`에 정의되어 있고, `project.ts`는 그걸 타입 전용으로 import만 하고 재수출하지 않음
  - 해결 방법: import 경로를 `../types/dependency.js`로 수정

### 미완료

- `scanRepository.save` → `saveDependencies` → `saveFindings`를 하나의 트랜잭션으로 묶는 작업(계획 3b 항목 10) — 포트 인터페이스(`ScanRepository`/`FindingRepository`) 변경이 필요한 더 큰 작업이라 한계로 기록하고 보류
- `GET /api/projects` 목록 집계가 프로젝트당 N+1 쿼리 (계획에서 MVP 범위에서는 허용하기로 결정한 사항)
- ~~Docker Desktop이 세션에서 실행 중이 아니어서 실제 PostgreSQL + 브라우저로의 end-to-end 수동 확인은 못함~~ → 2026-10-04에 완료 (아래 기록 참고)
- 루트에 미커밋 산출물(`result.json`, `sbom.json`, `scratch-sbom.json`)과 `package-lock.json`(pnpm 워크스페이스인데 중복)이 그대로 남아있음 — 삭제 여부 사용자 확인 필요

### 다음 작업

- ~~Docker Desktop 실행 후 실제 DB 연동 end-to-end 확인~~ → 2026-10-04 완료
- 루트 미커밋 산출물 정리 여부 결정
- Phase 4 착수 전 "artifact → Java 패키지 매핑 방식"과 "취약 API 정보 출처" 결정 (overview-plan §7)

## 2026-10-04

### 완료

- Phase 3 실제 DB + 브라우저 end-to-end 확인
  - 변경 이유: 10-03에는 Docker가 꺼져 있어 API inject 테스트로만 검증했음. 완료 조건(phase-3 §5)의 웹 항목을 실제 환경에서 확인하기 위함
  - 확인 내용: 마이그레이션 2개 적용 상태 확인 → `API_PORT=3001 pnpm dev:api` + `pnpm dev:web` → 프로젝트 목록, 없는 경로 등록 시 `PATH_NOT_FOUND` 표시, 대시보드 "Run scan"(COMPLETED, Dependencies 3 / Vulnerabilities 12 / Critical 1 / High 5), 취약점 목록(심각도·CVSS 정렬, Used/Reachable/Risk `—`), CVE-2022-42889 상세(GHSA id, CVSS 벡터, purl, fixed 1.10.0, affectedRanges 원문). 콘솔 에러 없음
  - Phase 3 완료 조건 8개 체크, overview-plan §2 갱신

- README에 Phase 3 실제 동작 문서화 + GitHub 저장소 입력 계획 추가 (`b43028d docs: document Phase 3 behavior and plan GitHub repository input`)
  - 변경 파일: `README.md`, `.claude/resources/phase3-{dashboard,vulnerability-list}.jpg`, `.claude/docs/overview-plan.md`, `apps/web/vite.config.ts`
  - 주요 변경 사항:
    - README에 "현재 구현 상태 (Phase 3까지)" 섹션 추가: Phase 진행 표, 실제 CLI 출력, 대시보드·취약점 목록 스크린샷, 알려진 한계
    - overview-plan에 "(MVP 1 이후) GitHub Repository Input" 계획 추가: `RepositorySource`로 얕은 clone 후 기존 `ScanOrchestrator` 재사용, commit SHA 근거 저장, clone 보안 규칙
    - vite proxy가 `API_PORT`를 따르도록 수정 (기본값 3000 유지)

- `vulntrace` CLI 전역 링크 (`apps/cli`에서 `pnpm link --global`) — 이제 `vulntrace scan <경로>` 한 줄로 실행. README CLI 섹션에 방법 추가

### 문제 해결

- 문제: `pnpm dev:api` 실행 시 `listen EACCES: permission denied 127.0.0.1:3000`
  - 원인: 로컬 Grafana가 3000번 포트를 사용 중. API는 `API_PORT`를 지원하지만 vite proxy 주소는 3000으로 고정되어 있었음
  - 해결 방법: `apps/web/vite.config.ts` proxy를 `process.env.API_PORT ?? '3000'`으로 바꾸고, API와 웹을 같은 `API_PORT`로 실행

### 미완료

- 대시보드 스캔 옵션 선택 UI (allow Maven / OSV 조회) — 계획 3c-15에 있었으나 미구현. 훅은 옵션을 받을 수 있어 체크박스만 추가하면 됨
- 취약점 목록 Fixed 열의 버전 목록이 정렬되지 않음 (예: `2.18.8, 3.1.4, 2.21.4`)
- 루트의 `result.json`, `sbom.json`, `scratch-sbom.json` 정리 여부 결정

### 다음 작업

- Phase 4 착수 전 "artifact → Java 패키지 매핑 방식"과 "취약 API 정보 출처" 결정 (overview-plan §7)
- MVP 1 이후 GitHub 저장소 입력 (overview-plan §4)

## 2026-10-17

### 완료

- Phase 4: Java 소스 사용 분석 마무리 → MVP 1 달성 (상세 계획 `.claude/docs/phase-4-source-usage.md`)
  - 변경 파일: `packages/source-analyzer/src/{JavaSourceAnalyzer,types,index}.ts`, `packages/source-analyzer/src/parser/{JavaTokenizer,LightweightJavaParser}.ts`(+테스트), `packages/source-analyzer/src/scanner/JavaFileScanner.ts`, `packages/source-analyzer/src/usage/{artifactPackages,vulnerableApis,UsageMatcher,assessFindingUsage}.ts`(+테스트), `packages/shared/src/types/{source-usage,vulnerability}.ts`, `packages/shared/src/api/{usage,vulnerability,summary,index}.ts`, `packages/core/src/{ScanOrchestrator,createScanOrchestrator,index}.ts`, `packages/core/src/summary/summarizeScan.ts`, `prisma/schema.prisma`, `prisma/migrations/20261004062230_phase4_source_usage`, `apps/api/src/{dto/usage.dto,dto/vulnerability.dto,persistence/prisma/FindingRepository.prisma,routes/findings.route,routes/projects.route}.ts`, `apps/cli/src/{commands/report.command,render/text-report}.ts`(+테스트), `apps/web/src/{api/queries,format/usage}.ts`, `apps/web/src/routes/{VulnerabilityListPage,VulnerabilityDetailPage,ProjectDashboardPage}.tsx`, `README.md`, `.claude/docs/{overview-plan,phase-4-source-usage}.md`, `.claude/resources/phase4-{vulnerability-list,usage-evidence}.jpg`
  - 변경 이유: CLAUDE.md Phase 4 / §23 11·12항 — 취약 의존성을 애플리케이션 소스가 실제로 쓰는지를 파일:라인 증거와 함께 판정하고 CLI·웹에 표시
  - 주요 변경 사항:
    - 분석 엔진·core·API(1~6단계)는 이전 세션에서 미커밋 상태로 구현되어 있었음. 오늘 남은 작업을 점검해 마무리
    - CLI: `report`에 만들어 두고 연결하지 않았던 사용 증거 섹션(`renderSourceUsage`)을 출력에 추가. 취약점 표·증거 목록의 열 너비를 고정값 대신 가장 긴 값 기준으로 계산해 긴 의존성 이름에서 열이 밀리던 문제 해결
    - Web: 목록 `Used` 열(`Yes (vulnerable API used)` / `No` / 미분석 `—`), 상세 `Usage evidence` 섹션(`GET /findings/:id/usages`, 판정·매핑 근거·증거 표), 대시보드 `Used Vulnerabilities`
    - 검증: typecheck / test 238개 / build 통과, 픽스처 3종 기대값 확인, 실제 PostgreSQL + 브라우저 end-to-end 확인(새 스캔 후 `TemplateService.java:3/14/15` 증거 표시, 콘솔 에러 없음)
  - 루트 산출물(`result.json`, `sbom.json`, `scratch-sbom.json`)은 커밋에서 제외하기로 결정 (파일은 로컬에 유지)

### 문제 해결

- 문제: `pnpm test`에서 CLI 렌더러 테스트 2개 실패
  - 원인: 요약에 `Used by source` 줄, 취약점 표에 `Used`/`Vuln API` 열을 추가한 뒤 테스트 기대값을 갱신하지 않았음
  - 해결 방법: 기대값 갱신 + 소스 분석 성공 시 요약, 긴 의존성 이름 정렬, 사용 증거 섹션, 미분석 표시 테스트 추가

### 미완료

- 웹 상세 화면의 사용 증거 표 Snippet 열 때문에 가로 스크롤이 생김 (디자인 최소화 원칙으로 보류)
- CLI `report` 사용 증거 섹션이 사용되지 않은 finding도 모두 출력해 길어짐
- 취약 API 목록은 CVE-2022-42889 하나뿐 (나머지는 `NO_API_INFO`)
- `queries.ts`, `ProjectDashboardPage.tsx`, `VulnerabilityDetailPage.tsx`의 기존 Prettier 경고는 그대로 둠

### 다음 작업

- MVP 1 이후 GitHub 저장소 입력 (overview-plan §4)
- 그다음 Phase 5 — Spring 엔드포인트 분석
