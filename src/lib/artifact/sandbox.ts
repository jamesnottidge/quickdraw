/**
 * The only permission an artifact frame gets. Without allow-same-origin the frame has an opaque
 * origin: it cannot read the host's DOM, cookies or storage.
 */
export const ARTIFACT_SANDBOX = 'allow-scripts' as const;

/** Escape hatches that must never be added to the sandbox. */
export const FORBIDDEN_SANDBOX_TOKENS = [
  'allow-same-origin',
  'allow-top-navigation',
  'allow-top-navigation-by-user-activation',
  'allow-popups',
  'allow-popups-to-escape-sandbox',
  'allow-forms',
  'allow-modals',
  'allow-downloads',
  'allow-pointer-lock',
  'allow-presentation',
] as const;
