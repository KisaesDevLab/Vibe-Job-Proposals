import { createContext, useContext, type ReactNode } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from './api';

export interface User {
  id: string;
  username: string;
  role: 'admin' | 'owner';
}

interface AuthCtx {
  user: User | null;
  loading: boolean;
  refresh: () => void;
}
const Ctx = createContext<AuthCtx>({ user: null, loading: true, refresh: () => {} });

export function AuthProvider({ children }: { children: ReactNode }) {
  const qc = useQueryClient();
  const { data, isLoading } = useQuery({
    queryKey: ['me'],
    queryFn: () => api.get<User>('/auth/me').catch(() => null),
    retry: false,
    staleTime: 60_000,
  });
  return (
    <Ctx.Provider value={{ user: data ?? null, loading: isLoading, refresh: () => qc.invalidateQueries({ queryKey: ['me'] }) }}>
      {children}
    </Ctx.Provider>
  );
}

export const useAuth = () => useContext(Ctx);
