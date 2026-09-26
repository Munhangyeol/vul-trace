# Phase 1 상세 계획 — Repository + Maven Dependency Analysis

작성일: 2026-09-26
기준 문서: `CLAUDE.md` §7 Phase 1, §15, §16, §19 (본 계획보다 우선함)
상위 문서: `overview-plan.md`

---

## 0. 착수 전 결정 사항

구현 전에 확정해야 하는 항목입니다. 각 항목의 권장안을 기준으로 이 문서를 작성했습니다.

| # | 결정 사항 | 권장안 | 대안 |
|---|---|---|---|
| D1 | `mvn` 실행 허용 방식 | **옵트인**: CLI `--allow-maven` 플래그, API 요청 옵션 `allowMaven`. 미허용 시 pom.xml만 분석 | 기본 허용 + 경고 |
| D2 | XML 파서 | **`fast-xml-parser`** 도입 (순수 JS, 외부 엔티티 미해석). 추가 사유는 커밋 메시지에 기록 (§21-3) | 직접 작성한 파서 — 정확도 위험이 커서 비권장 |
| D3 | Prisma 저장소 구현 위치 | **`apps/api/src/persistence/prisma/`**. core는 포트(인터페이스)만 가지고, CLI는 DB 없이 동작 | `init_plan.md`의 `packages/core/src/adapters/prisma/`. 이 경우 CLI도 Prisma 의존을 가짐 |
| D4 | 버전 미확정 의존성 처리 | 버전이 정해지지 않으면 purl을 만들 수 없으므로 `dependencies`에 넣지 않음. **`unresolvedDependencies`** 로 따로 보관하고 사유를 기록 | 버전을 빈 문자열로 저장 — purl 규칙 위반이라 비권장 |
| D5 | 작업 분할 | **1a 분석 + CLI** → **1b 저장 + API** 순서로 진행 | 한 번에 진행 |

> D1 배경: `mvn`을 실행하면 부모 POM과 플러그인을 내려받아 실행합니다. `.mvn/extensions.xml`이나 `<extensions>true</extensions>`가 있으면 **분석 대상 저장소가 지정한 코드가 빌드 확장으로 실행될 수 있습니다.** §16("신뢰 여부를 따지지 않고 Maven 플러그인을 실행하지 않는다")에 따라 기본값은 정적 분석만 하는 것으로 둡니다.

---

## PLAN

### Goal

로컬 Maven 프로젝트 경로를 입력하면 다음을 수행합니다.

- 프로젝트 메타데이터를 추출합니다.
- 직접 의존성과 전이 의존성을 추출합니다.
- 좌표를 정규화하고 purl을 생성합니다.
- 결과를 CLI로 출력하고, API를 통해 DB에 저장합니다.

모든 의존성에는 **어디서 발견했는지**(pom.xml인지 dependency:tree인지, 파일 경로, 전이 경로)를 함께 남깁니다.

### Current phase

Phase 0이 완료되었고 이번에 Phase 1을 시작합니다.

### Current behavior

| 위치 | 상태 |
|---|---|
| `MavenDependencyAnalyzer.analyze` | `NotImplementedError` 반환 |
| `purl.ts` | 구현 및 테스트 완료 (`toMavenPurl`, `toPackageCoordinate`) |
| `ScanOrchestrator` | `DEPENDENCY` 단계만 연결됨. `PROJECT_DETECTION` 단계 기록 없음 |
| CLI `dependencies` | 오케스트레이터를 호출하지만 결과는 항상 FAILED |
| API `projects`/`scans` | `501 Not Implemented` 스텁 |
| Prisma | 스키마만 있고 마이그레이션 없음 |
| 개발 환경 | **Maven 미설치** (2026-09-26 확인), Java 17 설치됨 |

### Target behavior

```text
$ vulntrace dependencies fixtures/spring-vulnerable-used
[SCAN] scan started: .../spring-vulnerable-used
[PROJECT] Maven project detected: com.example:spring-vulnerable-used:0.0.1-SNAPSHOT
[DEPENDENCY] 1 dependencies resolved, 1 unresolved (version managed by parent)
[DEPENDENCY] transitive resolution skipped: maven execution not allowed
[SCAN] scan finished: COMPLETED

Dependencies: 1
  direct      compile   pkg:maven/org.apache.commons/commons-text@1.9      (pom.xml)
Unresolved: 1
  direct      compile   org.springframework.boot:spring-boot-starter-web   version managed by parent (not resolved)
```

`--allow-maven`을 주고 Maven이 설치되어 있으면 전이 의존성까지 포함하고, Spring Boot 스타터의 버전도 확정됩니다.

### Affected modules

| 패키지 | 변경 |
|---|---|
| `packages/shared` | `DependencySource` 확장, `UnresolvedDependency` 추가, `ScanStage`에 `DEPENDENCY_TREE` 추가 |
| `packages/dependency-analyzer` | 핵심 구현 (아래 §2) |
| `packages/core` | 오케스트레이터 단계 매핑, `ScanReport` 확장, 옵션 전달 |
| `apps/cli` | `--allow-maven`, `--maven-timeout` 옵션, 렌더러 확장 |
| `apps/api` (1b) | Prisma 저장소, `POST/GET /projects`, `POST/GET /scans`, `GET /dependencies`, DTO |
| `prisma/` (1b) | 초기 마이그레이션 |

---

## 1. 도메인 모델 변경 (`packages/shared`)

변경은 최소한으로 하되, 증거를 보존하는 데 필요한 필드만 추가합니다.

```ts
// types/dependency.ts
export interface DependencySource {
  kind: 'pom.xml' | 'dependency-tree';
  filePath: string;
  /** 전이 의존성을 끌어온 상위 의존성 경로(루트 제외, 가까운 순). Phase 8 조치 안내에도 사용. */
  introducedBy?: string[];   // purl[]
}

export type UnresolvedReason =
  | 'VERSION_MANAGED_BY_PARENT'     // <parent> 또는 BOM의 dependencyManagement
  | 'UNRESOLVED_PROPERTY'           // ${...} 치환 실패
  | 'VERSION_RANGE';                // [1.0,2.0) 같은 범위 표기

export interface UnresolvedDependency {
  groupId: string;
  artifactId: string;
  rawVersion?: string;              // pom에 적힌 원문
  scope: string;
  reason: UnresolvedReason;
  source: DependencySource;
}
```

```ts
// types/project.ts
export type ScanStage =
  | 'PROJECT_DETECTION'
  | 'DEPENDENCY'
  | 'DEPENDENCY_TREE'   // 추가: mvn dependency:tree 결과
  | 'SBOM' | ...;
```

단계 상태 규칙 (§19):

| 상황 | `DEPENDENCY_TREE` 상태 | 전체 스캔 상태 |
|---|---|---|
| Maven 실행 허용 안 됨 | `SKIPPED` (`maven execution not allowed`) | COMPLETED |
| 실행했으나 `mvn` 없음 / 타임아웃 / 0이 아닌 종료 코드 / 출력 파싱 실패 | `FAILED` (사유 기록) | **PARTIAL** (pom.xml 결과는 보존) |
| 성공 | `SUCCEEDED` | COMPLETED |

지금의 `deriveScanState` 규칙만으로 위 표가 그대로 성립하므로 이 함수는 수정하지 않습니다.

---

## 2. `packages/dependency-analyzer` 구현

### 2.1 파일 구성

```text
src/
├── index.ts
├── MavenProjectDetector.ts        경로 검증 + pom.xml 탐지
├── pom/
│   ├── PomParser.ts               XML → RawPom (순수 함수)
│   ├── PomModel.ts                RawPom / PomDependency 타입
│   └── resolvePomDependencies.ts  속성 치환 + dependencyManagement 적용 (순수 함수)
├── tree/
│   ├── MavenDependencyTreeRunner.ts   execFile + timeout + 임시 출력 파일
│   └── DependencyTreeParser.ts        트리 텍스트 → 노드 목록 (순수 함수)
├── process/
│   └── ProcessRunner.ts           외부 프로세스 실행 포트 (테스트에서 가짜 구현으로 교체)
├── mergeDependencies.ts           pom 결과 + 트리 결과 병합 (순수 함수)
├── purl.ts                        (기존)
└── MavenDependencyAnalyzer.ts     위 구성 요소 조립
```

### 2.2 `MavenProjectDetector`

- 입력 경로를 `path.resolve`로 정규화하고, 존재하는 디렉터리인지 확인합니다. 아니면 `PROJECT_NOT_FOUND`.
- `<path>/pom.xml`이 없으면 `UNSUPPORTED_PROJECT`.
- 하위 디렉터리는 탐색하지 않습니다. 루트의 pom.xml만 봅니다.
- 다음 파일이 있으면 경고를 남기고, 그 사실을 `mvn` 실행 판단에 넘깁니다.
  - `.mvn/extensions.xml`
  - `.mvn/maven.config`
  - `.mvn/jvm.config`
  - `mvnw`, `mvnw.cmd` (실행하지 않고 경고만)

### 2.3 `PomParser` + `resolvePomDependencies`

추출 대상:

```text
project: groupId(없으면 parent.groupId), artifactId, version(없으면 parent.version), packaging
parent:  groupId, artifactId, version, relativePath
properties
dependencies[]:          groupId, artifactId, version?, scope(기본 compile), type, classifier, optional
dependencyManagement[]:  같은 필드 (scope=import BOM은 해석하지 않고 존재만 기록)
modules[]
```

버전 결정 규칙 (순수 함수):

1. `dependency.version`이 있으면 속성을 치환합니다. 대상은 `${project.version}`, `${project.groupId}`, `${project.parent.version}`, `<properties>` 안의 값입니다.
2. 버전이 없으면 **같은 pom의** `dependencyManagement`에서 찾습니다.
3. 그래도 없으면 `UnresolvedDependency`로 기록합니다.
   - `<parent>`가 있으면 `VERSION_MANAGED_BY_PARENT`
   - 치환 실패면 `UNRESOLVED_PROPERTY`
   - `[`, `(`로 시작하면 `VERSION_RANGE`

보안 및 견고성:

- `DOCTYPE`이나 `ENTITY` 선언이 있으면 파싱을 거부하고 `PARSE_ERROR`를 반환합니다. XXE와 엔티티 확장 공격을 막기 위해서입니다.
- 파일 크기에 상한을 둡니다(예: 5 MB). 넘으면 `PARSE_ERROR`.
- 속성 치환은 최대 10단계까지만 하고, 순환 참조를 검출합니다.

범위 밖 항목 (경고만 남김):

- `<modules>` 하위 모듈 분석 (멀티모듈)
- 로컬 부모 POM(`relativePath`)과 원격 부모 POM 읽기
- `<profiles>` 활성화 규칙
- import BOM 해석

### 2.4 `ProcessRunner` + `MavenDependencyTreeRunner`

```ts
export interface ProcessRunner {
  run(command: string, args: readonly string[], options: {
    cwd: string; timeoutMs: number; maxOutputBytes: number;
  }): Promise<ProcessResult>;   // { exitCode, stdout, stderr, timedOut, spawnError? }
}
```

실행 명령 (인자는 **모두 고정값**이고, 사용자 입력은 `cwd`와 출력 파일 경로에만 들어갑니다):

```text
mvn -B --no-transfer-progress
    org.apache.maven.plugins:maven-dependency-plugin:<고정버전>:tree
    -DoutputType=text
    -DoutputFile=<os.tmpdir()/vulntrace-XXXX/tree.txt>
```

- 플러그인 버전을 완전한 이름으로 고정합니다. pom에 적힌 플러그인 버전을 쓰지 않기 위해서입니다. 버전은 착수 시점에 Maven Central에서 확인해 상수로 둡니다.
- `-DoutputFile`로 받은 결과는 `[INFO]` 접두어가 없는 트리 텍스트입니다. stdout 로그를 파싱하지 않습니다.
- 기본 타임아웃은 120초이고 CLI 옵션으로 바꿀 수 있습니다. stdout/stderr는 크기 상한을 두고 보관하며, 실패 사유에는 stderr 끝부분만 넣습니다.
- 임시 디렉터리는 성공하든 실패하든 `finally`에서 지웁니다.
- 셸 문자열 결합과 `exec()`는 쓰지 않습니다 (§15).

**Windows 주의**: Maven 실행 파일은 `mvn.cmd`입니다. Node 20.12.2 이후 버전(CVE-2024-27980 대응)은 `shell` 옵션 없이 `.cmd`/`.bat`을 `spawn`하면 `EINVAL`을 던집니다. 이렇게 대응합니다.

- Windows에서만 `mvn.cmd`를 `shell: true`로 실행합니다.
- 이때 모든 인자는 코드에 고정된 상수여야 하고, 임시 파일 경로는 공백과 셸 메타문자가 없는지 검증합니다.
- 설치 경로는 `VULNTRACE_MAVEN_PATH` 환경변수로 덮어쓸 수 있게 합니다. 경로는 검증 후 사용합니다.

### 2.5 `DependencyTreeParser`

입력 예시 (`outputType=text` 형식):

```text
com.example:spring-vulnerable-used:jar:0.0.1-SNAPSHOT
+- org.springframework.boot:spring-boot-starter-web:jar:3.5.6:compile
|  +- org.springframework.boot:spring-boot-starter:jar:3.5.6:compile
|  \- org.springframework:spring-webmvc:jar:6.2.11:compile
\- org.apache.commons:commons-text:jar:1.9:compile
   \- org.apache.commons:commons-lang3:jar:3.17.0:compile
```

- 들여쓰기 깊이(`+- `, `\- `, `|  `, 공백 3칸)로 부모-자식 관계를 계산해 `introducedBy`를 만듭니다.
- 좌표 형식은 두 가지를 처리합니다.
  - `g:a:type:v:scope`
  - `g:a:type:classifier:v:scope`
- 첫 줄은 루트 프로젝트이므로 의존성에서 제외합니다.
- 깊이 1은 `direct=true`입니다.
- 인식하지 못한 줄은 버리지 않고, 줄 번호와 함께 파싱 오류로 반환합니다 (§19 "실패를 조용히 무시하지 않는다").
- 위 예시의 버전 숫자는 형식을 보여주기 위한 것입니다. 테스트 데이터는 §5를 참고하세요.

### 2.6 `mergeDependencies`

| 경우 | 결과 |
|---|---|
| pom에만 있음 (트리 없음) | `direct=true`, `source.kind='pom.xml'` |
| pom과 트리 모두에 있음 | `direct=true`, **버전은 트리 값**(실제 해석된 버전), `source.kind='pom.xml'`. pom 버전과 다르면 경고 |
| 트리에만 있음 | `direct=false`, `source.kind='dependency-tree'`, `introducedBy` 기록 |
| pom에서 미확정, 트리에서 확정 | `unresolved`에서 빼고 `dependencies`로 옮김 |

- 기준 키는 `groupId:artifactId(:classifier)`입니다.
- `test`/`provided` 스코프도 제외하지 않고 스코프 값을 그대로 둡니다. 필터링은 이후 Phase에서 판단합니다.

### 2.7 `MavenDependencyAnalyzer`

```ts
export interface DependencyAnalysisOptions {
  allowMaven: boolean;
  mavenTimeoutMs?: number;
}

export interface TransitiveResolution {
  status: 'RESOLVED' | 'SKIPPED' | 'FAILED';
  reason?: string;
}

export interface DependencyAnalysisResult {
  project: MavenProjectMetadata;
  dependencies: ProjectDependency[];
  unresolvedDependencies: UnresolvedDependency[];
  transitive: TransitiveResolution;   // 기존 transitiveResolved: boolean 대체
  warnings: string[];
}
```

- 생성자에서 `ProcessRunner`를 주입받습니다. 기본값은 `node:child_process` 구현입니다.
- pom.xml 탐지나 파싱에 실패하면 `err(...)`를 반환하고, 그 결과 `DEPENDENCY` 단계가 FAILED가 됩니다.
- 트리 해석에 실패하면 `ok(...)`를 반환하되 `transitive.status='FAILED'`로 둡니다. pom 결과는 보존됩니다.

---

## 3. `packages/core` 변경

- `ScanOrchestrator.run(projectPath, options: DependencyAnalysisOptions)`
- 단계 기록을 다음처럼 매핑합니다.
  - `PROJECT_DETECTION`: 탐지 실패면 FAILED, 성공이면 SUCCEEDED
  - `DEPENDENCY`: pom 분석 결과
  - `DEPENDENCY_TREE`: `transitive.status`
- `ScanReport`에 `project`, `unresolvedDependencies`, `warnings`를 추가합니다.
- 로그는 `[PROJECT] Maven project detected: g:a:v`, `[DEPENDENCY] N dependencies resolved, M unresolved` 형식으로 남깁니다.
- 경로와 로그 메시지에 인증 정보가 들어가지 않도록 합니다 (§20). 예를 들어 `settings.xml` 내용은 출력하지 않습니다.
- 에러 코드에 `PROJECT_NOT_FOUND`/`UNSUPPORTED_PROJECT`를 쓰는 경우, 해당 단계를 `PROJECT_DETECTION`으로 봅니다. 에러 코드와 단계의 매핑은 오케스트레이터에서 합니다.

---

## 4. 앱 연결

### 4.1 CLI (1a)

```bash
vulntrace dependencies <path> [--allow-maven] [--maven-timeout <seconds>] [--json]
vulntrace scan <path> [--allow-maven]
```

- `--json`: `ScanReport`를 JSON으로 출력합니다. 테스트와 자동화용입니다.
- `--allow-maven`이 켜져 있고 `.mvn/extensions.xml` 등이 발견되면 경고를 출력합니다. 실행 자체는 막지 않습니다. 사용자가 명시적으로 허용했기 때문입니다.
- 렌더러에는 `Unresolved` 섹션, 의존성 출처 표시, `DEPENDENCY_TREE` 상태를 추가합니다.
- 종료 코드는 FAILED면 1입니다. PARTIAL은 0으로 두고 경고를 출력합니다.

### 4.2 API + DB (1b)

- `prisma migrate dev --name init`으로 초기 마이그레이션을 만들고, `docker compose up -d postgres`로 확인합니다.
- `ProjectDependency` 테이블에 `introduced_by String[]`를 추가합니다.
  - `unresolved_dependencies` 테이블을 새로 만들지는 결정이 필요합니다.
  - **권장**: `ScanJob`에 `unresolvedDependencies Json` 컬럼을 추가합니다. 조회 전용 증거라서 별도 테이블은 과합니다.
- 저장소 구현은 `apps/api/src/persistence/prisma/`에 둡니다 (D3).
  - `ProjectRepository`, `ScanRepository`, `FindingRepository.saveDependencies/listDependencies`
- `Dependency.purl @unique`는 `upsert`로 재사용하고, `ProjectDependency`는 스캔마다 새로 만듭니다.

| 엔드포인트 | 동작 |
|---|---|
| `POST /api/projects` | `{ name, path }`. 경로 존재 여부만 검증하고 스캔은 하지 않음 |
| `GET /api/projects`, `GET /api/projects/:id` | 목록/단건 DTO |
| `POST /api/projects/:id/scans` | `{ allowMaven?: boolean }`. **요청 안에서 동기로 실행**(큐 없음, §3). 결과 ScanJob DTO 반환 |
| `GET /api/projects/:id/scans` | 스캔 목록 (상태와 단계 결과 포함) |
| `GET /api/projects/:id/dependencies` | 최근 스캔의 의존성 DTO (출처 포함) |

- Prisma 모델을 그대로 반환하지 않고 `apps/api/src/dto/`에 매핑 함수를 둡니다 (§10).
- 요청 본문 검증은 Fastify JSON Schema로 합니다. 이미 가진 기능이므로 추가 의존이 필요 없습니다.
- API가 받는 `path`는 서버 로컬 경로입니다. API를 외부에 노출하면 임의 경로를 스캔할 수 있습니다. 1b에서는 `VULNTRACE_SCAN_ROOT` 환경변수로 허용할 루트 디렉터리를 제한하는 방안을 적용하는 것을 권장합니다.

---

## 5. 테스트 계획

Maven이 설치되지 않은 환경에서도 **기본 테스트는 전부 통과해야 합니다.**

| 대상 | 종류 | 케이스 |
|---|---|---|
| `MavenProjectDetector` | 단위 (임시 디렉터리) | 존재하지 않는 경로, 파일 경로, pom.xml 없음, `.mvn/extensions.xml` 경고 |
| `PomParser` | 단위 | 4개 픽스처 pom, parent의 groupId/version 상속, 기본 scope, `optional`, `classifier`, 잘못된 XML → `PARSE_ERROR`, DOCTYPE 거부, 크기 상한 |
| `resolvePomDependencies` | 단위 | `${project.version}`, 사용자 정의 속성, 중첩 속성, 순환 속성, 로컬 dependencyManagement, 부모 관리 버전 → unresolved, 버전 범위 → unresolved |
| `DependencyTreeParser` | 단위 (텍스트 샘플) | 단일/중첩/classifier, 깊이 계산, `introducedBy`, 인식 못한 줄 → 오류 + 줄 번호, 빈 입력, CRLF |
| `MavenDependencyTreeRunner` | 단위 (가짜 `ProcessRunner`) | ENOENT → FAILED, 타임아웃, 0이 아닌 종료, 출력 파일 없음, 임시 디렉터리 정리, 고정 인자 검증 |
| `mergeDependencies` | 단위 | §2.6 표의 4가지 경우 + 버전 불일치 경고 |
| `MavenDependencyAnalyzer` | 통합 (픽스처 + 가짜 러너) | `allowMaven=false` → SKIPPED, 러너 성공 → 전이 포함, 러너 실패 → FAILED + pom 결과 보존 |
| `ScanOrchestrator` | 단위 | 단계 매핑과 COMPLETED/PARTIAL/FAILED 판정 |
| CLI 렌더러 | 스냅샷 | 사람이 읽는 출력과 `--json` |
| API (1b) | `app.inject` | DTO 형태, 404, 400 (스키마 위반) |
| 실제 Maven | e2e (**옵트인**) | `VULNTRACE_E2E_MAVEN=1`일 때만 실행. 픽스처에 실제 `mvn` 실행 |

**트리 샘플 데이터**: `packages/dependency-analyzer/test-data/*.tree.txt`에 둡니다.

- 현재 개발 환경에는 Maven이 없으므로, 처음에는 형식 규격에 맞춰 직접 만든 샘플로 시작합니다.
- Maven을 쓸 수 있는 신뢰된 환경에서 `fixtures/spring-vulnerable-used`의 실제 출력을 한 번 캡처해 교체하고, 캡처한 사실을 커밋 메시지에 남깁니다.

### 픽스처 기대값 (`allowMaven=false`)

| 픽스처 | `dependencies` | `unresolved` |
|---|---|---|
| `spring-safe-app` | 0 | `spring-boot-starter-web` (VERSION_MANAGED_BY_PARENT) |
| `spring-vulnerable-unused` | `commons-text@1.9` (direct, compile) | `spring-boot-starter-web` |
| `spring-vulnerable-used` | `commons-text@1.9` | `spring-boot-starter-web` |
| `spring-vulnerable-reachable` | `commons-text@1.9` | `spring-boot-starter-web` |

위 표는 현재 픽스처 pom.xml의 `<dependency>` 구성(2026-09-26 확인)을 기준으로 합니다.

---

## 6. 작업 순서 (커밋 단위)

각 단계를 마칠 때마다 `pnpm typecheck && pnpm test`를 실행합니다.

### 1a — 분석 엔진 + CLI

| # | 작업 | 검증 |
|---|---|---|
| 1 | `shared` 타입 확장 (`DependencySource.introducedBy`, `UnresolvedDependency`, `DEPENDENCY_TREE`) | typecheck |
| 2 | `MavenProjectDetector` + 테스트 | test |
| 3 | `fast-xml-parser` 추가, `PomParser` + 테스트 | test |
| 4 | `resolvePomDependencies` + 테스트 | test |
| 5 | `DependencyTreeParser` + 샘플 데이터 + 테스트 | test |
| 6 | `ProcessRunner` + `MavenDependencyTreeRunner` + 가짜 러너 테스트 | test |
| 7 | `mergeDependencies` + `MavenDependencyAnalyzer` 조립 + 픽스처 통합 테스트 | test |
| 8 | `ScanOrchestrator` 단계 매핑 + 옵션 전달 + 테스트 | test |
| 9 | CLI 옵션, 렌더러, `--json` | `vulntrace dependencies fixtures/spring-vulnerable-used` 수동 확인 |

### 1b — 저장 + API

| # | 작업 | 검증 |
|---|---|---|
| 10 | Prisma 스키마 보완 (`introduced_by`, `unresolved_dependencies`) + 초기 마이그레이션 | `prisma validate`, `migrate dev` |
| 11 | `apps/api` Prisma 저장소 구현 | 로컬 Postgres 연동 테스트 |
| 12 | 프로젝트/스캔/의존성 라우트 + DTO + 스키마 검증 | `app.inject` 테스트 |
| 13 | `VULNTRACE_SCAN_ROOT` 경로 제한 | 테스트 |
| 14 | (옵트인) 실제 Maven e2e 테스트 추가 | Maven 환경에서 수동 실행 |

---

## Risks

| 위험 | 영향 | 완화 |
|---|---|---|
| `mvn` 실행으로 저장소가 지정한 확장·플러그인이 실행됨 | 보안 (§16) | 옵트인(D1), 플러그인 버전 고정, `.mvn/` 파일 경고 |
| Windows에서 `.cmd`를 실행하려면 셸이 필요함 | 인젝션 위험, 실행 실패 | 인자 전부 상수화, 임시 경로 검증, `VULNTRACE_MAVEN_PATH` |
| Spring Boot 프로젝트는 대부분 버전을 부모 POM이 관리 | Maven 없이 분석하면 스타터 대부분이 unresolved | unresolved에 사유를 명시. 부모 POM 해석은 범위 밖으로 두고 필요성을 Phase 2에서 재평가 |
| 개발 환경에 Maven이 없음 | 트리 파서가 실제 출력과 다를 수 있음 | 형식 기반 샘플로 시작하고, 실제 출력 캡처 후 교체, e2e 옵트인 |
| API의 동기 스캔이 오래 걸림 (Maven 다운로드) | 요청 타임아웃 | Maven 타임아웃을 서버 요청 타임아웃보다 짧게 설정. 큐는 실제로 필요해지기 전까지 도입하지 않음 |
| API로 임의 로컬 경로 스캔 가능 | 정보 노출 | `VULNTRACE_SCAN_ROOT` 제한 |
| `fast-xml-parser` 추가 | 의존성 증가 | 검증된 라이브러리, 사유 기록, DOCTYPE 사전 거부 |

## Verification

```text
pnpm typecheck
pnpm test
pnpm build
pnpm lint
node apps/cli/dist/index.js dependencies fixtures/spring-vulnerable-used
node apps/cli/dist/index.js dependencies fixtures/spring-vulnerable-used --json
node apps/cli/dist/index.js dependencies ./does-not-exist            → FAILED, exit 1
(1b) pnpm db:up && npx prisma migrate dev && pnpm dev:api
     POST /api/projects → POST /api/projects/:id/scans → GET /api/projects/:id/dependencies
(선택) VULNTRACE_E2E_MAVEN=1 pnpm test                                → Maven 설치 환경
```

## Phase 1 Definition of Done

- [ ] 로컬 경로를 입력받고, pom.xml을 탐지하고, 프로젝트 메타데이터를 추출함
- [ ] 직접 의존성이 추출되고 버전 미확정 의존성은 사유와 함께 기록됨
- [ ] `--allow-maven` 사용 시 전이 의존성과 `introducedBy`가 추출됨
- [ ] 모든 의존성에 purl과 출처가 기록됨
- [ ] Maven 미허용/실패 시 SKIPPED/FAILED 사유가 기록되고 pom 결과가 보존됨
- [ ] CLI `dependencies`가 결과를 출력함
- [ ] 결과가 PostgreSQL에 저장되고 API로 조회됨 (1b)
- [ ] 기본 테스트가 Maven 없이 모두 통과함

## Known limitations (Phase 1 완료 시점 예상)

- 멀티모듈과 부모 POM 파일은 해석하지 않습니다. Maven을 쓰지 않으면 부모가 관리하는 버전은 unresolved로 남습니다.
- profiles와 import BOM은 해석하지 않습니다.
- 의존성 증거는 파일 경로 단위입니다. pom.xml 줄 번호는 기록하지 않습니다 (XML 파서가 위치 정보를 제공하지 않음).
- Gradle 프로젝트는 지원하지 않습니다.

## 다음 단계

Phase 2: 확정된 `dependencies`(purl 보유)로 CycloneDX 구성 요소를 만들고, OSV 조회를 구현합니다. OSV 문서를 먼저 확인합니다.
