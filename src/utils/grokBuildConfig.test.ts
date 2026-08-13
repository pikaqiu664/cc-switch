import { describe, expect, it } from "vitest";
import { parse as parseToml } from "smol-toml";
import {
  buildGrokBuildConfig,
  extractGrokBuildBaseUrl,
  normalizeGrokReasoningEfforts,
  parseGrokBuildConfig,
  updateGrokBuildConfig,
  validateGrokBuildConfig,
} from "./grokBuildConfig";

const singleModelValues = {
  model: "grok-4.5",
  models: [
    {
      profile: "grok-4.5",
      model: "grok-4.5",
      name: 'Relay "A"',
      contextWindow: 500000,
      reasoningEfforts: [] as string[],
    },
  ],
  baseUrl: "https://relay.example.com/v1",
  apiKey: "secret",
  envKey: "",
  apiBackend: "responses",
};

describe("Grok Build config", () => {
  it("builds the expected provider TOML", () => {
    const config = buildGrokBuildConfig(singleModelValues);
    const parsed = parseToml(config) as any;

    expect(parsed.models.default).toBe("grok-4.5");
    expect(parsed.model["grok-4.5"]).toEqual({
      model: "grok-4.5",
      base_url: "https://relay.example.com/v1",
      name: 'Relay "A"',
      api_key: "secret",
      api_backend: "responses",
      context_window: 500000,
    });
    expect(config).toContain('[model."grok-4.5"]');
  });

  it("reads values back from a generated config", () => {
    const config = buildGrokBuildConfig({
      ...singleModelValues,
      model: "custom-model",
      models: [
        {
          profile: "custom-model",
          model: "upstream-model",
          name: "Custom",
          contextWindow: 320000,
          reasoningEfforts: [],
        },
      ],
    });

    expect(parseGrokBuildConfig(config)).toEqual({
      model: "custom-model",
      models: [
        {
          profile: "custom-model",
          model: "upstream-model",
          name: "Custom",
          contextWindow: 320000,
          reasoningEfforts: [],
        },
      ],
      baseUrl: "https://relay.example.com/v1",
      apiKey: "secret",
      envKey: "",
      apiBackend: "responses",
    });
    expect(extractGrokBuildBaseUrl(config)).toBe(
      "https://relay.example.com/v1",
    );
  });

  it("accepts env_key credentials without adding an empty api_key", () => {
    const config = `[models]
default = "env-profile"

[model."env-profile"]
model = "grok-4.5"
base_url = "https://api.example.com/v1"
name = "Env Relay"
env_key = "XAI_API_KEY"
api_backend = "responses"
context_window = 500000
`;

    expect(validateGrokBuildConfig(config)).toBeNull();
    expect(parseGrokBuildConfig(config).envKey).toBe("XAI_API_KEY");

    const updated = updateGrokBuildConfig(config, {
      ...parseGrokBuildConfig(config),
      baseUrl: "https://updated.example.com/v1",
    });
    const parsed = parseToml(updated) as any;
    expect(parsed.model["env-profile"].env_key).toBe("XAI_API_KEY");
    expect(parsed.model["env-profile"]).not.toHaveProperty("api_key");
  });

  it("reports malformed, incomplete, and invalid-window configs", () => {
    expect(validateGrokBuildConfig("")).toBe("config.toml must not be empty");
    expect(validateGrokBuildConfig("[models")).not.toBeNull();
    expect(validateGrokBuildConfig('[models]\ndefault = "missing"\n')).toBe(
      "Missing [models] default",
    );

    const missingCredentials = `[models]
default = "grok-4.5"

[model."grok-4.5"]
model = "grok-4.5"
base_url = "https://api.example.com/v1"
name = "Relay"
api_backend = "responses"
context_window = 500000
`;
    expect(validateGrokBuildConfig(missingCredentials)).toBe(
      'Missing api_key or env_key in [model."grok-4.5"]',
    );

    const invalidWindow = missingCredentials.replace(
      "context_window = 500000",
      "context_window = 0",
    );
    expect(validateGrokBuildConfig(invalidWindow)).toBe(
      'Missing api_key or env_key in [model."grok-4.5"]',
    );
    expect(
      validateGrokBuildConfig(
        invalidWindow.replace(
          'name = "Relay"',
          'name = "Relay"\napi_key = "secret"',
        ),
      ),
    ).toBe('context_window must be a positive integer in [model."grok-4.5"]');
  });

  it("renames the selected profile without leaving the old table behind", () => {
    const original = buildGrokBuildConfig({
      ...singleModelValues,
      models: [
        {
          profile: "old-profile",
          model: "grok-upstream",
          name: "Relay",
          contextWindow: 500000,
          reasoningEfforts: [],
        },
      ],
      model: "old-profile",
    });

    const parsedValues = parseGrokBuildConfig(original);
    const renamed = updateGrokBuildConfig(original, {
      ...parsedValues,
      model: "new-profile",
      models: [{ ...parsedValues.models[0], profile: "new-profile" }],
    });
    const parsed = parseToml(renamed) as any;

    expect(parsed.models.default).toBe("new-profile");
    expect(parsed.model["new-profile"].model).toBe("grok-upstream");
    expect(parsed.model).not.toHaveProperty("old-profile");
  });

  it("writes multiple model tables with per-profile reasoning efforts", () => {
    const config = buildGrokBuildConfig({
      model: "deepseek-v4-pro",
      models: [
        {
          profile: "deepseek-v4-pro",
          model: "deepseek-v4-pro",
          name: "DeepSeek V4 Pro",
          contextWindow: 1000000,
          reasoningEfforts: ["low", "high", "max"],
        },
        {
          profile: "deepseek-v4-flash",
          model: "deepseek-v4-flash",
          name: "DeepSeek V4 Flash",
          contextWindow: 1000000,
          reasoningEfforts: ["low", "high"],
        },
      ],
      baseUrl: "https://api.deepseek.com/v1",
      apiKey: "secret",
      envKey: "",
      apiBackend: "chat_completions",
    });
    const parsed = parseToml(config) as any;

    expect(parsed.models.default).toBe("deepseek-v4-pro");
    expect(Object.keys(parsed.model)).toEqual([
      "deepseek-v4-pro",
      "deepseek-v4-flash",
    ]);
    expect(parsed.model["deepseek-v4-pro"]).toMatchObject({
      model: "deepseek-v4-pro",
      base_url: "https://api.deepseek.com/v1",
      supports_reasoning_effort: true,
      reasoning_efforts: ["low", "high", "max"],
    });
    expect(parsed.model["deepseek-v4-flash"].reasoning_efforts).toEqual([
      "low",
      "high",
    ]);
  });

  it("round-trips multi-model config with shared credentials", () => {
    const config = buildGrokBuildConfig({
      model: "deepseek-v4-flash",
      models: [
        {
          profile: "deepseek-v4-flash",
          model: "deepseek-v4-flash",
          name: "DeepSeek V4 Flash",
          contextWindow: 1000000,
          reasoningEfforts: ["low", "high", "max"],
        },
        {
          profile: "deepseek-v4-pro",
          model: "deepseek-v4-pro",
          name: "DeepSeek V4 Pro",
          contextWindow: 1000000,
          reasoningEfforts: ["low", "high", "max"],
        },
      ],
      baseUrl: "https://api.deepseek.com/v1",
      apiKey: "secret",
      envKey: "",
      apiBackend: "chat_completions",
    });
    const parsed = parseGrokBuildConfig(config);

    expect(parsed.model).toBe("deepseek-v4-flash");
    expect(parsed.baseUrl).toBe("https://api.deepseek.com/v1");
    expect(parsed.apiBackend).toBe("chat_completions");
    expect(parsed.models).toHaveLength(2);
    expect(parsed.models.map((entry) => entry.profile)).toEqual([
      "deepseek-v4-flash",
      "deepseek-v4-pro",
    ]);
    expect(parsed.models[0].reasoningEfforts).toEqual(["low", "high", "max"]);
  });

  it("drops reasoning fields when efforts are emptied", () => {
    const original = buildGrokBuildConfig({
      ...singleModelValues,
      models: [
        {
          profile: "grok-4.5",
          model: "grok-4.5",
          name: "Relay",
          contextWindow: 500000,
          reasoningEfforts: ["low", "high"],
        },
      ],
    });
    const updated = updateGrokBuildConfig(original, {
      ...parseGrokBuildConfig(original),
      models: [
        { ...parseGrokBuildConfig(original).models[0], reasoningEfforts: [] },
      ],
    });
    const parsed = parseToml(updated) as any;

    expect(parsed.model["grok-4.5"]).not.toHaveProperty(
      "supports_reasoning_effort",
    );
    expect(parsed.model["grok-4.5"]).not.toHaveProperty("reasoning_efforts");
  });

  it("keeps unrelated top-level tables and models.default_reasoning_effort", () => {
    const original = `[models]
default = "old-profile"
default_reasoning_effort = "max"

[model."old-profile"]
model = "grok-4.5"
base_url = "https://api.example.com/v1"
name = "Relay"
api_key = "secret"
api_backend = "responses"
context_window = 500000

[marketplace]
default_skills_installs_purged = true
`;
    const updated = updateGrokBuildConfig(original, {
      ...parseGrokBuildConfig(original),
      models: [
        {
          profile: "new-profile",
          model: "grok-4.5",
          name: "Relay",
          contextWindow: 500000,
          reasoningEfforts: ["high"],
        },
      ],
      model: "new-profile",
    });
    const parsed = parseToml(updated) as any;

    expect(parsed.models.default).toBe("new-profile");
    expect(parsed.models.default_reasoning_effort).toBe("max");
    expect(parsed.marketplace.default_skills_installs_purged).toBe(true);
    expect(parsed.model["new-profile"].reasoning_efforts).toEqual(["high"]);
  });

  it("normalizes reasoning effort text with trim and dedupe", () => {
    expect(normalizeGrokReasoningEfforts("low, high, low,, max")).toEqual([
      "low",
      "high",
      "max",
    ]);
    expect(normalizeGrokReasoningEfforts("")).toEqual([]);
  });

  it("rejects invalid reasoning_efforts in any model table", () => {
    const config = `[models]
default = "a"

[model."a"]
model = "grok-4.5"
base_url = "https://api.example.com/v1"
name = "Relay"
api_key = "secret"
api_backend = "responses"
context_window = 500000
reasoning_efforts = []

[model."b"]
model = "grok-4.5-mini"
base_url = "https://api.example.com/v1"
name = "Relay Mini"
api_key = "secret"
api_backend = "responses"
context_window = 500000
reasoning_efforts = ["low", 42]
`;

    expect(validateGrokBuildConfig(config)).toBe(
      'reasoning_efforts must be a non-empty string array in [model."a"]',
    );
    expect(
      validateGrokBuildConfig(config.replace("reasoning_efforts = []", "")),
    ).toBe('reasoning_efforts must be a non-empty string array in [model."b"]');
  });
});
