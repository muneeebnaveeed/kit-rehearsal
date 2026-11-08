// The CI jobs (see .github/workflows/ci.yml) every ruleset requires, and that the commands opening PRs
// wait for. required-checks.test.ts fails if this list, ci.yml and the rulesets drift apart.
export const REQUIRED_CHECKS = ["🧰 setup", "📝 config", "🧹 lint", "🔎 typecheck", "🧪 test", "📦 build"];
