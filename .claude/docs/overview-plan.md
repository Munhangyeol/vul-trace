# VulnTrace 전체 개발 계획 (overview-plan)

작성일: 2026-09-26
기준 문서: `CLAUDE.md` (규범 문서, 본 계획보다 우선함)
관련 문서: `init_plan.md` (Phase 0 스캐폴딩 상세 계획)

이 문서는 Phase 0 ~ Phase 8 전체 로드맵을 한 곳에 정리한다.
각 Phase 착수 시에는 별도의 상세 계획(`phase-N-*.md`)을 `CLAUDE.md` §22 PLAN 형식으로 작성한다.

---

## 1. 최종 목표

> 어떤 취약점을 먼저 고쳐야 하는지, 어떤 코드가 그것을 사용하는지, 외부 요청이 어떻게 그 코드에 도달하는지, 그리고 그 결론을 뒷받침하는 증거는 무엇인지.

단순 CVE 나열이 아니라 아래 4단계를 **증거와 함께** 구분하는 것이 핵심이다 (§6, §7 Phase 6).

```text
dependency exists       → pom.xml / dependency:tree 근거
dependency is used      → import / 참조 위치 (파일:라인)
vulnerable API is used  → 취약 API 호출 위치 (파일:라인)
vulnerable API reachable→ 엔드포인트 → ... → 호출 위치 콜 경로
```

---

## 2. 현재 상태 (2026-11-16 기준)

**Phase 0 (스캐폴딩) 완료** — 커밋 `1470308 feat: scaffold TypeScript monorepo for VulnTrace MVP`
**Phase 1 (Maven 의존성 분석) 완료** — 커밋 `3cce848 feat: implement Phase 1 Maven dependency analysis`
**Phase 2 (SBOM + OSV 취약점 매칭) 완료** — 커밋 `5bc7f58 feat: implement Phase 2 SBOM + OSV vulnerability matching`
**Phase 3 (CLI 리포트 + React 대시보드, DB 연동) 완료** — 커밋 `7a11c4d feat: implement Phase 3 CLI report + React dashboard (DB-backed)`, 상세 계획 `phase-3-dashboard-cli.md` (2026-10-04 실제 DB + 브라우저 end-to-end 확인)
**Phase 4 (Java 소스 사용 분석) 완료 — MVP 1 달성** — 상세 계획 `phase-4-source-usage.md` (2026-10-17 픽스처 3종 CLI 확인 + 실제 DB + 브라우저 end-to-end 확인)
**GitHub 저장소 입력 완료 (MVP 1 이후)** — §4 "GitHub Repository Input" (2026-11-15 공개 저장소 3개로 CLI·API·웹 end-to-end 확인)
**Phase 5 (Spring 엔드포인트 분석) 완료** — 커밋 `07a385a feat: implement Phase 5 Spring endpoint analysis`, 상세 계획 `phase-5-spring-endpoints.md` (2026-11-16 픽스처 + 실제 DB + 브라우저 + 실제 저장소 2개 대조)

| 영역 | 상태 |
|---|---|
| 모노레포 | pnpm workspace, TS strict, ESM, tsc project references |
| `packages/shared` | 도메인 타입 + `Result`/`AnalysisError` 모델, `VulnerabilityCoverage` 정의 |
| `packages/dependency-analyzer` | pom.xml 파싱(속성 치환/dependencyManagement), `mvn dependency:tree` 실행/파싱, 병합 — 구현 완료 |
| `packages/sbom` | `CycloneDxBuilder` — CycloneDX 1.5 SBOM 생성 구현 완료 |
| `packages/vulnerability` | `OsvVulnerabilityProvider` — OSV querybatch/vulns 조회, CVSS v3 계산, 심각도 매핑, fixed version 추출 구현 완료 |
| `packages/source-analyzer` | 토크나이저 기반 경량 Java 파서(`JavaTokenizer`/`LightweightJavaParser`), `JavaFileScanner`(main/test 구분, 심볼릭 링크·숨김 폴더 제외, 파일 수·크기 상한), 패키지 매핑표(`artifactPackages`)와 groupId 추정, 취약 API 목록(`vulnerableApis`), `UsageMatcher`, `assessFindingUsage` 구현 완료 |
| `packages/repository-source` | `RepositorySource` 인터페이스, `LocalPathSource`, `GitRepositorySource`(https://github.com만 허용, 얕은 clone, 서브모듈·LFS·심볼릭 링크·hook·자격 증명 끔, 크기 상한, commit SHA 기록), URL·ref 검증 |
| `packages/spring-analyzer` | `SpringEndpointAnalyzer` — 어노테이션 인자 파싱(토크나이저 재사용), import 기반 Spring 어노테이션 판별, 클래스+메서드 경로 결합, HTTP 메서드 합집합/`ANY`, 계산 못 한 값은 `unresolved`, 어노테이션 원문·위치 증거 구현 완료 |
| `packages/reachability`/`risk` | 인터페이스 + `NotImplementedError` 스텁 (Phase 6~7 예정) |
| `packages/core` | `RepositoryScanRunner`가 저장소 가져오기(`REPOSITORY_FETCH`, GIT만) → `ScanOrchestrator` → 임시 폴더 삭제를 묶고, clone 경로를 저장소 기준 상대 경로로 바꿈. `ScanOrchestrator`가 PROJECT_DETECTION → DEPENDENCY → DEPENDENCY_TREE → SBOM → VULNERABILITY → SOURCE_USAGE → SPRING_ENDPOINT까지 연결 (`[SOURCE]`/`[SPRING]` 로그, 실패 시 PARTIAL). `summarizeScan`(`usedVulnerabilities` 포함)/`compareFindings`/`pickDisplayId`를 CLI·API 공용 집계·정렬 로직으로 추가 |
| `apps/cli` | `scan`(요약+취약점 표)/`report`(요약+의존성+취약점+미확정, `--json` 지원, 소스 사용 증거 섹션)/`dependencies`/`vulnerabilities` 구현 완료. `endpoints` 명령과 요약의 `Endpoints:` 줄 추가(Phase 5). 취약점 표에 `Used`/`Vuln API` 열 (`--allow-maven`, `--skip-vulnerabilities`, `--sbom`). 모든 명령이 로컬 경로 또는 GitHub URL(`--ref`)을 받음 |
| `apps/api` | 프로젝트/스캔/의존성/취약점/finding 라우트 + `GET /projects`(목록에 `latestScan` 집계 포함)/`GET /projects/:id/summary`(대시보드 집계, `usedVulnerabilities`), `GET /findings/:id/usages`(사용 증거), `GET /projects/:id/endpoints`(Spring 엔드포인트, summary에 `endpoints`) 구현 완료 (Prisma 저장). DTO 타입은 `packages/shared/src/api/*`로 이동. 프로젝트 등록이 `sourceType`(LOCAL/GIT)·`repoUrl`·`ref`를 받고, 스캔 결과에 `commitSha` 기록 |
| `apps/web` | Vite + Router + TanStack Query. 프로젝트 등록/목록, 대시보드(집계+스캔 실행+단계별 상태), 취약점 목록, 상세 화면까지 실데이터 연동 완료. 목록 `Used` 열, 상세 `Usage evidence` 섹션, 대시보드 `Used Vulnerabilities`·`Spring Endpoints` 표시, 엔드포인트 목록 화면. Reachable/Risk Score는 Phase 6/7 전까지 `—`. 등록 폼에 "Local path / GitHub URL" 선택, 목록·대시보드에 출처와 commit 표시 |
| `prisma/` | 마이그레이션 5개 적용 (`init`, `phase2_vulnerability_evidence`, `phase4_source_usage`, `github_repository_input`, `phase5_spring_endpoints`) |
| `fixtures/` | Spring 픽스처 4종 (`commons-text:1.9`, CVE-2022-42889 기준). `spring-vulnerable-used`에 pom 파싱 경로 검증용 `guava`/`jackson-databind`/`commons-io` 추가 |
| 품질 도구 | ESLint, Prettier, Vitest, husky + commitlint |

**다음 작업: Phase 6 — 도달 가능성(Reachability) 분석**

---

## 3. 로드맵 한눈에 보기

```text
Phase 0  스캐폴딩                          ✅ 완료
Phase 1  Maven 의존성 분석                  ✅ 완료
Phase 2  SBOM + OSV 취약점 매칭             ✅ 완료
Phase 3  CLI 리포트 + React 대시보드 (DB 연동) ✅ 완료
Phase 4  Java 소스 사용 분석                ✅ 완료, 여기까지 MVP 1 (§23)
(MVP 1 이후) GitHub 저장소 입력             ✅ 완료 — 로컬 경로 외에 GitHub URL로 스캔
Phase 5  Spring 엔드포인트 분석             ✅ 완료
Phase 6  도달성(Reachability) 분석          ◀ 다음
Phase 7  위험도 우선순위화
Phase 8  조치(Remediation) 안내
(선택)   Stage B Java Analyzer Adapter / LLM 설명 생성
```

| Phase | 주요 패키지 | 필요한 DB 테이블 | 대표 검증 |
|---|---|---|---|
| 1 | `dependency-analyzer`, `core` | `projects`, `scan_jobs`, `dependencies`, `project_dependencies` | pom 파싱 / 트리 파싱 단위 테스트 |
| 2 | `sbom`, `vulnerability` | `vulnerabilities`, `project_vulnerabilities` | OSV 응답 정규화 테스트, 픽스처에서 CVE-2022-42889 검출 |
| 3 | `apps/cli`, `apps/api`, `apps/web` | (조회) | `vulntrace scan fixtures/...` 출력, 대시보드 표시 |
| 4 | `source-analyzer` | `source_usages` | Case A: `used=false`, Case B/C: `used=true` |
| GitHub 입력 | `repository-source`(신규), `core`, `apps/*` | `projects` 컬럼 추가, `scan_jobs.commitSha` | 공개 GitHub 저장소 URL로 스캔 → 로컬 경로 스캔과 같은 결과 + commit SHA 기록 |
| 5 | `spring-analyzer` | `spring_endpoints` | 라우트 추출 단위 테스트 |
| 6 | `reachability` | `methods`, `method_calls`, `reachability_paths` | Case B: `reachable=false`, Case C: `reachable=true` |
| 7 | `risk` | `risk_scores` | 점수 + 근거 단위 테스트 |
| 8 | `core`, `apps/*` | (조회) | 상세 화면/리포트에 조치 정보 표시 |

---

## 4. Phase별 계획

각 Phase 공통 완료 조건:

```text
pnpm typecheck / pnpm test / pnpm build 통과
해당 Phase 단위 테스트 추가
픽스처 기대값 검증 (해당되는 경우)
ScanOrchestrator에 단계 연결 + [TAG] 로그 추가 (§20)
실패 시 성공한 단계 결과 보존, PARTIAL/FAILED 기록 (§19)
```

### Phase 1 — Repository + Maven Dependency Analysis

**목표**: 로컬 경로 → pom.xml 탐지 → 직접/전이 의존성 추출 → 정규화 → 저장

작업 순서:

1. `MavenProjectDetector` — 경로 검증, `pom.xml` 탐지 (멀티모듈은 루트 우선, 모듈은 추후)
2. `PomParser` — `groupId/artifactId/version`, `<dependencies>`, `<properties>` 치환, `<parent>` 인식
3. `purl` — 이미 구현됨, 엣지 케이스 테스트 보강
4. `MavenDependencyTreeRunner` — `execFile('mvn', [...])`, 타임아웃, stdout/stderr 캡처 (§15)
5. `DependencyTreeParser` — 트리 텍스트 → 좌표 (순수 함수)
6. `MavenDependencyAnalyzer` — 조립, 직접/전이 병합, `direct` 플래그, 근거(`pom.xml` / `dependency:tree`) 기록
7. Prisma 초기 마이그레이션 + `ProjectRepository`/`ScanRepository` Prisma 어댑터
8. CLI `vulntrace dependencies <path>` 연결

주의 사항:

- Maven 미설치/실패 시 직접 의존만으로 진행하고 `transitiveResolved=false` + 실패 사유 기록 → `PARTIAL`
- `mvn` 실행은 신뢰 문제를 고려 (§16): 플러그인 실행 범위 최소화, `--batch-mode`, 오프라인 옵션 검토
- `<parent>`(spring-boot-starter-parent)의 버전 관리(dependencyManagement)는 pom 단독 파싱으로 해결 불가 → 버전 미확정 의존은 `dependency:tree` 결과로 보완하고, 불가 시 경고로 남김

완료 기준: 4개 픽스처 모두 `commons-text` 유무/버전이 정확히 추출됨

### Phase 2 — SBOM + Vulnerability Matching

**목표**: 의존성 → CycloneDX → OSV 조회 → 취약점 Finding 저장

작업 순서:

1. `CycloneDxBuilder` — 컴포넌트 목록 생성 (순수 함수), 필요 시 JSON export
2. OSV API 스펙 **실제 문서 확인** 후 `OsvVulnerabilityProvider` 구현 (§21 "외부 API 발명 금지")
3. `osv-response` 정규화 — 외부 응답 경계 검증, 별칭(CVE/GHSA) 처리
4. `severity` — CVSS → `Severity` 매핑
5. 영향 버전 범위/수정 버전(fixed version) 추출
6. `vulnerabilities`, `project_vulnerabilities` 저장
7. CLI `vulntrace vulnerabilities <path>` 연결

주의 사항:

- 단위 테스트는 녹화된 OSV 응답 JSON으로 수행 (네트워크 비의존)
- 라이브 OSV 결과는 변할 수 있으므로 픽스처 기대값은 `commons-text` CVE로 한정 (`fixtures/README.md`)
- 네트워크 실패 시 의존성 결과는 보존하고 `PARTIAL`

완료 기준: `fixtures/spring-vulnerable-*`에서 CVE-2022-42889 검출, fixed version `1.10.0` 표시

### Phase 3 — React Dashboard + CLI

**목표**: 동일한 `core` 엔진을 CLI와 API/웹에서 재사용

작업 순서:


1. CLI `scan` / `report` — 요약 출력 (Dependencies / Vulnerabilities / Critical / High)
2. API — `POST/GET /api/projects`, `POST/GET /api/projects/:id/scans`, `GET .../dependencies`, `GET .../vulnerabilities`
3. DTO 계층 정의 (Prisma 모델 직접 노출 금지, §10)
4. Web — Project List / Project Dashboard / Vulnerability List 데이터 연동 (TanStack Query)
5. `docker-compose`로 Postgres 기동 후 end-to-end 확인

주의 사항:

- 디자인 작업 최소화 (§3, §7 Phase 3). 표 형태로 충분
- 스캔은 초기에 요청 내 동기 실행 또는 단순 비동기 실행. 큐 도입 금지 (§3)
- 프론트엔드에 분석 로직 금지 (§12)

### Phase 4 — Java Source Usage Analysis

**목표**: 취약 의존성 → 실제 소스 사용 증거(파일:라인)

작업 순서:

1. `JavaFileScanner` — `src/main/java` 탐색 (테스트 소스 구분)
2. `LightweightJavaParser` (Stage A) — package, import, 어노테이션, 클래스/메서드 선언, 단순 호출
   - 정규식 단독 의존 금지 (§14). 토크나이저 기반 경량 파서 또는 검증된 TS용 Java 파서 도입 검토 (의존 추가 시 근거 기록)
3. 의존성 → 패키지 매핑 — artifact가 제공하는 Java 패키지 목록 확보 방식 결정
   (초기: 알려진 매핑 테이블 / 이후: JAR 내용 인덱싱 검토)
4. `UsageMatcher` — import, 패키지 참조, 객체 생성, 명확한 메서드 호출 매칭 + 증거 생성
5. 취약 API 사용 여부 구분 (예: `StringSubstitutor.createInterpolator`) — 취약 API 정보 출처 정의 필요
6. `source_usages` 저장, 상세 화면/CLI에 증거 표시

완료 기준 (§17):

```text
spring-vulnerable-unused    → used=false
spring-vulnerable-used      → used=true  (TemplateService.java:라인)
spring-vulnerable-reachable → used=true
```

**Phase 4 완료 = MVP 1 달성** (§23 1~12항 end-to-end)

### (MVP 1 이후) GitHub Repository Input

**목표**: 로컬 경로뿐 아니라 GitHub 저장소 URL을 입력받아 그 소스 코드를 분석

CLAUDE.md는 Phase 1에서 "로컬 경로 입력"만 요구하므로, 이 단계는 최종 제품 요구에 따라 추가한 확장이다. 분석 엔진을 픽스처로 먼저 완성한 뒤(MVP 1) 진행한다.

설계 방향:

- 분석기는 지금처럼 "폴더 경로"만 입력으로 받는다. 저장소를 가져오는 일은 별도의 입력 단계에서 처리하고, `ScanOrchestrator`와 분석기는 바꾸지 않는다

```text
사용자 입력: https://github.com/owner/repo (+ branch / tag / commit)
        ↓
RepositorySource
  ├─ LocalPathSource      ← 현재 방식
  └─ GitRepositorySource  ← 얕은 clone으로 임시 작업 폴더 생성
        ↓
ScanOrchestrator.run(작업 폴더 경로)   ← 변경 없음
        ↓
스캔 종료 후 작업 폴더 삭제
```

작업 순서:

1. `RepositorySource` 인터페이스 + `LocalPathSource`(기존 경로 검증 로직 이동)
2. `GitRepositorySource` — `execFile('git', ['clone', '--depth', '1', '--single-branch', '--no-recurse-submodules', ...])`, 타임아웃, stdout/stderr 캡처, 실패 사유 기록
3. 실제로 분석한 commit SHA를 스캔 결과에 근거로 저장 (§6.2)
4. `projects`에 `sourceType`(LOCAL / GIT), `repoUrl`, `ref` 추가, `scan_jobs`에 `commitSha` 추가
5. 스캔 단계에 저장소 가져오기 단계(예: `REPOSITORY_FETCH`) 추가 — 실패하면 FAILED와 사유 기록 (§19)
6. API 등록 DTO 확장, 웹 등록 폼에 "로컬 경로 / GitHub URL" 선택, CLI `vulntrace scan https://github.com/...` 지원

보안 (§15, §16 — 저장소는 신뢰할 수 없는 입력):

- 처음에는 `https://github.com/<owner>/<repo>` 형식만 허용. `GIT_ALLOW_PROTOCOL=https`로 `file://`, `ext::` 등 다른 전송 방식 차단
- clone 옵션: 서브모듈 받지 않음, LFS 다운로드 끄기(`GIT_LFS_SKIP_SMUDGE=1`), 심볼릭 링크 끄기(`core.symlinks=false`), 저장소 크기·파일 수 상한
- clone한 코드는 빌드·실행하지 않음. 정적 분석만 하고, `--allow-maven`은 지금처럼 사용자가 직접 켜야만 동작
- 비공개 저장소(토큰 필요)는 초기 범위 밖. 지원할 때도 토큰은 로그·DB에 평문으로 남기지 않음 (§20)
- GitHub API tarball 방식은 압축 해제 라이브러리 추가와 경로 탈출 방어가 필요하므로, 얕은 clone을 우선 사용

완료 기준: 공개 GitHub 저장소 URL을 등록해 스캔하면 같은 코드를 로컬 경로로 스캔한 결과와 일치하고, 결과에 commit SHA가 기록됨. 스캔 후 임시 작업 폴더가 남지 않음

**구현 결과 (2026-11-15)**:

- 결정: D1 `ProcessRunner`는 `dependency-analyzer`의 것을 재사용(`env` 옵션만 추가). D2 ref는 브랜치·태그만(commit SHA 지정은 이후). D3 스캔은 요청 안에서 동기 실행, clone 타임아웃 120초
- API는 core만 의존하도록 URL·ref 검증 함수를 core에서 다시 export. 기존 `{ name, path }` 등록 요청은 그대로 LOCAL로 처리
- `REPOSITORY_FETCH` 단계는 GIT 스캔에만 붙음. 스캔 상태는 분석 단계 기준으로 정함(clone은 됐지만 Maven 프로젝트가 아니면 FAILED). clone 실패 시 나머지 단계는 모두 SKIPPED
- clone 폴더 기준 절대 경로(pom.xml 증거, 단계 사유, 경고, git stderr)는 저장소 기준 상대 경로나 `<workspace>`로 바꿔 저장
- 검증: spring-petclinic(`500158f`)·java-sec-code(`4711f4e`)를 URL과 로컬 경로로 각각 스캔해 의존성·미확정 의존성·SBOM·finding 내용·소스 사용 증거가 일치함을 확인(finding 배열 순서만 OSV 병렬 조회 때문에 다름). text4shell(`288959e`)은 API+DB로 스캔해 `HelloController.java:5/20/23` 증거 확인. 없는 저장소는 자격 증명 창 없이 `CLONE_FAILED`, `file://` URL은 등록 단계에서 400
- 한계: 크기 상한은 clone 후에 검사(받는 도중은 타임아웃만), 비공개 저장소·GitHub 외 호스트·commit SHA ref 미지원, `--allow-maven`을 GIT 소스에 켜면 경고만 남김

### Phase 5 — Spring Endpoint Analysis

**목표**: 컨트롤러/엔드포인트 메타데이터 추출

- `@RestController`, `@Controller`, `@RequestMapping`, `@Get/Post/Put/Delete/PatchMapping` 탐지
- 클래스 레벨 + 메서드 레벨 경로 결합, `value`/`path` 속성, 배열 경로, `method=` 속성 처리
- 추출: HTTP Method, Path, Controller Class, Controller Method, 파일:라인
- `spring_endpoints` 저장

완료 기준: `spring-vulnerable-reachable`에서 `POST /api/templates/render → TemplateController.render` 추출

**완료 (2026-11-16, `07a385a`)** — 상세 결정·검증·한계는 `phase-5-spring-endpoints.md`. 계산 못 한 경로(상수 등)는 추측하지 않고 `unresolved`로 남기며, 엔드포인트마다 어노테이션 원문과 위치를 증거로 저장. 실제 저장소 대조: spring-petclinic 17/17, java-sec-code 133개(누락으로 보인 2곳은 Spring 동작과 일치)

### Phase 6 — Reachability Analysis

**목표**: 엔드포인트 → 컨트롤러 → 서비스 → 내부 메서드 → 취약 API 사용까지의 전체 경로

작업 순서:

1. `CallGraph` — `methods`, `method_calls` 구성 (필드 주입/생성자 주입 타입 기반 단순 해석)
2. `ReachabilityAnalyzer` — 엔드포인트 메서드에서 BFS, 취약 사용 지점까지 경로 탐색
3. 경로 증거(`CallPath` 각 단계의 파일:라인) 저장 → `reachability_paths`
4. 4단계 구분 결과를 Finding에 반영 (exists / used / vulnerable API used / reachable)
5. `GET /api/findings/:id/reachability`, 상세 화면 경로 표시

한계 명시: 인터페이스 다형성, 리플렉션, AOP 프록시, 람다 등은 Stage A에서 미지원 → 결과에 "분석 범위" 표기.
정밀도가 부족하면 **Stage B (Java Analyzer Adapter)** 도입을 이 시점에 검토 (§5).

완료 기준 (§17):

```text
spring-vulnerable-used      → reachable=false
spring-vulnerable-reachable → reachable=true
  POST /api/templates/render → TemplateController.render
  → TemplateService.render → StringSubstitutor.createInterpolator
```

### Phase 7 — Risk Prioritization

**목표**: 설명 가능한 위험 점수

- 입력: CVSS, direct/transitive, 소스 사용, 취약 API 사용, 도달성, HTTP 노출, 인증 요구 여부, 알려진 익스플로잇, fixed version 존재
- `RiskScoreCalculator`는 순수 함수, 가중치는 `rules.ts`로 외부화
- 결과는 항상 `{ score, reasons[] }` — 근거 없는 점수 금지 (§8)
- 인증 요구 여부(Spring Security 설정 등)는 정적으로 판단 가능한 범위만, 불확실하면 "unknown"으로 표기
- 취약점 목록 기본 정렬을 위험 점수로 변경

### Phase 8 — Remediation

**목표**: 조치에 필요한 정보를 한 화면/리포트에 제공

- 현재 버전 / 영향 버전 범위 / 수정 버전
- 영향 파일, 영향 메서드, 도달 가능한 엔드포인트
- 위험 근거, 권장 조치 (직접 의존: 버전 업그레이드 / 전이 의존: 부모 의존 업그레이드 또는 `dependencyManagement` override)
- LLM 기반 요약/설명은 결정론적 결과가 모두 갖춰진 뒤 **선택 사항**으로만 추가 (§6.3)

---

## 5. 마일스톤

| 마일스톤 | 포함 Phase | 결과 |
|---|---|---|
| M0 스캐폴딩 | 0 | ✅ 빌드/테스트 가능한 골격 |
| M1 의존성 인벤토리 | 1 | CLI로 직접/전이 의존성 + purl 출력 |
| M2 취약점 탐지 | 2 | CLI로 CVE 목록 + fixed version 출력 |
| M3 대시보드 | 3 | 웹에서 프로젝트/취약점 조회 |
| **MVP 1** | 1~4 | ✅ §23 Definition of Done 전체 충족 (소스 사용 증거 포함) |
| M4 GitHub 입력 | MVP 1 이후 | 공개 GitHub 저장소 URL로 스캔, commit SHA 근거 기록 |
| M5 도달성 | 5~6 | 엔드포인트 → 취약 API 콜 경로 제시 |
| M6 우선순위/조치 | 7~8 | 설명 가능한 점수 + 조치 안내 |

---

## 6. 전 Phase 공통 원칙

- **증거 우선** (§6.2): boolean만 저장하지 않는다. 모든 결론에 파일:라인 / 경로 / 출처를 함께 저장
- **결정론적 분석** (§6.3): LLM은 취약 여부 판단에 사용하지 않음
- **미래 Phase 선구현 금지** (§21): 현재 Phase 범위만 구현, 다음 Phase는 인터페이스까지
- **분석 로직 단일화** (§11): CLI와 API는 모두 `core`의 `ScanOrchestrator`만 호출
- **Java 특화 로직 추상화** (§14): 파서 전략 인터페이스 뒤에 두어 Stage B 교체 시 호출부 불변
- **스캐너 보안** (§15, §16): 분석 대상은 신뢰하지 않음. 앱 실행 금지, `execFile` + 인자 검증 + 타임아웃
- **인프라 최소화** (§3): Redis/Kafka/큐/마이크로서비스 도입 금지 (구체적 필요 발생 전까지)

---

## 7. 주요 위험 및 미결정 사항

| 항목 | 영향 Phase | 대응 |
|---|---|---|
| `mvn` 실행의 신뢰 문제 (부모 POM/플러그인 다운로드·실행) | 1 | 실행 옵션 최소화, 실패 시 PARTIAL, 사용자 옵트인 플래그 검토 |
| 부모 POM 버전 관리로 인한 pom 단독 파싱 한계 | 1 | `dependency:tree` 보완, 미확정 버전 경고 |
| OSV 결과 변동성 | 2 | 테스트는 녹화 응답 사용, 픽스처 기대값 한정 |
| artifact → Java 패키지 매핑 방법 | 4 | 결정(phase-4 D2): 수동 매핑표 + groupId 추정, 근거(`basis`) 표시. JAR 인덱싱은 이후 검토 |
| 취약 API(함수 단위) 정보 출처 | 4, 6 | 결정(phase-4 D3): OSV 응답에 Maven용 함수 단위 필드 없음 확인 → 수동 목록(`vulnerableApis.ts`), 없으면 `NO_API_INFO`. 2026-11-15 확대: Log4Shell 계열 3건, snakeyaml 8건, fastjson 1건, SpEL 3건(OSV가 준 GHSA/CVE ID 기준). jackson-databind 계열은 CVE별 조건 확인 후 추가 |
| API와 구현이 나뉜 라이브러리 | 4, 6 | 결정(2026-11-15): 선별한 관계표(`apiImplementations.ts`)로 API 사용 → 구현 `used`(`viaApi` 경로·근거 저장). 로깅 라이브러리만, `log4j-to-slf4j`가 있으면 연결 안 함 |
| TS 기반 Java 파싱 정밀도 | 4~6 | 파서 추상화 유지, 한계 명시, 필요 시 Stage B |
| 다형성/DI/AOP로 인한 콜 그래프 누락 | 6 | "분석 범위" 표기, false negative 가능성 문서화 |
| 인증 요구 여부 정적 판단 | 7 | 판단 불가 시 unknown, 점수 근거에 명시 |
| 외부 저장소 clone의 신뢰 문제 (악성 저장소, 대용량, 서브모듈/LFS/심볼릭 링크) | GitHub 입력 | https만 허용, 얕은 clone, 서브모듈·LFS·심볼릭 링크 끄기, 크기 상한, 코드 실행 금지 |
| 비공개 저장소 인증 토큰 관리 | GitHub 입력 | 초기에는 공개 저장소만 지원, 이후 토큰은 평문 저장·로그 금지 |

---

## 8. 문서 운영

- 본 문서: 전체 로드맵. Phase 완료 시 §2 현재 상태와 §3 체크 표시 갱신
- Phase 상세 계획: `.claude/docs/phase-N-<name>.md` (§22 PLAN 형식)
- 규범 충돌 시 항상 `CLAUDE.md` 우선
