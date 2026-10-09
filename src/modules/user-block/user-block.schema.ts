import { z } from 'zod';

export const blockUserSchema = z.object({ user_id: z.string().uuid() });
export const blockedUserParamSchema = z.object({ userId: z.string().uuid() });

export type BlockedUser = {
  user_id: string;
  first_name: string;
  last_name: string;
  created_at: string;
};
