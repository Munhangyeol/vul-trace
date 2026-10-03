# Phase 3 상세 계획 — CLI 리포트 + React 대시보드 (DB 연동)

작성일: 2026-10-03
기준 문서: `CLAUDE.md` §7 Phase 3, §10, §11, §12, §13, §21 (본 계획보다 우선함)
상위 문서: `overview-plan.md`
선행 문서: `phase-2-sbom-vulnerability-matching.md` (커밋 `5bc7f58`)

## Context

Phase 1(`3cce848`)과 Phase 2(`5bc7f58`)에서 분석 엔진, Prisma 저장, API 조회가 끝났습니다. 남은 문제는 세 가지입니다.

1. **CLI**: `scan` 출력에 CLAUDE.md가 요구하는 요약 숫자(Dependencies / Vulnerabilities / Critical / High)가 없습니다. `report`는 옵션 없이 JSON만 출력합니다 (`apps/cli/src/commands/report.command.ts`).
2. **API**: 프로젝트 목록과 대시보드에 필요한 집계(최근 스캔, 의존성 수, 취약점 수, 심각도별 수)를 주는 엔드포인트가 없습니다. 응답 DTO 타입은 `apps/api/src/dto/`에만 있어서 웹이 가져다 쓸 수 없습니다(웹은 `@vulntrace/shared`만 의존).
3. **Web**: 4개 페이지 모두 하드코딩된 골격입니다. 프로젝트 등록이나 스캔 실행 UI도 없습니다.

목표는 **같은 core 엔진 결과를 CLI와 웹 양쪽에서 보는 것**(MVP §23의 9·10항)입니다. 디자인 작업은 최소로 하고 표 위주로 만듭니다.

---

## 0. 결정 사항 (권장안으로 진행)

| # | 항목 | 결정 |
|---|---|---|
| D1 | 집계 로직 위치 | `packages/core`에 순수 함수 `summarizeScan`을 둡니다. CLI와 API가 같이 씁니다 (§11, 로직 중복 금지) |
| D2 | 정렬 로직 위치 | CLI 렌더러에 있는 `compareFindings`/`pickDisplayId`/`SEVERITY_RANK`를 core로 옮깁니다. API가 정렬된 목록을 주고, 웹은 받은 순서대로 그립니다 |
| D3 | API 응답 타입 공유 | DTO **타입**은 `packages/shared/src/api/`로 옮기고(type-only), 매핑 함수(`toXxxDto`)는 `apps/api`에 남깁니다. 방향은 web → shared 그대로입니다 (§13) |
| D4 | 프로젝트 목록 집계 | `GET /api/projects` 응답 각 항목에 `latestScan` 요약을 **추가 필드**로 붙입니다(기존 필드 유지). 집계는 `listFindings` + `summarizeScan`으로 계산합니다. N+1 쿼리는 MVP에서는 허용하고 한계로 적어 둡니다 |
| D5 | 대시보드 집계 | `GET /api/projects/:projectId/summary`를 새로 만듭니다 (최근 스캔 상태·단계, 개수, coverage, 미확정 의존성) |
| D6 | 스캔 실행 방식 | 지금처럼 요청 안에서 동기 실행합니다. 큐는 쓰지 않습니다 (§3). 웹은 `useMutation`의 pending 상태로 표시합니다 |
| D7 | Used / Reachable / Risk 열 | 값을 지어내지 않습니다. `—`로 두고 "Phase 4/6/7에서 분석"이라고 툴팁으로 알립니다 (§6.2) |
| D8 | 웹 테스트 | 새 의존성(jsdom, testing-library)은 추가하지 않습니다. 순수 포맷 함수만 vitest(node)로 테스트하고, 화면은 수동 e2e로 확인합니다 |

---

## 1. 작업 분할 (커밋 단위)

각 단계를 마칠 때마다 `pnpm typecheck && pnpm test`를 실행합니다.

### 3a — core 집계 + CLI

| # | 작업 | 파일 |
|---|---|---|
| 1 | `summarizeScan(report-like 입력)` → `{ dependencies, unresolved, vulnerabilities(고유 id 수), findings(행 수), vulnerableDependencies, bySeverity: Record<Severity, number>, coverage }`. 순수 함수와 단위 테스트 | `packages/core/src/summary/summarizeScan.ts` (+ `.test.ts`) |
| 2 | `compareFindings`, `pickDisplayId`, `SEVERITY_RANK`를 core로 옮기고 export | `packages/core/src/summary/findingOrder.ts`, `packages/core/src/index.ts` |
| 3 | `renderSummary`에 CLAUDE.md 형식의 요약 블록을 추가합니다 (`Project / Dependencies / Vulnerabilities / Critical / High / Not checked`). `renderVulnerabilities`는 core의 정렬을 사용 | `apps/cli/src/render/text-report.ts` |
| 4 | `scan`: 요약과 취약점 표만 출력. `report`: maven/vulnerability 옵션을 받고, 기본은 사람이 읽는 전체 리포트(요약+의존성+취약점+미확정), `--json`이면 JSON | `scan.command.ts`, `report.command.ts` (기존 `addMavenOptions`/`addVulnerabilityOptions`/`runScan` 재사용) |
| 5 | 렌더러 스냅샷 테스트 (가짜 `ScanReport`: 정상, VULNERABILITY FAILED, 미확정 존재, 0건) | `apps/cli/src/render/text-report.test.ts` |

목표 출력 (`vulntrace scan fixtures/spring-vulnerable-used`):

```text
Project: spring-vulnerable-used
State:   COMPLETED

Dependencies:      5   (2 unresolved — not checked)
Vulnerabilities:   1
Critical:          1
High:              0

ID               Severity  CVSS  Dependency                                Fixed
CVE-2022-42889   CRITICAL  9.8   org.apache.commons:commons-text@1.9       1.10.0
```

### 3b — API 계약 + 집계 엔드포인트

| # | 작업 | 파일 |
|---|---|---|
| 6 | DTO 타입을 shared로 이동: `ProjectDto`, `ScanJobDto`, `ProjectDependencyDto`, `VulnerabilityFindingDto`, `ErrorResponseDto` + 새 `ProjectSummaryDto`, `ProjectListItemDto`. api의 `dto/*.ts`는 shared 타입을 import하고 매핑 함수만 남김 | `packages/shared/src/api/*.ts`, `packages/shared/src/index.ts`, `apps/api/src/dto/*.ts` |
| 7 | `GET /api/projects` → `ProjectListItemDto[]` (`latestScan?: { id, state, finishedAt, dependencyCount, vulnerabilityCount, bySeverity }`) | `projects.route.ts` |
| 8 | `GET /api/projects/:projectId/summary` → 최근 스캔이 없으면 `latestScan: null` | `projects.route.ts` |
| 9 | `GET /projects/:id/vulnerabilities`의 findings를 core `compareFindings`로 정렬 | `projects.route.ts` |
| 10 | (정리) 스캔 저장을 하나의 트랜잭션으로 묶을지 검토. 지금은 `scanRepository.save` → `saveDependencies` → `saveFindings`가 따로 실행되어, 중간에 실패하면 대시보드 숫자가 어긋날 수 있음. 포트 변경 폭이 작으면 반영하고, 크면 한계로 기록 | `scans.route.ts`, `persistence/prisma/*` |
| 11 | `app.inject` 테스트: 목록 집계, summary(스캔 전후), 404, 정렬 순서. 기존 시드 방식(`server.test.ts:201`)을 재사용 | `apps/api/src/server.test.ts` |

### 3c — Web 데이터 연동

| # | 작업 | 파일 |
|---|---|---|
| 12 | `apiPost` 추가, 에러 본문(`ErrorResponseDto`)을 `ApiError`에 담기 | `apps/web/src/api/client.ts` |
| 13 | TanStack Query 훅과 쿼리 키 모음: `useProjects`, `useProjectSummary`, `useVulnerabilities`, `useFinding`, `useCreateProject`, `useRunScan` (스캔 성공 시 summary·vulnerabilities·projects 무효화) | `apps/web/src/api/queries.ts` |
| 14 | **Project List**: 표(Project / Last Scan / Dependency Count / Vulnerability Count) + 등록 폼(name, path). 서버의 400 응답(`PATH_NOT_ALLOWED`, `PATH_NOT_FOUND`)을 그대로 표시 | `ProjectListPage.tsx` |
| 15 | **Project Dashboard**: 지표(Dependencies, Vulnerabilities, Critical, High, Used=—, Reachable=—), 스캔 실행 버튼(옵션: allow Maven, OSV 조회), 최근 스캔 상태와 단계 표, coverage, 미확정 의존성 목록. PARTIAL/FAILED면 사유를 눈에 띄게 표시 | `ProjectDashboardPage.tsx` |
| 16 | **Vulnerability List**: CVE(displayId) / Dependency / Version / Severity / CVSS / Fixed / Used / Reachable / Risk Score. 마지막 세 열은 `—` (D7). 행을 누르면 상세로 이동 | `VulnerabilityListPage.tsx` |
| 17 | **Vulnerability Detail**: CVE 메타데이터(별칭, 요약, 심각도 + `severitySource`, CVSS 벡터), Dependency(purl), 현재/fixed 버전, **근거**(provider, queriedAt, affectedRanges 원문), references. Usage/Reachability/Risk/Remediation 섹션은 "아직 분석하지 않음 (Phase N)"으로 표시 | `VulnerabilityDetailPage.tsx` |
| 18 | 순수 포맷 함수(심각도 라벨, 날짜, fixed 없음 → `no fix`)를 분리하고 테스트. `vitest.config.ts`의 include에 `apps/web/src/**/*.test.ts` 추가 | `apps/web/src/format/*.ts` |

웹에는 분석 로직을 넣지 않습니다. 정렬·집계·displayId 선택은 모두 API가 담당합니다 (§12).

### 3d — end-to-end 확인 + 문서

| # | 작업 |
|---|---|
| 19 | `pnpm db:up` → `npx prisma migrate dev` → `pnpm dev:api` + `pnpm dev:web` → 픽스처 등록 → 스캔 → 4개 화면 확인 |
| 20 | README에 웹 실행 방법 추가. `overview-plan.md` §2·§3 갱신, DAILY_LOG 기록 |
| 21 | 정리: 루트의 미커밋 산출물(`result.json`, `sbom.json`, `scratch-sbom.json`)은 커밋하지 않고 삭제. `pnpm-lock.yaml`과 `package-lock.json`이 함께 있으므로 `package-lock.json` 삭제를 제안 (pnpm 워크스페이스) |

---

## 2. 재사용할 기존 코드

- `ScanOrchestrator.run` / `runScan` (`apps/cli/src/commands/runScan.ts`): CLI 실행 경로는 그대로 둡니다
- `addMavenOptions`/`parseMavenOptions`, `addVulnerabilityOptions`/`parseVulnerabilityOptions`: `report`에도 그대로 붙입니다
- `stageNote`, `renderDependencies`, `renderVulnerabilities` (`apps/cli/src/render/text-report.ts`)
- `toVulnerabilityFindingDto`의 displayId 처리: core의 `pickDisplayId`로 교체해 중복을 없앱니다
- `ScanRepository.listByProject` (startedAt 내림차순, `[0]`이 최근 스캔)와 `FindingRepository.listFindings`
- `isWithinScanRoot` (`apps/api/src/lib/scanRoot.ts`): 등록 시 경로 검증은 이미 서버에 있으므로 웹에서 다시 검증하지 않습니다
- vite proxy `/api → 127.0.0.1:3000`: 이미 설정되어 있습니다

---

## 3. 위험 요소

| 위험 | 대응 |
|---|---|
| 동기 스캔(OSV 포함)이 오래 걸려 웹 요청이 타임아웃 | Phase 2의 OSV 전체 시간 상한을 유지. 버튼 pending 표시. 비동기 전환은 실제로 문제가 생기면 검토 |
| DTO 이동 중 API 응답 형태가 바뀜 | 필드는 추가만 합니다. 기존 `server.test.ts` 단언을 그대로 통과해야 합니다 |
| 목록 집계 N+1 | MVP 규모에서는 허용. 한계로 기록하고, 필요해지면 `scan_jobs`에 집계 컬럼을 추가 |
| Used/Reachable 값을 보여줄 수 없음 | `—`와 Phase 안내로 표시. false로 표시하지 않습니다 |

---

## 4. Verification

```text
pnpm typecheck && pnpm test && pnpm build && pnpm lint
node apps/cli/dist/index.js scan fixtures/spring-vulnerable-used            → 요약 블록 + CVE-2022-42889
node apps/cli/dist/index.js report fixtures/spring-vulnerable-used          → 전체 텍스트 리포트
node apps/cli/dist/index.js report fixtures/spring-vulnerable-used --json   → JSON
node apps/cli/dist/index.js scan fixtures/spring-safe-app                   → Vulnerabilities 0, VULNERABILITY SKIPPED
(네트워크 차단) scan                                                         → PARTIAL, 의존성 결과 유지
pnpm db:up && npx prisma migrate dev && pnpm dev:api && pnpm dev:web
  웹: 프로젝트 등록(fixtures/spring-vulnerable-used) → 스캔 → 대시보드 Critical 1
      → 취약점 목록 → 상세(fixed 1.10.0, affectedRanges 근거 표시)
  잘못된 경로 등록 → PATH_NOT_FOUND 메시지 표시
```

## 5. Phase 3 Definition of Done

- [ ] `vulntrace scan`이 Dependencies / Vulnerabilities / Critical / High 요약을 출력
- [ ] `vulntrace report`가 텍스트와 JSON 리포트를 모두 지원
- [ ] 집계·정렬 로직이 core 한 곳에만 있고 CLI와 API가 함께 사용
- [ ] 웹이 shared의 DTO 타입만으로 API를 호출 (Prisma 모델 노출 없음)
- [ ] Project List / Dashboard / Vulnerability List / Detail 화면이 실제 DB 데이터를 표시
- [ ] 웹에서 프로젝트 등록과 스캔 실행이 가능
- [ ] 미확정 의존성 수와 단계 실패 사유가 웹에도 표시
- [ ] Used / Reachable / Risk는 지어낸 값 없이 "미분석"으로 표시

## 범위 밖

소스 사용 분석(Phase 4), 엔드포인트·도달성(5·6), 위험 점수(7), 인증/권한, 페이지네이션, 비동기 스캔 큐, UI 라이브러리 도입.

## 다음 단계

Phase 4 — Java 소스 사용 분석. 착수 전에 "artifact → Java 패키지 매핑 방식"과 "취약 API 정보 출처"를 먼저 결정해야 합니다 (overview-plan §7).
