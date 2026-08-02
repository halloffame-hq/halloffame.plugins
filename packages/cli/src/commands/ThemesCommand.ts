import { Application } from '../Application'
import { Command } from '@h3ravel/musket'
import { DB } from 'arkormx'
import { Logger } from '@h3ravel/shared'
import { ThemeRecord } from '../types'
import { ThemeRepository } from '../database/ThemeRepository'

export class ThemesCommand extends Command<Application> {
  signature = 'themes'
  description = 'Manage all system themes interactively'

  async handle(): Promise<void> {
    const project = this.app.project

    this.info(`Detected Hall of Fame ${project.kind} project at ${project.root}.`)

    if (project.kind === 'app') {
      this.fail(
        'Theme persistence requires the paired Hall of Fame API project. Run this command from its root.',
      )

      return
    }

    const themes = await DB.table<ThemeRecord>('themes')
      .select({
        id: true,
        name: true,
        status: true,
        version: true,
        document: true,
      })
      .orderBy({ version: 'desc' })
      .get()

    const id = await this.choice(
      'Choose Theme:',
      themes
        .map((e) => ({
          name: e.name,
          value: e.id,
          description: `Version: ${e.version}`,
        }))
        .toArray(),
    )

    const theme = themes.firstWhere('id', id)
    if (!theme) {
      this.error('Invalid Theme')
      process.exit(0)
    }

    const action = await this.choice('Action:', [
      { name: 'Details', value: 'details' },
      {
        name: 'Delete Theme',
        value: 'delete',
        disabled: theme.version == 1,
      },
      { name: 'Exit', value: 'exit' },
    ])

    switch (action) {
      case 'delete':
        if (await this.confirm(`Are you sure you want to delete ${theme.name}`)) {
          const s = this.spinner(`Deleting ${theme.name}...`)
          await this.deleteTheme(theme)
          s.succeed(`${theme.name} deleted successfully.`)
        }
        break
      case 'details':
        this.themeDetails(theme)
        break

      default:
        process.exit(0)
    }
  }

  async themeDetails(theme: ThemeRecord) {
    const fields: Array<[string, string]> = [
      ['Name', theme.name],
      ['Status', String(theme.status)],
      ['Version', String(theme.version)],
    ]

    console.log(fields.map(([label, value]) => Logger.log([
      [label, ['cyan', 'bold']],
      [`${value}`, 'white'],
    ], ': ', false)).join('\n'))
  }

  async deleteTheme(theme: ThemeRecord) {
    await new ThemeRepository().delete(theme)
  }
}
