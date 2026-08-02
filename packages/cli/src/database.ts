import { Arkorm, DB, Model, createKyselyAdapter } from 'arkormx'
import { Kysely, PostgresDialect } from 'kysely'

import type { HallOfFameProject } from './types'
import { Pool } from 'pg'
import { config as loadEnv } from 'dotenv'
import path from 'node:path'

export interface ProjectDatabase {
  close(): Promise<void>
}

const number = (value: string | undefined, fallback: number): number => {
  const result = Number(value ?? fallback)

  return Number.isFinite(result) ? result : fallback
}

export async function connectProjectDatabase(project: HallOfFameProject): Promise<ProjectDatabase> {
  if (project.kind !== 'api') {
    throw new Error('Database customization must be run from the Hall of Fame API project root.')
  }

  loadEnv({
    path: path.join(project.root, '.env'),
    override: false,
    quiet: true,
  })

  const pool = new Pool(
    process.env.DATABASE_URL
      ? { connectionString: process.env.DATABASE_URL }
      : {
          host: process.env.DB_HOST ?? '127.0.0.1',
          port: number(process.env.DB_PORT, 5432),
          user: process.env.DB_USERNAME ?? 'postgres',
          database: process.env.DB_DATABASE ?? 'arkstack',
          password: process.env.DB_PASSWORD ?? 'postgres',
        },
  )
  const database = new Kysely<Record<string, never>>({
    dialect: new PostgresDialect({ pool }),
  })
  const adapter = createKyselyAdapter(database)

  Arkorm.configure({ adapter, paths: { buildOutput: 'dist' } })
  Model.setAdapter(adapter)
  DB.setAdapter(adapter)

  await DB.raw('select 1 as connected')

  return { close: () => database.destroy() }
}
