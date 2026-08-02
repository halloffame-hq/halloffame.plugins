export type ProjectKind = "api" | "app";

export interface HallOfFameProject {
  kind: ProjectKind;
  name: string;
  root: string;
}

export interface ThemePalette {
  primary: string;
  primaryForeground: string;
  accent: string;
  accentForeground: string;
  background: string;
  foreground: string;
  surface: string;
  surfaceForeground: string;
  muted: string;
  mutedForeground: string;
  border: string;
}

export interface ThemeRadii {
  postCard: string;
  hallCard: string;
  featuredCategoryCard: string;
  recommendedHall: string;
  button: string;
  skeleton: string;
  spotlightCard: string;
  categoryCard: string;
  franklyCard: string;
  anonymousCard: string;
  premiumCard: string;
  pinCard: string;
}

export interface ThemeDocument {
  schemaVersion: 1;
  identity: { name: string; shortName: string; tagline: string };
  metadata: { titleTemplate: string; description: string };
  auth: { title: string; description: string };
  colors: { light: ThemePalette; dark: ThemePalette };
  typography: { sans: string; heading: string; mono: string };
  shape: { radius: string; radii: ThemeRadii };
  spacing: { density: "compact" | "comfortable" | "spacious" };
}

export interface ThemeRecord {
  [key: string]: unknown;
  id: string;
  name: string;
  version: number;
  document: ThemeDocument;
}

export interface SystemOptions {
  "features.premium": boolean;
  "features.advertising": boolean;
  "features.messaging": boolean;
  "features.frankly": boolean;
  "limits.post_word_count": number;
}

export type BooleanSystemOption = Exclude<
  keyof SystemOptions,
  'limits.post_word_count'
>;

export interface PromptAdapter {
  ask(message: string, defaultValue?: string): Promise<string>;
  choice(
    message: string,
    choices: Array<{ name: string; value: string }>,
    defaultIndex?: number,
  ): Promise<string>;
  checkbox(
    message: string,
    choices: Array<{ name: string; value: string }>,
    required?: boolean,
    prefix?: string,
    pageSize?: number
  ): Promise<string[]>;
  confirm(message: string, defaultValue?: boolean): Promise<boolean>;
}
