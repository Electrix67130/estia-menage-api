import { z } from 'zod';

export const registerDeviceTokenSchema = z.object({
  token: z.string().min(1).max(255),
  platform: z.enum(['ios', 'android']).optional(),
});
export type RegisterDeviceToken = z.infer<typeof registerDeviceTokenSchema>;

export const removeDeviceTokenSchema = z.object({
  token: z.string().min(1).max(255),
});
export type RemoveDeviceToken = z.infer<typeof removeDeviceTokenSchema>;

export type DeviceTokenRow = {
  id: string;
  user_id: string;
  token: string;
  platform: string | null;
  created_at: string;
  updated_at: string;
};
