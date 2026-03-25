import { useEffect, useState } from 'react';
import type { AppearanceTheme } from '@shared/domain/tooling';

/** Resolves the effective theme and applies it to the document root. */
export function useTheme(themeSetting: AppearanceTheme) {
  useEffect(() => {
    function resolveEffective(pref: AppearanceTheme): 'dark' | 'light' {
      if (pref === 'dark' || pref === 'light') return pref;
      return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
    }

    const apply = () => {
      document.documentElement.dataset.theme = resolveEffective(themeSetting);
    };

    apply();

    if (themeSetting === 'system') {
      const mq = window.matchMedia('(prefers-color-scheme: dark)');
      mq.addEventListener('change', apply);
      return () => mq.removeEventListener('change', apply);
    }
  }, [themeSetting]);
}

/** Manages sidecar capabilities loading and refresh. */
export function useSidecarCapabilities(api: {
  describeSidecarCapabilities: () => Promise<import('@shared/contracts/sidecar').SidecarCapabilities>;
  refreshSidecarCapabilities: () => Promise<import('@shared/contracts/sidecar').SidecarCapabilities>;
}) {
  const [capabilities, setCapabilities] = useState<import('@shared/contracts/sidecar').SidecarCapabilities>();
  const [isRefreshing, setIsRefreshing] = useState(false);

  useEffect(() => {
    let disposed = false;

    void api
      .describeSidecarCapabilities()
      .then((c) => !disposed && setCapabilities(c))
      .catch((e) => {
        if (!disposed) console.warn('Failed to load sidecar capabilities', e);
      });

    return () => { disposed = true; };
  }, [api]);

  async function refresh() {
    setIsRefreshing(true);
    try {
      const c = await api.refreshSidecarCapabilities();
      setCapabilities(c);
    } finally {
      setIsRefreshing(false);
    }
  }

  return { capabilities, isRefreshing, refresh };
}
