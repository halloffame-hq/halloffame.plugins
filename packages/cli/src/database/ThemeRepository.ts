import type { SystemOptions, ThemeDocument, ThemeRecord } from '../types'

import { DB } from 'arkormx'
import { randomUUID } from 'node:crypto'

const SYSTEM_DEFAULTS: SystemOptions = {
  'features.premium': true,
  'features.advertising': true,
  'features.messaging': true,
  'features.frankly': true,
  'limits.post_word_count': 500,
}

export class ThemeRepository {
  async active(): Promise<ThemeRecord> {
    const theme = await DB.table<ThemeRecord>('themes')
      .select({
        id: true,
        name: true,
        version: true,
        document: true,
      })
      .where('status', 'active')
      .orderBy({ version: 'desc' })
      .limit(1)
      .first()

    if (!theme) throw new Error('No active theme exists. Run the API database seeder first.')

    return theme
  }

  async systemOptions(): Promise<SystemOptions> {
    const keys = Object.keys(SYSTEM_DEFAULTS)
    const rows = await DB.table<{ key: keyof SystemOptions; value: unknown }>('platform_settings')
      .select({
        key: true,
        value: true,
      })
      .whereIn('key', keys)
      .get()
    const options = structuredClone(SYSTEM_DEFAULTS)
    for (const row of rows) options[row.key] = row.value as never

    return options
  }

  async save(
    name: string,
    document: ThemeDocument,
    settings: SystemOptions,
    activate: boolean,
  ): Promise<ThemeRecord> {
    return DB.transaction(async (database) => {
      const active = await database
        .table<ThemeRecord>('themes')
        .select({
          id: true,
          name: true,
          version: true,
          document: true,
        })
        .where('status', 'active')
        .orderBy({ version: 'desc' })
        .first()

      if (!active) throw new Error('No active theme exists. Run the API database seeder first.')

      const versionRows = await database.raw<{ version: number }>(
        'select coalesce(max(version), 0) + 1 as version from themes',
      )
      const version = Number(versionRows.first()?.version ?? 1)
      const id = randomUUID()
      const now = new Date()

      if (activate) {
        await database.table('themes').where('status', 'active').update({
          status: 'archived',
          updated_at: now,
        })
      }

      await database.table('themes').create({
        id,
        name,
        status: activate ? 'active' : 'draft',
        version,
        document: JSON.stringify(document),
        based_on_id: active.id,
        created_by: null,
        created_at: now,
        updated_at: now,
        activated_at: activate ? now : null,
      })

      await database.raw(
        `insert into media_attachments
          (id, media_id, attachable_type, attachable_id, collection, position, created_at, updated_at)
         select gen_random_uuid(), media_id, attachable_type, ?, collection, position, ?, ?
         from media_attachments where attachable_type = ? and attachable_id = ?`,
        [id, now, now, 'Theme', active.id],
      )

      for (const [key, value] of Object.entries(settings)) {
        await database.raw(
          `insert into platform_settings (id, key, value, updated_by, created_at, updated_at)
           values (?, ?, ?::jsonb, null, ?, ?)
           on conflict (key) do update set value = excluded.value, updated_by = null, updated_at = excluded.updated_at`,
          [randomUUID(), key, JSON.stringify(value), now, now],
        )

        await this.audit(database, {
          action: 'config.updated',
          subjectType: 'setting',
          subjectId: key,
          summary: `Set ${key} to ${JSON.stringify(value)} through the customization CLI.`,
          metadata: { value, source: '@hallofame/cli' },
          now,
        })
      }

      await this.audit(database, {
        action: activate ? 'theme.applied' : 'theme.imported',
        subjectType: 'Theme',
        subjectId: id,
        summary: `${activate ? 'Applied' : 'Created'} theme version ${version} through the customization CLI.`,
        metadata: { version, basedOnId: active.id, source: '@hallofame/cli' },
        now,
      })

      return { id, name, version, document }
    })
  }

  private async audit(
    database: DB,
    entry: {
      action: string
      subjectType: string
      subjectId: string
      summary: string
      metadata: Record<string, unknown>
      now: Date
    },
  ): Promise<void> {
    await database.table('audit_logs').create({
      id: randomUUID(),
      actor_id: null,
      actor_label: 'Hall of Fame customization CLI',
      action: entry.action,
      subject_type: entry.subjectType,
      subject_id: entry.subjectId,
      summary: entry.summary,
      metadata: JSON.stringify(entry.metadata),
      created_at: entry.now,
      updated_at: entry.now,
    })
  }

  async delete(theme: ThemeRecord) {
    return DB.transaction(async (database) => {
      if (theme.status === 'active') {
        await database.table<ThemeRecord>('themes').where('id', theme.id).update({ status: 'archived' })
        await database.table<ThemeRecord>('themes').where('version', 1).update({
          status: 'active',
          activated_at: new Date()
        })
      }

      await database.table<ThemeRecord>('themes').where('id', theme.id).delete()
      await this.deleteAttachments(theme)

      await this.audit(database, {
        action: 'theme.deleted',
        subjectType: 'Theme',
        subjectId: theme.id,
        summary: `Deleted theme version ${theme.version}.`,
        metadata: { version: theme.version, source: '@hallofame/cli' },
        now: new Date(),
      })
    })
  }

  async deleteAttachments(theme: ThemeRecord) {
    await DB.table<ThemeRecord>('media_attachments')
      .where('attachable_id', theme.id)
      .where('attachable_type', 'Theme')
      .delete()
  }
}
