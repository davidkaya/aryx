import { FormField, InfoCallout, SelectInput, TextareaInput, TextInput } from '@renderer/components/ui';
import { changeMcpTransport, joinMultiline, splitMultiline, splitTokens, updateMcpServer } from '@renderer/lib/settingsHelpers';
import { validateMcpServerDefinition, type McpServerDefinition } from '@shared/domain/tooling';
import { ToolingEditorShell } from './ToolingEditorShell';

export function McpServerEditor({
  server,
  onChange,
  onBack,
  onSave,
  onDelete,
}: {
  server: McpServerDefinition;
  onChange: (server: McpServerDefinition) => void;
  onBack: () => void;
  onSave: () => Promise<void>;
  onDelete?: () => Promise<void>;
}) {
  const validationError = validateMcpServerDefinition(server);

  return (
    <ToolingEditorShell
      disableSave={Boolean(validationError)}
      error={validationError}
      onBack={onBack}
      onDelete={onDelete}
      onSave={onSave}
      subtitle="Machine-wide server definition"
      title={server.name || 'Untitled MCP Server'}
    >
      <section className="space-y-4">
        <h4 className="text-[12px] font-semibold uppercase tracking-wider text-zinc-500">
          General
        </h4>
        <div className="grid gap-4 sm:grid-cols-2">
          <FormField label="Name" required>
            <TextInput
              onChange={(value) => onChange(updateMcpServer(server, { name: value }))}
              value={server.name}
            />
          </FormField>
          <FormField label="Transport" required>
            <SelectInput
              onChange={(value) => onChange(changeMcpTransport(server, value as McpServerDefinition['transport']))}
              options={[
                { value: 'local', label: 'Local process' },
                { value: 'http', label: 'HTTP' },
                { value: 'sse', label: 'SSE' },
              ]}
              value={server.transport}
            />
          </FormField>
        </div>
      </section>

      <section className="space-y-4">
        <h4 className="text-[12px] font-semibold uppercase tracking-wider text-zinc-500">
          {server.transport === 'local' ? 'Process' : 'Endpoint'}
        </h4>
        {server.transport === 'local' ? (
          <>
            <FormField label="Command" required>
              <TextInput
                onChange={(value) => onChange(updateMcpServer(server, { command: value }))}
                placeholder="node"
                value={server.command}
              />
            </FormField>
            <FormField label="Arguments">
              <TextareaInput
                onChange={(value) => onChange(updateMcpServer(server, { args: splitMultiline(value) }))}
                placeholder="One argument per line"
                rows={3}
                value={joinMultiline(server.args)}
              />
            </FormField>
            <FormField label="Working directory">
              <TextInput
                onChange={(value) => onChange(updateMcpServer(server, { cwd: value || undefined }))}
                placeholder="Optional — defaults to project root"
                value={server.cwd ?? ''}
              />
            </FormField>
          </>
        ) : (
          <FormField label="Server URL" required>
            <TextInput
              onChange={(value) => onChange(updateMcpServer(server, { url: value }))}
              placeholder="https://example.com/mcp"
              value={server.url}
            />
          </FormField>
        )}
      </section>

      <section className="space-y-4">
        <h4 className="text-[12px] font-semibold uppercase tracking-wider text-zinc-500">
          Advanced
        </h4>
        <div className="grid gap-4 sm:grid-cols-2">
          <FormField label="Allowed tools">
            <TextareaInput
              onChange={(value) => onChange(updateMcpServer(server, { tools: splitTokens(value) }))}
              placeholder="* for all, or one per line"
              rows={3}
              value={joinMultiline(server.tools)}
            />
          </FormField>
          <FormField label="Timeout (ms)">
            <TextInput
              inputMode="numeric"
              onChange={(value) =>
                onChange(
                  updateMcpServer(server, {
                    timeoutMs: value.trim() ? Number(value) : undefined,
                  }),
                )
              }
              placeholder="Optional"
              value={server.timeoutMs?.toString() ?? ''}
            />
          </FormField>
        </div>
      </section>

      <InfoCallout>
        Keep secrets out of this form. Use commands or endpoints that authenticate through the OS or external tooling.
      </InfoCallout>
    </ToolingEditorShell>
  );
}
