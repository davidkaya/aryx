import { FormField, InfoCallout, TextareaInput, TextInput } from '@renderer/components/ui';
import { joinMultiline, splitMultiline, splitTokens, updateLspProfile } from '@renderer/lib/settingsHelpers';
import { validateLspProfileDefinition, type LspProfileDefinition } from '@shared/domain/tooling';
import { ToolingEditorShell } from './ToolingEditorShell';

export function LspProfileEditor({
  profile,
  onChange,
  onBack,
  onSave,
  onDelete,
}: {
  profile: LspProfileDefinition;
  onChange: (profile: LspProfileDefinition) => void;
  onBack: () => void;
  onSave: () => Promise<void>;
  onDelete?: () => Promise<void>;
}) {
  const validationError = validateLspProfileDefinition(profile);

  return (
    <ToolingEditorShell
      disableSave={Boolean(validationError)}
      error={validationError}
      onBack={onBack}
      onDelete={onDelete}
      onSave={onSave}
      subtitle="Machine-wide language server definition"
      title={profile.name || 'Untitled LSP Profile'}
    >
      <section className="space-y-4">
        <h4 className="text-[12px] font-semibold uppercase tracking-wider text-zinc-500">
          General
        </h4>
        <div className="grid gap-4 sm:grid-cols-2">
          <FormField label="Name" required>
            <TextInput
              onChange={(value) => onChange(updateLspProfile(profile, { name: value }))}
              value={profile.name}
            />
          </FormField>
          <FormField label="Language ID" required>
            <TextInput
              onChange={(value) => onChange(updateLspProfile(profile, { languageId: value }))}
              placeholder="typescript"
              value={profile.languageId}
            />
          </FormField>
        </div>
      </section>

      <section className="space-y-4">
        <h4 className="text-[12px] font-semibold uppercase tracking-wider text-zinc-500">
          Server
        </h4>
        <FormField label="Command" required>
          <TextInput
            onChange={(value) => onChange(updateLspProfile(profile, { command: value }))}
            placeholder="typescript-language-server"
            value={profile.command}
          />
        </FormField>
        <FormField label="Arguments">
          <TextareaInput
            onChange={(value) => onChange(updateLspProfile(profile, { args: splitMultiline(value) }))}
            placeholder="One argument per line"
            rows={3}
            value={joinMultiline(profile.args)}
          />
        </FormField>
      </section>

      <section className="space-y-4">
        <h4 className="text-[12px] font-semibold uppercase tracking-wider text-zinc-500">
          File matching
        </h4>
        <FormField label="File extensions" required>
          <TextareaInput
            onChange={(value) => onChange(updateLspProfile(profile, { fileExtensions: splitTokens(value) }))}
            placeholder={'.ts\n.tsx'}
            rows={3}
            value={joinMultiline(profile.fileExtensions)}
          />
        </FormField>
      </section>

      <InfoCallout>
        Project root resolution comes from the active session's project, not from this definition.
      </InfoCallout>
    </ToolingEditorShell>
  );
}
