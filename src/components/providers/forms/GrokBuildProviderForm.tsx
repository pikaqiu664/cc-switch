import { useEffect, useMemo, useRef, useState } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import { Plus, Trash2, Wand2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Form,
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from "@/components/ui/form";
import { Input } from "@/components/ui/input";
import { Checkbox } from "@/components/ui/checkbox";
import JsonEditor from "@/components/JsonEditor";
import { useDarkMode } from "@/hooks/useDarkMode";
import { providerSchema, type ProviderFormData } from "@/lib/schemas/provider";
import {
  buildLocalProxyRequestOverrides,
  formatRequestOverrideObject,
} from "@/lib/requestOverrides";
import type {
  ClaudeApiKeyField,
  CodexApiFormat,
  CodexChatReasoning,
  PromptCacheRoutingMode,
  ProviderCategory,
  ProviderMeta,
} from "@/types";
import type { ProviderFormProps, ProviderFormValues } from "./ProviderForm";
import { BasicFormFields } from "./BasicFormFields";
import { CodexFormFields } from "./CodexFormFields";
import { ModelInputWithFetch, ReasoningLevelsInput } from "./shared";
import { ProviderPresetSelector } from "./ProviderPresetSelector";
import {
  fetchModelsForConfig,
  showFetchModelsError,
  type FetchedModel,
} from "@/lib/api/model-fetch";
import {
  grokBuildOfficialPreset,
  grokBuildProviderPresets,
  type GrokBuildProviderPreset,
} from "@/config/grokBuildProviderPresets";
import {
  codexApiFormatFromWireApi,
  extractCodexBaseUrl,
  extractCodexModelName,
  extractCodexWireApi,
} from "@/utils/providerConfigUtils";
import {
  GROK_BUILD_DEFAULT_API_BACKEND,
  GROK_BUILD_DEFAULT_CONTEXT_WINDOW,
  GROK_BUILD_DEFAULT_MODEL,
  buildGrokBuildConfig,
  parseGrokBuildConfig,
  updateGrokBuildConfig,
  validateGrokBuildConfig,
  type GrokBuildModelEntry,
} from "@/utils/grokBuildConfig";
import { resolveProviderIcon } from "@/utils/providerIcon";
import { GROKBUILD_OFFICIAL_PROVIDER_ID } from "@/utils/providerCapabilities";

type GrokBuildProviderFormProps = Omit<ProviderFormProps, "appId">;

// 预设列表见 grokBuildProviderPresets.ts：独立维护（与 Codex 预设无联动），
// 不含官方 / OAuth / 国产官方直连 / 纯开源托管站，默认模型为 Grok 系。
const grokPresetEntries: Array<{
  id: string;
  preset: GrokBuildProviderPreset;
}> = [
  { id: GROKBUILD_OFFICIAL_PROVIDER_ID, preset: grokBuildOfficialPreset },
  ...grokBuildProviderPresets.map((preset, index) => ({
    id: `grokbuild-${index}`,
    preset,
  })),
];

export const grokApiBackendFromApiFormat = (format: CodexApiFormat): string => {
  if (format === "openai_chat") return "chat_completions";
  if (format === "anthropic") return "messages";
  return "responses";
};

/** 新建档位行的默认值（档位名与实际模型一致，等级映射为空） */
function createModelEntry(profile: string, name = ""): GrokBuildModelEntry {
  return {
    profile,
    model: profile,
    name,
    contextWindow: GROK_BUILD_DEFAULT_CONTEXT_WINDOW,
    reasoningEfforts: [],
  };
}

export function GrokBuildProviderForm({
  providerId,
  submitLabel,
  onSubmit,
  onCancel,
  onSubmittingChange,
  initialData,
  showButtons = true,
}: GrokBuildProviderFormProps) {
  const { t } = useTranslation();
  const isDarkMode = useDarkMode();
  const initialConfigText =
    typeof initialData?.settingsConfig?.config === "string"
      ? initialData.settingsConfig.config
      : undefined;
  const initialConfig = useMemo(
    () => parseGrokBuildConfig(initialConfigText),
    [initialConfigText, initialData?.name],
  );

  const [selectedPresetId, setSelectedPresetId] = useState<string | null>(
    initialData ? null : "custom",
  );
  const [category, setCategory] = useState<ProviderCategory | undefined>(
    initialData?.category ?? "custom",
  );
  const [isPartner, setIsPartner] = useState(
    initialData?.meta?.isPartner ?? false,
  );
  const [partnerPromotionKey, setPartnerPromotionKey] = useState<string>();
  // 多模型档位列表：models.default 指向的档位用 defaultProfile 单独跟踪，
  // 列表内容（profile/model/name/上下文/思考等级）由行编辑维护。
  const [modelEntries, setModelEntries] = useState<GrokBuildModelEntry[]>(
    initialConfig.models.length > 0
      ? initialConfig.models
      : [
          createModelEntry(
            initialConfig.model || GROK_BUILD_DEFAULT_MODEL,
            initialData?.name ?? "",
          ),
        ],
  );
  const [defaultProfile, setDefaultProfile] = useState(
    initialConfig.model || GROK_BUILD_DEFAULT_MODEL,
  );
  const [baseUrl, setBaseUrl] = useState(initialConfig.baseUrl);
  const [apiKey, setApiKey] = useState(initialConfig.apiKey);
  const [apiBackend, setApiBackend] = useState(initialConfig.apiBackend);
  const [rawConfig, setRawConfig] = useState(
    initialConfigText ?? buildGrokBuildConfig(initialConfig),
  );
  const [apiFormat, setApiFormat] = useState<CodexApiFormat>(
    (initialData?.meta?.apiFormat as CodexApiFormat | undefined) ??
      "openai_responses",
  );
  const [anthropicAuthField, setAnthropicAuthField] =
    useState<ClaudeApiKeyField>(
      initialData?.meta?.apiKeyField ?? "ANTHROPIC_AUTH_TOKEN",
    );
  const [impersonateClaudeCode, setImpersonateClaudeCode] = useState(
    initialData?.meta?.impersonateClaudeCode === true,
  );
  const [maxOutputTokens, setMaxOutputTokens] = useState(
    initialData?.meta?.maxOutputTokens
      ? String(initialData.meta.maxOutputTokens)
      : "",
  );
  const [codexChatReasoning, setCodexChatReasoning] =
    useState<CodexChatReasoning>(initialData?.meta?.codexChatReasoning ?? {});
  const [promptCacheRouting, setPromptCacheRouting] =
    useState<PromptCacheRoutingMode>(
      initialData?.meta?.promptCacheRouting ?? "auto",
    );
  const [isFullUrl, setIsFullUrl] = useState(
    initialData?.meta?.isFullUrl ?? false,
  );
  const [customUserAgent, setCustomUserAgent] = useState(
    initialData?.meta?.customUserAgent ?? "",
  );
  const [headersOverride, setHeadersOverride] = useState(
    formatRequestOverrideObject(
      initialData?.meta?.localProxyRequestOverrides?.headers,
    ),
  );
  const [bodyOverride, setBodyOverride] = useState(
    formatRequestOverrideObject(
      initialData?.meta?.localProxyRequestOverrides?.body,
    ),
  );
  const [endpointAutoSelect, setEndpointAutoSelect] = useState(
    initialData?.meta?.endpointAutoSelect ?? true,
  );
  const [isEndpointModalOpen, setIsEndpointModalOpen] = useState(false);
  const [presetEndpoints, setPresetEndpoints] = useState<string[]>([]);
  const [draftCustomEndpoints, setDraftCustomEndpoints] = useState<string[]>(
    [],
  );
  // 模型自动获取：拉取 /models 列表供行内"实际请求模型"下拉选择
  const [fetchedModels, setFetchedModels] = useState<FetchedModel[]>([]);
  const [isFetchingModels, setIsFetchingModels] = useState(false);
  const fetchModelsSeqRef = useRef(0);

  // 拉取请求身份（Base URL / 完整地址开关 / API Key / 自定义 UA）一变即清空
  // 旧列表并作废在途请求，避免换号后残留旧列表误导选择。
  useEffect(() => {
    fetchModelsSeqRef.current += 1;
    setFetchedModels((prev) => (prev.length === 0 ? prev : []));
  }, [baseUrl, isFullUrl, apiKey, customUserAgent]);

  const handleFetchModels = () => {
    if (!baseUrl.trim() || !apiKey.trim()) {
      showFetchModelsError(null, t, {
        hasApiKey: !!apiKey.trim(),
        hasBaseUrl: !!baseUrl.trim(),
      });
      return;
    }
    const seq = ++fetchModelsSeqRef.current;
    setIsFetchingModels(true);
    fetchModelsForConfig(baseUrl, apiKey, isFullUrl, undefined, customUserAgent)
      .then((models) => {
        if (seq !== fetchModelsSeqRef.current) return;
        setFetchedModels(models);
        if (models.length === 0) {
          toast.info(t("providerForm.fetchModelsEmpty"));
        } else {
          toast.success(
            t("providerForm.fetchModelsSuccess", { count: models.length }),
          );
        }
      })
      .catch((error) => {
        if (seq !== fetchModelsSeqRef.current) return;
        console.warn("[GrokBuild] Failed to fetch models:", error);
        showFetchModelsError(error, t);
      })
      .finally(() => setIsFetchingModels(false));
  };

  const form = useForm<ProviderFormData>({
    resolver: zodResolver(providerSchema),
    defaultValues: {
      name: initialData?.name ?? initialConfig.models[0]?.name ?? "",
      websiteUrl: initialData?.websiteUrl ?? "",
      notes: initialData?.notes ?? "",
      settingsConfig: JSON.stringify({ config: rawConfig }),
      icon:
        resolveProviderIcon(
          "grokbuild",
          initialData?.icon,
          initialData?.iconColor,
        ) ?? "",
      iconColor: initialData?.iconColor ?? "",
    },
    mode: "onSubmit",
  });
  const { isSubmitting } = form.formState;
  const websiteUrl = form.watch("websiteUrl") ?? "";

  useEffect(() => {
    onSubmittingChange?.(isSubmitting);
  }, [isSubmitting, onSubmittingChange]);

  // Grok Build 预设已不含 cn_official（国产官方直连无法在 Grok CLI 使用）
  const presetCategoryLabels = useMemo(
    () => ({
      official: t("providerForm.categoryOfficial", { defaultValue: "官方" }),
      aggregator: t("providerForm.categoryAggregation", {
        defaultValue: "聚合服务",
      }),
      third_party: t("providerForm.categoryThirdParty", {
        defaultValue: "第三方",
      }),
    }),
    [t],
  );

  const speedTestEndpoints = useMemo(() => {
    const urls = new Set<string>();
    const add = (url?: string) => {
      const normalized = url?.trim().replace(/\/+$/, "");
      if (normalized) urls.add(normalized);
    };
    add(baseUrl);
    presetEndpoints.forEach(add);
    draftCustomEndpoints.forEach(add);
    return Array.from(urls).map((url) => ({ url }));
  }, [baseUrl, draftCustomEndpoints, presetEndpoints]);

  /** 用给定的档位列表与默认档位重建 config.toml 文本（公共字段取当前 state） */
  const syncWithEntries = (entries: GrokBuildModelEntry[], profile: string) => {
    setRawConfig((current) =>
      updateGrokBuildConfig(current, {
        model: profile,
        models: entries,
        baseUrl,
        apiKey,
        apiBackend,
        envKey: parseGrokBuildConfig(current).envKey,
      }),
    );
  };

  const updateEntry = (index: number, patch: Partial<GrokBuildModelEntry>) => {
    const next = modelEntries.map((entry, i) =>
      i === index ? { ...entry, ...patch } : entry,
    );
    setModelEntries(next);
    syncWithEntries(next, defaultProfile);
  };

  const addEntry = () => {
    const nextProfile = `grok-${modelEntries.length + 1}`;
    const next = [
      ...modelEntries,
      createModelEntry(nextProfile, form.getValues("name") || ""),
    ];
    setModelEntries(next);
    syncWithEntries(next, defaultProfile);
  };

  const removeEntry = (index: number) => {
    const removing = modelEntries[index];
    if (modelEntries.length <= 1) return;
    const next = modelEntries.filter((_, i) => i !== index);
    const nextDefault =
      removing && defaultProfile === removing.profile && next[0]
        ? next[0].profile
        : defaultProfile;
    setModelEntries(next);
    setDefaultProfile(nextDefault);
    syncWithEntries(next, nextDefault);
  };

  /** 一键填充：把第一行的思考等级复制到其余所有行 */
  const fillEffortsToAllEntries = () => {
    const source = modelEntries[0]?.reasoningEfforts ?? [];
    if (source.length === 0) {
      toast.error(
        t("grokBuild.fillEffortsEmpty", {
          defaultValue: "请先在第一行填写思考等级",
        }),
      );
      return;
    }
    const next = modelEntries.map((entry, index) =>
      index === 0 ? entry : { ...entry, reasoningEfforts: [...source] },
    );
    setModelEntries(next);
    syncWithEntries(next, defaultProfile);
    toast.success(
      t("grokBuild.fillEffortsSuccess", {
        defaultValue: "已将思考等级应用到所有档位",
      }),
    );
  };

  const handlePresetChange = (presetId: string) => {
    setSelectedPresetId(presetId);
    if (presetId === "custom") {
      setCategory("custom");
      setIsPartner(false);
      setPartnerPromotionKey(undefined);
      setPresetEndpoints([]);
      return;
    }

    if (presetId === GROKBUILD_OFFICIAL_PROVIDER_ID) {
      // 官方登录：无 API Key / 地址 / 模型表可填，提交走 ensure seed 流程
      form.setValue("name", grokBuildOfficialPreset.name);
      form.setValue("websiteUrl", grokBuildOfficialPreset.websiteUrl);
      form.setValue("icon", grokBuildOfficialPreset.icon ?? "");
      form.setValue("iconColor", grokBuildOfficialPreset.iconColor ?? "");
      setCategory("official");
      setIsPartner(false);
      setPartnerPromotionKey(undefined);
      setPresetEndpoints([]);
      setRawConfig("");
      return;
    }

    const entry = grokPresetEntries.find(
      (candidate) => candidate.id === presetId,
    );
    if (!entry) return;
    const preset = entry.preset;
    const presetName = preset.nameKey ? String(t(preset.nameKey)) : preset.name;
    const presetBaseUrl = extractCodexBaseUrl(preset.config) ?? "";
    const presetModel = extractCodexModelName(preset.config) ?? defaultProfile;
    const presetApiFormat =
      preset.apiFormat ??
      codexApiFormatFromWireApi(extractCodexWireApi(preset.config)) ??
      "openai_responses";
    const presetApiKey =
      "auth" in preset && typeof preset.auth?.OPENAI_API_KEY === "string"
        ? preset.auth.OPENAI_API_KEY
        : "";
    const presetApiBackend = grokApiBackendFromApiFormat(presetApiFormat);

    form.setValue("name", presetName);
    form.setValue("websiteUrl", preset.websiteUrl ?? "");
    form.setValue("icon", preset.icon ?? "");
    form.setValue("iconColor", preset.iconColor ?? "");
    setCategory(preset.category ?? "custom");
    setIsPartner(preset.isPartner ?? false);
    setPartnerPromotionKey(preset.partnerPromotionKey);
    setBaseUrl(presetBaseUrl);
    setApiKey(presetApiKey);
    setApiFormat(presetApiFormat);
    setApiBackend(presetApiBackend);
    setPresetEndpoints(preset.endpointCandidates ?? []);
    const presetEntry = createModelEntry(presetModel, presetName);
    setModelEntries([presetEntry]);
    setDefaultProfile(presetModel);
    setRawConfig(
      buildGrokBuildConfig({
        model: presetModel,
        models: [presetEntry],
        baseUrl: presetBaseUrl,
        apiKey: presetApiKey,
        envKey: "",
        apiBackend: presetApiBackend,
      }),
    );
  };

  const handleRawConfigChange = (value: string) => {
    setRawConfig(value);
    if (validateGrokBuildConfig(value)) return;
    const parsed = parseGrokBuildConfig(value);
    setModelEntries(
      parsed.models.length > 0
        ? parsed.models
        : [createModelEntry(parsed.model || GROK_BUILD_DEFAULT_MODEL)],
    );
    setDefaultProfile(parsed.model || GROK_BUILD_DEFAULT_MODEL);
    setBaseUrl(parsed.baseUrl);
    setApiKey(parsed.apiKey);
    setApiBackend(parsed.apiBackend || GROK_BUILD_DEFAULT_API_BACKEND);
    if (parsed.models[0]?.name) form.setValue("name", parsed.models[0].name);
  };

  const handleSubmit = async (values: ProviderFormData) => {
    const name = values.name.trim();

    // 官方条目：config 快照原样透传（新增时为空），不做自定义模型字段校验，
    // 也不重建 config —— 新增走 ensure seed，编辑只允许改名称/图标等元信息。
    if (category === "official") {
      await onSubmit({
        ...values,
        name,
        websiteUrl: values.websiteUrl?.trim() ?? "",
        notes: values.notes?.trim() ?? "",
        settingsConfig: JSON.stringify({ config: rawConfig }),
        presetId: selectedPresetId ?? undefined,
        presetCategory: "official",
        isPartner: false,
        meta: initialData?.meta,
      });
      return;
    }

    const envKey = parseGrokBuildConfig(rawConfig).envKey?.trim();
    if (!name || !baseUrl.trim() || (!apiKey.trim() && !envKey)) {
      toast.error(
        t("providerForm.requiredFields", {
          defaultValue: "请填写供应商名称、API 地址、API Key 和模型",
        }),
      );
      return;
    }

    // 档位显示名留空时回填供应商名称，保持"供应商名即默认显示名"的旧行为。
    const finalEntries = modelEntries.map((entry) =>
      entry.name.trim() ? entry : { ...entry, name },
    );

    const finalConfig = updateGrokBuildConfig(rawConfig, {
      model: defaultProfile,
      models: finalEntries,
      baseUrl,
      apiKey,
      apiBackend,
      envKey,
    });
    const configError = validateGrokBuildConfig(finalConfig);
    if (configError) {
      toast.error(
        t("grokBuild.invalidToml", {
          error: configError,
          defaultValue: `config.toml 格式错误: ${configError}`,
        }),
      );
      return;
    }

    const requestOverrides = buildLocalProxyRequestOverrides(
      headersOverride,
      bodyOverride,
    );
    if (requestOverrides.error) {
      toast.error(requestOverrides.error);
      return;
    }

    const customEndpoints = Object.fromEntries(
      draftCustomEndpoints.map((url) => [
        url,
        { url, addedAt: Date.now(), lastUsed: undefined },
      ]),
    );
    const parsedMaxOutputTokens = Number.parseInt(maxOutputTokens, 10);
    const initialMeta = { ...(initialData?.meta ?? {}) };
    delete initialMeta.custom_endpoints;
    const meta: ProviderMeta = {
      ...initialMeta,
      apiFormat,
      apiKeyField: anthropicAuthField,
      isFullUrl,
      endpointAutoSelect,
      isPartner,
      partnerPromotionKey,
      impersonateClaudeCode,
      promptCacheRouting,
      codexChatReasoning,
      customUserAgent: customUserAgent.trim() || undefined,
      localProxyRequestOverrides: requestOverrides.overrides,
      maxOutputTokens:
        Number.isInteger(parsedMaxOutputTokens) && parsedMaxOutputTokens > 0
          ? parsedMaxOutputTokens
          : undefined,
    };
    if (!providerId && Object.keys(customEndpoints).length > 0) {
      meta.custom_endpoints = customEndpoints;
    }
    const payload: ProviderFormValues = {
      ...values,
      name,
      websiteUrl: values.websiteUrl?.trim() ?? "",
      notes: values.notes?.trim() ?? "",
      settingsConfig: JSON.stringify({ config: finalConfig }),
      presetId: selectedPresetId ?? undefined,
      presetCategory: category ?? "custom",
      isPartner,
      meta,
    };

    await onSubmit(payload);
  };

  const rawConfigError = validateGrokBuildConfig(rawConfig);
  const defaultEntry = modelEntries.find(
    (entry) => entry.profile === defaultProfile,
  );
  // CodexFormFields 的"默认模型"输入编辑默认档位的实际请求模型。
  const defaultUpstreamModel = defaultEntry?.model ?? "";

  return (
    <Form {...form}>
      <form
        id="provider-form"
        onSubmit={form.handleSubmit(handleSubmit)}
        className="space-y-6 glass rounded-xl p-6 border border-white/10"
      >
        {!initialData && (
          <ProviderPresetSelector
            selectedPresetId={selectedPresetId}
            presetEntries={grokPresetEntries}
            presetCategoryLabels={presetCategoryLabels}
            onPresetChange={handlePresetChange}
            category={category}
          />
        )}

        <BasicFormFields form={form} />

        {category !== "official" && (
          <>
            <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
              <FormItem>
                <FormLabel htmlFor="grokbuild-api-backend">
                  {t("grokBuild.apiBackend", { defaultValue: "API Backend" })}
                </FormLabel>
                <Input
                  id="grokbuild-api-backend"
                  value={apiBackend}
                  onChange={(event) => {
                    const value = event.target.value;
                    setApiBackend(value);
                    syncWithEntries(modelEntries, defaultProfile);
                  }}
                  placeholder="responses"
                  autoComplete="off"
                />
              </FormItem>
            </div>

            <CodexFormFields
              appId="grokbuild"
              providerId={providerId}
              codexApiKey={apiKey}
              onApiKeyChange={(value) => {
                setApiKey(value);
                syncWithEntries(modelEntries, defaultProfile);
              }}
              category={category}
              shouldShowApiKeyLink={Boolean(websiteUrl)}
              websiteUrl={websiteUrl}
              isPartner={isPartner}
              partnerPromotionKey={partnerPromotionKey}
              shouldShowSpeedTest
              codexBaseUrl={baseUrl}
              onBaseUrlChange={(value) => {
                setBaseUrl(value);
                syncWithEntries(modelEntries, defaultProfile);
              }}
              isFullUrl={isFullUrl}
              onFullUrlChange={setIsFullUrl}
              isEndpointModalOpen={isEndpointModalOpen}
              onEndpointModalToggle={setIsEndpointModalOpen}
              onCustomEndpointsChange={setDraftCustomEndpoints}
              autoSelect={endpointAutoSelect}
              onAutoSelectChange={setEndpointAutoSelect}
              codexModel={defaultUpstreamModel}
              onModelChange={(value) => {
                const index = modelEntries.findIndex(
                  (entry) => entry.profile === defaultProfile,
                );
                if (index >= 0) updateEntry(index, { model: value });
              }}
              apiFormat={apiFormat}
              onApiFormatChange={(value) => {
                const backend = grokApiBackendFromApiFormat(value);
                setApiFormat(value);
                setApiBackend(backend);
                syncWithEntries(modelEntries, defaultProfile);
              }}
              anthropicAuthField={anthropicAuthField}
              onAnthropicAuthFieldChange={setAnthropicAuthField}
              impersonateClaudeCode={impersonateClaudeCode}
              onImpersonateClaudeCodeChange={setImpersonateClaudeCode}
              maxOutputTokens={maxOutputTokens}
              onMaxOutputTokensChange={setMaxOutputTokens}
              codexChatReasoning={codexChatReasoning}
              onCodexChatReasoningChange={setCodexChatReasoning}
              promptCacheRouting={promptCacheRouting}
              onPromptCacheRoutingChange={setPromptCacheRouting}
              speedTestEndpoints={speedTestEndpoints}
              customUserAgent={customUserAgent}
              onCustomUserAgentChange={setCustomUserAgent}
              localProxyHeadersOverride={headersOverride}
              onLocalProxyHeadersOverrideChange={setHeadersOverride}
              localProxyBodyOverride={bodyOverride}
              onLocalProxyBodyOverrideChange={setBodyOverride}
            />

            {/* 模型档位：多行列表（交互参考 Claude 模型映射区），
                每行一个 [model.<profile>] 表 + 可选的思考等级映射 */}
            <div className="space-y-3 border-t border-border-default pt-3">
              <div className="flex items-center justify-between">
                <FormLabel>
                  {t("grokBuild.modelProfilesLabel", {
                    defaultValue: "模型档位",
                  })}
                </FormLabel>
                <div className="flex gap-2">
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    onClick={fillEffortsToAllEntries}
                    className="h-7 gap-1"
                  >
                    <Wand2 className="h-3.5 w-3.5" />
                    {t("grokBuild.fillEfforts", {
                      defaultValue: "一键填充等级",
                    })}
                  </Button>
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    onClick={addEntry}
                    className="h-7 gap-1"
                  >
                    <Plus className="h-3.5 w-3.5" />
                    {t("grokBuild.addModel", { defaultValue: "添加模型" })}
                  </Button>
                </div>
              </div>
              <p className="text-xs leading-relaxed text-muted-foreground">
                {t("grokBuild.modelProfilesHint", {
                  defaultValue:
                    "一个档位对应 config.toml 的一张 [model.<档位名>] 表；API 地址、API Key 与 API Backend 为所有档位共享。思考等级按上游实际支持填写（逗号分隔），留空不写入。",
                })}
              </p>

              <div className="hidden grid-cols-[32px_140px_1fr_1fr_110px_170px_36px] gap-2 px-1 text-xs font-medium text-muted-foreground md:grid">
                <span aria-hidden />
                <span>
                  {t("grokBuild.columnProfile", { defaultValue: "档位名" })}
                </span>
                <span>
                  {t("grokBuild.columnName", { defaultValue: "显示名" })}
                </span>
                <span>
                  {t("grokBuild.columnModel", {
                    defaultValue: "实际请求模型",
                  })}
                </span>
                <span>
                  {t("grokBuild.columnContextWindow", {
                    defaultValue: "上下文窗口",
                  })}
                </span>
                <span>
                  {t("grokBuild.columnReasoning", {
                    defaultValue: "思考等级",
                  })}
                </span>
                <span aria-hidden />
              </div>

              <div className="space-y-2">
                {modelEntries.map((entry, index) => (
                  <div
                    key={`${entry.profile}-${index}`}
                    className="grid grid-cols-1 items-center gap-2 md:grid-cols-[32px_140px_1fr_1fr_110px_170px_36px]"
                  >
                    <Checkbox
                      checked={defaultProfile === entry.profile}
                      onCheckedChange={(checked) => {
                        // 默认档位必须存在且只有一个：勾选即设为默认，取消勾选忽略
                        if (checked) {
                          setDefaultProfile(entry.profile);
                          syncWithEntries(modelEntries, entry.profile);
                        }
                      }}
                      aria-label={t("grokBuild.columnDefaultProfile", {
                        defaultValue: "默认档位",
                      })}
                      title={t("grokBuild.columnDefaultProfile", {
                        defaultValue: "设为默认档位",
                      })}
                    />
                    <Input
                      id={
                        defaultProfile === entry.profile
                          ? "grokbuild-profile"
                          : `grokbuild-profile-${index}`
                      }
                      value={entry.profile}
                      onChange={(event) => {
                        const value = event.target.value.trim();
                        const wasDefault = defaultProfile === entry.profile;
                        const next = modelEntries.map((item, i) =>
                          i === index ? { ...item, profile: value } : item,
                        );
                        setModelEntries(next);
                        const nextDefault = wasDefault ? value : defaultProfile;
                        setDefaultProfile(nextDefault);
                        syncWithEntries(next, nextDefault);
                      }}
                      placeholder="grok-4.5"
                      autoComplete="off"
                      aria-label={t("grokBuild.columnProfile", {
                        defaultValue: "档位名",
                      })}
                    />
                    <Input
                      value={entry.name}
                      onChange={(event) =>
                        updateEntry(index, { name: event.target.value })
                      }
                      placeholder={t("grokBuild.namePlaceholder", {
                        defaultValue: "例如: DeepSeek V4 Flash",
                      })}
                      autoComplete="off"
                      aria-label={t("grokBuild.columnName", {
                        defaultValue: "显示名",
                      })}
                    />
                    <ModelInputWithFetch
                      id={`grokbuild-model-${index}`}
                      value={entry.model}
                      onChange={(value) => updateEntry(index, { model: value })}
                      placeholder="deepseek-v4-flash"
                      fetchedModels={fetchedModels}
                      isLoading={isFetchingModels}
                      onFetch={handleFetchModels}
                      aria-label={t("grokBuild.columnModel", {
                        defaultValue: "实际请求模型",
                      })}
                    />
                    <Input
                      type="number"
                      min={1}
                      inputMode="numeric"
                      value={entry.contextWindow}
                      onChange={(event) =>
                        updateEntry(index, {
                          contextWindow: Number.parseInt(
                            event.target.value.replace(/[^\d]/g, ""),
                            10,
                          ),
                        })
                      }
                      placeholder="500000"
                      autoComplete="off"
                      aria-label={t("grokBuild.columnContextWindow", {
                        defaultValue: "上下文窗口",
                      })}
                    />
                    <ReasoningLevelsInput
                      value={entry.reasoningEfforts}
                      onChange={(levels) =>
                        updateEntry(index, {
                          reasoningEfforts: levels ?? [],
                        })
                      }
                      placeholder="low, high, max"
                      aria-label={t("grokBuild.columnReasoning", {
                        defaultValue: "思考等级",
                      })}
                    />
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon"
                      className="h-9 w-9 text-muted-foreground hover:text-destructive"
                      onClick={() => removeEntry(index)}
                      disabled={modelEntries.length <= 1}
                      title={t("common.delete", { defaultValue: "删除" })}
                    >
                      <Trash2 className="h-4 w-4" />
                    </Button>
                  </div>
                ))}
              </div>
            </div>

            <div className="space-y-2">
              <FormLabel htmlFor="grokbuild-config-toml">
                {t("grokBuild.rawConfig", { defaultValue: "config.toml" })}
              </FormLabel>
              <JsonEditor
                value={rawConfig}
                onChange={handleRawConfigChange}
                placeholder=""
                darkMode={isDarkMode}
                rows={3}
                showValidation={false}
                language="javascript"
              />
              {rawConfigError && (
                <p className="text-xs text-destructive">
                  {t("grokBuild.invalidToml", {
                    error: rawConfigError,
                    defaultValue: `Invalid config.toml: ${rawConfigError}`,
                  })}
                </p>
              )}
            </div>
          </>
        )}

        <FormField
          control={form.control}
          name="settingsConfig"
          render={() => (
            <FormItem className="hidden">
              <FormControl>
                <Input type="hidden" />
              </FormControl>
              <FormMessage />
            </FormItem>
          )}
        />

        {showButtons && (
          <div className="flex justify-end gap-2">
            <Button variant="outline" type="button" onClick={onCancel}>
              {t("common.cancel")}
            </Button>
            <Button type="submit" disabled={isSubmitting}>
              {submitLabel}
            </Button>
          </div>
        )}
      </form>
    </Form>
  );
}
