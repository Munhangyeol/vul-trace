# Phase 7 상세 계획 — 위험도 우선순위 (Risk Prioritization)

작성일: 2026-11-22
기준 문서: `CLAUDE.md` §6, §7 Phase 7, §8 Risk Module, §16, §19 (본 계획보다 우선함)
상위 문서: `overview-plan.md`
선행 문서: `phase-4-source-usage.md`, `phase-5-spring-endpoints.md`, `phase-6-reachability.md`
상태: **완료** (`feat/phase7-risk`, 아래 VERIFY)

## PLAN

### Goal

Finding마다 **설명 가능한 위험 점수**를 매겨 "무엇부터 고칠지"를 정합니다.
점수는 항상 `{ score, reasons[] }`이고, 점수의 모든 점수 단위는 근거(reason)에 대응합니다 (§8 "never hide scoring logic").
같은 입력에는 항상 같은 점수가 나와야 합니다 (결정적 분석, §6.3 — LLM 사용 안 함).

핵심 효과: **쓰이지 않는 Critical보다 엔드포인트에서 닿는 Medium이 위로** 올라오게 합니다.

### Current phase

Phase 7 (Phase 0~6 완료, `master` = `46eec31`). 조치 안내(Phase 8)는 구현하지 않습니다.

### Affected modules

| 모듈 | 변경 |
|---|---|
| `packages/shared` | `RiskScore`/`RiskReason` 확장(요인별 상태), `AuthenticationStatus`, `Vulnerability.references`에 type 보존, DTO `FindingRiskDto`, 목록 DTO의 `risk` |
| `packages/vulnerability` | OSV `references[].type`을 버리지 않고 보존 (D5) |
| `packages/spring-analyzer` | 엔드포인트별 인증 근거 수집: 핸들러·컨트롤러의 `@PreAuthorize`/`@Secured`/`@RolesAllowed` (D4) |
| `packages/risk` | 스텁 → `rules.ts`(가중치 표), `RiskScoreCalculator`(순수 함수), `assessAuthentication` |
| `packages/core` | `RISK` 단계, `[RISK]` 로그, `Finding.risk`, `compareFindings`를 위험 점수 우선으로 |
| `prisma/` | `phase7_risk` 마이그레이션 (`risk_scores`에 인덱스·`rules_version`, 기존 테이블 재사용) |
| `apps/api` | 스캔 시 점수 저장, 목록 DTO `risk`, `GET /api/findings/:id`에 근거, 목록 기본 정렬 |
| `apps/cli` | 취약점 표 `Risk` 열(정렬 기준), `report`의 위험 근거 섹션 |
| `apps/web` | 목록 `Risk Score` 열(지금은 `—`)과 정렬, 상세 `Risk reasons` 섹션(지금은 "Not analyzed yet") |

### Current behavior

- `RiskScoreCalculator.calculate`가 `NotImplementedError`를 던지고, `RISK` 단계는 `SKIPPED (not implemented (Phase 7))`입니다.
- 취약점 목록은 심각도 → CVSS → 패키지 이름 순입니다 (`compareFindings`). 쓰이지 않는 Critical이 항상 맨 위에 옵니다.
- OSV 참조는 URL만 남기고 `type`을 버립니다.

### Target behavior

픽스처 `commons-text 1.9` (CVE-2022-42889, CVSS 9.8) 기준:

```text
spring-vulnerable-reachable  Risk 89  = CVSS 9.8 (+39) + 엔드포인트에서 도달 (+35)
                                      + 직접 의존성 (+5) + Spring Security 의존성 없음 (+10)
                                      + 수정 버전 1.10.0 있음 (0, 참고)
spring-vulnerable-used       Risk 64  = +39 + 취약 API 사용·경로 없음 (+20) + 직접 (+5)
spring-vulnerable-unused     Risk 44  = +39 + 쓰이지 않음 (0) + 직접 (+5)
```

(점수는 D2 가중치 기준 예시이며, 가중치를 바꾸면 테스트 기대값도 함께 바꿉니다.)

## 0. 결정 사항

| # | 항목 | 결정 |
|---|---|---|
| D1 | 점수 형태 | 0~100 정수, 요인별 점수를 더한 값(상한 100, 하한 0). 곱셈·비선형 없이 덧셈만 써서 근거 합계 = 점수가 항상 성립. 가중치 표는 `packages/risk/src/rules.ts` 한 곳에 두고 `RULES_VERSION`을 붙여 저장 (나중에 가중치가 바뀌어도 어느 기준의 점수인지 알 수 있게) |
| D2 | 가중치 (초안) | **심각도** 최대 40: CVSS v3 점수 × 4 (반올림). CVSS가 없으면 등급으로 대체 (CRITICAL 36 / HIGH 28 / MEDIUM 18 / LOW 8 / UNKNOWN 10, 근거에 "CVSS 없음, 등급 사용" 표시). **사용 단계** 최대 35, 가장 높은 단계 하나만: 쓰이지 않음 0 / 쓰임(취약 API 정보 없음 포함) +10 / 취약 API 사용·경로 없음 +20 / 엔드포인트에서 도달 +35. **직접 의존성** +5. **인증** (도달 가능할 때만) 인증 없음 +10 / 인증 필요 −10 / 모름 0. **익스플로잇 근거** +10 (D5). **수정 버전** 0 (참고 근거로만 표시). 합계 최대 100 |
| D3 | 분석 안 된 요인 | 단계가 실행되지 않았거나 실패한 요인은 0점이고 근거에 "not analyzed (사유)"로 남깁니다. 0점의 "아님"과 "모름"을 구분합니다 (§19와 같은 원칙). `RISK` 단계는 `VULNERABILITY`만 성공하면 실행되고, 나머지 요인이 없으면 있는 정보로만 계산합니다 |
| D4 | 인증 판단 | 정적으로 확실한 것만 판단합니다. **NOT_REQUIRED**: 의존성(해석 못 한 것 포함)에 `org.springframework.security` 그룹이 하나도 없음. **REQUIRED**: 경로가 시작되는 모든 핸들러 메서드 또는 그 컨트롤러 클래스에 `@PreAuthorize`/`@Secured`/`@RolesAllowed`가 import로 확인되어 붙어 있음. **UNKNOWN**: 그 밖의 모든 경우, 특히 Spring Security가 있지만 URL 규칙(`SecurityFilterChain`, `WebSecurityConfigurerAdapter`)으로만 보호하는 경우 — URL 규칙 해석은 이번 범위 밖. `permitAll`/`anonymous` 표현식은 REQUIRED로 보지 않습니다 |
| D5 | 익스플로잇 근거 | OSV 스키마(1.9.2)에는 "알려진 익스플로잇" 필드가 없습니다. 가장 가까운 것은 `references[].type = EVIDENCE`("취약점 주장의 타당성을 보여 주는 시연")입니다. Phase 2를 고쳐 참조 type을 보존하고, `EVIDENCE` 참조가 있으면 +10과 함께 그 URL을 근거로 남깁니다. 없으면 0점에 "OSV에 익스플로잇 근거 없음 — 없다는 뜻은 아님"으로 표시합니다. CISA KEV 같은 외부 목록은 새 외부 데이터 소스라 이번에는 넣지 않습니다 (아래 열린 질문) |
| D6 | HTTP 노출 | Stage A의 진입점은 Spring 엔드포인트뿐이므로 "도달 가능"이 곧 HTTP 노출입니다. 별도 점수를 주지 않고, 도달 근거에 닿는 엔드포인트 목록(최대 5개 + 개수)을 붙입니다. `HTTP_EXPOSURE` 요인은 근거 설명용으로만 씁니다 (점수 0) |
| D7 | 같은 취약점, 여러 Finding | 점수는 Finding(의존성 × 취약점) 단위입니다. 요약의 "가장 위험한 취약점"은 같은 취약점 id 중 최고 점수를 씁니다 |
| D8 | 정렬 | `compareFindings`를 **위험 점수 내림차순 → 기존 순서(심각도 → CVSS → 이름)**로 바꿉니다. 점수가 없는 Finding(단계 실패)은 기존 순서로 뒤에 둡니다. CLI·API·웹 모두 이 함수를 씁니다 |
| D9 | 저장 | 기존 `risk_scores` 테이블(`score`, `reasons` JSON)을 씁니다. `rules_version` 열과 `project_vulnerability_id` 인덱스를 추가합니다. Finding 하나당 한 행 (다시 저장하면 교체) |
| D10 | 보안 (§16) | 새 외부 호출 없음. 이미 모은 스캔 결과만으로 계산합니다 |

### 열린 질문 (구현 전에 정해야 함)

- **CISA KEV(실제로 악용된 취약점 목록) 도입 여부** — 가장 강한 "알려진 익스플로잇" 신호지만, 새 외부 데이터 소스(다운로드, 캐시, 갱신 주기, 오프라인 동작)가 필요합니다. 권장: Phase 7에서는 넣지 않고 OSV `EVIDENCE`만 쓴 뒤, 필요하면 별도 작업으로 `ExploitIntelProvider` 인터페이스 뒤에 붙입니다.
- **가중치 초안(D2)이 감각에 맞는지** — 특히 "도달 +35"와 "인증 없음 +10"의 크기.

## 1. 작업 순서

1. **shared 타입** — `RiskReason`에 `status`(`APPLIED`/`NOT_APPLICABLE`/`NOT_ANALYZED`)와 근거 상세(`evidence`), `AuthenticationStatus`, `RiskScore.rulesVersion`, `Vulnerability.referenceTypes`(또는 `{url,type}[]`)
2. **Phase 2 보정** (`vulnerability`) — OSV 참조 type 보존 + 정규화 테스트. 기존 저장 형식(URL 문자열 배열)과 호환되게 읽기
3. **인증 근거** (`spring-analyzer`) — 엔드포인트별 보안 어노테이션 수집 (import 기반 판별, Phase 5와 같은 방식)
4. **`rules.ts` + `RiskScoreCalculator`** (`risk`) — 순수 함수, 요인별 근거 생성, 합계 검증
5. **core** — `RISK` 단계, `[RISK] N findings scored, top: ...` 로그, `Finding.risk`, `compareFindings` 변경
6. **prisma 마이그레이션 + 저장소** — D9
7. **API** — 저장, 목록 DTO `risk`, 상세 근거, 정렬
8. **CLI** — `Risk` 열(첫 정렬 기준), `report` 근거 섹션
9. **Web** — 목록 `Risk Score` 열, 상세 `Risk reasons` 섹션
10. **테스트 + 검증**

## Risks

- **가중치가 자의적이라는 비판** → 가중치를 한 파일에 모으고, 근거마다 점수와 이유를 보여 주며, `RULES_VERSION`으로 기록. 점수보다 **순서**가 맞는지를 픽스처·실제 저장소에서 확인
- **"인증 없음" 오판** → 의존성이 전혀 없을 때만 NOT_REQUIRED로 하고, 나머지는 UNKNOWN(0점)
- **정렬 변경으로 기존 화면·테스트가 깨짐** → `compareFindings` 테스트를 먼저 고치고 CLI 렌더러 테스트 기대값 갱신
- **Phase 2 저장 형식 변경** → 참조 type을 새 필드로 추가하고 기존 행은 type 없음으로 읽음 (재스캔 시 채워짐)

## Verification

### 단위 테스트

- 계산기: 요인별 점수, 상한·하한, 근거 합계 = 점수, CVSS 없음 대체, 분석 안 된 요인, 인증 세 상태, EVIDENCE 유무, 같은 입력 → 같은 출력
- 인증 근거: 메서드·클래스 어노테이션, import 판별, 동명 커스텀 어노테이션 무시, Spring Security 의존성 유무
- OSV 참조 type 보존, 정렬 순서

### 픽스처 (§17)

| Fixture | 기대 |
|---|---|
| `spring-vulnerable-reachable` | 가장 높은 점수, 근거에 도달 경로 엔드포인트와 "Spring Security 없음" |
| `spring-vulnerable-used` | reachable보다 낮고 unused보다 높음 |
| `spring-vulnerable-unused` | 가장 낮음 |

### 통합 확인

`pnpm typecheck` / `test` / `lint` / `build`, 실제 DB 마이그레이션, API 스캔, 웹 목록 정렬·상세 근거 화면, java-sec-code에서 상위 10개 순서를 보고 "도달 가능한 fastjson·log4j·snakeyaml이 쓰이지 않는 jackson보다 위"인지 확인 (java-sec-code는 Spring Security를 써서 인증은 UNKNOWN이 기대값).

## VERIFY (2026-11-22)

열린 질문은 계획대로 정했습니다: CISA KEV는 넣지 않고 OSV `EVIDENCE`만 사용, 가중치는 D2 초안 그대로 (`RULES_VERSION = 2026-11-22.1`).

### Phase 7 Definition of Done

| 항목 | 결과 |
|---|---|
| OSV `EVIDENCE` 참조 보존 (Phase 2 보정) | ✅ `Vulnerability.evidenceReferences`, 정규화 테스트. Phase 7 이전에 저장된 데이터는 `null` → 근거 `NOT_ANALYZED` |
| 엔드포인트별 접근 어노테이션 (`@PreAuthorize`/`@Secured`/`@RolesAllowed`) | ✅ import 기반 판별, `permitAll()` 등은 제외, 동명 커스텀 어노테이션 무시 (테스트) |
| `rules.ts` + `RiskScoreCalculator` (순수 함수, 근거 합계 = 점수, 0~100) | ✅ 단위 테스트 10개 |
| `RISK` 단계, `[RISK]` 로그, SKIPPED/FAILED/PARTIAL | ✅ core 테스트 3개 |
| `compareFindings` 위험 점수 우선 | ✅ 정렬 테스트. CLI·API·웹이 같은 함수 사용 |
| 마이그레이션 `phase7_risk`, 저장·조회 | ✅ 실제 PostgreSQL 적용, `migrate diff` 차이 없음, API 스캔 후 점수·근거 읽기 확인 |
| CLI `Risk` 열·`report` 근거 섹션 | ✅ 렌더러 테스트 + 픽스처 |
| Web 목록 `Risk Score` 열·상세 `Risk reasons` | ✅ 브라우저 확인, 콘솔 오류 없음 |
| `pnpm typecheck` / `test`(429) / `lint` / `build` | ✅ |

### 확인 결과

픽스처 (계획한 점수와 정확히 일치):

```text
spring-vulnerable-reachable  89 = +39 CVSS 9.8, +35 POST /api/templates/render에서 도달, +5 직접, +10 Spring Security 없음
spring-vulnerable-used       64 = +39, +20 취약 API 사용·경로 없음, +5
spring-vulnerable-unused     44 = +39, 0 쓰이지 않음, +5
```

`spring-vulnerable-used`의 14개 Finding은 API·웹 목록에서 commons-text(64)가 맨 위, 쓰이지 않는 jackson-databind HIGH(37)가 그 아래로 정렬됩니다.

java-sec-code (Finding 161개): 상위 10개가 모두 엔드포인트에서 도달하는 Finding입니다 (log4j-core 80, fastjson 79, snakeyaml 73~62). 도달하는 **MEDIUM snakeyaml(66)이 도달 정보 없는 CRITICAL fastjson·dom4j(55·54)보다 위**로, Phase 7의 목표 동작을 확인했습니다. 인증은 기대대로 전부 UNKNOWN입니다 (Spring Security 사용, URL 규칙은 분석 범위 밖).

### 알려진 한계

- 실제 데이터에서 OSV `EVIDENCE` 참조가 있는 취약점은 java-sec-code 161건 중 0건이었습니다. 익스플로잇 요인은 구현·테스트됐지만 실제로 점수에 반영되는 경우는 드뭅니다. 더 강한 신호가 필요하면 CISA KEV를 별도 작업으로 검토합니다
- 인증은 어노테이션과 의존성 유무만 봅니다. `SecurityFilterChain` URL 규칙을 쓰는 프로젝트는 UNKNOWN(0점)입니다
- `@RolesAllowed`의 `jakarta`/`javax` 외 다른 JSR-250 구현, 메타 어노테이션(커스텀 어노테이션 안의 `@PreAuthorize`)은 인식하지 않습니다
- 가중치는 초안입니다. 바꿀 때는 `RULES_VERSION`을 올리고 테스트 기대값을 함께 바꿉니다

## 다음 작업

Phase 8(조치 안내).
