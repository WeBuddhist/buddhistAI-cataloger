import { useCallback } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import type { UserUpdateRequest } from '../api/user';
import { fetchWithAccessToken } from '@/lib/fetchWithAccessToken';

export function useUserActions() {
  const queryClient = useQueryClient();

  const updateUser = useCallback(async (userId: string, userData: UserUpdateRequest) => {
    try {
      const response = await fetchWithAccessToken(`/api/settings/users/${userId}`, {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify(userData)
      });

      if (response.ok) {
        // Invalidate users queries to refetch updated data
        queryClient.invalidateQueries({ queryKey: ['users'] });
        queryClient.invalidateQueries({ queryKey: ['user', userId] });
        // Your own record (nav, tool access) is cached as ['user', 'me']; editing yourself
        // here otherwise needs a page reload to show. The Outline Fixer and Author Identification keep
        // their roles apart.
        queryClient.invalidateQueries({ queryKey: ['user', 'me'] });
        queryClient.invalidateQueries({ queryKey: ['outline-fix', 'me'] });
        queryClient.invalidateQueries({ queryKey: ['author-identification', 'me'] });
        return await response.json();
      } else {
        const error = await response.json().catch(() => ({ detail: 'Failed to update user' }));
        throw new Error(error.detail || 'Failed to update user');
      }
    } catch (error) {
      console.error('Error updating user:', error);
      throw error;
    }
  }, [queryClient]);

  const deleteUser = useCallback(async (userId: string) => {
    if (!confirm('Are you sure you want to delete this user? This action cannot be undone.')) {
      return;
    }

    try {
      const response = await fetchWithAccessToken(`/api/settings/users/${userId}`, {
        method: 'DELETE',
        headers: {
          'Content-Type': 'application/json'
        }
      });

      if (response.ok) {
        // Invalidate users queries to refetch updated data
        queryClient.invalidateQueries({ queryKey: ['users'] });
        queryClient.invalidateQueries({ queryKey: ['user', userId] });
      } else {
        const error = await response.json().catch(() => ({ detail: 'Failed to delete user' }));
        throw new Error(error.detail || 'Failed to delete user');
      }
    } catch (error) {
      console.error('Error deleting user:', error);
      throw error;
    }
  }, [queryClient]);

  return {
    updateUser,
    deleteUser
  };
}
