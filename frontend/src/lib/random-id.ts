/**
 * A v4 UUID that works outside a secure context.
 *
 * `crypto.randomUUID()` is gated to secure contexts. On https:// and on
 * localhost it exists; on a phone opening the app over the LAN at
 * http://192.168.1.26:3000 it is undefined, and every call site threw
 * "crypto.randomUUID is not a function" on the first tap. That took out the
 * whole worker intake flow -- creating a draft, adding a photo, adding a
 * part -- on the one device the flow is designed for.
 *
 * `crypto.getRandomValues()` is NOT secure-context gated, so the fallback
 * below is still cryptographically sound; only the convenience wrapper is
 * missing on plain HTTP, not the randomness.
 *
 * Related, and worth knowing together: `getUserMedia` is secure-context
 * gated too, which is why live camera capture cannot work over LAN HTTP
 * either. That one has no workaround -- it needs an HTTPS tunnel. This one
 * did.
 */

/**
 * Monotonic counter for the last-resort branch, so two ids generated in the
 * same millisecond cannot collide.
 */
let counter = 0;

function formatUuid(bytes: Uint8Array): string {
  // Version 4 and the RFC 4122 variant are positional, not random.
  bytes[6] = (bytes[6] & 0x0f) | 0x40;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;

  const hex = Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
  return [
    hex.slice(0, 8),
    hex.slice(8, 12),
    hex.slice(12, 16),
    hex.slice(16, 20),
    hex.slice(20, 32),
  ].join("-");
}

export function randomId(): string {
  const webCrypto: Crypto | undefined = globalThis.crypto;

  if (typeof webCrypto?.randomUUID === "function") {
    return webCrypto.randomUUID();
  }

  if (typeof webCrypto?.getRandomValues === "function") {
    return formatUuid(webCrypto.getRandomValues(new Uint8Array(16)));
  }

  // No Web Crypto at all. Not reachable in any browser this app supports
  // (getRandomValues predates IE11), but throwing here would take down
  // intake completely, which is worse than a weaker id. Seeded from time +
  // a counter as well as Math.random so same-millisecond calls on one
  // device still cannot collide.
  const bytes = new Uint8Array(16);
  let seed = Date.now() ^ (counter++ << 16);
  for (let i = 0; i < bytes.length; i += 1) {
    seed = (seed * 1103515245 + 12345) & 0x7fffffff;
    bytes[i] = (seed ^ Math.floor(Math.random() * 256)) & 0xff;
  }
  return formatUuid(bytes);
}
