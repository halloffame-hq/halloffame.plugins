import { Application as BaseApp, Musket } from '@h3ravel/musket'
import { ProjectDatabase, connectProjectDatabase } from './database'

import { HallOfFameProject } from './types'
import { Logger } from '@h3ravel/shared'
import { detectHallOfFameProject } from './project'

export class Application extends BaseApp {
    project!: HallOfFameProject
    connection!: ProjectDatabase

    static async init() {
        try {
            const app = new Application()
            app.project = await detectHallOfFameProject()

            app.connection = await connectProjectDatabase(app.project)

            return app
        } catch (error) {
            Logger.error(error instanceof Error ? error.message : String(error))
            process.exit(1)
        }
    }

    registerMusketListeners(musket: Musket<this>): void {
        musket.afterHandle.once(async () => {
            await this.connection.close()
        })
    }
}