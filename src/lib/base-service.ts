import { Knex } from 'knex';

export interface PaginationOptions {
  page?: number;
  limit?: number;
  orderBy?: string;
  order?: 'asc' | 'desc';
}

export interface PaginatedResult<T> {
  data: T[];
  meta: {
    total: number;
    page: number;
    limit: number;
    totalPages: number;
  };
}

class BaseService<T extends Record<string, unknown> = Record<string, unknown>> {
  readonly db: Knex;
  readonly table: string;

  constructor(db: Knex, tableName: string) {
    this.db = db;
    this.table = tableName;
  }

  // --------------- READ ---------------

  async findAll({
    page = 1,
    limit = 20,
    orderBy = 'created_at',
    order = 'desc',
  }: PaginationOptions = {}): Promise<PaginatedResult<T>> {
    const offset = (page - 1) * limit;

    const [items, [{ count }]] = await Promise.all([
      this.db(this.table)
        .select('*')
        .orderBy(orderBy, order)
        .limit(limit)
        .offset(offset) as Promise<T[]>,
      this.db(this.table).count('* as count') as Promise<{ count: string }[]>,
    ]);

    return {
      data: items,
      meta: {
        total: parseInt(count, 10),
        page,
        limit,
        totalPages: Math.ceil(parseInt(count, 10) / limit),
      },
    };
  }

  async findById(id: string): Promise<T | undefined> {
    return this.db(this.table).where({ id }).first() as Promise<T | undefined>;
  }

  async findOne(where: Partial<T>): Promise<T | undefined> {
    return this.db(this.table).where(where as Record<string, unknown>).first() as Promise<T | undefined>;
  }

  async findMany(where: Partial<T>): Promise<T[]> {
    return this.db(this.table).where(where as Record<string, unknown>) as Promise<T[]>;
  }

  // --------------- CREATE ---------------

  async create(data: Partial<T>): Promise<T> {
    const [row] = await this.db(this.table).insert(data as Record<string, unknown>).returning('*');
    return row as T;
  }

  async createMany(dataArray: Partial<T>[]): Promise<T[]> {
    return this.db(this.table).insert(dataArray as Record<string, unknown>[]).returning('*') as Promise<T[]>;
  }

  // --------------- UPDATE ---------------

  async update(id: string, data: Partial<T>): Promise<T | undefined> {
    const [row] = await this.db(this.table)
      .where({ id })
      .update({ ...data, updated_at: this.db.fn.now() } as Record<string, unknown>)
      .returning('*');
    return row as T | undefined;
  }

  // --------------- DELETE ---------------

  async delete(id: string): Promise<boolean> {
    const deleted = await this.db(this.table).where({ id }).del();
    return deleted > 0;
  }

  async softDelete(id: string): Promise<T | undefined> {
    return this.update(id, { deleted_at: this.db.fn.now() } as unknown as Partial<T>);
  }
}

export default BaseService;
