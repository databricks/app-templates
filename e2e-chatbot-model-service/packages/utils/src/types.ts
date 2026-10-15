/**
 * Shared types used across packages
 */

export interface User {
  id: string;
  email: string;
}

export type VisibilityType = 'private' | 'public';
