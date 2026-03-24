# Agent Guidelines

These instructions apply to any automated or semi-automated agent working in this repository.

## 1. Non-negotiable engineering principles

- Follow repository-specific conventions first. When the repository does not define a convention, always follow the most common globally accepted conventions for the language, framework, platform, and tooling you are working in.
- Write code that is clean, well structured, readable, and maintainable by default. Treat this as a hard requirement, not a preference.
- Prefer idiomatic, ecosystem-native solutions over clever, surprising, or custom patterns.
- Choose designs that a strong maintainer in that technology would expect on first read.
- Keep implementations cohesive, predictable, and easy to reason about. Avoid unnecessary abstraction, indirection, or complexity.

## 2. Technology convention rules

- Always apply the dominant conventions of the specific technology you touch. Do not mix patterns from one ecosystem into another when they are not idiomatic there.
- Use official language and framework guidance as the default source of truth when repository conventions are absent.
- Match the naming, file organization, error-handling style, typing model, testing style, and architectural patterns that are most commonly used by mature projects in that ecosystem.
- If a repository convention conflicts with a global convention, follow the repository convention unless it would clearly reduce correctness or maintainability.

### Examples

- **TypeScript / JavaScript**: prefer idiomatic modern TypeScript and standard JavaScript conventions, clear module boundaries, strong typing, descriptive names, `camelCase` for values and functions, `PascalCase` for types and components, and avoidance of `any` unless genuinely unavoidable.
- **C# / .NET**: follow standard .NET conventions, `PascalCase` for public types and members, `camelCase` for locals and parameters, clear class and namespace organization, proper async/await usage with `Async` suffixes, and nullable-aware, type-safe code.
- **SQL / database code**: write explicit, readable queries; use clear naming; prefer maintainable schema and query structure over compact but opaque statements.
- **Tests**: use the testing patterns most natural to the framework in use, keep tests behavior-focused and readable, and favor clear setup/action/assertion flow.
- **Other technologies**: default to the mainstream conventions most widely used by that ecosystem's official documentation and production-grade projects.

## 3. Code quality and structure

- Code must always be clean and well structured.
- Keep files, modules, classes, and functions focused on a single responsibility.
- Separate concerns clearly and maintain sensible boundaries between UI, domain logic, data access, infrastructure, and tests where applicable.
- Prefer simple control flow, explicit intent, and low cognitive overhead.
- Avoid duplication when a shared abstraction improves clarity and maintainability.
- Prefer composition and small reusable units over sprawling functions, deep inheritance, or tightly coupled code.
- Make invalid states difficult to represent through types, structure, or APIs whenever the technology supports it.
- Add comments only when they explain intent, reasoning, or non-obvious behavior that the code itself cannot communicate clearly.

## 4. Core delivery standards

- Keep commits atomic. Each commit should represent one logical change and use a Conventional Commit message such as `feat:`, `fix:`, `refactor:`, `docs:`, `test:`, or `chore:`.
- Treat tests as part of the implementation, not as follow-up work. Every fix, behavior change, and new feature must be covered by tests, and the relevant test suite must pass before the work is considered complete.
- Always check whether `README.md` needs an update before handing work off. If the change affects user-facing behavior, workflows, prerequisites, installation, packaging, or product positioning, update the README in the same change.
- Always check whether `ARCHITECTURE.md` needs an update before handing work off. If the change affects runtime boundaries, data flow, persistence, IPC, orchestration, tooling integration, packaging, or other material technical design, update `ARCHITECTURE.md` in the same change.
- Do not ship quick fixes, hacks, or "temporary" patches as final solutions. Take the time to understand the problem, plan the change, and implement a maintainable solution that fits the codebase cleanly.
- Remove code that is no longer necessary before handing work off. If an experiment, workaround, hotfix, helper, or test path does not end up being part of the final correct solution, delete it rather than leaving dead or misleading code behind.
- Apply the same quality bar to feature work. Think through scope, edge cases, integration points, and long-term maintainability before implementing.
- When adding or updating dependencies, use the latest stable version available. If a non-latest version is required for compatibility, document the reason explicitly in the change.

## 5. Repository workflow expectations

- Use Bun for dependency management and script execution.
- Prefer repository-local tooling over global machine state whenever possible.
- Keep changes focused and reviewable. Avoid mixing unrelated concerns into a single change.
- When the user asks only for a plan, stay in planning flow: analyze the codebase, clarify scope as needed, and write or update the plan, but do not begin implementation until the user explicitly asks you to start the work.
- Do not trigger workflow or mode transitions that implicitly approve or begin implementation unless the user has explicitly requested that transition.
- Always commit completed repository changes before handing work off. If unrelated pre-existing changes are present in the worktree, stop and ask the user how to proceed before creating the commit.
- Do not mark work as done until both the implementation and its verification are complete.
