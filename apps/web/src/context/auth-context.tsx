import React, { createContext, useContext, useState, useEffect } from 'react';
import {
  fetchMe,
  login as apiLogin,
  signup as apiSignup,
  logout as apiLogout,
  acceptInvite as apiAcceptInvite,
  fetchCsrfToken,
  type CurrentUser,
} from '../api/client';

interface AuthContextType {
  user: CurrentUser | null;
  loading: boolean;
  login: (email: string, pass: string) => Promise<CurrentUser>;
  signup: (email: string, pass: string, tenantName?: string) => Promise<CurrentUser>;
  acceptInvite: (token: string, email: string, pass: string) => Promise<CurrentUser>;
  logout: () => Promise<void>;
  refetchUser: () => Promise<void>;
}

export const AuthContext = createContext<AuthContextType | undefined>(undefined);

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<CurrentUser | null>(null);
  const [loading, setLoading] = useState(true);

  const checkAuth = async () => {
    try {
      await fetchCsrfToken();
      const me = await fetchMe();
      setUser(me);
    } catch {
      setUser(null);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    checkAuth();
  }, []);

  const login = async (email: string, pass: string) => {
    const loggedIn = await apiLogin(email, pass);
    setUser(loggedIn);
    return loggedIn;
  };

  const signup = async (email: string, pass: string, tenantName?: string) => {
    const newUser = await apiSignup(email, pass, tenantName);
    setUser(newUser);
    return newUser;
  };

  const acceptInvite = async (token: string, email: string, pass: string) => {
    const acceptedUser = await apiAcceptInvite(token, email, pass);
    setUser(acceptedUser);
    return acceptedUser;
  };

  const logout = async () => {
    await apiLogout();
    setUser(null);
  };

  const refetchUser = async () => {
    const me = await fetchMe();
    setUser(me);
  };

  return (
    <AuthContext.Provider
      value={{
        user,
        loading,
        login,
        signup,
        acceptInvite,
        logout,
        refetchUser,
      }}
    >
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const context = useContext(AuthContext);
  if (!context) {
    throw new Error('useAuth must be used within an AuthProvider');
  }
  return context;
}
