import { useEffect, useRef, type RefObject } from 'react';

/**
 * Calls `onClose` when a click lands outside the referenced element.
 * Only attaches the listener while `active` is true.
 */
export function useClickOutside<T extends HTMLElement>(
  onClose: () => void,
  active: boolean,
): RefObject<T | null> {
  const ref = useRef<T | null>(null);

  useEffect(() => {
    if (!active) return;

    function handleClick(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        onClose();
      }
    }

    document.addEventListener('mousedown', handleClick);
    return () => document.removeEventListener('mousedown', handleClick);
  }, [active, onClose]);

  return ref;
}
