/**
 * Ensures the PrismJS global is available before @lexical/code-prism
 * captures its tokenizer reference.
 *
 * @lexical/code-prism reads `globalThis.Prism` at module-evaluation time.
 * In Vite dev mode the esbuild CJS shim may not have set the global yet,
 * so we force it here.  This module must be imported before any module
 * that transitively loads @lexical/code-prism.
 */
import Prism from 'prismjs';

if (typeof globalThis !== 'undefined' && !globalThis.Prism) {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (globalThis as any).Prism = Prism;
}
