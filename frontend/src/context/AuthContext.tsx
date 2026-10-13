import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from "react";
import { apiClient, SESSION_EXPIRED_EVENT } from "@/lib/api";

export type AuthUser = {
  user_id: string;
  org_id: string;
  org_name: string;
  email?: string | null;
  name?: string | null;
  notifications?: boolean;
  newsletter?: boolean;
};

type AuthContextType = {
  isAuthenticated: boolean;
  loading: boolean;
  user: AuthUser | null;
  workosEnabled: boolean;
  passwordAuthEnabled: boolean;
  devLoginEnabled: boolean;
  loginWithWorkos: () => void;
  login: (email: string, password: string) => Promise<void>;
  loginDev: (email: string) => Promise<void>;
  logout: () => Promise<void>;
  refresh: () => Promise<void>;
};

const AuthContext = createContext<AuthContextType>({
  isAuthenticated: false,
  loading: true,
  user: null,
  workosEnabled: false,
  passwordAuthEnabled: true,
  devLoginEnabled: true,
  loginWithWorkos: () => {},
  login: async () => {},
  loginDev: async () => {},
  logout: async () => {},
  refresh: async () => {},
});

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<AuthUser | null>(null);
  const [loading, setLoading] = useState(true);
  const [workosEnabled, setWorkosEnabled] = useState(false);
  const [passwordAuthEnabled, setPasswordAuthEnabled] = useState(true);
  const [devLoginEnabled, setDevLoginEnabled] = useState(true);

  const refresh = useCallback(async () => {
    try {
      const { data } = await apiClient.get<AuthUser>("/auth/me");
      setUser(data);
    } catch {
      setUser(null);
    }
  }, []);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const { data: status } = await apiClient.get<{
          workos: boolean;
          dev_login: boolean;
          password_auth?: boolean;
        }>("/auth/status");
        if (!cancelled) {
          setWorkosEnabled(Boolean(status.workos));
          setDevLoginEnabled(Boolean(status.dev_login));
          setPasswordAuthEnabled(status.password_auth !== false);
        }
      } catch {
        if (!cancelled) {
          setWorkosEnabled(false);
          setDevLoginEnabled(true);
          setPasswordAuthEnabled(true);
        }
      }
      try {
        await refresh();
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [refresh]);

  // A 401 on any signed-in request means the session cookie is gone: drop the
  // user so ProtectedRoute returns to the sign-in page instead of every panel
  // showing its own error.
  useEffect(() => {
    const onExpired = () => setUser(null);
    window.addEventListener(SESSION_EXPIRED_EVENT, onExpired);
    return () => window.removeEventListener(SESSION_EXPIRED_EVENT, onExpired);
  }, []);

  const loginWithWorkos = useCallback(() => {
    window.location.href = `${apiClient.defaults.baseURL}/auth/login`;
  }, []);

  const login = useCallback(
    async (email: string, password: string) => {
      await apiClient.post("/auth/login", { email, password });
      await refresh();
    },
    [refresh],
  );

  const loginDev = useCallback(
    async (email: string) => {
      await apiClient.post("/auth/dev-login", { email });
      await refresh();
    },
    [refresh],
  );

  const logout = useCallback(async () => {
    try {
      await apiClient.post("/auth/logout");
    } finally {
      setUser(null);
    }
  }, []);

  return (
    <AuthContext.Provider
      value={{
        isAuthenticated: Boolean(user),
        loading,
        user,
        workosEnabled,
        passwordAuthEnabled,
        devLoginEnabled,
        loginWithWorkos,
        login,
        loginDev,
        logout,
        refresh,
      }}
    >
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  return useContext(AuthContext);
}
