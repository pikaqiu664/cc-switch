import { parse as parseToml, stringify as stringifyToml } from "smol-toml";

export const GROK_BUILD_DEFAULT_MODEL = "grok-4.5";
export const GROK_BUILD_DEFAULT_API_BACKEND = "responses";
export const GROK_BUILD_DEFAULT_CONTEXT_WINDOW = 500000;

/** Grok Build 单个模型档位（对应 config.toml 的 [model.<profile>] 表） */
export interface GrokBuildModelEntry {
  /** 档位名：客户端可见的模型档位，也是 [model.<profile>] 表名 */
  profile: string;
  /** 实际发送给上游的模型名 */
  model: string;
  /** 显示名 */
  name: string;
  /** 上下文窗口 */
  contextWindow: number;
  /** 思考等级映射（空数组 = 不写 reasoning 字段） */
  reasoningEfforts: string[];
}

export interface GrokBuildConfigValues {
  /** 默认档位（models.default 指向的 profile） */
  model: string;
  /** 全部模型档位 */
  models: GrokBuildModelEntry[];
  /** 公共 API 地址（多档位共享同一网关） */
  baseUrl: string;
  /** 公共 API Key */
  apiKey: string;
  /** 公共凭据环境变量名 */
  envKey?: string;
  /** 公共 API Backend */
  apiBackend: string;
}

const asRecord = (value: unknown): Record<string, unknown> | undefined =>
  value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;

const asString = (value: unknown, fallback = "") =>
  typeof value === "string" ? value : fallback;

/** 解析单个 [model.<profile>] 表为档位条目 */
function parseModelEntry(profile: string, table: unknown): GrokBuildModelEntry {
  const entry = asRecord(table);
  const rawContextWindow = entry?.context_window;
  const rawEfforts = Array.isArray(entry?.reasoning_efforts)
    ? entry.reasoning_efforts.filter(
        (level): level is string => typeof level === "string",
      )
    : [];
  return {
    profile,
    model: asString(entry?.model, profile),
    name: asString(entry?.name, profile),
    contextWindow:
      typeof rawContextWindow === "number" &&
      Number.isInteger(rawContextWindow) &&
      rawContextWindow > 0
        ? rawContextWindow
        : GROK_BUILD_DEFAULT_CONTEXT_WINDOW,
    reasoningEfforts: rawEfforts.map((level) => level.trim()).filter(Boolean),
  };
}

/** 解析 config.toml 中全部 [model.*] 表为档位列表（保持文件顺序） */
function parseModelEntries(
  modelTables: unknown,
  defaultProfile: string,
): GrokBuildModelEntry[] {
  const tables = asRecord(modelTables);
  if (!tables) return [];
  const profiles = Object.keys(tables);
  if (profiles.length === 0) return [];

  // 默认档位排最前，其余保持原顺序，便于表单首行即默认档位。
  const ordered = [
    defaultProfile,
    ...profiles.filter((profile) => profile !== defaultProfile),
  ].filter((profile) => profile in tables);

  return ordered.map((profile) => parseModelEntry(profile, tables[profile]));
}

/** 归一化思考等级文本：去空白、去空串、去重，保持填写顺序 */
export function normalizeGrokReasoningEfforts(text: string): string[] {
  const seen = new Set<string>();
  return text
    .split(",")
    .map((level) => level.trim())
    .filter((level) => {
      if (!level || seen.has(level)) return false;
      seen.add(level);
      return true;
    });
}

export function parseGrokBuildConfig(
  configToml: string | undefined,
): GrokBuildConfigValues {
  const fallback: GrokBuildConfigValues = {
    model: GROK_BUILD_DEFAULT_MODEL,
    models: [],
    baseUrl: "",
    apiKey: "",
    envKey: "",
    apiBackend: GROK_BUILD_DEFAULT_API_BACKEND,
  };

  if (!configToml?.trim()) return fallback;

  try {
    const root = asRecord(parseToml(configToml));
    const models = asRecord(root?.models);
    const defaultModel = asString(models?.default, GROK_BUILD_DEFAULT_MODEL);
    const modelEntries = parseModelEntries(root?.model, defaultModel);
    if (modelEntries.length === 0) return fallback;

    // 公共凭据从默认档位表读取（多档位共享网关与密钥的约定）。
    const selectedModel = asRecord(asRecord(root?.model)?.[defaultModel]);
    return {
      model: defaultModel,
      models: modelEntries,
      baseUrl: asString(selectedModel?.base_url),
      apiKey: asString(selectedModel?.api_key),
      envKey: asString(selectedModel?.env_key),
      apiBackend: asString(
        selectedModel?.api_backend,
        GROK_BUILD_DEFAULT_API_BACKEND,
      ),
    };
  } catch {
    return fallback;
  }
}

export function buildGrokBuildConfig(values: GrokBuildConfigValues): string {
  return updateGrokBuildConfig(undefined, values);
}

export function updateGrokBuildConfig(
  configToml: string | undefined,
  values: GrokBuildConfigValues,
): string {
  const defaultProfile = values.model.trim() || GROK_BUILD_DEFAULT_MODEL;
  let config: Record<string, unknown> = {};

  try {
    config = asRecord(configToml?.trim() ? parseToml(configToml) : {}) ?? {};
  } catch {
    config = {};
  }

  // [models] 只重写 default 指向；其余键（如官方配置的
  // default_reasoning_effort）原样保留，避免破坏与 Grok CLI 的兼容。
  const existingModels = asRecord(config.models) ?? {};
  config.models = { ...existingModels, default: defaultProfile };

  const baseUrl = values.baseUrl.trim();
  const apiKey = values.apiKey.trim();
  const envKey = values.envKey?.trim() ?? "";
  const apiBackend = values.apiBackend.trim() || GROK_BUILD_DEFAULT_API_BACKEND;

  // 全量重建 [model.*]：档位列表是 provider 快照的权威来源，
  // 旧表中已删除的档位同步移除。
  const modelTables: Record<string, unknown> = {};
  for (const entry of values.models) {
    const profile = entry.profile.trim();
    if (!profile) continue;
    const table: Record<string, unknown> = {
      model: entry.model.trim() || profile,
      base_url: baseUrl,
      name: entry.name.trim() || profile,
      api_backend: apiBackend,
      context_window:
        Number.isInteger(entry.contextWindow) && entry.contextWindow > 0
          ? entry.contextWindow
          : GROK_BUILD_DEFAULT_CONTEXT_WINDOW,
    };
    if (apiKey) table.api_key = apiKey;
    if (envKey) table.env_key = envKey;

    // 思考等级映射：填写了才写 reasoning 字段，留空保持 Grok CLI 默认行为。
    const efforts = entry.reasoningEfforts
      .map((level) => level.trim())
      .filter(Boolean);
    if (efforts.length > 0) {
      table.supports_reasoning_effort = true;
      table.reasoning_efforts = efforts;
    }
    modelTables[profile] = table;
  }
  config.model = modelTables;

  return `${stringifyToml(config).trim()}\n`;
}

export function validateGrokBuildConfig(configToml: string): string | null {
  if (!configToml.trim()) return "config.toml must not be empty";
  let root: Record<string, unknown>;
  try {
    root = asRecord(parseToml(configToml)) ?? {};
  } catch (error) {
    return error instanceof Error ? error.message : "Invalid TOML";
  }

  const models = asRecord(root.models);
  const defaultProfile = asString(models?.default).trim();
  if (!defaultProfile) return "Missing [models] default";

  const modelTables = asRecord(root.model);
  if (!modelTables || Object.keys(modelTables).length === 0) {
    return "Missing [model.<profile>] tables";
  }
  const selected = asRecord(modelTables[defaultProfile]);
  if (!selected) return `Missing [model."${defaultProfile}"] table`;

  // 每个档位表都必须是完整可用的模型配置（多模型改造后的强校验）。
  for (const [profile, rawTable] of Object.entries(modelTables)) {
    const table = asRecord(rawTable);
    if (!table) return `Invalid [model."${profile}"] table`;
    for (const field of ["model", "base_url", "name", "api_backend"]) {
      if (!asString(table[field]).trim())
        return `Missing ${field} in [model."${profile}"]`;
    }
    if (!asString(table.api_key).trim() && !asString(table.env_key).trim()) {
      return `Missing api_key or env_key in [model."${profile}"]`;
    }
    const contextWindow = table.context_window;
    if (
      typeof contextWindow !== "number" ||
      !Number.isInteger(contextWindow) ||
      contextWindow <= 0
    ) {
      return `context_window must be a positive integer in [model."${profile}"]`;
    }
    const reasoningEfforts = table.reasoning_efforts;
    if (reasoningEfforts !== undefined) {
      if (
        !Array.isArray(reasoningEfforts) ||
        reasoningEfforts.length === 0 ||
        reasoningEfforts.some((level) => typeof level !== "string")
      ) {
        return `reasoning_efforts must be a non-empty string array in [model."${profile}"]`;
      }
    }
  }

  return null;
}

export function extractGrokBuildBaseUrl(configToml: string): string {
  return parseGrokBuildConfig(configToml).baseUrl;
}
