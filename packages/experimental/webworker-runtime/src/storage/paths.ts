/**
 * Virtual root of the worker host's in-memory filesystem. Kept
 * in one module so the process shim, the path/os shims, and the VFS image
 * collector cannot drift apart.
 */

/** Virtual filesystem root; `process.cwd()` and every absolute path start here. */
export const TBM_ENGINE_ROOT = '/tbm'

/** `$TBM_ENGINE_HOME`: durable-state directory inside the image. */
export const TBM_ENGINE_HOME = `${TBM_ENGINE_ROOT}/home`

/** Flat, symlink-free package tree resolved by the worker module loader. */
export const TBM_ENGINE_NODE_MODULES = `${TBM_ENGINE_ROOT}/node_modules`

/** Image configuration directory: the VFS manifest and the shipped agent presets. */
export const TBM_ENGINE_CONFIG = `${TBM_ENGINE_ROOT}/config`

/** Default (empty) workspace directory. */
export const TBM_ENGINE_WORKSPACE = `${TBM_ENGINE_ROOT}/workspace`

/** Temporary directory reported by `os.tmpdir()`. */
export const TBM_ENGINE_TMP = `${TBM_ENGINE_ROOT}/tmp`
