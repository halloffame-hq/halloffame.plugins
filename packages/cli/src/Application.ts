import { Application as BaseApp, Musket } from '@h3ravel/musket'
import { ProjectDatabase, connectProjectDatabase } from './database'

import { HallOfFameProject } from './types'
import { Logger } from '@h3ravel/shared'
import { detectHallOfFameProject } from './project'

export class Application extends BaseApp {
  project!: HallOfFameProject
  private connection?: ProjectDatabase

  static async init() {
    try {
      const app = new Application()
      app.project = await detectHallOfFameProject()

      return app
    } catch (error) {
      Logger.error(error instanceof Error ? error.message : String(error))
      process.exit(1)
    }
  }

  /**
   * Lazily connect to the project database. Commands that never touch the
   * database (for example the localization round-trip) skip the connection
   * entirely, which lets them run from the app root as well as the API root.
   */
  async database(): Promise<ProjectDatabase> {
    if (!this.connection) {
      this.connection = await connectProjectDatabase(this.project)
    }

    return this.connection
  }

  registerMusketListeners(musket: Musket<this>): void {
    musket.afterHandle.once(async () => {
      if (this.connection) await this.connection.close()
    })
  }
}
