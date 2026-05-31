import { z } from 'zod';

export const userRoleEnum = z.enum(['admin', 'prestataire']);

export type UserRole = z.infer<typeof userRoleEnum>;

export type OrganizationMemberRow = {
  id: string;
  organization_id: string;
  user_id: string;
  role: UserRole;
  created_at: string;
  updated_at: string;
};

export type MembershipWithOrg = OrganizationMemberRow & {
  organization_name: string;
};
