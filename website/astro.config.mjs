import { defineConfig } from 'astro/config';
import tailwindcss from '@tailwindcss/vite';

export default defineConfig({
  site: 'https://aryx.app',
  vite: {
    plugins: [tailwindcss()],
  },
  output: 'static',
});
