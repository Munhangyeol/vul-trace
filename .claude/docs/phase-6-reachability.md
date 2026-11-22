# Phase 6 상세 계획 — 도달 가능성(Reachability) 분석

작성일: 2026-11-22
기준 문서: `CLAUDE.md` §5, §6.2, §7 Phase 6, §14, §16, §17, §19 (본 계획보다 우선함)
상위 문서: `overview-plan.md`
선행 문서: `phase-4-source-usage.md`, `phase-5-spring-endpoints.md`
상태: **구현 완료, 브라우저 화면 확인 남음** (아래 VERIFY)

## PLAN

### Goal

취약 API 사용 지점마다 "외부 HTTP 요청이 거기까지 닿는가"를 판정합니다.
결론만 남기지 않고 **엔드포인트 → 핸들러 → … → 취약 API 호출 위치**까지의 경로를 단계마다 파일:라인과 함께 저장합니다(§6.2).

CLAUDE.md §7이 요구하는 네 단계를 Finding마다 따로 보여 줍니다.

```text
dependency exists       → Phase 1~2 (pom.xml / dependency:tree)
dependency is used      → Phase 4 FindingUsage.used
vulnerable API is used  → Phase 4 FindingUsage.vulnerableApi = USED
vulnerable API reachable→ Phase 6 (이 문서)
```

### Current phase

Phase 6 (Phase 0~5와 GitHub 저장소 입력 완료). 위험 점수(Phase 7)와 조치 안내(Phase 8)는 구현하지 않습니다.

### Affected modules

| 모듈 | 변경 |
|---|---|
| `packages/source-analyzer` | `LightweightJavaParser`가 메서드 본문 범위, 매개변수, 생성자, 필드, `extends`/`implements`를 기록하고, 호출·객체 생성·변수 선언에 **감싸는 메서드**를 붙임. 기존 필드는 그대로 두고 항목만 추가 |
| `packages/shared` | `ReachabilityResult` 확장(상태, 분석 범위, 경로 단계 증거), `FindingReachabilityDto`, summary DTO의 `reachableVulnerabilities` |
| `packages/reachability` | 스텁 → `CallGraphBuilder`(타입 해석 + 호출 연결), `ReachabilityAnalyzer`(BFS 경로 탐색) 구현 |
| `packages/core` | `ScanOrchestrator`의 `REACHABILITY` 단계, `[REACHABILITY]` 로그, `Finding.reachability`, `summarizeScan`의 도달 집계 |
| `prisma/` | `phase6_reachability` 마이그레이션 (`reachability_paths` 열 추가, `project_vulnerabilities`에 도달 상태) |
| `apps/api` | 스캔 시 경로 저장, `GET /api/findings/:id/reachability`, summary의 `reachableVulnerabilities` |
| `apps/cli` | 취약점 표의 `Reachable` 열, `report`의 도달 경로 섹션, 요약의 `Reachable:` 줄 |
| `apps/web` | 목록 `Reachable` 열, 상세 `Reachability path` 섹션, 대시보드 `Reachable Vulnerabilities` 카드 (지금은 모두 `—`) |

### Current behavior

- `ReachabilityAnalyzer.analyze`가 `NotImplementedError`를 던지고, `REACHABILITY` 단계는 `SKIPPED (not implemented (Phase 6))`입니다.
- 파서는 호출(`invocations`)을 **파일 단위로만** 모읍니다. 어느 메서드 안의 호출인지, 변수가 필드인지 지역 변수인지 구분하지 않습니다. 그래서 지금 상태로는 호출 그래프를 만들 수 없습니다.
- `methods`, `method_calls`, `reachability_paths` 테이블은 `init` 마이그레이션에 있지만 쓰이지 않습니다.

### Target behavior

```text
spring-vulnerable-unused    → reachability = NO_VULNERABLE_API_USAGE (used=false)
spring-vulnerable-used      → reachability = NOT_REACHABLE          (used=true, 경로 없음)
spring-vulnerable-reachable → reachability = REACHABLE
    POST /api/templates/render
    → TemplateController.render      (TemplateController.java:20  templateService.render(template))
    → TemplateService.render         (TemplateService.java:14     StringSubstitutor.createInterpolator())
    → StringSubstitutor#createInterpolator
spring-safe-app             → commons-text finding 없음
```

## 0. 결정 사항

| # | 항목 | 결정 |
|---|---|---|
| D1 | 분석 방식 | Stage A(TypeScript만 사용)를 유지합니다. Phase 4의 `JavaAnalysisResult`를 입력으로 쓰고 파일을 다시 읽지 않습니다. Stage B(Java Analyzer Adapter) 도입은 D13의 측정 결과를 보고 따로 정합니다 |
| D2 | 파서 확장 | `JavaMethod`에 `parameters`(타입·이름), `bodyRange`(시작/끝 줄), `isConstructor`, 매개변수 개수를 추가합니다. `JavaType`에 `fields`, `superclass`, `interfaces`를 추가합니다. 호출·객체 생성·변수 선언에는 `enclosingMethod`(타입 + 메서드 인덱스)를 붙입니다. 기존 필드의 의미는 바꾸지 않아 Phase 4·5 결과가 그대로여야 합니다(기존 테스트로 확인) |
| D3 | 메서드 식별 | `패키지.클래스#메서드(매개변수 개수)`. 같은 이름·같은 개수의 오버로드는 구분하지 않고 모두 연결하며, 이 경우 간선에 `AMBIGUOUS_OVERLOAD`를 표시합니다(놓치기보다 과하게 잡는 쪽) |
| D4 | 타입 이름 해석 | 단순 이름 → 단일 import → 같은 패키지 → 중첩 클래스 → 와일드카드 import 순서. 프로젝트 소스(MAIN)에 있는 타입만 그래프 노드가 되고, 라이브러리 타입은 노드가 되지 않습니다 |
| D5 | 호출 연결 규칙 | 지원: `m()`·`this.m()` → 같은 클래스(없으면 프로젝트 안의 상위 클래스), `field.m()`·`this.field.m()` → 필드 타입, `param.m()`·`local.m()` → 같은 메서드 안의 선언 타입, `Type.m()` → 정적 호출, `new T(...)` → `T`의 생성자. 미지원: 체인 호출(`a().b()`), 리플렉션, 람다·메서드 참조의 실제 실행 시점, AOP 프록시, 이벤트·스케줄러 |
| D6 | 인터페이스 호출 | Spring 서비스는 `UserService` 인터페이스 + `UserServiceImpl` 구현이 흔합니다. 수신 타입이 프로젝트 인터페이스(또는 추상 클래스)이면 **프로젝트 안의 모든 구현 클래스**에 연결하고 간선에 `INTERFACE_DISPATCH`를 표시합니다(CHA). 구현이 여러 개면 실제로는 하나만 주입될 수 있다는 점을 증거에 남깁니다 |
| D7 | 람다 안의 호출 | 람다 본문의 호출은 감싸는 메서드의 호출로 봅니다. 람다가 실제로 실행되는지는 판단하지 않고, 이 점을 한계로 기록합니다 |
| D8 | 도달 대상(sink) | MAIN 소스의 `vulnerableApi=true` 사용(`METHOD_CALL`·`OBJECT_CONSTRUCTION`)을 줄 범위로 감싸는 메서드에 붙입니다. 필드 초기화식·static 블록처럼 메서드 밖의 사용은 해당 클래스의 생성자(또는 `<clinit>`) 노드에 붙이고 그렇게 붙였다고 표시합니다. `IMPORT` 사용은 위치가 메서드 밖이라 대상이 아닙니다 |
| D9 | 판정 상태 | `REACHABLE` (경로 1개 이상) / `NOT_REACHABLE` (취약 API 사용은 있으나 경로를 찾지 못함 — **없다는 증명이 아님**) / `NO_VULNERABLE_API_USAGE` (Phase 4 결과가 `NOT_DETECTED`) / `NO_API_INFO` (취약 API 정보 없음) / `NOT_ANALYZED` (단계가 실행되지 않음). 웹·CLI의 `Reachable` 열은 `yes` / `no` / `—`로 줄여 보여 주고, 상세에서 상태 이름과 이유를 보여 줍니다 |
| D10 | 경로 탐색 | 엔드포인트 핸들러마다 BFS로 가장 짧은 경로를 찾습니다. 방문 집합으로 순환을 막고, 깊이는 30단계, Finding당 저장하는 경로는 최대 20개(엔드포인트 × 사용 지점 조합당 1개)로 제한합니다. 잘린 경우 전체 개수와 함께 `truncated`를 기록합니다 |
| D11 | 경로 증거 (§6.2) | 단계마다 메서드(클래스·이름·선언 위치), 다음 단계를 부르는 호출 위치(파일:라인 + 소스 한 줄), 연결 근거(`DIRECT` / `INTERFACE_DISPATCH` / `AMBIGUOUS_OVERLOAD` / `ATTRIBUTED_TO_INITIALIZER`)를 저장합니다. 마지막 단계는 Phase 4의 `SourceUsage`를 가리킵니다 |
| D12 | 분석 범위 표기 | `NOT_REACHABLE`을 과신하지 않도록, 엔드포인트에서 출발해 방문한 메서드 안의 **해석하지 못한 호출 개수**(체인 호출, 타입 모름 등)를 Finding마다 남깁니다. 미지원 기능 목록(D5·D7)은 결과에 고정 문구로 붙입니다 |
| D13 | Stage B 판단 기준 | 구현 후 spring-petclinic, java-sec-code에서 "방문한 메서드의 호출 중 해석 못 한 비율"을 잽니다. 이 비율과 수작업 대조에서 놓친 경로를 보고 Stage B 필요 여부를 VERIFY 절에 기록합니다. 이번 Phase에서 Stage B를 구현하지는 않습니다 |
| D14 | 저장 | `reachability_paths`에 `source_usage_id`(대상 사용 지점)를 추가하고, `steps` JSON에 D11의 단계 증거를 넣습니다. `project_vulnerabilities`에 `reachability_status`와 `reachability_scope`(JSON, D12)를 추가합니다. 전체 호출 그래프(`methods`/`method_calls`)는 크기가 커서 이번에는 저장하지 않고, 노드·간선·미해석 호출 수만 단계 결과에 기록합니다. 그래프 저장은 화면에서 필요해질 때 추가합니다 |
| D15 | 단계 상태 (§19) | `SOURCE_USAGE`와 `SPRING_ENDPOINT`가 모두 성공해야 실행합니다. 하나라도 없으면 `SKIPPED (...)`, 분석기가 예외를 던지면 `FAILED`이고 앞 단계 결과는 유지(`PARTIAL`). 엔드포인트가 0개면 단계는 성공이고 사용 지점이 있는 Finding은 `NOT_REACHABLE (no endpoints)` |
| D16 | 보안 (§16) | 소스를 읽기만 합니다. 애플리케이션 코드를 로드·실행하지 않고, Maven·OSV를 추가로 부르지 않습니다 |

## 1. 작업 순서

1. **파서 확장** (`source-analyzer`) — D2. 메서드 본문 범위·매개변수·생성자·필드·상속 정보, `enclosingMethod`. 기존 파서 테스트 + Phase 4/5 테스트가 그대로 통과하는지 먼저 확인
2. **shared 타입/DTO** — `ReachabilityStatus`, `CallPathStep` 증거 확장(호출 위치 snippet, 연결 근거), `ReachabilityScope`, `FindingReachabilityDto`, summary의 `reachableVulnerabilities`
3. **`CallGraphBuilder`** (`reachability`) — D3~D7. 타입 색인(이름 → 타입, 인터페이스 → 구현), 메서드 노드, 호출 간선, 미해석 호출 목록
4. **`ReachabilityAnalyzer`** — D8~D12. sink 연결, BFS, 경로 증거 조립, 상태 판정
5. **core** — `REACHABILITY` 단계, `[REACHABILITY] N reachable findings` 로그, `Finding.reachability`, `summarizeScan` 집계
6. **prisma 마이그레이션 + 저장소** — D14. `FindingRepository`에 경로 저장·조회 추가
7. **API** — 스캔 시 저장, `GET /api/findings/:id/reachability`, summary
8. **CLI** — `Reachable` 열, `report` 경로 섹션(`--json` 포함), 요약 줄
9. **Web** — 목록 열, 상세 경로 섹션(단계별 파일:라인), 대시보드 카드
10. **테스트** — 아래 Verification

## Risks

- **파서 확장이 Phase 4 결과를 바꿀 위험** → 기존 필드는 건드리지 않고 항목만 추가. 픽스처 3종과 실제 저장소의 Phase 4 결과(사용 증거 수)를 변경 전후로 비교
- **놓친 경로 (false negative)** — 체인 호출, 빌더 패턴, `@Autowired` 없는 동적 조회, 이벤트 리스너 → `NOT_REACHABLE`을 "경로 못 찾음"으로 표기하고 미해석 호출 수를 함께 보여 줌(D9, D12)
- **과한 경로 (false positive)** — CHA로 모든 구현에 연결, 오버로드 미구분, 람다 → 간선마다 근거를 표시해 사람이 판단할 수 있게 함(D6, D11)
- **큰 저장소에서의 성능** — 엔드포인트 수 × 그래프 크기 BFS. 엔드포인트별 BFS 결과를 Finding 사이에 재사용하고, java-sec-code(엔드포인트 133개)로 시간을 잼
- **Spring 특유의 간접 호출** — `@Async`, `@EventListener`, 필터·인터셉터, `@ControllerAdvice` 진입점은 이번 범위 밖. 한계로 명시

## Verification

### 단위 테스트

- 파서: 메서드 본문 범위(중첩 클래스·익명 클래스·람다 포함), 매개변수, 생성자, 필드, `extends`/`implements`, `enclosingMethod`
- 타입 해석: import / 같은 패키지 / 중첩 / 와일드카드 / 라이브러리 타입 제외
- 호출 연결: 필드·생성자 주입·지역 변수·매개변수·정적 호출·`this`·상위 클래스 메서드·인터페이스 → 구현(1개, 여러 개)·오버로드·체인 호출 미해석 기록
- 경로 탐색: 순환, 깊이 제한, 경로 개수 제한, 엔드포인트 0개, 메서드 밖 sink
- core: 단계 SKIPPED/FAILED/PARTIAL, 집계

### 픽스처 (§17)

| Fixture | 기대 |
|---|---|
| `spring-vulnerable-unused` | `used=false`, `reachable=false` (`NO_VULNERABLE_API_USAGE`) |
| `spring-vulnerable-used` | `used=true`, `reachable=false` (`NOT_REACHABLE`) |
| `spring-vulnerable-reachable` | `used=true`, `reachable=true`, Target behavior의 경로와 파일:라인 일치 |

픽스처 계약은 바꾸지 않습니다. 인터페이스 구현·필드 주입·Lombok `@RequiredArgsConstructor` 같은 변형은 합성 소스 단위 테스트로 다룹니다.

### 통합 확인

`pnpm typecheck` / `pnpm test` / `pnpm build` / `pnpm lint`, 실제 PostgreSQL에 마이그레이션 적용, API + 웹 화면 확인(목록 열·상세 경로·대시보드 카드), spring-petclinic과 java-sec-code에서 경로 몇 개를 소스와 수작업 대조하고 D13 측정값 기록.

## VERIFY (2026-11-22)

브랜치: `feat/phase6-reachability` (커밋 전)

### Phase 6 Definition of Done

| 항목 | 결과 |
|---|---|
| 파서가 메서드 범위·매개변수·생성자·필드·상속·감싸는 메서드를 기록 | ✅ 기존 파서·Phase 4·5 테스트 변경 없이 통과 + 새 테스트 5개 |
| `CallGraphBuilder` / `ReachabilityAnalyzer` (D3~D12) | ✅ 합성 소스 단위 테스트 10개 (필드 주입, 지역 변수·매개변수, 정적 호출, 생성자, 다른 패키지 import, 인터페이스 → 구현, 오버로드, 순환, 깊이 제한, 테스트 소스 제외, 필드 초기화식 sink, 미해석 호출 수) |
| `REACHABILITY` 단계, `[REACHABILITY]` 로그, SKIPPED/FAILED/PARTIAL | ✅ core 테스트 3개 추가 |
| `summarizeScan.reachableVulnerabilities` (분석 안 됨 = `null`) | ✅ |
| 마이그레이션 `phase6_reachability`, 경로 저장·조회 | ✅ 실제 PostgreSQL에 `prisma migrate deploy` 적용, `migrate diff`(DB ↔ 스키마) 차이 없음. ⚠️ Prisma 저장소로 경로를 저장·조회하는 스캔은 아직 안 돌려 봄 |
| `GET /api/findings/:id/reachability`, 목록 DTO `reachability`, summary `reachableVulnerabilities` | ✅ in-memory 저장소로 API 테스트. Prisma 저장소 경로는 DB가 없어 미확인 |
| CLI `Reachable` 열·요약 줄·`report` 경로 섹션 | ✅ 렌더러 테스트 + 픽스처 실행 |
| Web 목록 열·상세 경로 섹션·대시보드 카드 | ⚠️ 타입 검사·포맷터 테스트 통과. **브라우저 화면 확인은 못 함** (API가 DB 필요) |
| `pnpm typecheck` / `test` / `lint` / `build` | ✅ |

### 확인 결과

픽스처 (`vulntrace report fixtures/<name>`, OSV 실제 조회):

```text
spring-vulnerable-reachable  CVE-2022-42889  Reachable: yes
  POST /api/templates/render
    -> com.example.demo.TemplateController#render
         src/main/java/com/example/demo/TemplateController.java:20  return templateService.render(template);
    -> com.example.demo.TemplateService#render
         src/main/java/com/example/demo/TemplateService.java:14  StringSubstitutor interpolator = StringSubstitutor.createInterpolator();
    => org.apache.commons.text.StringSubstitutor#createInterpolator
spring-vulnerable-used       CVE-2022-42889  Reachable: no path (no call path from any endpoint)
spring-vulnerable-unused     CVE-2022-42889  Reachable: no (NO_VULNERABLE_API_USAGE)
```

실제 저장소 (GitHub URL로 스캔, Maven 실행 끔):

| 저장소 | 엔드포인트 | 호출 그래프 | 결과 |
|---|---|---|---|
| spring-petclinic | 17 | 메서드 109, 호출 86 | Finding 0건 (의존성 버전이 모두 parent 관리라 Maven 없이는 OSV 조회 대상 없음) → 도달 판정 대상 없음 |
| java-sec-code | 133 | 메서드 375, 호출 187, 미해석 18 | REACHABLE 10, NO_VULNERABLE_API_USAGE 5, NO_API_INFO 146 |

java-sec-code의 REACHABLE 10건(fastjson 1, log4j-core 1, snakeyaml 8)의 경로는 모두 소스와 수작업 대조해 일치했습니다 (`Fastjson.java:23`, `Jsonp.java:77`, `Log4j.java:20`, `Rce.java:113/119`). 다만 모두 컨트롤러에서 바로 취약 API를 부르는 1단계 경로라, 여러 단계 경로는 픽스처와 단위 테스트로만 확인했습니다.

**D13 측정 (Stage B 판단):** java-sec-code에서 처음 미해석 호출은 217개였고 그중 172개가 체인 호출이었습니다. 대부분은 `ob.get("name").toString()`처럼 프로젝트 코드로 갈 수 없는 라이브러리 호출이었습니다. 그래서 "프로젝트 메서드 중 같은 이름이 하나도 없는 호출은 프로젝트 코드에 닿을 수 없다"는 규칙으로 걸러 **18개**(체인 9, 타입에 그 메서드 없음 8, 수신자 모름 1)로 줄였습니다. 이 규모에서는 Stage B가 아직 필요하지 않다고 판단합니다. 서비스 계층이 깊은 실제 애플리케이션에서 다시 재 봐야 합니다.

### 검증 중 고친 문제

- 미해석 호출 수가 라이브러리 체인 호출까지 세어 "놓친 것"을 과장함 → 프로젝트 메서드 이름에 없는 호출은 세지 않도록 변경 (`CallGraphBuilder.resolveInvocation`)

### 알려진 한계

- D5·D7의 미지원 항목(체인 호출, 리플렉션, AOP·필터·인터셉터, `@Async`/`@EventListener`/`@Scheduled`, 람다 실행 여부, 주입되는 구현 선택)은 결과마다 `scope.unsupported`로 표시
- `super.m()`은 체인 호출로 처리되어 따라가지 않음
- 변수 타입은 이름 기준으로 찾으므로, 같은 메서드 안에서 같은 이름을 다른 블록에서 다시 선언하면 가장 가까운 앞쪽 선언을 씀
- Lombok `@Slf4j`의 `log` 같은 생성 필드는 모름 (프로젝트 메서드와 이름이 겹칠 때만 미해석으로 셈)
- java-sec-code `/rce/sec/yarm`은 `new Yaml(new SafeConstructor())` 뒤의 `load`라 실제로는 안전하지만 REACHABLE로 나옴. 도달성 문제가 아니라 Phase 4 취약 API 목록이 생성자 인자를 보지 않기 때문 (Phase 7 이후 정밀화 대상)
- 전체 호출 그래프(`methods`/`method_calls`)는 저장하지 않음 (D14)

## 다음 작업

1. API 서버로 `spring-vulnerable-reachable`을 스캔 → Prisma 저장소의 경로 저장·조회와 웹 목록·상세·대시보드 화면 확인
2. 그다음 Phase 7(위험도 우선순위)
