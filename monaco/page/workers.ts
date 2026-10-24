// The worker each language service runs in, by Monaco's label (`web/workers/<name>.js`); every
// other label is the editor's own worker. Apart from `languages.ts`, so the build reads it without
// loading Monaco.
export const WORKERS: Record<string, string> = { json: "json" };
