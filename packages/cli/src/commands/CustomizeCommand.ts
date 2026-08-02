import { promptForSystemOptions, promptForTheme } from '../promptTheme'

import { Application } from '../Application'
import { Command } from '@h3ravel/musket'
import { ThemeRepository } from '../database/ThemeRepository'

export class CustomizeCommand extends Command<Application> {
  signature = 'customize'
  description = 'Interactively customize a Hall of Fame installation'

  async handle(): Promise<void> {
    const project = this.app.project

    this.info(`Detected Hall of Fame ${project.kind} project at ${project.root}.`)

    if (project.kind === 'app') {
      this.fail(
        'Theme persistence requires the paired Hall of Fame API project. Run this command from its root.',
      )

      return
    }

    try {
      const repository = new ThemeRepository()
      const active = await repository.active()

      const themeName = await this.ask('Theme version name', `${active.name} customization`)

      if (!themeName.trim() || themeName.trim().length > 120) {
        throw new Error('Theme version name must be between 1 and 120 characters.')
      }

      const document = await promptForTheme(this, active.document)
      const settings = await promptForSystemOptions(this, await repository.systemOptions())

      const activate = await this.confirm('Apply this customization immediately?', true)

      const theme = await repository.save(themeName.trim(), document, settings, activate)

      this.success(
        `${activate ? 'Applied' : 'Created'} theme version ${theme.version}: ${theme.name}`,
      )
    } finally {
      await this.app.connection.close()
    }
  }
}
