"use client";

import { create } from "zustand";
import type { AuthResponse, UserPublic } from "@qtp/shared";
import { get, post } from "./api";
import { TOKEN_KEY } from "./config";

interface AuthState {
  user: UserPublic | null;
  token: string | null;
  loading: boolean;
  hydrate: () => Promise<void>;
  login: (username: string, password: string) => Promise<void>;
  /** Finish an SSO sign-in with the JWT issued by /api/auth/callback. */
  completeSso: (token: string) => Promise<void>;
  logout: () => void;
}

export const useAuth = create<AuthState>((set, getState) => ({
  user: null,
  token: null,
  loading: true,
  hydrate: async () => {
    const token =
      typeof window !== "undefined"
        ? window.localStorage.getItem(TOKEN_KEY)
        : null;
    if (!token) {
      set({ loading: false });
      return;
    }
    try {
      const user = await get<UserPublic>("/api/auth/me");
      set({ user, token, loading: false });
    } catch {
      window.localStorage.removeItem(TOKEN_KEY);
      set({ user: null, token: null, loading: false });
    }
  },
  login: async (username, password) => {
    const res = await post<AuthResponse>("/api/auth/login", { username, password });
    window.localStorage.setItem(TOKEN_KEY, res.token);
    set({ user: res.user, token: res.token });
  },
  completeSso: async (token) => {
    window.localStorage.setItem(TOKEN_KEY, token);
    try {
      const user = await get<UserPublic>("/api/auth/me");
      set({ user, token, loading: false });
    } catch (err) {
      window.localStorage.removeItem(TOKEN_KEY);
      throw err;
    }
  },
  logout: () => {
    window.localStorage.removeItem(TOKEN_KEY);
    set({ user: null, token: null });
    void getState;
  },
}));
