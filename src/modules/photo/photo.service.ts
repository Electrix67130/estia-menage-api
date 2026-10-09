import { Knex } from 'knex';
import BaseService, { PaginationOptions, PaginatedResult } from '@/lib/base-service';
import { PhotoRow } from './photo.schema';
import { blockedIdsFor } from '@/lib/blocks';

class PhotoService extends BaseService<PhotoRow> {
  constructor(db: Knex) {
    super(db, 'photo');
  }

  async findByMenage(
    menageId: string,
    options: PaginationOptions & { section_id?: string; viewerId?: string } = {},
  ): Promise<PaginatedResult<PhotoRow & { first_name: string; last_name: string }>> {
    const { page = 1, limit = 20, orderBy = 'created_at', order = 'desc', section_id, viewerId } = options;
    const offset = (page - 1) * limit;

    // Les photos des personnes que le lecteur a bloquées ne lui sont pas servies.
    const blocked = await blockedIdsFor(this.db, viewerId);
    const baseQuery = this.db(this.table)
      .join('user', 'photo.uploaded_by', 'user.id')
      .where('photo.menage_id', menageId)
      .modify((qb) => {
        if (blocked.length > 0) qb.whereNotIn('photo.uploaded_by', blocked);
      });

    if (section_id) {
      baseQuery.andWhere('photo.section_id', section_id);
    }

    const [items, [{ count }]] = await Promise.all([
      baseQuery
        .clone()
        .select('photo.*', 'user.first_name', 'user.last_name')
        .orderBy(`photo.${orderBy}`, order)
        .limit(limit)
        .offset(offset),
      baseQuery.clone().count('* as count') as Promise<{ count: string }[]>,
    ]);

    return {
      data: items,
      meta: { total: parseInt(count, 10), page, limit, totalPages: Math.ceil(parseInt(count, 10) / limit) },
    };
  }

  async findByLogement(
    logementId: string,
    options: PaginationOptions & { logement_room_id?: string } = {},
  ): Promise<PaginatedResult<PhotoRow & { first_name: string; last_name: string }>> {
    const {
      page = 1,
      limit = 20,
      orderBy = 'created_at',
      order = 'desc',
      logement_room_id,
    } = options;
    const offset = (page - 1) * limit;

    const baseQuery = this.db(this.table)
      .join('user', 'photo.uploaded_by', 'user.id')
      .where('photo.logement_id', logementId);

    if (logement_room_id) {
      baseQuery.andWhere('photo.logement_room_id', logement_room_id);
    }

    const [items, [{ count }]] = await Promise.all([
      baseQuery
        .clone()
        .select('photo.*', 'user.first_name', 'user.last_name')
        .orderBy(`photo.${orderBy}`, order)
        .limit(limit)
        .offset(offset),
      baseQuery.clone().count('* as count') as Promise<{ count: string }[]>,
    ]);

    return {
      data: items,
      meta: { total: parseInt(count, 10), page, limit, totalPages: Math.ceil(parseInt(count, 10) / limit) },
    };
  }
}

export default PhotoService;
