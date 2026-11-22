# Phase 5 상세 계획 — Spring 엔드포인트 분석

작성일: 2026-11-16
기준 문서: `CLAUDE.md` §6.2, §7 Phase 5, §14, §16, §19 (본 계획보다 우선함)
상위 문서: `overview-plan.md`
선행 문서: `phase-4-source-usage.md`, GitHub 저장소 입력(`887c25e`), API 경유 사용 판정(`c88b96c`)
커밋: `07a385a feat: implement Phase 5 Spring endpoint analysis` (`feat/phase5-spring-endpoints` → `master` fast-forward)

## PLAN

### Goal

애플리케이션의 HTTP 진입점(Spring MVC 엔드포인트)을 **어노테이션 원문과 파일:라인 근거와 함께** 찾습니다.
Phase 6 도달 가능성 분석은 이 엔드포인트의 핸들러 메서드에서 출발합니다.

### Current phase

Phase 5 (Phase 0~4와 GitHub 저장소 입력 완료). 도달 가능성(Phase 6)과 위험도(Phase 7)는 구현하지 않습니다.

### Affected modules

| 모듈 | 변경 |
|---|---|
| `packages/shared` | `SpringEndpoint` 확장(`EndpointHttpMethod`, `unresolved`, `evidence`), `HttpMethod`에 `TRACE` 추가, `SpringEndpointDto`/`ProjectEndpointsDto`, summary DTO에 `endpoints` |
| `packages/source-analyzer` | `tokenizeJava`를 패키지 밖으로 export (어노테이션 인자 파싱에 재사용) |
| `packages/spring-analyzer` | 스텁 → `SpringEndpointAnalyzer`, `annotationArguments`, `annotations`(import 기반 해석) 구현 |
| `packages/core` | `ScanOrchestrator`에 `SPRING_ENDPOINT` 단계, `ScanReport.endpoints`, `EndpointRepository` 포트 |
| `prisma/` | `phase5_spring_endpoints` 마이그레이션 |
| `apps/api` | `PrismaEndpointRepository`, 스캔 시 엔드포인트 저장, `GET /projects/:id/endpoints`, summary에 엔드포인트 수 |
| `apps/cli` | `endpoints` 명령, `scan` 요약의 `Endpoints:` 줄, `report`의 엔드포인트 섹션 |
| `apps/web` | 대시보드 `Spring Endpoints` 카드, 엔드포인트 목록 화면 |

### Current behavior

`SpringEndpointAnalyzer.analyze`가 `NotImplementedError`를 던지고, `SPRING_ENDPOINT` 단계는 `SKIPPED (not implemented (Phase 5))`.
`spring_endpoints` 테이블은 `init` 마이그레이션에 있었지만 쓰이지 않았습니다.

### Target behavior

```text
spring-vulnerable-reachable → GET  /api/hello             → HelloController.hello
                              POST /api/templates/render  → TemplateController.render
그 밖의 픽스처 3종           → GET  /api/hello             → HelloController.hello
```

## 0. 결정 사항

| # | 항목 | 결정 |
|---|---|---|
| D1 | 입력 | Phase 4 `JavaAnalysisResult`(이미 파싱된 파일)를 그대로 씁니다. 파서가 이미 타입·메서드의 어노테이션과 인자 원문(`rawArguments`)을 남기고 있어서 파일을 다시 읽지 않습니다. 그래서 `SPRING_ENDPOINT`는 `SOURCE_USAGE`가 성공했을 때만 실행됩니다 |
| D2 | 어노테이션 인자 | 인자 원문을 `tokenizeJava`로 다시 토큰화해 파싱합니다(정규식 단독 금지, §14). 단일 값 → `value`, `{a, b}` 배열, `name = value` 쌍, 문자열 리터럴의 `+` 연결과 이스케이프를 처리합니다 |
| D3 | Spring 어노테이션 판별 | 이름만 보지 않고 import로 확인합니다. 단일 import, 와일드카드 import, 완전한 이름(`@org.springframework...GetMapping`)만 인정합니다. `com.acme.web.RestController` 같은 동명 어노테이션은 무시합니다 |
| D4 | 컨트롤러 | `@RestController`(`org.springframework.web.bind.annotation`), `@Controller`(`org.springframework.stereotype`)가 붙은 `class`만 봅니다. 컨트롤러 어노테이션 없이 `@RequestMapping`만 있는 클래스는 Spring 6 동작에 맞춰 제외합니다. 중첩 클래스는 자기 이름(`Outer.Inner`)으로 처리합니다 |
| D5 | 경로 결합 | 클래스 경로 × 메서드 경로의 모든 조합. `/`로 시작하도록 맞추고 중복 `/`를 합칩니다(`api` + `render` → `/api/render`, `/api` + `` → `/api`, 둘 다 없으면 `/`) |
| D6 | HTTP 메서드 | `@GetMapping` 등은 고정. `@RequestMapping`은 `method` 속성(`RequestMethod.X`, 완전한 이름, static import한 `X`)을 읽습니다. 클래스와 메서드 수준 조건은 Spring처럼 합집합이고, 조건이 하나도 없으면 `ANY`(모든 메서드 허용)로 표시합니다. 메서드×경로 조합마다 엔드포인트 1개 |
| D7 | 계산할 수 없는 값 | 상수(`ApiPaths.USERS`) 등 리터럴이 아닌 값은 추측하지 않습니다. 경로에는 `${ApiPaths.USERS}`처럼 식을 그대로 두고, 식 원문을 `unresolved` 배열에 기록합니다. 해석 못 한 `method` 값도 `unresolved`에 넣고 `ANY`로 둡니다(노출 면을 숨기지 않는 쪽) |
| D8 | 매핑 어노테이션이 여러 개 | Spring의 merged annotation 탐색처럼 **직접 붙은 `@RequestMapping`을 단축 어노테이션보다 우선**하고, 그 외에는 첫 번째를 씁니다. 어느 쪽을 썼는지 경고로 남깁니다 |
| D9 | 증거 (§6.2) | 엔드포인트마다 컨트롤러 어노테이션, 클래스 `@RequestMapping`(있을 때), 메서드 매핑 어노테이션의 원문(여러 줄은 한 줄로 접음)과 위치를 `evidence`로 저장합니다. `location`은 핸들러 메서드 선언 위치입니다 |
| D10 | 테스트 소스 | `src/test/java`는 서비스되지 않으므로 제외합니다 |
| D11 | 단계 상태 (§19) | Java 분석 결과가 없으면 `SKIPPED (Java source analysis not available)`, 분석기가 예외를 던지면 `FAILED`이고 앞 단계 결과는 유지(`PARTIAL`). "엔드포인트 0개"와 "분석 안 됨"을 구분해 CLI는 `unavailable (...)`, API summary는 `null`, 웹은 `—`로 표시합니다 |
| D12 | 저장 | 기존 `spring_endpoints`에 `column`, `unresolved`(JSON), `evidence`(JSON) 열과 `scan_id` 인덱스를 추가합니다. 저장·조회는 새 포트 `EndpointRepository`(finding 저장소와 분리)를 거칩니다 |
| D13 | 보안 (§16) | 소스를 읽기만 합니다. 애플리케이션 코드를 로드하거나 실행하지 않고, Maven·OSV도 필요 없습니다(`vulntrace endpoints`는 둘 다 끈 채 실행) |

## 1. 작업 순서

1. shared 타입/DTO 확장
2. spring-analyzer: `parseAnnotationArguments` → 어노테이션 해석(`annotations.ts`) → `SpringEndpointAnalyzer`
3. core: `SPRING_ENDPOINT` 단계, `[SPRING]` 로그, `ScanReport.endpoints`, `EndpointRepository` 포트
4. prisma 마이그레이션 + `PrismaEndpointRepository`
5. API: 스캔 시 저장, `GET /projects/:id/endpoints`, summary의 `endpoints`
6. CLI: `endpoints` 명령, 요약 줄, `report` 섹션
7. Web: 대시보드 카드, 엔드포인트 목록 화면
8. 테스트: 인자 파싱, 경로 결합, 분석기(합성 소스 + 픽스처), orchestrator, CLI 렌더러, API inject

## Risks

- 어노테이션만 보는 방식이라 인터페이스 상속 매핑, 합성 어노테이션, 함수형 라우팅을 놓칠 수 있음 → 한계를 README와 이 문서에 명시
- 상수 경로를 풀지 않아 실제 경로를 모를 수 있음 → 값을 지어내지 않고 `unresolved`로 노출

## Verification

`pnpm typecheck` / `pnpm test` / `pnpm build` / `pnpm lint`, 픽스처 기대값, 실제 PostgreSQL에 마이그레이션 적용, API + 웹 화면 확인, 실제 저장소의 매핑 어노테이션과 1:1 대조.

## VERIFY (2026-11-16)

### Phase 5 Definition of Done

- [x] `@RestController` / `@Controller` 클래스와 `@RequestMapping` / `@GetMapping` / `@PostMapping` / `@PutMapping` / `@DeleteMapping` / `@PatchMapping` 탐지 (import로 Spring 어노테이션인지 확인)
- [x] HTTP Method, Path, Controller Class, Controller Method, 파일:라인 추출
- [x] 클래스 + 메서드 경로 결합, `value`/`path` 속성, 배열 경로, `method=` 속성(`RequestMethod.X`, static import) 처리
- [x] 어노테이션 원문과 위치를 증거로 저장, 계산 못 한 값은 `unresolved`로 노출
- [x] `SPRING_ENDPOINT` 단계가 `ScanOrchestrator`에 연결되고, 실패해도 이전 단계 결과를 보존(`PARTIAL`)
- [x] `spring_endpoints` 저장 (`phase5_spring_endpoints` 마이그레이션)
- [x] API: `GET /api/projects/:projectId/endpoints`, summary에 `endpoints`
- [x] CLI: `vulntrace endpoints`, `scan` 요약 `Endpoints:`, `report` 엔드포인트 섹션
- [x] Web: 대시보드 `Spring Endpoints`, 엔드포인트 목록 화면
- [x] 완료 기준: `spring-vulnerable-reachable`에서 `POST /api/templates/render → TemplateController.render` 추출

### 확인 결과

- `pnpm typecheck` / `pnpm test`(382개, 이번에 32개 추가) / `pnpm build`(web 포함) / `pnpm lint` 통과
- 픽스처 (`vulntrace endpoints`):

```text
spring-vulnerable-reachable → GET  /api/hello             HelloController.java:10
                              POST /api/templates/render  TemplateController.java:19
spring-safe-app / spring-vulnerable-unused / spring-vulnerable-used → GET /api/hello
```

- 실제 PostgreSQL: Docker Desktop을 켜고 `pnpm db:up` → `prisma migrate deploy`로 마이그레이션 5개 적용, `prisma migrate diff`(DB ↔ 스키마) 결과 "No difference detected"
- API + 브라우저: `spring-vulnerable-reachable` 등록·스캔 후 `SPRING_ENDPOINT SUCCEEDED`, `GET /endpoints`에 엔드포인트 2개와 증거. 대시보드 `Spring Endpoints 2`, 목록 화면에 Method / Path / Controller / Handler / Source / Mapping 표시. 콘솔 에러 없음
- 실제 저장소 (`vulntrace endpoints <GitHub URL>`):
  - spring-petclinic: 엔드포인트 17개, 메서드 수준 매핑 어노테이션 17개와 1:1 일치. 경로와 GET/POST 구분이 실제 컨트롤러와 같음
  - java-sec-code: 엔드포인트 133개(`ANY` 37개, `unresolved` 0개). 매핑 어노테이션 134곳을 대조해 엔드포인트가 없는 2곳을 확인했고 둘 다 의도한 결과
    - `ClassDataLoader`: 컨트롤러 어노테이션이 없어 Spring이 등록하지 않는 클래스
    - `Cors.vuls3`: `@GetMapping("*")`와 `@RequestMapping("/vuln/crossOrigin")`가 함께 붙음

### 검증 중 고친 문제

- 문제: `Cors.vuls3`처럼 매핑 어노테이션이 둘이면 앞의 `@GetMapping("*")`를 골라 `GET /cors/*`로 보고함
  - 원인: "첫 번째 어노테이션 사용" 규칙. Spring의 merged annotation 탐색은 직접 붙은 `@RequestMapping`을 메타 어노테이션으로만 가진 단축 어노테이션보다 먼저 찾음
  - 해결: 직접 붙은 `@RequestMapping` 우선(D8), 경고에 실제로 쓴 어노테이션 표기, 회귀 테스트 추가 → `ANY /cors/vuln/crossOrigin`
- 문제: 마이그레이션 확인 스크립트가 끝나지 않음
  - 원인: `prisma migrate status`는 적용 안 된 마이그레이션이 있으면 0이 아닌 코드로 끝나서, 성공할 때까지 기다리는 루프가 끝나지 않음
  - 해결: 작업을 멈추고 `migrate deploy`를 바로 실행

### 알려진 한계

- 경로 값은 문자열 리터럴과 리터럴끼리의 `+` 연결만 계산. 상수는 같은 파일에 있어도 풀지 않음(`unresolved`)
- `server.servlet.context-path`, `spring.mvc.servlet.path` 같은 설정 파일 접두사 미적용
- 인터페이스·상위 클래스에 선언된 매핑(OpenAPI generator `*Api` 인터페이스 등), 사용자 합성 어노테이션, `RouterFunction`·WebFlux 함수형 엔드포인트, Spring Data REST, Actuator 미탐지
- Spring 5 이하에서 컨트롤러 어노테이션 없이 클래스 수준 `@RequestMapping`만으로 등록되던 핸들러는 놓칠 수 있음
- `params` / `headers` / `consumes` / `produces` 조건과 인증 요구(`@PreAuthorize`, Spring Security 설정)는 아직 보지 않음 → Phase 7 위험도 입력("authentication requirement")에서 다룰 예정
- 같은 이름으로 오버로드된 핸들러는 `controllerMethod` 이름만으로는 구분되지 않음(위치로 구분)
- 웹 엔드포인트 목록은 Mapping 열이 넓어 좁은 화면에서 가로 스크롤이 생김

## 다음 작업

Phase 6 — 도달 가능성 분석. `SpringEndpoint.controllerClass#controllerMethod`(+ `location`)에서 출발해 Phase 4 사용 증거 위치까지 호출 경로를 찾고, `reachability_paths`(이미 `spring_endpoints.id`를 참조)에 저장합니다.
