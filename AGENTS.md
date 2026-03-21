# Agent Guidelines

These instructions apply to any automated or semi-automated agent working in this repository.

## Core delivery standards

- Keep commits atomic. Each commit should represent one logical change and use a Conventional Commit message such as `feat:`, `fix:`, `refactor:`, `docs:`, `test:`, or `chore:`.
- Treat tests as part of the implementation, not as follow-up work. Every fix, behavior change, and new feature must be covered by tests, and the relevant test suite must pass before the work is considered complete.
- Do not ship quick fixes, hacks, or "temporary" patches as final solutions. Take the time to understand the problem, plan the change, and implement a maintainable solution that fits the codebase cleanly.
- Apply the same quality bar to feature work. Think through scope, edge cases, integration points, and long-term maintainability before implementing.
- When adding or updating dependencies, use the latest stable version available. If a non-latest version is required for compatibility, document the reason explicitly in the change.

## Repository workflow expectations

- Use Bun for dependency management and script execution.
- Prefer repository-local tooling over global machine state whenever possible.
- Keep changes focused and reviewable. Avoid mixing unrelated concerns into a single change.
- Always commit completed repository changes before handing work off. If unrelated pre-existing changes are present in the worktree, stop and ask the user how to proceed before creating the commit.
- Do not mark work as done until both the implementation and its verification are complete.
