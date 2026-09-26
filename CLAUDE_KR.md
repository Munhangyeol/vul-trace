# CLAUDE_KR.md

## 1. 프로젝트 개요

### 프로젝트명
VulnTrace

### 프로젝트 목표
VulnTrace는 TypeScript를 중심으로 구현하는 취약점 분석 및 우선순위화 플랫폼이다.

가능한 범위에서 프론트엔드, 백엔드, CLI를 동일한 언어로 구성한다.

주요 애플리케이션 기술 스택:

- 프론트엔드: React + TypeScript
- 백엔드: Node.js + TypeScript
- 백엔드 프레임워크: Fastify
- 데이터베이스: PostgreSQL
- ORM: Prisma
- CLI: TypeScript
- 취약점 데이터: OSV
- SBOM: CycloneDX
- 초기 분석 대상: Java / Spring Boot / Maven 프로젝트

VulnTrace 자체의 구현 언어와 분석 대상 프로젝트의 언어는 같을 필요가 없다.

초기 방향:

> VulnTrace 자체는 TypeScript로 개발하고, Java / Spring Boot / Maven 프로젝트를 분석한다.

### 핵심 목표
이 프로젝트는 CVE 목록만 보여주는 도구를 목표로 하지 않는다.

최종적으로 다음 질문에 답할 수 있어야 한다.

> 어떤 취약점이 실제 애플리케이션에 영향을 줄 가능성이 있는지, 어느 코드에서 사용하는지, 외부 Entry Point에서 도달 가능한지, 왜 우선적으로 수정해야 하는지를 설명한다.

### 핵심 처리 흐름

```text
Java / Spring Boot Repository
        ↓
프로젝트 탐지
        ↓
Maven 의존성 추출
        ↓
SBOM 생성
        ↓
OSV 취약점 매핑
        ↓
Java 소스 사용 여부 분석
        ↓
Spring Endpoint 분석
        ↓
Reachability 분석
        ↓
Risk Scoring
        ↓
React Dashboard / CLI Report
```

---

## 2. 아키텍처 방향

VulnTrace는 TypeScript 중심 Monorepo로 구성한다.

권장 구조:

```text
vulntrace/
├── apps/
│   ├── web/
│   │   └── React + TypeScript
│   ├── api/
│   │   └── Node.js + TypeScript + Fastify
│   └── cli/
│       └── TypeScript
│
├── packages/
│   ├── core/
│   ├── dependency-analyzer/
│   ├── sbom/
│   ├── vulnerability/
│   ├── source-analyzer/
│   ├── spring-analyzer/
│   ├── reachability/
│   ├── risk/
│   └── shared/
│
├── prisma/
├── fixtures/
└── CLAUDE.md
```

초기부터 여러 백엔드 서비스로 나누지 않는다.

처음에는 Modular Monolith 형태로 시작한다.

---

## 3. 초기 기술 스택

### 프론트엔드

```text
React
TypeScript
Vite
React Router
TanStack Query
```

실제 전역 Client State가 필요한 상황이 생기기 전에는 Redux, Zustand를 도입하지 않는다.

서버 상태는 우선 TanStack Query로 관리한다.

UI Library는 선택 사항이다.

분석 엔진이 동작하기 전에 화면 디자인에 과도한 시간을 쓰지 않는다.

### 백엔드

```text
Node.js
TypeScript
Fastify
```

### 데이터베이스

```text
PostgreSQL
Prisma
```

### CLI

권장:

```text
TypeScript
Commander.js
```

예시:

```bash
vulntrace scan ./sample-spring-project
```

### 보안 / 분석

```text
OSV API
CycloneDX
Maven
Java Source Parser / Analysis Adapter
```

### 인프라

```text
Docker
Docker Compose
```

명확한 필요가 생기기 전까지 Redis, Kafka, Queue, Microservice를 도입하지 않는다.

---

## 4. 중요한 아키텍처 원칙

VulnTrace의 구현 언어와 분석 대상 언어는 독립적이다.

예:

```text
VulnTrace 구현:
TypeScript

분석 대상:
Java / Spring Boot / Maven
```

Node.js에서는 다음 작업을 수행할 수 있다.

- pom.xml 읽기
- Maven 명령 실행
- Maven 출력 파싱
- SBOM 생성
- OSV 호출
- .java 파일 탐색
- Java 구문 분석
- 내부 Call Graph 구성
- 필요한 경우 별도의 Java Analyzer 프로세스 호출

분석 대상이 Java라는 이유만으로 전체 애플리케이션을 Java로 다시 작성하지 않는다.

---

## 5. Java 분석 전략

Java 분석은 단계적으로 확장한다.

### Stage A — TypeScript만 사용

초기 구현에서는 가능한 범위까지 TypeScript에서 처리한다.

지원 대상:

```text
pom.xml 파싱
mvn dependency:tree 실행
Dependency 추출
Java 파일 탐색
package 분석
import 분석
Annotation 탐지
단순 Method 탐지
단순 호출 관계 분석
```

첫 MVP에는 이 정도로 충분하다.

### Stage B — 별도 Java Analyzer Adapter

Java의 정교한 Semantic Analysis가 필요해질 경우 작은 전용 Analyzer를 추가한다.

예:

```text
Node.js / TypeScript
        ↓
JavaAnalyzerAdapter
        ↓
java -jar java-analyzer.jar
        ↓
JSON 결과
```

Java Analyzer는 메인 백엔드가 아니라 외부 분석 엔진으로 취급한다.

사용 가능한 Java 도구 예:

- JavaParser
- Symbol Solver
- Call Graph 관련 라이브러리

TypeScript 애플리케이션은 계속 다음을 담당한다.

- 전체 Scan Orchestration
- 데이터 저장
- 취약점 매핑
- Risk Scoring
- API
- CLI
- Frontend 연동

---

## 6. 핵심 제품 원칙

### 6.1 CVE 탐지만으로 끝내지 않는다

나쁜 예:

```text
log4j-core 2.14.1
→ CVE 탐지
→ Critical
```

선호:

```text
log4j-core 2.14.1
→ CVE 탐지
→ Dependency 존재
→ 애플리케이션 코드에서 실제 사용
→ 취약 API 사용
→ POST /api/login에서 도달 가능
→ 위험도 산정 근거 제공
```

### 6.2 결과보다 근거를 우선한다

주요 보안 분석 결과에는 근거를 함께 저장한다.

예:

```text
Dependency 근거:
pom.xml

사용 근거:
src/main/java/.../LoggingService.java:42

Reachability:
POST /api/login
→ LoginController.login
→ AuthService.login
→ LoggingService.write
```

단순히 최종 Boolean만 저장하지 않는다.

### 6.3 결정론적 분석 우선

LLM을 취약점 존재 여부 판단의 근거로 사용하지 않는다.

LLM은 추후 다음 용도로만 사용 가능하다.

- 수정 가이드 요약
- 개발자용 설명 생성
- 리포트 문장 생성

LLM이 취약점 존재 여부 자체를 결정하지 않는다.

---

## 7. 개발 단계

개발은 반드시 단계적으로 진행한다.

### Phase 1 — Repository + Maven Dependency Analysis

목표:

```text
Spring Boot Repository
→ Maven 탐지
→ Dependency 추출
```

필수 기능:

- 로컬 프로젝트 경로 입력
- pom.xml 탐지
- 프로젝트 메타데이터 파싱
- 직접 의존성 추출
- 가능하면 Maven dependency tree 실행
- 전이 의존성 추출
- Dependency 정규화
- DB 저장

### Phase 2 — SBOM + Vulnerability Matching

목표:

```text
Dependencies
→ CycloneDX SBOM
→ OSV
→ Vulnerability Findings
```

필수 기능:

- CycloneDX 호환 Component 생성
- Maven purl 생성
- OSV 조회
- 취약점 메타데이터 저장
- 프로젝트 Dependency와 취약점 매핑

### Phase 3 — React Dashboard + CLI

Web과 CLI는 동일한 분석 Core를 사용해야 한다.

예:

```bash
vulntrace scan ./demo-app
```

초기 React Dashboard:

```text
Projects
Dependencies
Vulnerabilities
Severity
Current Version
Fixed Version
```

분석 엔진이 동작하기 전에 복잡한 UI부터 만들지 않는다.

### Phase 4 — Java Source Usage Analysis

목표:

```text
Vulnerable Dependency
→ Java Source
→ 실제 사용 근거
```

초기 지원:

- import 문
- package 참조
- 객체 생성
- 명확한 Method Call

초기부터 완벽한 Java Semantic Resolution을 구현하지 않는다.

### Phase 5 — Spring Endpoint Analysis

탐지 대상:

```text
@RestController
@Controller
@RequestMapping
@GetMapping
@PostMapping
@PutMapping
@DeleteMapping
@PatchMapping
```

추출:

```text
HTTP Method
Path
Controller Class
Controller Method
```

### Phase 6 — Reachability Analysis

목표:

```text
Spring Endpoint
→ Controller Method
→ Service Method
→ 내부 Method
→ Vulnerable Dependency Usage
```

전체 Call Path를 저장한다.

다음 상태를 구분한다.

```text
dependency exists
dependency is used
vulnerable API is used
vulnerable API is reachable
```

### Phase 7 — Risk Prioritization

Risk Score 입력 예시:

```text
CVSS
직접 / 전이 의존성 여부
실제 소스 사용 여부
취약 API 사용 여부
Reachability
HTTP 노출
인증 필요 여부
공개 Exploit 존재
수정 버전 존재
```

점수는 반드시 설명 가능해야 한다.

### Phase 8 — Remediation

표시 정보:

```text
현재 버전
영향 버전
수정 버전
영향 파일
영향 메서드
도달 가능한 Endpoint
Risk Score 산정 근거
권장 조치
```

LLM 기능은 결정론적 분석 결과가 확보된 이후 선택적으로 추가한다.

---

## 8. 핵심 모듈

### Project Module

역할:

- 프로젝트 등록
- Scan Lifecycle
- 프로젝트 메타데이터 관리

### Dependency Analyzer

역할:

- Maven 프로젝트 탐지
- pom.xml 파싱
- Dependency Tree 실행
- Dependency 정규화
- purl 생성

권장 이름:

```text
MavenDependencyAnalyzer
```

### SBOM Module

역할:

- Dependency 데이터를 CycloneDX 형식으로 정규화
- 필요 시 SBOM Export

### Vulnerability Module

역할:

- 취약점 Provider 조회
- 외부 취약점 데이터 정규화
- Dependency와 Finding 매핑

### Source Analyzer

역할:

- Java 파일 탐색
- Package 탐지
- Import 탐지
- Source Usage 식별

### Spring Analyzer

역할:

- Spring Controller 탐지
- Endpoint Annotation 탐지
- Route 메타데이터 추출

### Reachability Analyzer

역할:

- 지원 가능한 호출 관계 구성
- Endpoint부터 취약 사용 지점까지 Path 탐색
- 전체 Call Path 근거 저장

### Risk Module

역할:

- Risk Score 계산
- 산정 근거 반환
- 점수 계산 로직을 숨기지 않음

---

## 9. 데이터 모델

예상 테이블:

```text
projects
scan_jobs

dependencies
project_dependencies

vulnerabilities
project_vulnerabilities

source_usages

spring_endpoints

methods
method_calls

reachability_paths
```

최종 결론만 저장하지 않는다.

근거 데이터를 보존한다.

---

## 10. API 가이드

권장 Endpoint:

```text
POST   /api/projects
GET    /api/projects
GET    /api/projects/:projectId

POST   /api/projects/:projectId/scans
GET    /api/projects/:projectId/scans

GET    /api/projects/:projectId/dependencies
GET    /api/projects/:projectId/vulnerabilities

GET    /api/findings/:findingId
GET    /api/findings/:findingId/usages
GET    /api/findings/:findingId/reachability
```

Prisma Model을 API 응답에 직접 노출하지 않는다.

명시적인 Application DTO를 사용한다.

---

## 11. CLI 가이드

CLI는 API와 동일한 Core Module을 사용한다.

분석 로직을 중복 구현하지 않는다.

예:

```bash
vulntrace scan ./sample-app
vulntrace dependencies ./sample-app
vulntrace vulnerabilities ./sample-app
vulntrace report ./sample-app
```

---

## 12. 프론트엔드 가이드

사용:

```text
React
TypeScript
Vite
React Router
TanStack Query
```

초기 화면:

### Project List

```text
Project
Last Scan
Dependency Count
Vulnerability Count
```

### Project Dashboard

```text
Dependencies
Vulnerabilities
Critical
High
Used Vulnerabilities
Reachable Vulnerabilities
```

### Vulnerability List

```text
CVE
Dependency
Version
CVSS
Used
Reachable
Risk Score
```

### Vulnerability Detail

```text
CVE 정보
Dependency
현재 버전
수정 버전
사용 근거
Reachability Path
Risk Score 근거
Remediation
```

Frontend는 얇게 유지한다.

보안 분석 로직은 Core / Backend Module에 위치해야 한다.

---

## 13. Monorepo 규칙

Workspace 기반 Monorepo를 권장한다.

가능한 선택:

- pnpm workspace
- npm workspace

Repository 복잡도가 실제로 필요로 하기 전에는 Turborepo, Nx를 추가하지 않는다.

공통 타입:

```text
packages/shared
```

Core 분석 로직은 React에 의존하면 안 된다.

권장 의존 방향:

```text
web
 ↓
shared

api
 ↓
core
 ↓
dependency-analyzer
vulnerability
source-analyzer
spring-analyzer
reachability
risk
```

---

## 14. Java Parsing 규칙

Regex에만 의존하지 않는다.

단, 다음에는 Regex를 사용할 수 있다.

- 프로젝트 탐지
- 가벼운 전처리
- 단순 Fallback Parsing

권장 추상화:

```text
JavaSourceAnalyzer
```

예:

```ts
interface JavaSourceAnalyzer {
  analyzeProject(projectPath: string): Promise<JavaAnalysisResult>;
}
```

첫 버전은 TypeScript 기반 구현을 사용할 수 있다.

향후 Java 프로세스로 위임하더라도 호출부는 변경되지 않도록 추상화한다.

---

## 15. 외부 프로세스 실행 규칙

필요한 경우 Node.js에서 외부 도구 실행을 허용한다.

예:

```text
mvn dependency:tree
mvn help:effective-pom
java -jar java-analyzer.jar
```

규칙:

- 안전하지 않은 Shell String 연결 대신 `spawn` / `execFile` 사용
- Argument 검증
- Timeout 적용
- stdout / stderr 수집
- 실패 원인 기록
- 사용자 입력을 임의 Shell Command로 실행하지 않음
- 분석 대상 Repository를 신뢰하지 않는 입력으로 취급

---

## 16. Scanner 보안 원칙

VulnTrace는 방어 목적의 보안 도구다.

분석 대상 Repository는 신뢰하지 않는 입력으로 간주한다.

다음은 자동으로 수행하지 않는다.

- 애플리케이션 소스 코드 실행
- 프로젝트 Startup Script 실행
- Repository 내부 임의 Shell Script 실행
- 보안 검토 없이 프로젝트가 제어하는 임의 Maven Plugin 실행

가능하면 정적 분석을 우선한다.

---

## 17. 테스트 전략

### Unit Test

필수:

```text
pom.xml 파싱
Dependency 정규화
purl 생성
OSV 응답 정규화
Risk Scoring
Spring Route 추출
```

### Fixture Project

다음 테스트 프로젝트를 유지한다.

```text
fixtures/
├── spring-safe-app/
├── spring-vulnerable-unused/
├── spring-vulnerable-used/
└── spring-vulnerable-reachable/
```

### Case A

```text
취약 Dependency 존재
하지만 소스에서 미사용
```

결과:

```text
used = false
reachable = false
```

### Case B

```text
취약 Dependency 사용
하지만 Endpoint에서는 도달 불가
```

결과:

```text
used = true
reachable = false
```

### Case C

```text
취약 Dependency 사용
Spring Endpoint에서 도달 가능
```

결과:

```text
used = true
reachable = true
```

---

## 18. 코딩 규칙

TypeScript Strict Mode를 사용한다.

선호:

```text
명확한 Domain Type
작은 Module
의존성 역전
분석 변환 로직은 Pure Function 우선
명확한 Result / Error Model
```

지양:

```text
any
거대한 Service Class
CommonUtil
HelperManager
숨겨진 Global State
Module 간 Circular Dependency
```

좋은 Naming:

```text
MavenDependencyAnalyzer
CycloneDxBuilder
OsvVulnerabilityProvider
JavaSourceAnalyzer
SpringEndpointAnalyzer
ReachabilityAnalyzer
RiskScoreCalculator
```

---

## 19. 오류 처리

분석 실패를 조용히 무시하지 않는다.

명확한 Scan 상태를 사용한다.

예:

```text
PENDING
RUNNING
PARTIAL
COMPLETED
FAILED
```

성공한 단계의 결과는 보존한다.

---

## 20. 로깅

권장 로그:

```text
[SCAN] scan started
[PROJECT] Maven project detected
[DEPENDENCY] 143 dependencies found
[SBOM] SBOM generated
[VULN] 12 vulnerable dependencies found
[SOURCE] 5 dependencies used by source
[SPRING] 18 endpoints discovered
[REACHABILITY] 2 reachable findings
[SCAN] scan completed
```

Repository Credential, Access Token, Secret은 로그에 남기지 않는다.

---

## 21. Claude Code 작업 규칙

변경 전:

1. 이 파일을 읽는다.
2. 기존 Repository 구조를 확인한다.
3. 현재 개발 Phase를 확인한다.
4. 요청받지 않은 미래 Phase 기능은 구현하지 않는다.
5. 영향 파일과 테스트 범위를 확인한다.

구현 시:

1. 가장 작은 동작 가능한 변경을 우선한다.
2. 이유 없이 정상 동작 중인 Module을 재작성하지 않는다.
3. 필요하지 않은 Dependency를 추가하지 않는다.
4. 존재하지 않는 외부 API를 임의로 만들지 않는다.
5. 검증 없이 정상 동작한다고 주장하지 않는다.
6. Frontend와 분석 로직을 분리한다.
7. 분석 Module은 API와 CLI 모두에서 재사용 가능해야 한다.
8. Java 전용 로직은 Analyzer 추상화 뒤에 둔다.
9. 분석 대상이 Java라는 이유만으로 Backend를 Java로 마이그레이션하지 않는다.
10. 보안 Finding에는 근거를 보존한다.

변경 후:

1. Typecheck 실행
2. Test 실행
3. 필요한 경우 Build 실행
4. 실패 결과 보고
5. 알려진 한계 보고

---

## 22. Claude Code 작업 형식

비단순 작업은 다음 순서로 진행한다.

### PLAN

```text
목표
현재 Phase
영향 Module
현재 동작
목표 동작
구현 방식
위험 요소
검증 방식
```

### ACT

현재 Task에 필요한 범위만 구현한다.

### VERIFY

다음을 보고한다.

```text
변경 파일
Typecheck 결과
Test 결과
Build 결과
알려진 한계
다음 권장 작업
```

관련 없는 코드는 수정하지 않는다.

---

## 23. MVP 완료 기준

첫 MVP는 다음이 End-to-End로 동작하면 완료로 본다.

```text
1. 사용자가 로컬 Spring Boot Maven 프로젝트 경로 입력
2. VulnTrace가 pom.xml 탐지
3. 직접 의존성 추출
4. 전이 의존성 추출
5. purl 생성
6. CycloneDX SBOM 생성
7. OSV 조회
8. Vulnerability Finding 저장
9. CLI에서 취약점 결과 출력
10. React Dashboard에서 취약점 결과 표시
11. 기본 Java Import 사용 여부 탐지
12. Source Usage 근거 표시
```

Reachability는 MVP 1의 필수 조건이 아니다.

---

## 24. 장기 목표

최종 아키텍처:

```text
React Web
    │
    ├───────────────┐
    │               │
Node.js API      TypeScript CLI
    │               │
    └───────┬───────┘
            ↓
      VulnTrace Core
            ↓
 ┌──────────┼──────────┐
 ↓          ↓          ↓
Dependency  Vuln       Source
Analyzer    Matcher    Analyzer
            │
            ↓
      Spring Analyzer
            ↓
      Reachability
            ↓
       Risk Scoring
            ↓
       PostgreSQL

향후 선택적 구성:

TypeScript
    ↓
Java Analyzer Adapter
    ↓
Java AST / Symbol 전용 Analyzer
```

향후 전문 Java 분석기를 추가하더라도 전체 프로젝트는 TypeScript 중심 구조를 유지한다.

최종 시스템은 다음 질문에 답할 수 있어야 한다.

> 어떤 취약점을 먼저 수정해야 하는가? 어느 코드가 해당 취약점을 사용하는가? 외부 요청에서 어떻게 도달 가능한가? 그 판단을 뒷받침하는 근거는 무엇인가?
