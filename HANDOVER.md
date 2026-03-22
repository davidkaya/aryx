# Handover: Copilot connection status UI

This document is for the frontend/UX model that will build the user-facing experience on top of the backend changes implemented in this task.

## Goal

Build UI for the roadmap's highest-priority backend work:

- show whether Kopaya can reach GitHub Copilot successfully
- explain why it cannot when something is wrong
- let the user refresh capability status after installing or logging into Copilot CLI

Do **not** build raw provider-secret management UI for this flow. Kopaya currently relies on the system-installed GitHub Copilot CLI rather than storing provider API keys itself.

## Backend changes already implemented

### 1. `SidecarCapabilities` now includes connection diagnostics

File: `src/shared/contracts/sidecar.ts`

New field:

```ts
connection: {
  status: 'ready' | 'copilot-cli-missing' | 'copilot-auth-required' | 'copilot-error';
  summary: string;
  detail?: string;
  copilotCliPath?: string;
  checkedAt: string;
}
```

This comes from the .NET sidecar and is included alongside `runtime`, `modes`, and `models`.

### 2. There is now a refreshable backend API

Files:

- `src/shared/contracts/ipc.ts`
- `src/shared/contracts/channels.ts`
- `src/preload/index.ts`
- `src/main/ipc/registerIpcHandlers.ts`
- `src/main/KopayaAppService.ts`

New renderer-callable method:

```ts
window.kopayaApi.refreshSidecarCapabilities()
```

This bypasses the cached capability result in `KopayaAppService` and fetches a fresh capability payload from the sidecar. Use this for Retry / Refresh buttons after the user fixes CLI install or login state.

### 3. Sidecar diagnostics now distinguish common failure modes

Files:

- `sidecar/src/Kopaya.AgentHost/Services/CopilotCliPathResolver.cs`
- `sidecar/src/Kopaya.AgentHost/Services/SidecarProtocolHost.cs`
- `sidecar/src/Kopaya.AgentHost/Contracts/ProtocolModels.cs`

The backend now reports:

- `ready`: Copilot CLI was found and model listing succeeded
- `copilot-cli-missing`: Kopaya could not find the `copilot` command on `PATH`
- `copilot-auth-required`: Copilot CLI exists, but the error looks like login/auth is required
- `copilot-error`: Copilot CLI exists, but model loading failed for another reason

### 4. Validation status

Validated successfully after the change:

- `bun test`
- `dotnet test sidecar\Kopaya.AgentHost.slnx` using an alternate build output path to avoid a locked local executable in the shared environment

## Important architecture note

Kopaya currently does **not** manage provider credentials directly for this path.

The sidecar resolves the system-installed `copilot` command and uses that runtime. That means the near-term UI should be about:

- install state
- login state
- connection health
- model availability
- refresh / retry

It should **not** ask the user for OpenAI, Anthropic, or Google secrets as part of this specific Copilot status flow.

## Current renderer integration point

File: `src/renderer/App.tsx`

On mount, the renderer already does:

```ts
api.describeSidecarCapabilities().then(setSidecarCapabilities)
```

This state is already stored in:

```ts
const [sidecarCapabilities, setSidecarCapabilities] = useState<SidecarCapabilities>();
```

So the frontend work is mostly about:

1. reading `sidecarCapabilities.connection`
2. rendering the right UX state
3. calling `api.refreshSidecarCapabilities()` when the user retries

## Recommended UI states

### `ready`

Show:

- positive connected state
- connection summary
- model count (`sidecarCapabilities.models.length`)
- optional advanced details like CLI path and last checked time

Good copy direction:

- "Connected to GitHub Copilot"
- "19 models available"

### `copilot-cli-missing`

Show:

- an actionable install state
- summary from backend
- detail text in an expandable "technical details" area
- a Refresh button that calls `refreshSidecarCapabilities()`

Good copy direction:

- "GitHub Copilot CLI not found"
- "Install the `copilot` CLI and make sure it is available on PATH"

### `copilot-auth-required`

Show:

- an actionable login state
- summary from backend
- technical details if available
- a Refresh button after the user logs in externally

Good copy direction:

- "GitHub Copilot needs sign-in"
- "Finish login in the Copilot CLI, then refresh"

### `copilot-error`

Show:

- a generic error state
- summary from backend
- `detail` in a technical details area
- Refresh button

Good copy direction:

- "Kopaya found Copilot, but could not load models"

## Recommended frontend implementation shape

### Suggested state additions in `App.tsx`

- keep using the existing `sidecarCapabilities` state
- add a small `isRefreshingCapabilities` boolean state
- create a refresh handler that calls `api.refreshSidecarCapabilities()`

Example shape:

```ts
const refreshCapabilities = async () => {
  setIsRefreshingCapabilities(true);
  try {
    const capabilities = await api.refreshSidecarCapabilities();
    setSidecarCapabilities(capabilities);
  } finally {
    setIsRefreshingCapabilities(false);
  }
};
```

### Suggested component split

Any of these would be reasonable:

- a new `CopilotStatusCard` in settings
- a small status section near model/pattern settings
- a dedicated connectivity block in the settings panel

### Suggested UX details

- treat `detail` as secondary, not primary
- show the backend `summary` prominently
- expose CLI path only in advanced details
- keep the empty/loading state graceful
- do not block the rest of the app if capabilities are degraded

## What is intentionally not implemented yet

These are still future enhancements, not part of this backend change:

- actual GitHub account or org identity reporting
- CLI version reporting
- an in-app "log in to Copilot" action
- push-based status updates when the external CLI state changes
- direct provider credential storage for OpenAI / Anthropic / Google

## Suggested follow-up order for the frontend model

1. Add a settings/status UI for `sidecarCapabilities.connection`
2. Add a Refresh button using `refreshSidecarCapabilities()`
3. Surface model count and summary in the connected state
4. Add expandable technical details for `detail` and `copilotCliPath`
5. Keep future direct-provider credential UX separate from this Copilot flow
