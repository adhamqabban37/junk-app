const STORAGE_KEY = "junkyard:tenantId";
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * A device is provisioned for exactly one yard (tenant) at setup time,
 * before anyone logs in — mirrors the backend auth design decision that
 * both PIN and password login require a known tenantId rather than
 * resolving it from email/PIN alone (see backend docs/PROGRESS.md Phase 2).
 */
export function getTenantId(): string | null {
  if (typeof window === "undefined") {
    return null;
  }
  return window.localStorage.getItem(STORAGE_KEY);
}

export function setTenantId(tenantId: string): void {
  if (!UUID_PATTERN.test(tenantId)) {
    throw new Error(`setTenantId: not a valid UUID: ${tenantId}`);
  }
  window.localStorage.setItem(STORAGE_KEY, tenantId);
}

export function clearTenantId(): void {
  if (typeof window === "undefined") {
    return;
  }
  window.localStorage.removeItem(STORAGE_KEY);
}
