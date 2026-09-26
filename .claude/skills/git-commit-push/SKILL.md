---
name: git-commit-push
description: 변경사항을 확인하고, 적절한 커밋 메시지를 작성해 커밋한 뒤 원격 저장소로 push까지 자동으로 수행합니다. "커밋하고 푸시해줘", "commit and push", "변경사항 반영해줘" 같은 요청에 사용하세요.
---

# Git Commit & Push

현재 작업 디렉토리의 변경사항을 커밋하고 push까지 한 번에 처리한다.

## 절차

1. **현재 상태 파악 (병렬 실행)**
   - `git status` — 추적되지 않은 파일 확인
   - `git diff` — 스테이징되지 않은 변경사항 확인
   - `git diff --staged` — 이미 스테이징된 변경사항 확인
   - `git log --oneline -10` — 이 저장소의 커밋 메시지 스타일 파악
   - `git branch --show-current` 및 `git rev-parse --abbrev-ref --symbolic-full-name @{u}` — 현재 브랜치와 upstream 존재 여부 확인 (upstream 없으면 3단계 참고)

2. **변경 내용이 없으면 중단**
   - 스테이징되지 않은 변경사항도, 추적되지 않은 파일도 없으면 그대로 사용자에게 보고하고 종료한다. 빈 커밋을 만들지 않는다.

3. **스테이징 전 점검**
   - `git add`는 파일을 명시적으로 지정한다 (`git add -A`, `git add .` 금지). 의도치 않은 대용량 바이너리나 `.env`, credentials, 키 파일 등 민감 정보가 포함되지 않았는지 파일 목록을 확인한다.
   - 스테이징 후 `git status`로 실제 포함된 파일을 다시 확인하고, 파일명이 무해해 보여도 의심스러우면 내용을 확인한다.

4. **커밋 메시지 작성**
   - 변경의 "왜"에 집중한 1~2문장 요약. 어떤 종류의 변경인지(기능 추가/버그 수정/리팩터링 등) 정확히 반영한다.
   - 저장소의 기존 커밋 메시지 스타일(2단계 `git log` 결과)을 따른다.
   - 메시지는 항상 HEREDOC으로 전달해 포맷을 보존한다:
     ```bash
     git commit -m "$(cat <<'EOF'
     <커밋 메시지>

     Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
     EOF
     )"
     ```
   - 시스템 프롬프트에 다른 attribution 지침이 주어져 있다면 그것을 우선 따른다.

5. **커밋**
   - hook을 건너뛰지 않는다 (`--no-verify` 금지). 기존 커밋을 `--amend`하지 않고 항상 새 커밋을 만든다.
   - pre-commit hook이 실패하면 원인을 고쳐 다시 스테이징하고 새 커밋을 만든다.

6. **push**
   - upstream이 설정되어 있으면 `git push`.
   - upstream이 없으면 `git push -u origin <현재 브랜치>`.
   - **강제 push(`--force`, `--force-with-lease`)는 사용자가 명시적으로 요청하지 않는 한 절대 사용하지 않는다.** push가 거부되면 이유(reject 메시지)를 그대로 보고하고, 임의로 force push나 `reset --hard`로 해결하려 하지 않는다.
   - `master`/`main`으로의 force push는 사용자가 요청하더라도 반드시 먼저 경고한다.

7. **결과 보고**
   - 커밋 해시, 커밋 메시지 요약, push된 브랜치/원격을 간단히 보고한다.
   - push가 실패했다면 실패 사유와 다음에 필요한 조치를 명시한다.

## 주의사항

- 이 스킬은 사용자가 명시적으로 호출했을 때만 커밋과 push를 함께 수행한다. 스킬 밖에서 임의로 push하지 않는다.
- PR 생성이 필요한 경우(예: `master`에 직접 push할 수 없는 워크플로우)는 이 스킬의 범위가 아니며, 별도로 `gh pr create` 흐름을 사용한다.
- 커밋 대상 브랜치가 `master`/`main`이고 원격에 다른 사람의 커밋이 먼저 push되어 있다면(`push` 시 non-fast-forward 오류), 임의로 `pull --rebase`나 병합을 수행하지 말고 사용자에게 확인한다.
