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

## 2. 현재 상태 (2026-09-26 기준)

**Phase 0 (스캐폴딩) 완료** — 커밋 `1470308 feat: scaffold TypeScript monorepo for VulnTrace MVP`
**Phase 1 (Maven 의존성 분석) 완료** — 커밋 `3cce848 feat: implement Phase 1 Maven dependency analysis`
**Phase 2 (SBOM + OSV 취약점 매칭) 완료** — 커밋 `5bc7f58 feat: implement Phase 2 SBOM + OSV vulnerability matching`
**Phase 3 (CLI 리포트 + React 대시보드, DB 연동) 완료** — 상세 계획 `phase-3-dashboard-cli.md`

| 영역 | 상태 |
|---|---|
| 모노레포 | pnpm workspace, TS strict, ESM, tsc project references |
| `packages/shared` | 도메인 타입 + `Result`/`AnalysisError` 모델, `VulnerabilityCoverage` 정의 |
| `packages/dependency-analyzer` | pom.xml 파싱(속성 치환/dependencyManagement), `mvn dependency:tree` 실행/파싱, 병합 — 구현 완료 |
| `packages/sbom` | `CycloneDxBuilder` — CycloneDX 1.5 SBOM 생성 구현 완료 |
| `packages/vulnerability` | `OsvVulnerabilityProvider` — OSV querybatch/vulns 조회, CVSS v3 계산, 심각도 매핑, fixed version 추출 구현 완료 |
| `packages/source-analyzer`/`spring-analyzer`/`reachability`/`risk` | 인터페이스 + `NotImplementedError` 스텁 (Phase 4~7 예정) |
| `packages/core` | `ScanOrchestrator`가 PROJECT_DETECTION → DEPENDENCY → DEPENDENCY_TREE → SBOM → VULNERABILITY까지 연결. `summarizeScan`/`compareFindings`/`pickDisplayId`를 CLI·API 공용 집계·정렬 로직으로 추가 |
| `apps/cli` | `scan`(요약+취약점 표)/`report`(요약+의존성+취약점+미확정, `--json` 지원)/`dependencies`/`vulnerabilities` 구현 완료 (`--allow-maven`, `--skip-vulnerabilities`, `--sbom`) |
| `apps/api` | 프로젝트/스캔/의존성/취약점/finding 라우트 + `GET /projects`(목록에 `latestScan` 집계 포함)/`GET /projects/:id/summary`(대시보드 집계) 구현 완료 (Prisma 저장). DTO 타입은 `packages/shared/src/api/*`로 이동 |
| `apps/web` | Vite + Router + TanStack Query. 프로젝트 등록/목록, 대시보드(집계+스캔 실행+단계별 상태), 취약점 목록, 상세 화면까지 실데이터 연동 완료. Used/Reachable/Risk Score는 Phase 4/6/7 전까지 `—` |
| `prisma/` | 마이그레이션 2개 적용 (`init`, `phase2_vulnerability_evidence`) |
| `fixtures/` | Spring 픽스처 4종 (`commons-text:1.9`, CVE-2022-42889 기준). `spring-vulnerable-used`에 pom 파싱 경로 검증용 `guava`/`jackson-databind`/`commons-io` 추가 |
| 품질 도구 | ESLint, Prettier, Vitest, husky + commitlint |

**다음 작업: Phase 4 — Java 소스 사용 분석** (착수 전 "artifact → Java 패키지 매핑 방식"과 "취약 API 정보 출처" 결정 필요, §7 참고)

---

## 3. 로드맵 한눈에 보기

```text
Phase 0  스캐폴딩                          ✅ 완료
Phase 1  Maven 의존성 분석                  ✅ 완료
Phase 2  SBOM + OSV 취약점 매칭             ✅ 완료
Phase 3  CLI 리포트 + React 대시보드 (DB 연동) ✅ 완료
Phase 4  Java 소스 사용 분석                ◀ 다음, 여기까지 MVP 1 (§23)
Phase 5  Spring 엔드포인트 분석
Phase 6  도달성(Reachability) 분석
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

### Phase 5 — Spring Endpoint Analysis

**목표**: 컨트롤러/엔드포인트 메타데이터 추출

- `@RestController`, `@Controller`, `@RequestMapping`, `@Get/Post/Put/Delete/PatchMapping` 탐지
- 클래스 레벨 + 메서드 레벨 경로 결합, `value`/`path` 속성, 배열 경로, `method=` 속성 처리
- 추출: HTTP Method, Path, Controller Class, Controller Method, 파일:라인
- `spring_endpoints` 저장

완료 기준: `spring-vulnerable-reachable`에서 `POST /api/templates/render → TemplateController.render` 추출

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
| **MVP 1** | 1~4 | §23 Definition of Done 전체 충족 (소스 사용 증거 포함) |
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
| artifact → Java 패키지 매핑 방법 | 4 | 초기 매핑 테이블, 이후 JAR 인덱싱 검토 |
| 취약 API(함수 단위) 정보 출처 | 4, 6 | OSV `affected[].ecosystem_specific` 등 실제 필드 확인 후 결정, 없으면 수동 큐레이션 |
| TS 기반 Java 파싱 정밀도 | 4~6 | 파서 추상화 유지, 한계 명시, 필요 시 Stage B |
| 다형성/DI/AOP로 인한 콜 그래프 누락 | 6 | "분석 범위" 표기, false negative 가능성 문서화 |
| 인증 요구 여부 정적 판단 | 7 | 판단 불가 시 unknown, 점수 근거에 명시 |

---

## 8. 문서 운영

- 본 문서: 전체 로드맵. Phase 완료 시 §2 현재 상태와 §3 체크 표시 갱신
- Phase 상세 계획: `.claude/docs/phase-N-<name>.md` (§22 PLAN 형식)
- 규범 충돌 시 항상 `CLAUDE.md` 우선
