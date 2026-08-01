import { create } from "zustand";
import { clearTenantId, getTenantId, setTenantId } from "./tenant";

interface TenantState {
  tenantId: string | null;
  hydrated: boolean;
  hydrate: () => void;
  bind: (tenantId: string) => void;
  unbind: () => void;
}

/** Thin Zustand wrapper around tenant.ts's localStorage functions, matching the hydrate()/hydrated pattern used by useIntakeStore and useAuthSession. */
export const useTenantStore = create<TenantState>((set) => ({
  tenantId: null,
  hydrated: false,

  hydrate: () => set({ tenantId: getTenantId(), hydrated: true }),

  bind: (tenantId) => {
    setTenantId(tenantId);
    set({ tenantId, hydrated: true });
  },

  unbind: () => {
    clearTenantId();
    set({ tenantId: null, hydrated: true });
  },
}));
