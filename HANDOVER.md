# Handover: Copilot version + account context UI

This document is for the frontend/UX agent that will extend the existing Copilot connection UI.

## Goal

Build on top of the current Settings → `AI Provider` → `Connection` view so it can show:

- whether the installed Copilot CLI is current or outdated
- which GitHub account Copilot is currently using
- organization context when it can be discovered

Do **not** add provider-secret management for this flow. Kopaya still relies on the system-installed GitHub Copilot CLI.

## Backend changes now implemented

### 1. `SidecarCapabilities.connection` has new structured fields

File: `src/shared/contracts/sidecar.ts`

New payload shape:

```ts
connection: {
  status: 'ready' | 'copilot-cli-missing' | 'copilot-auth-required' | 'copilot-error';
  summary: string;
  detail?: string;
  copilotCliPath?: string;
  checkedAt: string;
  copilotCliVersion?: {
    status: 'latest' | 'outdated' | 'unknown';
    installedVersion?: string;
    latestVersion?: string;
    detail?: string;
  };
  account?: {
    authenticated: boolean;
    login?: string;
    host?: string;
    authType?: string;
    statusMessage?: string;
    organizations?: string[];
  };
}
```

### 2. Version state is now resolved by the sidecar

Files:

- `sidecar/src/Kopaya.AgentHost/Services/CopilotConnectionMetadataResolver.cs`
- `sidecar/src/Kopaya.AgentHost/Services/SidecarProtocolHost.cs`

The sidecar now runs `copilot version` and classifies the result as:

- `latest`: the CLI explicitly reported that the install is current
- `outdated`: the CLI reported that a newer version is available
- `unknown`: the version command timed out, failed, or did not return a recognizable update state

Important nuance:

- this **does not** change `connection.status`
- `connection.status` still means install/auth/model-list health
- version freshness is a separate concern and should be rendered separately in the UI

### 3. Account context is now resolved by the sidecar

Files:

- `sidecar/src/Kopaya.AgentHost/Services/CopilotConnectionMetadataResolver.cs`
- `sidecar/src/Kopaya.AgentHost/Services/SidecarProtocolHost.cs`

The sidecar now uses the Copilot SDK auth-status call to populate:

- `account.authenticated`
- `account.login`
- `account.host`
- `account.authType`
- `account.statusMessage`

### 4. Organization context is best-effort

When the Copilot auth status provides a login + host, the sidecar also makes a best-effort `gh` CLI lookup for org memberships:

- it verifies the `gh` authenticated user matches the Copilot login on the same host
- if that succeeds, it fetches `user/orgs`
- those org logins are returned as `account.organizations`

Important nuance:

- `organizations` may be missing entirely
- that can mean `gh` is not installed, not authenticated, lacks `read:org`, timed out, or the accounts did not match
- the frontend should treat organizations as optional enhancement data, not a guaranteed field

## Files changed

Backend / shared contracts:

- `src/shared/contracts/sidecar.ts`
- `sidecar/src/Kopaya.AgentHost/Contracts/ProtocolModels.cs`
- `sidecar/src/Kopaya.AgentHost/Services/SidecarProtocolHost.cs`
- `sidecar/src/Kopaya.AgentHost/Services/CopilotConnectionMetadataResolver.cs`

Tests:

- `sidecar/tests/Kopaya.AgentHost.Tests/SidecarProtocolHostTests.cs`
- `sidecar/tests/Kopaya.AgentHost.Tests/CopilotConnectionMetadataResolverTests.cs`

## Validation status

Validated successfully after the change:

- `bun test`
- `dotnet test sidecar\Kopaya.AgentHost.slnx -p:BaseOutputPath="<session-sidecar-build-path>"`

## Current renderer state

There is already a Copilot settings surface:

- `src/renderer/components/SettingsPanel.tsx`
- `src/renderer/components/CopilotStatusCard.tsx`

Current behavior:

- shows connection readiness / missing CLI / auth required / generic error
- shows model count, CLI path, and checked timestamp
- **does not yet render** the new `copilotCliVersion` or `account` fields

## Recommended frontend follow-up

### 1. Show the active GitHub account prominently

Good options:

- a compact identity row like `davidkaya · github.com`
- a small pill/chip under the connection status
- a labeled metadata grid in the expanded details area

Suggested fallback behavior:

- if `account.login` exists, show it
- if `account.host` exists, show it next to the login
- if `account.statusMessage` exists but login is missing, use that as secondary text

### 2. Show CLI freshness as a separate badge/state

Recommended mapping:

- `latest` → subtle positive/neutral badge like `Up to date`
- `outdated` → amber warning badge like `Update available`
- `unknown` → low-emphasis muted label like `Version unknown`

Good details to show in the expanded area:

- installed version
- latest version (when known)
- raw `detail` text only as secondary / technical detail

### 3. Show organizations only when present

If `account.organizations` exists and has values:

- render them as small pills/tags
- cap the visible count if the list is long
- consider `+N more` if there are many

If it is missing:

- do not show an empty placeholder
- fall back to host/account info instead

### 4. Keep account/version separate from the main connection summary

Do **not** overload the existing top-level connection state.

Recommended mental model:

- main status row = “Can Kopaya use Copilot right now?”
- version badge = “Should the CLI be updated?”
- account info = “Who is Kopaya connected as?”
- org pills = “What org context is discoverable?”

## Suggested UI copy

For account:

- `Signed in as davidkaya`
- `github.com`

For version:

- `Copilot CLI is up to date`
- `Copilot CLI update available`
- `Could not determine Copilot CLI version`

For orgs:

- `Organizations`

## Non-goals of this backend change

Still not implemented:

- an in-app `copilot update` action
- an in-app `copilot login` action
- direct provider credentials for OpenAI / Anthropic / Google
- guaranteed authoritative “active organization” selection semantics

The new org data is “best effort discovered context,” not a firm entitlement model.
