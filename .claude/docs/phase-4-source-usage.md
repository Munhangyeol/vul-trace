# Phase 4 상세 계획 — Java 소스 사용 분석

작성일: 2026-10-04
기준 문서: `CLAUDE.md` §5 Stage A, §6.2, §7 Phase 4, §14, §16, §17 (본 계획보다 우선함)
상위 문서: `overview-plan.md`
선행 문서: `phase-3-dashboard-cli.md` (커밋 `7a11c4d`)

## PLAN
    
### Goal

취약 의존성마다 "애플리케이션 소스가 실제로 쓰는가"를 **파일:라인 증거와 함께** 판단합니다.
Phase 4가 끝나면 MVP 1(§23 1~12항)이 end-to-end로 동작합니다.

### Current phase

Phase 4 (Phase 0~3 완료). 도달성(Phase 6)과 엔드포인트(Phase 5)는 구현하지 않습니다.

### Affected modules

| 모듈 | 변경 |
|---|---|
| `packages/shared` | `SourceUsage`에 `sourceSet`·`vulnerableApi` 추가, `FindingUsage` 타입, `VulnerabilityFinding.usage?`, DTO 확장 |
| `packages/source-analyzer` | 토크나이저, 경량 파서, 파일 탐색, 패키지 매핑표, 취약 API 목록, `matchDependencyUsages`, `assessFindingUsage` |
| `packages/core` | `ScanOrchestrator`에 `SOURCE_USAGE` 단계 연결, `summarizeScan`에 `usedVulnerabilities` |
| `prisma/` | `phase4_source_usage` 마이그레이션 |
| `apps/api` | finding 저장/조회에 사용 증거 포함, `GET /findings/:id/usages` 구현, summary에 used 수 |
| `apps/cli` | 취약점 표에 `Used`/`API` 열, `report`에 사용 증거 섹션 |
| `apps/web` | 목록 `Used` 열, 상세 `Usage evidence` 섹션, 대시보드 `Used Vulnerabilities` |

### Current behavior

`SOURCE_USAGE` 단계는 `SKIPPED (not implemented)`. `LightweightJavaSourceAnalyzer`는 `NotImplementedError`를 던집니다.

### Target behavior

```text
spring-vulnerable-unused    → used=false
spring-vulnerable-used      → used=true, vulnerable API=USED (TemplateService.java:14)
spring-vulnerable-reachable → used=true, vulnerable API=USED (TemplateService.java:14)
```

## 0. 결정 사항

| # | 항목 | 결정 |
|---|---|---|
| D1 | Java 파서 | 새 의존성 없이 **토크나이저 기반 경량 파서**를 직접 작성합니다 (§14 "정규식 단독 금지"). 주석·문자열·텍스트 블록을 토큰 단계에서 걸러내므로 주석 안의 `import`나 문자열 안의 클래스 이름은 증거가 되지 않습니다. `JavaSourceAnalyzer` 인터페이스 뒤에 두어 Stage B로 바꿔도 호출부는 그대로입니다 |
| D2 | artifact → Java 패키지 매핑 | ① 수동 매핑표(`artifactPackages.ts`, 확실한 라이브러리만) ② 없으면 `groupId`를 패키지 접두사로 추정. 어느 쪽인지 `basis: 'CURATED' \| 'GROUP_ID'`로 결과에 남깁니다. 여러 의존성이 겹치면 가장 긴 접두사가 이깁니다. JAR 인덱싱은 이후 검토 |
| D3 | 취약 API 정보 출처 | 녹화된 OSV 응답(`GHSA-599f-7c49-w659.json`)에 Maven용 함수 단위 필드(`ecosystem_specific` 등)가 없음을 확인했습니다. 그래서 **직접 정리한 목록**(`vulnerableApis.ts`, 취약점 id/별칭 기준)을 씁니다. 목록에 없는 취약점은 `NO_API_INFO`로 표시하고 추측하지 않습니다 |
| D4 | 판정 단계 | `used`(main 소스에 사용 증거 있음, boolean)와 `vulnerableApi`(`USED` / `NOT_DETECTED` / `NO_API_INFO`)를 분리합니다. 정적 분석 한계 때문에 "취약 API를 안 쓴다"고 단정하지 않고 `NOT_DETECTED`라고 씁니다 |
| D5 | 테스트 소스 | `src/test/java` 사용도 증거로 저장하되 `sourceSet: 'TEST'`로 구분하고, `used` 판정에는 넣지 않습니다 |
| D6 | 저장 위치 | 사용 증거는 기존 `source_usages`(finding 단위)에 저장합니다. 판정과 매핑 근거는 `project_vulnerabilities`에 `used`, `vulnerable_api_status`, `usage_analysis`(JSON) 열로 추가합니다. 값이 `null`이면 "분석 안 됨"이고 `false`와 구분됩니다 |
| D7 | 단계 실패 | 소스 분석이 실패해도 의존성·취약점 결과는 보존하고 `SOURCE_USAGE FAILED` → `PARTIAL` (§19). 개별 파일 실패(크기 초과, 읽기 실패)는 경고로 남기고 계속 진행합니다 |
| D8 | 보안 (§16) | 소스는 읽기만 합니다. 심볼릭 링크는 따라가지 않고, 숨김 폴더·`target`·`node_modules`는 건너뜁니다. 파일 수(20,000)와 파일 크기(1 MiB)에 상한을 둡니다 |

## 1. 사용 판정 규칙 (Stage A)

| UsageKind | 감지 대상 | 예 |
|---|---|---|
| `IMPORT` | 일반/static/와일드카드 import가 의존성 패키지에 속함 | `import org.apache.commons.text.StringSubstitutor;` |
| `PACKAGE_REFERENCE` | import 없이 패키지 경로로 쓴 완전한 이름 | `org.apache.commons.text.StringSubstitutor.class` |
| `OBJECT_CONSTRUCTION` | `new T(...)`에서 `T`가 의존성 타입으로 해석됨 | `new StringSubstitutor(map)` |
| `METHOD_CALL` | `T.m(...)`(정적 호출), 선언 타입이 의존성 타입인 변수의 `v.m(...)`, static import한 `m(...)`, `T::m` | `StringSubstitutor.createInterpolator()` |

타입 이름 해석 순서: 같은 파일에 선언된 타입(→ 프로젝트 코드) → 단일 import → 와일드카드 import(의존성 패키지일 때만) → 패키지 경로로 쓴 완전한 이름.

알려진 한계 (결과에 "Stage A" 범위로 문서화):

- 반환값 체인의 수신 타입(`a().b()`)은 추적하지 않습니다
- `var` 추론은 `var x = new T(...)`만 처리합니다
- 변수 이름의 스코프는 파일 단위로 단순화합니다 (같은 이름이 서로 다른 타입이면 해석하지 않음)
- 리플렉션, 상속받은 메서드, `Type.FIELD.m()`(예: `StringLookupFactory.INSTANCE.xxx()`)의 수신 타입은 알 수 없음 → 취약 API가 `NOT_DETECTED`로 나올 수 있음
- `GROUP_ID` 추정 매핑은 같은 groupId를 쓰는 다른 artifact와 구분하지 못할 수 있음 (근거에 표시)

## 2. 작업 순서

1. shared 타입 확장
2. source-analyzer: `JavaTokenizer` → `LightweightJavaParser` → `JavaFileScanner` → `LightweightJavaSourceAnalyzer`
3. source-analyzer: `artifactPackages`, `vulnerableApis`, `matchDependencyUsages`, `assessFindingUsage`
4. core: `SOURCE_USAGE` 단계, 로그 `[SOURCE]`, `summarizeScan.usedVulnerabilities`
5. prisma 마이그레이션 + `PrismaFindingRepository`
6. API: DTO, `/findings/:id/usages`, summary
7. CLI 렌더러, Web 화면
8. 테스트: 토크나이저/파서/매칭/판정 단위 테스트, 픽스처 Case A/B/C, orchestrator, CLI 렌더러, API inject

## Risks

- TS 경량 파서의 정밀도 → 한계를 결과와 문서에 명시, 필요 시 Stage B
- 수동 목록(매핑표·취약 API)의 유지 비용과 누락 → 근거(`basis`, `NO_API_INFO`)를 숨기지 않음

## Verification

`pnpm typecheck` / `pnpm test` / `pnpm build`, 픽스처 3종 기대값, `vulntrace report fixtures/spring-vulnerable-used` 출력, API + 웹에서 사용 증거 표시 확인.

## VERIFY (2026-10-17)

### Phase 4 Definition of Done

- [x] Java 파일 탐색에서 main/test 소스를 구분하고, 심볼릭 링크·숨김 폴더·`target`·`node_modules`는 건너뜀
- [x] 토크나이저 기반 경량 파서로 package / import / 타입 선언 / `new` / 메서드 호출 추출 (주석·문자열 안의 이름은 증거가 되지 않음)
- [x] 의존성 → 패키지 매핑에 근거(`CURATED` / `GROUP_ID`)를 함께 저장
- [x] finding마다 `used`와 `vulnerableApi`(`USED` / `NOT_DETECTED` / `NO_API_INFO`)를 분리해 판정하고 파일:라인 증거를 저장
- [x] `SOURCE_USAGE` 단계가 `ScanOrchestrator`에 연결되고, 실패해도 이전 단계 결과를 보존(`PARTIAL`)
- [x] `source_usages`와 `project_vulnerabilities`의 판정 열 저장 (`phase4_source_usage` 마이그레이션)
- [x] API: finding DTO에 사용 요약, `GET /findings/:id/usages`, summary에 `usedVulnerabilities`
- [x] CLI: 요약에 `Used by source`, 취약점 표에 `Used`/`Vuln API` 열, `report`에 사용 증거 섹션
- [x] Web: 목록 `Used` 열, 상세 `Usage evidence` 섹션, 대시보드 `Used Vulnerabilities`

### 확인 결과

- `pnpm typecheck` / `pnpm test`(238개) / `pnpm build` 통과
- 픽스처 (`vulntrace report`, `--allow-maven` 없이):

```text
spring-safe-app             → 취약점 0
spring-vulnerable-unused    → used=false, vulnerable API=NOT_DETECTED
spring-vulnerable-used      → used=true,  vulnerable API=USED (TemplateService.java:14 StringSubstitutor#createInterpolator)
spring-vulnerable-reachable → used=true,  vulnerable API=USED
```

- 실제 PostgreSQL(마이그레이션 3개 적용) + 브라우저: 대시보드 "Run scan" 후 `SOURCE_USAGE SUCCEEDED`, `Used Vulnerabilities 1`. 목록에서 CVE-2022-42889만 `Yes (vulnerable API used)`, 상세 화면에 `TemplateService.java:3/14/15` 증거 표시. Phase 4 이전 스캔은 `—`(미분석)로 표시. 콘솔 에러 없음

### 알려진 한계

- §1의 Stage A 한계 그대로 (반환값 체인, 상속 메서드, 리플렉션, `Type.FIELD.m()` 미추적 → `NOT_DETECTED` 가능)
- 취약 API 목록은 현재 CVE-2022-42889 하나뿐. 나머지 취약점은 `NO_API_INFO`
- CLI `report`의 사용 증거 섹션은 사용되지 않은 finding도 매핑 근거와 함께 모두 출력해 길어질 수 있음
- 웹 상세 화면의 사용 증거 표는 Snippet 열이 넓어 가로 스크롤이 생김 (디자인 최소화 원칙으로 보류)
