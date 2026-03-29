import { FolderPlus, MessageSquarePlus, Settings } from 'lucide-react';
import { motion } from 'motion/react';

import appIconUrl from '../../../assets/icons/icon.png';

interface WelcomePaneProps {
  hasProjects: boolean;
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
}

function ActionCard({ icon, title, description, onClick }: ActionCardProps) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="group flex w-full cursor-pointer items-center gap-4 rounded-xl border border-[var(--color-glass-border)] bg-[var(--color-glass)] px-5 py-4 text-left backdrop-blur-sm transition-all duration-200 hover:border-[var(--color-border-glow)] hover:shadow-[0_0_20px_rgba(36,92,249,0.08),0_4px_12px_rgba(0,0,0,0.2)]"
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

export function WelcomePane({
  hasProjects,
  onNewScratchpad,
  onAddProject,
  onOpenSettings,
}: WelcomePaneProps) {
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

      <div className="relative z-10 flex w-full max-w-xs flex-col items-center gap-8 text-center">
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
            aryx
          </h1>
          <p className="mt-2 max-w-sm text-[13px] leading-relaxed text-[var(--color-text-secondary)]">
            Start a scratchpad conversation for ad-hoc questions or connect a project to work with
            repo-aware Copilot agents.
          </p>
        </motion.div>

        {/* Action cards */}
        <motion.div {...fadeUp(0.16)} className="flex w-full flex-col gap-2.5">
          <ActionCard
            icon={<MessageSquarePlus className="size-4 text-white" />}
            title="New Scratchpad"
            description="Ask anything without a project context"
            onClick={onNewScratchpad}
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
      </div>
    </div>
  );
}
