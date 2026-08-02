import type { HallOfFameProject, ProjectKind } from "./types";
import { access, readFile } from "node:fs/promises";

import path from "node:path";

const PROJECTS: Record<ProjectKind, { names: string[]; markers: string[] }> = {
  api: {
    names: ["hallofame.ng.api"],
    markers: ["src/config/database.ts", "src/core/platform/ThemeDocument.ts"],
  },
  app: {
    names: ["halloffame-react", "halloffame.ng.react"],
    markers: ["vite.config.ts", "src/repository/types/app-config.ts"],
  },
};

const exists = async (file: string): Promise<boolean> => {
  try {
    await access(file);

    return true;
  } catch {
    return false;
  }
};

export async function detectHallOfFameProject(
  cwd = process.cwd(),
): Promise<HallOfFameProject> {
  const root = path.resolve(cwd);
  const manifestPath = path.join(root, "package.json");
  if (!(await exists(manifestPath))) {
    throw new Error(
      "Run this command from a Hall of Fame API or app project root.",
    );
  }

  const manifest = JSON.parse(await readFile(manifestPath, "utf8")) as {
    name?: string;
  };

  const kind = (Object.keys(PROJECTS) as ProjectKind[]).find(
    (candidate) =>
      manifest.name && PROJECTS[candidate].names.includes(manifest.name),
  );

  if (kind && manifest.name) {
    const markerChecks = await Promise.all(
      PROJECTS[kind].markers.map(async (marker) => ({
        marker,
        exists: await exists(path.join(root, marker)),
      })),
    );

    if (markerChecks.every((check) => check.exists))
      return { kind, name: manifest.name, root };

    const missing = markerChecks
      .filter((check) => !check.exists)
      .map((check) => check.marker);

    throw new Error(
      `Hall of Fame ${kind} project is missing required files: ${missing.join(", ")}`,
    );
  }

  throw new Error(
    `Run this command from a Hall of Fame API or app project root. Found package "${manifest.name ?? "unnamed"}".`,
  );
}
