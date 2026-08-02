import type { Application } from "@h3ravel/musket";
import { CustomizeCommand } from "./commands/CustomizeCommand.js";
import { Kernel } from "@h3ravel/musket";

class CustomizationApplication {}

await Kernel.init(new CustomizationApplication() as Application, {
  name: "halloffame",
  baseCommands: [CustomizeCommand],
  packages: ["@hallofame/cli", "@h3ravel/musket", "arkormx"],
});
