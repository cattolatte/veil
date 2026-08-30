# Release process

Every milestone PR that changes behaviour gets a tag and a GitHub release. The
point is a legible record of what worked when — useful for the write-up, and
useful for bisecting a regression the night before the finale.

## Scheme

`v<MAJOR>.<MINOR>.<PATCH>-<stage>`

| Stage | Meaning |
|---|---|
| `alpha` | Scaffolding. Does not run end to end. |
| `beta` | A rubric component works and is measured. |
| `rc` | Feature complete, running in both browsers, all five metrics measured. |
| *(none)* | Submission build. |

`MINOR` increments per milestone. `PATCH` for fixes that do not add capability.

## On every milestone merge

```bash
git checkout main && git pull
git tag -a v0.7.0-beta -m "Milestone 7 — <what changed>"
git push origin v0.7.0-beta
gh release create v0.7.0-beta --title "v0.7.0-beta — <name>" --notes "<what and why>" --prerelease
```

Drop `--prerelease` only for `rc` and the submission build.

## Rule

A release note states which rubric component moved and by how much. "Improved
detection" is not a release note. "Detection F1 84.9% → 91.2%; canvas recall
0% → 73%" is.
