import { Application } from './Application'
import { CustomizeCommand } from './commands/CustomizeCommand'
import { Kernel } from '@h3ravel/musket'
import { LocalizeCommand } from './commands/LocalizeCommand'
import { ThemesCommand } from './commands/ThemesCommand'
import { version } from '../package.json'

await Kernel.init(await Application.init(), {
  name: 'halloffame',
  logo: String.raw`
 _  _  __  ___    ____   _  
| || |/__\| __|  / _/ | | | 
| >< | \/ | _|  | \_| |_| | 
|_||_|\__/|_|    \__/___|_|`,
  baseCommands: [CustomizeCommand, ThemesCommand, LocalizeCommand],
  packages: [{ name: '@hallofame/cli', version, alias: 'HOF CLI', base: true }],
  versionFormatter(pkgs, meta) {
    return pkgs
      .filter((e) => e.name !== 'Unknown')
      .map(meta.format)
      .join(meta.separator)
  },
  exceptionHandler(exception) {
    throw exception
  },
})
