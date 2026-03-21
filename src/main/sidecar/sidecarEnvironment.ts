const blockedEnvironmentKeys = new Set(['ELECTRON_RUN_AS_NODE', 'NODE_OPTIONS']);

export function createSidecarEnvironment(baseEnvironment: NodeJS.ProcessEnv): NodeJS.ProcessEnv {
  const sanitizedEnvironment: NodeJS.ProcessEnv = {};

  for (const [name, value] of Object.entries(baseEnvironment)) {
    const normalizedName = name.toUpperCase();

    if (normalizedName.startsWith('COPILOT_') || blockedEnvironmentKeys.has(normalizedName)) {
      continue;
    }

    sanitizedEnvironment[name] = value;
  }

  return sanitizedEnvironment;
}
