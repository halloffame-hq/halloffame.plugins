import type { SystemOptions, ThemeDocument, ThemeRecord } from "./types";

import { DB } from "arkormx";
import { randomUUID } from "node:crypto";

const SYSTEM_DEFAULTS: SystemOptions = {
  "features.premium": true,
  "features.advertising": true,
  "features.messaging": true,
  "features.frankly": true,
  "limits.post_word_count": 500,
};

export class ThemeRepository {
  async active(): Promise<ThemeRecord> {
    const theme = await DB.raw<ThemeRecord>(
      "select id, name, version, document from themes where status = ? order by version desc limit 1",
      ["active"],
    );

    const active = theme.first();
    if (!active)
      throw new Error(
        "No active Phase 21 theme exists. Run the API database seeder first.",
      );

    return active;
  }

  async systemOptions(): Promise<SystemOptions> {
    const keys = Object.keys(SYSTEM_DEFAULTS);
    const placeholders = keys.map(() => "?").join(", ");
    const rows = await DB.raw<{ key: keyof SystemOptions; value: unknown }>(
      `select key, value from platform_settings where key in (${placeholders})`,
      keys,
    );
    const options = structuredClone(SYSTEM_DEFAULTS);
    for (const row of rows) options[row.key] = row.value as never;

    return options;
  }

  async save(
    name: string,
    document: ThemeDocument,
    settings: SystemOptions,
    activate: boolean,
  ): Promise<ThemeRecord> {
    return DB.transaction(async (database) => {
      const current = await database.raw<ThemeRecord>(
        "select id, name, version, document from themes where status = ? order by version desc limit 1",
        ["active"],
      );

      const active = current.first();
      if (!active)
        throw new Error(
          "No active Phase 21 theme exists. Run the API database seeder first.",
        );

      const versionRows = await database.raw<{ version: number }>(
        "select coalesce(max(version), 0) + 1 as version from themes",
      );
      const version = Number(versionRows.first()?.version ?? 1);
      const id = randomUUID();
      const now = new Date();

      if (activate) {
        await database.raw(
          "update themes set status = ?, updated_at = ? where status = ?",
          ["archived", now, "active"],
        );
      }

      await database.raw(
        `insert into themes
          (id, version, name, status, document, based_on_id, created_by, activated_at, created_at, updated_at)
         values (?, ?, ?, ?, ?::jsonb, ?, null, ?, ?, ?)`,
        [
          id,
          version,
          name,
          activate ? "active" : "draft",
          JSON.stringify(document),
          active.id,
          activate ? now : null,
          now,
          now,
        ],
      );

      await database.raw(
        `insert into media_attachments
          (id, media_id, attachable_type, attachable_id, collection, position, created_at, updated_at)
         select gen_random_uuid(), media_id, attachable_type, ?, collection, position, ?, ?
         from media_attachments where attachable_type = ? and attachable_id = ?`,
        [id, now, now, "Theme", active.id],
      );

      for (const [key, value] of Object.entries(settings)) {
        await database.raw(
          `insert into platform_settings (id, key, value, updated_by, created_at, updated_at)
           values (?, ?, ?::jsonb, null, ?, ?)
           on conflict (key) do update set value = excluded.value, updated_by = null, updated_at = excluded.updated_at`,
          [randomUUID(), key, JSON.stringify(value), now, now],
        );

        await this.audit(database, {
          action: "config.updated",
          subjectType: "setting",
          subjectId: key,
          summary: `Set ${key} to ${JSON.stringify(value)} through the customization CLI.`,
          metadata: { value, source: "@hallofame/cli" },
          now,
        });
      }

      await this.audit(database, {
        action: activate ? "theme.applied" : "theme.imported",
        subjectType: "Theme",
        subjectId: id,
        summary: `${activate ? "Applied" : "Created"} theme version ${version} through the customization CLI.`,
        metadata: { version, basedOnId: active.id, source: "@hallofame/cli" },
        now,
      });

      return { id, name, version, document };
    });
  }

  private async audit(
    database: DB,
    entry: {
      action: string;
      subjectType: string;
      subjectId: string;
      summary: string;
      metadata: Record<string, unknown>;
      now: Date;
    },
  ): Promise<void> {
    await database.raw(
      `insert into audit_logs
        (id, actor_id, actor_label, action, subject_type, subject_id, summary, metadata, ip, created_at, updated_at)
       values (?, null, ?, ?, ?, ?, ?, ?::jsonb, null, ?, ?)`,
      [
        randomUUID(),
        "Hall of Fame customization CLI",
        entry.action,
        entry.subjectType,
        entry.subjectId,
        entry.summary,
        JSON.stringify(entry.metadata),
        entry.now,
        entry.now,
      ],
    );
  }
}
