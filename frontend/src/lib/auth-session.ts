import { create } from "zustand";

export interface AuthClaims {
  sub: string;
  tenantId: string;
  role: "worker" | "manager" | "owner";
  name: string;
  exp?: number;
}

const TOKEN_STORAGE_KEY = "junkyard:accessToken";

function decodeClaims(token: string): AuthClaims | null {
  try {
    const payload = token.split(".")[1];
    const normalized = payload.replace(/-/g, "+").replace(/_/g, "/");
    return JSON.parse(atob(normalized)) as AuthClaims;
  } catch {
    return null;
  }
}

function isExpired(claims: AuthClaims | null): boolean {
  if (!claims?.exp) {
    return false;
  }
  return claims.exp * 1000 <= Date.now();
}

interface AuthSessionState {
  token: string | null;
  claims: AuthClaims | null;
  /** True once restore() has run at least once — lets callers (e.g. the mobile layout's auth guard) wait for the localStorage read before deciding whether to redirect, without needing their own effect-local state. */
  restored: boolean;
  login: (token: string) => void;
  logout: () => void;
  /** Reads a previously-persisted token back into memory — what makes an offline-launched PWA still be authenticated without a network call. */
  restore: () => void;
}

export const useAuthSession = create<AuthSessionState>((set) => ({
  token: null,
  claims: null,
  restored: false,

  login: (token) => {
    window.localStorage.setItem(TOKEN_STORAGE_KEY, token);
    set({ token, claims: decodeClaims(token) });
  },

  logout: () => {
    window.localStorage.removeItem(TOKEN_STORAGE_KEY);
    set({ token: null, claims: null });
  },

  restore: () => {
    const token = window.localStorage.getItem(TOKEN_STORAGE_KEY);
    if (!token) {
      set({ restored: true });
      return;
    }
    const claims = decodeClaims(token);
    if (!claims || isExpired(claims)) {
      window.localStorage.removeItem(TOKEN_STORAGE_KEY);
      set({ token: null, claims: null, restored: true });
      return;
    }
    set({ token, claims, restored: true });
  },
}));
