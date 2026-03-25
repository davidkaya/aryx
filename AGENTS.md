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

## 5. Backend conventions (sidecar / C#)

These rules apply to all backend work under `sidecar\src` and `sidecar\tests`.

### Design and decomposition

- Keep backend code organized around clear responsibilities. Separate protocol handling, orchestration/workflow coordination, domain validation, external tool/process integration, and projection/mapping logic instead of blending them into one class or method.
- Prefer small, single-purpose methods over long procedural flows. If a method starts handling parsing, validation, state mutation, output formatting, and error handling together, split it.
- When a backend class grows multiple behavioral branches, prefer extracting focused helpers or internal collaborators rather than adding more nested conditionals.
- Reuse shared helpers for normalization, lookup, mapping, and repeated heuristics. Do not duplicate string cleanup, identifier resolution, event shaping, or path/tool resolution logic across services.

### Contracts and protocol safety

- Preserve public behavior and wire contracts by default. Refactors must not silently change DTO shapes, event ordering, command names, approval semantics, or serialized field names unless the task explicitly requires it.
- Keep protocol-related literals, decision names, activity types, and command/event types explicit and easy to audit. Avoid scattering the same backend protocol rules across unrelated methods.
- Prefer type-safe handling over reflection, loosely typed object plumbing, or stringly-typed branching when a direct C# model or pattern match is available.

### State, concurrency, and error handling

- Keep mutable state narrow and intentional. Shared state should be minimized, local when possible, and thread-safe when it must be shared.
- Make state transitions explicit. For backend coordination code, prefer code that makes ownership, lifecycle, and pending/completed/error states obvious on first read.
- Do not swallow backend exceptions unless the behavior intentionally converts them into diagnostics, protocol errors, or user-facing status. When you intentionally catch and continue, keep the fallback explicit and consistent.
- Avoid hidden side effects. Methods that mutate state, enqueue work, emit protocol events, or call external processes should read clearly as doing so.

### Clean backend implementation rules

- Avoid monolithic switch statements or giant orchestration methods when the branches can be cleanly dispatched through named helpers or handler maps.
- Keep heuristics and transformation rules named and localized. For parsing, transcript projection, merge behavior, and similar logic, extract the decision points into clearly named helpers.
- Do not leave dead branches, unused helpers, commented-out backend code, or temporary diagnostics behind.
- Prefer maintainable defaults over clever shortcuts. Backend code should optimize for debuggability, explicitness, and operational safety.

### Backend tests

- Every backend refactor must preserve or improve backend test coverage. If you replace internal mechanics, update the tests so the behavioral contract stays protected.
- Add focused regression tests for edge cases when refactors replace brittle logic, remove reflection, centralize heuristics, or change internal dispatch structure.
- Keep backend test setup readable. Prefer small builders/factories/helpers over repetitive inline setup once the same object graphs appear in multiple tests.

## 6. Frontend conventions (renderer)

### Component organization

The renderer follows a feature-based directory structure under `src/renderer/components/`:

```
components/
  ui/            → Shared UI primitives (ToggleSwitch, FormField, TextInput, etc.)
  chat/          → Chat feature components (InlinePills, ApprovalBanner, ThinkingDots)
  settings/      → Settings feature components (McpServerEditor, LspProfileEditor, ToolingEditorShell)
  pattern-graph/ → Pattern graph visualization
  *.tsx          → Top-level page/panel components (ChatPane, Sidebar, PatternEditor, etc.)
```

When adding new components:

- If it is a **reusable, domain-agnostic UI primitive** (button, input, toggle, callout), put it in `components/ui/` and re-export from `components/ui/index.ts`.
- If it is a **feature-specific sub-component** extracted from a larger component, put it in the matching feature directory (`chat/`, `settings/`, etc.). Create the directory if it does not exist yet.
- If it is a **top-level screen or panel**, it stays directly in `components/`.
- Keep component files under ~300 lines. When a file exceeds that, extract sub-components or helper hooks into the appropriate feature directory.

### Custom hooks

Custom hooks live in `src/renderer/hooks/`. Each hook gets its own file. Current hooks:

- `useClickOutside` — shared click-outside-to-dismiss behavior
- `useAppHooks` — app-level state hooks (`useTheme`, `useSidecarCapabilities`)

When extracting repeated stateful patterns, create a new hook here rather than duplicating `useEffect`/`useRef` logic across components.

### Lib utilities

Pure helper functions (no React imports) live in `src/renderer/lib/`. Current modules include `settingsHelpers.ts` (mutation/string helpers), `chatMarkdown.tsx`, `markdownEditor.ts`, `patternGraph.ts`, and others.

Keep a clear boundary: `lib/` for pure logic and data transforms, `hooks/` for React-aware stateful patterns, `components/` for rendered elements.

### State and rendering

- Stabilize callbacks passed as props with `useCallback`. Stabilize computed objects with `useMemo` when the consumer uses reference equality (e.g. inside `useEffect` dependency arrays or when passed to memoized children).
- Do not over-memoize. Simple, cheap computations do not need `useMemo`.
- Prefer lifting shared state into the nearest common parent rather than duplicating it across siblings.

### Accessibility

Every interactive component must include basic accessibility:

- Modals and dialogs: `role="dialog"`, `aria-modal="true"`, `aria-labelledby`, Escape-to-close.
- Dropdowns and popovers: `aria-expanded`, `aria-haspopup`, `role="listbox"` / `role="option"` as appropriate.
- Context menus: `role="menu"`, `role="menuitem"`, Escape-to-close.
- Toggle buttons: `aria-pressed`.
- Clickable non-button elements: must be keyboard-activatable with both Enter and Space.
- Alerts and status regions: `role="alert"` or `aria-live`.
- Loading indicators: `aria-label` describing the state.

### Imports and barrel exports

- Import shared UI primitives via the barrel: `import { ToggleSwitch, FormField } from '@renderer/components/ui'`.
- Feature sub-components are imported directly by path: `import { InlinePills } from '@renderer/components/chat/InlinePills'`.
- Use `@renderer/` and `@shared/` path aliases; do not use relative paths that cross directory boundaries (e.g. `../../shared/`).

## 7. Repository workflow expectations

- Use Bun for dependency management and script execution.
- Prefer repository-local tooling over global machine state whenever possible.
- For upstream behavior analysis, local source clones are available at `..\agent-framework` and `..\copilot-sdk`. Prefer inspecting those repositories directly when validating Agent Framework or Copilot SDK semantics instead of guessing from memory.
- Keep changes focused and reviewable. Avoid mixing unrelated concerns into a single change.
- Always commit completed repository changes before handing work off. If unrelated pre-existing changes are present in the worktree, stop and ask the user how to proceed before creating the commit.
- Do not mark work as done until both the implementation and its verification are complete.

## 8. Planning requirements

- If a task spans both backend and frontend work, the implementation plan must be split into **Part 1 — Backend** and **Part 2 — Frontend**. The Frontend part will be launched manually by the user.
- Backend work must be planned and executed first.
- Before frontend work begins, backend work must produce a handover artifact in the session workspace `files\` directory. Do not put this handover document in the repository.
- The frontend phase must consume that backend handover artifact and build on it rather than rediscovering backend contracts from scratch.

## 9. Validation checklist

Before every commit, run the following in order:

1. If the change touches backend C# code, run `bun run sidecar:test`.
2. If the change touches frontend or shared TypeScript code, run `bun run typecheck` and `bun test`.
3. Run the relevant build for the surfaces you changed. For full application changes, run `bun run build`. For backend-only work, `bun run sidecar:build` is the minimum required build validation.

When a change spans both frontend and backend, run the full validation path: `bun run typecheck`, `bun test`, `bun run sidecar:test`, and `bun run build`.

Do not commit if any step fails. Fix the issue first.
