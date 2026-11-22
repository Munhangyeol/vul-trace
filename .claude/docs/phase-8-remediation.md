# Phase 8 상세 계획 — 조치 안내 (Remediation)

작성일: 2026-11-22
기준 문서: `CLAUDE.md` §6.2, §6.3, §7 Phase 8, §16, §21 (본 계획보다 우선함)
상위 문서: `overview-plan.md`
선행 문서: `phase-6-reachability.md`, `phase-7-risk.md`
상태: **완료** (`feat/phase8-remediation`, 아래 VERIFY)

## PLAN

### Goal

"무엇을 고쳐야 하는가"에서 한 걸음 더 나가 **"어떻게 고치면 되는가"**를 근거와 함께 보여 줍니다.

CLAUDE.md §7 Phase 8이 요구하는 표시 항목:

```text
Current version / Affected version / Fixed version
Affected files / Affected methods / Reachable endpoints
Risk reasons / Recommended action
```

이 중 앞의 7개는 Phase 2~7에서 이미 모은 데이터입니다. Phase 8이 새로 만드는 것은 **권장 조치(Recommended action)** 하나이고, 핵심은 다음 질문에 결정적으로 답하는 것입니다.

> 이 의존성을 **어느 버전으로** 올리면 알려진 취약점이 **몇 개** 없어지는가, 그리고 그 근거는 무엇인가?

권장 조치는 규칙으로 계산합니다. LLM은 쓰지 않습니다 (§6.3 — 선택 사항으로 나중에 설명 문장만 붙일 수 있음).

### Current phase

Phase 8 (Phase 0~7 완료, `master` = `f06f695`). 로드맵의 마지막 Phase입니다.

### Affected modules

| 모듈 | 변경 |
|---|---|
| `packages/shared` | `RemediationAction`, `DependencyRemediation`(의존성 단위 조치), `FindingRemediation`(Finding 단위 요약), DTO |
| `packages/remediation` (신규) | `MavenVersion`(Maven 버전 비교), `isAffected`(OSV 범위 판정), `planRemediation`(순수 함수) |
| `packages/core` | `planRemediation`을 CLI·API 공용으로 노출 (스캔 단계는 추가하지 않음, D7) |
| `apps/api` | `GET /api/projects/:id/remediation`, 상세 DTO에 `remediation` |
| `apps/cli` | `report`의 조치 섹션, 새 명령 `vulntrace fix-plan <target>` |
| `apps/web` | "Fix plan" 화면(의존성 단위), 상세 화면 `Remediation` 섹션(지금은 "Not analyzed yet (Phase 8)") |

### Current behavior

- 상세 화면의 Remediation 섹션은 "Not analyzed yet (Phase 8)"입니다.
- `fixedVersions`는 OSV에 적힌 순서 그대로이고 정렬·비교하지 않습니다 (Phase 2 D5: Maven 버전 비교를 일부러 넣지 않음).
- 그래서 한 의존성에 Finding이 여러 개일 때 "어느 버전이면 전부 해결되는지"를 알 수 없습니다. 예: java-sec-code의 `jackson-databind 2.9.8`은 Finding 60개이고, 수정 버전이 `2.6.7.4`, `2.9.10.4`, `2.9.10.7`, `2.10.5.1`, `2.12.6.1`, `2.13.2.1` … 처럼 여러 릴리스 계열에 흩어져 있습니다.

### Target behavior

```text
$ vulntrace fix-plan fixtures/spring-vulnerable-reachable
Fix plan: 1 dependency, 1 finding

1. org.apache.commons:commons-text  1.9 → 1.10.0  (direct, pom.xml)
   fixes 1 of 1 finding  ·  highest risk 89  ·  same major
   CVE-2022-42889  risk 89  reachable from POST /api/templates/render
   affected files: src/main/java/com/example/demo/TemplateService.java:14
```

java-sec-code에서는 Finding 161개가 의존성 31개로 묶이고, `jackson-databind 2.9.8 → X`(OSV 범위로 계산한 최소 버전)가 Finding 몇 개를 없애는지가 한 줄로 나와야 합니다.

## 0. 결정 사항

| # | 항목 | 결정 |
|---|---|---|
| D1 | 조치 단위 | **의존성 단위**로 묶습니다. 같은 artifact의 Finding을 모아 "한 번의 업그레이드로 몇 개가 해결되는가"를 보여 주고, 의존성 목록은 그 안의 최고 위험 점수 순으로 정렬합니다. Finding 상세에는 자기 의존성의 조치를 요약해 보여 줍니다 |
| D2 | Maven 버전 비교 | `packages/remediation/src/MavenVersion.ts`에 Maven `ComparableVersion` 규칙의 필요한 부분을 직접 구현합니다: `.`/`-` 구분, 숫자 구간은 수 비교(`2.9.10.4` < `2.9.10.10`), 한정자 순서 `alpha < beta < milestone < rc(cr) < snapshot < (릴리스) < sp`, 그 밖의 한정자는 사전순, 끝의 0 무시(`1.0` = `1`). 외부 라이브러리는 쓰지 않습니다(§21 "의존성 추가 최소화"). 규칙을 확신할 수 없는 문자열은 비교하지 않고 `UNCOMPARABLE`로 표시합니다 |
| D3 | 영향 판정 | OSV `ECOSYSTEM` 범위(`introduced` / `fixed` / `last_affected` / `limit`)와 `versions` 목록을 OSV 스키마 규칙대로 평가하는 `isAffected(version, finding)`. 실제 데이터의 범위 타입은 모두 `ECOSYSTEM`이었고(java-sec-code 161건), 다른 타입(`SEMVER`, `GIT`)은 판정하지 않고 "모름"으로 둡니다 |
| D4 | 권장 버전 계산 | 후보 = 그 의존성의 모든 Finding에 적힌 수정 버전 중 **현재 버전보다 높은 것**. 낮은 것부터 차례로, **모든 Finding에 대해 `isAffected`가 거짓**인 첫 후보를 권장 버전으로 고릅니다. 그런 후보가 없으면 가장 많은 Finding을 해결하는 후보를 고르고 남는 Finding을 따로 적습니다. 근거로 "각 Finding이 이 버전에서 왜 해결되는지(어느 범위의 `fixed`)"를 남깁니다 |
| D5 | 후보 버전의 한계 | 후보는 OSV에 적힌 수정 버전뿐입니다. Maven Central에서 실제 릴리스 목록을 가져오지 않습니다(새 외부 호출, §16). 그래서 "OSV가 수정 버전으로 적은 것 중 가장 낮은 안전한 버전"이라고 표시하고, 더 최신 버전이 있을 수 있다고 적습니다 |
| D6 | 조치 종류 | `UPGRADE_DIRECT`(직접 의존성: pom.xml의 버전 변경) / `OVERRIDE_TRANSITIVE`(전이 의존성: 부모 의존성 업그레이드 또는 `<dependencyManagement>`로 버전 고정 — 부모의 어느 버전이 고쳤는지는 모르므로 고정 방법을 기본으로 제시, `introducedBy` 경로를 근거로) / `NO_FIX`(수정 버전 없음: 사용 위치·도달 엔드포인트를 근거로 "사용 제거·입력 제한·대체 라이브러리 검토"를 안내) / `REVIEW_UNUSED`(쓰이지 않는 직접 의존성: "소스 사용이 없음 — 런타임·리플렉션 사용을 확인한 뒤 제거 검토", 업그레이드와 함께 표시). 메이저 버전이 바뀌면 `MAJOR_UPGRADE` 경고를 붙입니다 |
| D7 | 계산 시점·저장 | 조치는 이미 저장된 Finding·의존성에서 **조회할 때 계산**하는 순수 함수입니다. 새 스캔 단계와 DB 테이블을 만들지 않습니다. 같은 데이터면 항상 같은 결과이므로 저장할 필요가 없고, 규칙을 고치면 재스캔 없이 반영됩니다. 결과에는 계산에 쓴 Finding id와 범위를 근거로 그대로 담습니다 |
| D8 | 부모 POM 관리 버전 | Spring Boot parent처럼 부모가 버전을 관리하는 의존성은 Maven을 돌리지 않으면 버전을 모르는 `unresolved`라 Finding이 없습니다. 이번 범위에서는 다루지 않고, 직접 선언된 버전이 있는 의존성만 `pom.xml`의 버전 변경으로 안내합니다 |
| D9 | 표시 항목 (§7) | Finding마다 현재 버전, 영향 범위(OSV 원문), 수정 버전(정렬됨), 영향 파일·메서드(Phase 4 사용 위치와 Phase 6 경로 단계), 도달 엔드포인트, 위험 근거(Phase 7), 권장 조치를 한 섹션에 모읍니다. 앞의 7개는 이미 있는 데이터를 다시 보여 주기만 합니다 |
| D10 | 보안 (§16) | 외부 호출 없음, 저장소 파일을 고치지 않음. pom.xml을 자동 수정하는 기능은 만들지 않습니다(사용자 저장소에 쓰기는 이번 범위 밖) |

### 열린 질문 (구현 전에 정해야 함)

- **새 CLI 명령 이름** — `vulntrace fix-plan`을 권장합니다(CLAUDE.md §11의 예시 명령 목록에는 없음). `report`에 섹션만 추가하고 명령은 만들지 않는 선택도 있습니다.
- **Maven Central 조회** — 실제 최신 릴리스까지 알려면 필요하지만 새 외부 호출입니다. 권장: 이번에는 하지 않음 (D5).

## 1. 작업 순서

1. **`MavenVersion`** — 파싱·비교 + 단위 테스트 (실제 데이터의 `2.9.10.4`, `2.10.5.1`, `32.1.3-jre`, `1.0-rc1`, `1.0-SNAPSHOT` 등)
2. **`isAffected`** — OSV `ECOSYSTEM` 범위 평가 + 테스트 (`introduced: 0`, 여러 범위, `last_affected`, `limit`, `versions` 목록)
3. **`planRemediation`** — 의존성별 묶기, 권장 버전(D4), 조치 종류(D6), 근거
4. **shared 타입/DTO**, core에서 공용 노출
5. **API** — `GET /api/projects/:id/remediation`, 상세 DTO의 `remediation`
6. **CLI** — `fix-plan` 명령, `report` 조치 섹션 (`--json` 포함)
7. **Web** — "Fix plan" 화면(대시보드에서 링크), 상세 `Remediation` 섹션
8. **검증** — 아래

## Risks

- **버전 비교 오류 → 잘못된 권장 버전**: 가장 위험한 부분. 실제 OSV 데이터의 버전 문자열로 테스트를 만들고, 비교할 수 없는 문자열은 추측하지 않고 `UNCOMPARABLE`로 표시
- **"이 버전이면 안전"이라는 과신**: OSV에 아직 없는 취약점, 다른 의존성의 취약점은 반영되지 않음 → "알려진 Finding 기준"이라고 항상 표시
- **전이 의존성 안내의 한계**: 부모 의존성의 어느 버전이 고쳤는지 모름 → `dependencyManagement` 고정을 기본으로 제시하고 이유를 적음
- **메이저 업그레이드**: API가 바뀔 수 있음 → `MAJOR_UPGRADE` 경고

## Verification

### 단위 테스트

- `MavenVersion`: 숫자·한정자·구분자·끝의 0·비교 불가 문자열
- `isAffected`: 범위 이벤트 조합별, `versions` 목록만 있는 경우
- `planRemediation`: 한 버전으로 전부 해결, 일부만 해결, 수정 버전 없음, 전이 의존성, 쓰이지 않는 직접 의존성, 메이저 업그레이드 경고, 정렬(최고 위험 순)

### 픽스처

| Fixture | 기대 |
|---|---|
| `spring-vulnerable-reachable` | commons-text `1.9 → 1.10.0`, 1개 해결, 위험 89, 엔드포인트 `POST /api/templates/render` |
| `spring-vulnerable-used` | commons-text가 맨 위, jackson-databind `2.15.2 → (계산된 버전)`로 해당 Finding 해결 |
| `spring-vulnerable-unused` | commons-text `1.9 → 1.10.0` + `REVIEW_UNUSED` |

### 통합 확인

`pnpm typecheck` / `test` / `lint` / `build`, API 응답, 웹 "Fix plan"·상세 화면(브라우저), java-sec-code에서 jackson-databind·snakeyaml·fastjson의 권장 버전을 OSV 범위와 손으로 대조.

## VERIFY (2026-11-22)

열린 질문은 계획대로 정했습니다: CLI 명령은 `vulntrace fix-plan <target>`, Maven Central은 조회하지 않음.

### Phase 8 Definition of Done

| 항목 | 결과 |
|---|---|
| `MavenVersion` (D2) | ✅ 실제 OSV 버전(`2.9.10.4`, `2.10.5.1`, `32.1.3-jre` 등), 한정자 순서·별칭·짧은 형태, 끝의 0, 비교 불가 문자열 — 테스트 5개 |
| `isAffected` (D3) | ✅ `introduced: 0`, 여러 릴리스 계열, `last_affected`, `limit`, `versions` 목록, ECOSYSTEM 외 타입은 UNKNOWN — 테스트 5개 |
| `planRemediation` (D1, D4, D6) | ✅ 여러 계열에 걸친 최소 버전, 메이저 경고, 부분 해결·수정 없음, 전이 의존성 고정, 쓰이지 않는 직접 의존성, 위험도 정렬 — 테스트 5개 |
| 조회 시 계산, 스캔 단계·DB 변경 없음 (D7) | ✅ 마이그레이션 없음. `StoredFinding`에 `scanId`를 붙여 Finding 상세에서 같은 스캔의 형제 Finding으로 계획 |
| API `GET /projects/:id/remediation`, `GET /findings/:id/remediation` | ✅ API 테스트 + 실제 DB에서 응답 확인 |
| CLI `fix-plan`, `report`의 조치 섹션 | ✅ 렌더러 테스트 + 픽스처 3종 |
| Web "Fix plan" 화면, 상세 `Remediation` 섹션 | ✅ 브라우저 확인 |
| `pnpm typecheck` / `test`(448) / `lint` / `build` | ✅ |

### 확인 결과

픽스처 (`vulntrace fix-plan`):

```text
spring-vulnerable-reachable  commons-text 1.9 → 1.10.0  fixes 1 of 1, risk 89, reachable from POST /api/templates/render,
                             affected method TemplateService#render, file TemplateService.java:14
spring-vulnerable-used       1) commons-text 1.9 → 1.10.0 (risk 64)  2) jackson-databind 2.15.2 → 2.18.11 fixes 12 of 12 (+ REVIEW_UNUSED)
spring-vulnerable-unused     commons-text 1.9 → 1.10.0 + REVIEW_UNUSED
```

java-sec-code (Finding 161개 → 의존성 31개):

```text
log4j-core      2.9.1   → 2.25.4   8/8
fastjson        1.2.24  → 1.2.48   2/2
snakeyaml       1.21    → 2.0      8/8  MAJOR (GHSA-mjmj-j48q-9wg2 / CVE-2022-1471은 2.0에서만 수정)
jackson-databind 2.9.8  → 2.18.11  60/60
velocity        1.7     → (없음)   NO_FIX
spring-expression 4.3.16 → 6.0.8  7/8  MAJOR + NO_FIX 1건
```

독립 대조: 권장 버전이 있는 의존성 28개 모두 (1) 현재 버전과 권장 버전 사이의 어떤 후보도 모든 Finding을 해결하지 못하고 (2) 현재 버전은 모든 Finding에 대해 `AFFECTED`로 판정됐습니다. (2)는 우리 범위 평가가 OSV의 실제 매칭 결과 161건과 모두 일치한다는 뜻입니다.

### 검증 중 고친 문제

- 영향 파일에 취약하지 않은 호출(`StringSubstitutor#replace`, `:15`)까지 나옴 → 취약 API 사용이 있으면 그 위치만 표시

### 알려진 한계

- 권장 버전은 OSV에 적힌 수정 버전 중에서만 고릅니다. 더 최신 릴리스, OSV에 아직 없는 취약점, 업그레이드 대상 버전 자체의 새 의존성은 반영하지 않습니다 (화면과 CLI에 근거 문장으로 항상 표시)
- 전이 의존성은 `dependencyManagement` 고정을 기본으로 안내합니다. 부모 의존성의 어느 버전이 고쳤는지는 모릅니다
- 부모 POM이 버전을 관리하는 의존성(Spring Boot starter 등)은 Maven 없이는 Finding이 없어 계획에 나오지 않습니다
- pom.xml을 자동으로 고치지 않습니다
- 개발 서버(`tsx watch`)가 패키지 빌드 도중 재시작하면 잠깐 새 export를 못 찾아 500을 냅니다(빌드가 끝나면 정상). 개발 환경에서만 생기는 현상입니다

## 다음 작업

로드맵의 Phase 0~8이 모두 끝났습니다. 남은 선택 과제는 `overview-plan.md`에 정리했습니다.
