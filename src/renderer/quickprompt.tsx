import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';

import '@fontsource-variable/outfit';
import '@fontsource-variable/dm-sans';
import '@fontsource-variable/jetbrains-mono';

import { QuickPromptApp } from '@renderer/components/quick-prompt/QuickPromptApp';
import '@renderer/styles.css';

const container = document.getElementById('root');
if (!container) {
  throw new Error('Could not find the root element.');
}

createRoot(container).render(
  <StrictMode>
    <QuickPromptApp />
  </StrictMode>,
);
