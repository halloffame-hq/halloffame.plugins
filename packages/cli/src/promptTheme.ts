import type {
  BooleanSystemOption,
  PromptAdapter,
  SystemOptions,
  ThemeDocument,
  ThemePalette,
  ThemeRadii,
} from "./types";

const RGB =
  /^rgba?\(\s*([\d.]+)\s*,\s*([\d.]+)\s*,\s*([\d.]+)(?:\s*,\s*([\d.]+))?\s*\)$/i;
const LENGTH = /^\d+(?:\.\d+)?(?:px|rem)$/;
const DEFAULT_AUTH: ThemeDocument["auth"] = {
  title: "Your community, your identity, your Hall of Fame.",
  description:
    "Connect with people who share your interests, celebrate moments and build a profile that feels like you.",
};
const RADIUS_KEYS: Array<keyof ThemeRadii> = [
  "postCard",
  "hallCard",
  "featuredCategoryCard",
  "recommendedHall",
  "button",
  "skeleton",
  "spotlightCard",
  "categoryCard",
  "franklyCard",
  "anonymousCard",
  "premiumCard",
  "pinCard",
];

const isRgbColor = (value: string): boolean => {
  const match = value.match(RGB);
  if (!match) return false;
  const channels = match.slice(1, 4).map(Number);
  const alpha = match[4];

  return (
    channels.every(
      (channel) => Number.isInteger(channel) && channel >= 0 && channel <= 255,
    ) &&
    (alpha === undefined || (Number(alpha) >= 0 && Number(alpha) <= 1))
  );
};

async function valid(
  prompt: PromptAdapter,
  message: string,
  current: string,
  maximum: number,
  validate: (value: string) => boolean = () => true,
): Promise<string> {
  const value = (await prompt.ask(message, current)).trim();
  if (!value || value.length > maximum || !validate(value)) {
    throw new Error(`${message} has an invalid value.`);
  }

  return value;
}

export async function promptForTheme(
  prompt: PromptAdapter,
  source: ThemeDocument,
): Promise<ThemeDocument> {
  const document = structuredClone(source);
  document.auth = { ...DEFAULT_AUTH, ...document.auth };
  document.shape.radii = Object.fromEntries(
    RADIUS_KEYS.map((key) => [
      key,
      document.shape.radii?.[key] ?? document.shape.radius,
    ]),
  ) as unknown as ThemeRadii;

  document.identity.name = await valid(
    prompt,
    "Application name",
    document.identity.name,
    80,
  );

  document.identity.shortName = await valid(
    prompt,
    "Short application name",
    document.identity.shortName,
    20,
  );

  document.identity.tagline = await valid(
    prompt,
    "Tagline",
    document.identity.tagline,
    160,
  );

  document.metadata.titleTemplate = await valid(
    prompt,
    "Page title template",
    document.metadata.titleTemplate,
    160,
  );

  document.metadata.description = await valid(
    prompt,
    "Application description",
    document.metadata.description,
    320,
  );

  document.auth.title = await valid(
    prompt,
    "Authentication title",
    document.auth.title,
    160,
  );

  document.auth.description = await valid(
    prompt,
    "Authentication description",
    document.auth.description,
    320,
  );

  const mode = await prompt.choice(
    "How much of the theme should be customized?",
    [
      { name: "Essential brand colors", value: "essential" },
      { name: "Every theme token", value: "complete" },
    ],
  );

  const paletteKeys = Object.keys(document.colors.light) as Array<
    keyof ThemePalette
  >;

  const keys = mode === "complete" ? paletteKeys : (["primary", "accent"] as const);

  for (const themeMode of ["light", "dark"] as const) {
    for (const key of keys) {
      document.colors[themeMode][key] = await valid(
        prompt,
        `${themeMode} ${key} color, rgb() or rgba()`,
        document.colors[themeMode][key],
        32,
        isRgbColor,
      );
    }
  }

  if (mode === "complete") {
    document.typography.sans = await valid(
      prompt,
      "Body font stack",
      document.typography.sans,
      200,
    );

    document.typography.heading = await valid(
      prompt,
      "Heading font stack",
      document.typography.heading,
      200,
    );

    document.typography.mono = await valid(
      prompt,
      "Monospace font stack",
      document.typography.mono,
      200,
    );

    document.shape.radius = await valid(
      prompt,
      "Default corner radius",
      document.shape.radius,
      24,
      (value) => LENGTH.test(value),
    );

    for (const key of Object.keys(document.shape.radii) as Array<
      keyof ThemeRadii
    >) {
      document.shape.radii[key] = await valid(
        prompt,
        `${key} corner radius`,
        document.shape.radii[key],
        24,
        (value) => LENGTH.test(value),
      );
    }
  }

  document.spacing.density = (await prompt.choice(
    "Interface density",
    [
      { name: "Compact", value: "compact" },
      { name: "Comfortable", value: "comfortable" },
      { name: "Spacious", value: "spacious" },
    ],
    ["compact", "comfortable", "spacious"].indexOf(document.spacing.density),
  )) as ThemeDocument["spacing"]["density"];

  return document;
}

export async function promptForSystemOptions(
  prompt: PromptAdapter,
  source: SystemOptions,
): Promise<SystemOptions> {
  const options = structuredClone(source);
  const optionKeys = Object.keys(options) as BooleanSystemOption[]

  const values = new Set(await prompt.checkbox(
    "System Options", [
    { name: 'Enable premium subscriptions', value: 'features.premium' },
    { name: 'Enable advertising', value: 'features.advertising' },
    { name: 'Enable direct messaging', value: 'features.messaging' },
    { name: 'Enable Frankly', value: 'features.frankly' },
  ]) as BooleanSystemOption[])


  for (const key of optionKeys) {
    if (typeof options[key] !== 'boolean') continue
    options[key] = values.has(key);
  }

  Object.assign(source, options);

  const wordCount = Number(
    await prompt.ask("Default post word limit", String(options["limits.post_word_count"])),
  );

  if (!Number.isInteger(wordCount) || wordCount < 1)
    throw new Error("Post word limit must be a positive integer.");
  options["limits.post_word_count"] = wordCount;

  return options;
}
