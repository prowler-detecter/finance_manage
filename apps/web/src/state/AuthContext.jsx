import { createContext, useContext, useEffect, useMemo, useState } from "react";
import { apiRequest } from "../lib/api";

const AuthContext = createContext(null);

export function AuthProvider({ children }) {
  const [user, setUser] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const token = localStorage.getItem("finance_token");
    if (!token) {
      setLoading(false);
      return;
    }

    apiRequest("/auth/me")
      .then((res) => setUser(res.user))
      .catch(() => {
        localStorage.removeItem("finance_token");
        setUser(null);
      })
      .finally(() => setLoading(false));
  }, []);

  const value = useMemo(() => {
    return {
      user,
      loading,
      async login(username, password) {
        const res = await apiRequest("/auth/login", {
          method: "POST",
          body: JSON.stringify({ username, password })
        });
        localStorage.setItem("finance_token", res.token);
        setUser(res.user);
      },
      logout() {
        localStorage.removeItem("finance_token");
        setUser(null);
      }
    };
  }, [user, loading]);

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used within AuthProvider");
  return ctx;
}
