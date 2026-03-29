import { CheckCircle2, Circle, FolderPlus, MessageSquarePlus, Settings, Zap } from 'lucide-react';
import { motion } from 'motion/react';

import type { SidecarConnectionStatus } from '@shared/contracts/sidecar';
import appIconUrl from '../../../assets/icons/icon.png';

interface WelcomePaneProps {
  hasProjects: boolean;
  connectionStatus?: SidecarConnectionStatus;
  onNewScratchpad: () => void;
  onAddProject: () => void;
  onOpenSettings: () => void;
}

const fadeUp = (delay: number) =>
  ({
    initial: { opacity: 0, y: 12 },
    animate: { opacity: 1, y: 0 },
    transition: { duration: 0.45, ease: [0.25, 0.46, 0.45, 0.94] as const, delay },
  }) as const;

interface ActionCardProps {
  icon: React.ReactNode;
  title: string;
  description: string;
  onClick: () => void;
  highlight?: boolean;
}

function ActionCard({ icon, title, description, onClick, highlight }: ActionCardProps) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`group flex w-full cursor-pointer items-center gap-4 rounded-xl border px-5 py-4 text-left backdrop-blur-sm transition-all duration-200 ${
        highlight
          ? 'border-[var(--color-border-glow)] bg-[var(--color-accent-muted)] shadow-[0_0_24px_rgba(36,92,249,0.1)] hover:shadow-[0_0_32px_rgba(36,92,249,0.15)]'
          : 'border-[var(--color-glass-border)] bg-[var(--color-glass)] hover:border-[var(--color-border-glow)] hover:shadow-[0_0_20px_rgba(36,92,249,0.08),0_4px_12px_rgba(0,0,0,0.2)]'
      }`}
    >
      <div className="brand-gradient-bg flex size-9 shrink-0 items-center justify-center rounded-full">
        {icon}
      </div>
      <div className="min-w-0">
        <span className="block text-[13px] font-medium text-[var(--color-text-primary)]">
          {title}
        </span>
        <span className="block text-[12px] leading-relaxed text-[var(--color-text-muted)]">
          {description}
        </span>
      </div>
    </button>
  );
}

interface SetupStepProps {
  label: string;
  done: boolean;
  active?: boolean;
}

function SetupStep({ label, done, active }: SetupStepProps) {
  return (
    <div className={`flex items-center gap-2 text-[12px] ${active ? 'text-[var(--color-text-primary)]' : 'text-[var(--color-text-muted)]'}`}>
      {done
        ? <CheckCircle2 className="size-3.5 text-[var(--color-status-success)]" />
        : <Circle className={`size-3.5 ${active ? 'text-[var(--color-accent)]' : 'text-[var(--color-text-muted)]'}`} />
      }
      <span className={done ? 'line-through opacity-60' : ''}>{label}</span>
    </div>
  );
}

export function WelcomePane({
  hasProjects,
  connectionStatus,
  onNewScratchpad,
  onAddProject,
  onOpenSettings,
}: WelcomePaneProps) {
  const isConnected = connectionStatus === 'ready';
  const isFirstRun = !hasProjects;

  // Determine setup progress
  const steps = [
    { label: 'GitHub Copilot connected', done: isConnected },
    { label: 'First project added', done: hasProjects },
  ];
  const completedSteps = steps.filter((s) => s.done).length;
  const allDone = completedSteps === steps.length;

  return (
    <div className="relative flex h-full flex-col items-center justify-center overflow-hidden px-8">
      {/* Ambient nebula glow */}
      <div
        className="pointer-events-none absolute inset-0"
        aria-hidden="true"
        style={{
          background: [
            'radial-gradient(ellipse 50% 40% at 50% 45%, rgba(36, 92, 249, 0.07) 0%, transparent 70%)',
            'radial-gradient(ellipse 40% 35% at 55% 50%, rgba(138, 41, 230, 0.05) 0%, transparent 65%)',
            'radial-gradient(ellipse 60% 50% at 45% 48%, rgba(54, 21, 207, 0.04) 0%, transparent 60%)',
          ].join(', '),
        }}
      />

      <div className="relative z-10 flex w-full max-w-sm flex-col items-center gap-6 text-center">
        {/* Icon */}
        <motion.div {...fadeUp(0)}>
          <img
            src={appIconUrl}
            alt="aryx"
            width={64}
            height={64}
            className="drop-shadow-[0_0_24px_rgba(36,92,249,0.3)]"
          />
        </motion.div>

        {/* Heading */}
        <motion.div {...fadeUp(0.08)}>
          <h1 className="font-display brand-gradient-text text-2xl font-bold tracking-tight">
            {isFirstRun ? 'Welcome to Aryx' : 'aryx'}
          </h1>
          <p className="mt-2 max-w-sm text-[13px] leading-relaxed text-[var(--color-text-secondary)]">
            {isFirstRun
              ? 'Your AI workspace powered by GitHub Copilot. Start a scratchpad for quick questions or connect a project for full agent support.'
              : 'Start a scratchpad conversation for ad-hoc questions or connect a project to work with repo-aware Copilot agents.'
            }
          </p>
        </motion.div>

        {/* Setup progress — only for first-run */}
        {isFirstRun && !allDone && (
          <motion.div {...fadeUp(0.12)} className="w-full rounded-xl border border-[var(--color-border)] bg-[var(--color-surface-1)]/60 p-4">
            <div className="mb-3 flex items-center justify-between">
              <span className="text-[11px] font-semibold uppercase tracking-wider text-[var(--color-text-muted)]">
                Getting started
              </span>
              <span className="text-[11px] text-[var(--color-text-muted)]">
                {completedSteps}/{steps.length}
              </span>
            </div>
            {/* Progress bar */}
            <div className="mb-3 h-1 overflow-hidden rounded-full bg-[var(--color-surface-3)]">
              <motion.div
                className="h-full rounded-full bg-gradient-to-r from-[var(--color-accent)] to-[var(--color-accent-purple)]"
                initial={{ width: 0 }}
                animate={{ width: `${(completedSteps / steps.length) * 100}%` }}
                transition={{ duration: 0.6, ease: 'easeOut', delay: 0.3 }}
              />
            </div>
            <div className="space-y-2">
              {steps.map((step, i) => (
                <SetupStep
                  key={step.label}
                  label={step.label}
                  done={step.done}
                  active={!step.done && steps.slice(0, i).every((s) => s.done)}
                />
              ))}
            </div>
          </motion.div>
        )}

        {/* Action cards */}
        <motion.div {...fadeUp(isFirstRun && !allDone ? 0.2 : 0.16)} className="flex w-full flex-col gap-2.5">
          {/* Primary CTA adapts to state */}
          {!isConnected && (
            <ActionCard
              icon={<Zap className="size-4 text-white" />}
              title="Connect GitHub Copilot"
              description="Check connection status and configure your CLI"
              onClick={onOpenSettings}
              highlight
            />
          )}

          <ActionCard
            icon={<MessageSquarePlus className="size-4 text-white" />}
            title={isFirstRun ? 'Try a Quick Scratchpad' : 'New Scratchpad'}
            description={isFirstRun ? 'Start a conversation — no setup needed' : 'Ask anything without a project context'}
            onClick={onNewScratchpad}
            highlight={isConnected && isFirstRun}
          />

          {!hasProjects && (
            <ActionCard
              icon={<FolderPlus className="size-4 text-white" />}
              title="Add Your First Project"
              description="Connect a repo for full agent support"
              onClick={onAddProject}
            />
          )}

          <ActionCard
            icon={<Settings className="size-4 text-white" />}
            title="Manage Patterns"
            description="Customize agent behaviors and workflows"
            onClick={onOpenSettings}
          />
        </motion.div>

        {/* Keyboard shortcut hints for returning users */}
        {!isFirstRun && (
          <motion.div {...fadeUp(0.24)} className="flex items-center gap-4 text-[11px] text-[var(--color-text-muted)]">
            <span>
              <kbd className="rounded border border-[var(--color-border)] px-1.5 py-0.5 font-mono text-[10px]">Ctrl+N</kbd>
              {' '}new session
            </span>
            <span>
              <kbd className="rounded border border-[var(--color-border)] px-1.5 py-0.5 font-mono text-[10px]">Ctrl+K</kbd>
              {' '}commands
            </span>
          </motion.div>
        )}
      </div>
    </div>
  );
}
