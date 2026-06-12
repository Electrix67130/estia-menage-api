import { Knex } from 'knex';
import BaseService from '@/lib/base-service';
import { DeviceTokenRow } from './device-token.schema';

class DeviceTokenService extends BaseService<DeviceTokenRow> {
  constructor(db: Knex) {
    super(db, 'device_token');
  }

  /**
   * Upsert : un token push est unique (1 appareil). S'il existe deja, on le
   * rattache au user courant (cas d'un telephone partage / re-login).
   */
  async register(userId: string, token: string, platform?: string): Promise<DeviceTokenRow> {
    const [row] = await this.db('device_token')
      .insert({ user_id: userId, token, platform: platform ?? null })
      .onConflict('token')
      .merge({ user_id: userId, platform: platform ?? null, updated_at: this.db.fn.now() })
      .returning('*');
    return row as DeviceTokenRow;
  }

  async removeByToken(userId: string, token: string): Promise<void> {
    await this.db('device_token').where({ user_id: userId, token }).del();
  }
}

export default DeviceTokenService;
