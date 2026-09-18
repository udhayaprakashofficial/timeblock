'use client';

import { createContext, useContext, type ReactNode } from 'react';
import type { UserDto } from '@timeblock/shared-types';

const UserContext = createContext<UserDto | null>(null);

export function UserProvider({
  user,
  children,
}: {
  user: UserDto;
  children: ReactNode;
}) {
  return <UserContext.Provider value={user}>{children}</UserContext.Provider>;
}

export function useAppUser(): UserDto {
  const user = useContext(UserContext);
  if (!user) {
    throw new Error('useAppUser must be used inside authenticated Shell');
  }
  return user;
}

export function useAppUserOptional(): UserDto | null {
  return useContext(UserContext);
}
