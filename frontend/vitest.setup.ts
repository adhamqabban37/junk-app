import "@testing-library/jest-dom/vitest";

/**
 * jsdom does not implement `URL.createObjectURL` / `revokeObjectURL`, so the
 * lookup falls through to Node's `URL`, whose `createObjectURL` accepts only
 * a `node:buffer` Blob and throws `ERR_INVALID_ARG_TYPE` on the jsdom Blob a
 * test actually constructs.
 *
 * Real browsers handle this fine, so stubbing is closing an environment gap,
 * not papering over a product bug. Faithful in the one way that matters:
 * every call returns a DISTINCT url, so a component that reuses a stale url
 * across blobs, or revokes the wrong one, still fails a test that looks.
 */
let objectUrlCounter = 0;
URL.createObjectURL = () => `blob:mock/${++objectUrlCounter}`;
URL.revokeObjectURL = () => undefined;
