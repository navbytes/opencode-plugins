# Repository automation

All code changes go through pull requests. Draft PRs skip expensive CI; mark a PR ready to validate its latest revision. Superseded PR runs cancel. Documentation-only changes skip product checks; no paid runner waits or duplicate main-branch validation.

Prepare a release by opening a PR with the version bump and release notes. A manual merge or an explicit instruction to a local agent to release authorizes publication after all required checks pass. “Prepare a release” stops at the PR. Never bypass checks or automatically merge dependency or release PRs. Repositories without a publishing destination do not need artificial releases.

Routine dependencies are grouped weekly; security updates remain immediate. Production schedules and existing external publishing approval gates remain in force.

Prepare a release with local gh: bump the selected packages/<name>/package.json, update bun.lock and that package’s CHANGELOG.md, then open a PR. After Required CI passes, merging publishes the merged package version using the existing publish.yml OIDC identity. Tag-trigger event suppression is handled by explicit workflow dispatch. Manual Release retries publication; it never bumps versions or writes to main.
