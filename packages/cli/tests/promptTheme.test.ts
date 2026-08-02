import type { PromptAdapter, ThemeDocument, ThemePalette } from "../src/types";

import { describe, expect, it } from "vitest";
import { promptForTheme } from "../src/promptTheme";

const palette: ThemePalette = {
  primary: "rgb(31, 94, 255)",
  primaryForeground: "rgb(248, 250, 252)",
  accent: "rgb(124, 58, 237)",
  accentForeground: "rgb(15, 23, 42)",
  background: "rgb(255, 255, 255)",
  foreground: "rgb(15, 23, 42)",
  surface: "rgb(255, 255, 255)",
  surfaceForeground: "rgb(15, 23, 42)",
  muted: "rgb(241, 245, 249)",
  mutedForeground: "rgb(100, 116, 139)",
  border: "rgb(226, 232, 240)",
};

function legacyTheme(): ThemeDocument {
  return {
    schemaVersion: 1,
    identity: {
      name: "Hall Of Fame",
      shortName: "HOF",
      tagline: "Celebrate what matters.",
    },
    metadata: {
      titleTemplate: "{title} | {app_name}",
      description: "Connect with communities.",
    },
    colors: { light: palette, dark: palette },
    typography: {
      sans: "Inter, sans-serif",
      heading: "Inter, sans-serif",
      mono: "monospace",
    },
    shape: { radius: "0.75rem" },
    spacing: { density: "comfortable" },
  } as ThemeDocument;
}

describe("promptForTheme", () => {
  it("fills fields missing from a legacy active theme before continuing", async () => {
    const messages: string[] = [];
    const choices = ["essential", "comfortable"];
    const prompt: PromptAdapter = {
      async ask(message, defaultValue) {
        messages.push(message);

        return defaultValue ?? "";
      },
      async choice() {
        return choices.shift() ?? "comfortable";
      },
      async checkbox() {
        return [];
      },
      async confirm() {
        return true;
      },
    };

    const document = await promptForTheme(prompt, legacyTheme());

    expect(messages).toContain("Authentication title");
    expect(document.auth.title).toBe(
      "Your community, your identity, your Hall of Fame.",
    );
    expect(document.shape.radii.franklyCard).toBe("0.75rem");
  });
});
