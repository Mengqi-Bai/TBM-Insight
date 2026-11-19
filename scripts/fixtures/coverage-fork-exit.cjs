// Preserve Node's exit before Vitest installs its test-level process.exit guard.
globalThis.__tbmCoverageFixtureExit = process.exit.bind(process)
