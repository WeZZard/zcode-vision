#!/usr/bin/env node
import {
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  writeFileSync,
} from "node:fs"
import { dirname, join, resolve } from "node:path"
import { homedir } from "node:os"
import { fileURLToPath, pathToFileURL } from "node:url"

const PICKER_MODEL_LIMIT = 6
const PICKER_PROVIDER_LIMIT = 3
const env = process.env
const packageRoot = dirname(dirname(fileURLToPath(import.meta.url)))

function usage() {
  return `Usage:
  node scripts/zcode-vision-models.mjs
  node scripts/zcode-vision-models.mjs --all
  node scripts/zcode-vision-models.mjs --model <provider/model>

Options:
  --all                   Include all discovered image-capable models as allModels[].
  --model <model>         Image-capable provider/model id to persist.
  --config-file <path>    ZCode config. Defaults to ~/.zcode/v2/config.json.
  --catalog-file <path>   ZCode model catalog JSON. Defaults to app resource discovery.
  --hints-file <path>     Vision model hint JSON. Defaults to bundled hints.
  --data-dir <path>       Plugin data dir for persisted choice. Defaults to ~/.zcode/vision.

Outputs JSON describing configured ZCode models identified as image-capable by metadata or hints.`
}

export function parseArgs(argv) {
  const args = {
    includeAll: false,
    selectedModel: undefined,
    configFile: undefined,
    catalogFile: undefined,
    hintsFile: undefined,
    dataDir: undefined,
    help: false,
  }

  for (let i = 0; i < argv.length; i += 1) {
    const rawArg = argv[i]
    const [arg, inlineValue] = splitInlineArg(rawArg)

    if (arg === "--help" || arg === "-h") {
      args.help = true
      continue
    }
    if (arg === "--all") {
      args.includeAll = true
      continue
    }
    if (arg === "--model") {
      args.selectedModel = inlineValue ?? readRequiredValue(argv, i, arg)
      if (inlineValue === undefined) i += 1
      continue
    }
    if (arg === "--config-file") {
      args.configFile = inlineValue ?? readRequiredValue(argv, i, arg)
      if (inlineValue === undefined) i += 1
      continue
    }
    if (arg === "--catalog-file") {
      args.catalogFile = inlineValue ?? readRequiredValue(argv, i, arg)
      if (inlineValue === undefined) i += 1
      continue
    }
    if (arg === "--hints-file") {
      args.hintsFile = inlineValue ?? readRequiredValue(argv, i, arg)
      if (inlineValue === undefined) i += 1
      continue
    }
    if (arg === "--data-dir") {
      args.dataDir = inlineValue ?? readRequiredValue(argv, i, arg)
      if (inlineValue === undefined) i += 1
      continue
    }
    throw new Error(`Unknown argument: ${rawArg}`)
  }

  return args
}

function splitInlineArg(arg) {
  const equals = arg.indexOf("=")
  if (equals < 0) return [arg, undefined]
  return [arg.slice(0, equals), arg.slice(equals + 1)]
}

function readRequiredValue(argv, index, flag) {
  const value = argv[index + 1]
  if (!value || value.startsWith("--")) {
    throw new Error(`${flag} requires a value`)
  }
  return value
}

function homeDir() {
  return env.ZCODE_TEST_HOME ?? homedir()
}

function defaultConfigFile() {
  return join(homeDir(), ".zcode", "v2", "config.json")
}

function defaultDataDir() {
  return join(homeDir(), ".zcode", "vision")
}

function defaultHintsFile() {
  return join(packageRoot, "data", "vision-model-hints.json")
}

function candidateCatalogFiles() {
  const explicit = env.ZCODE_MODEL_CATALOG_PATH
  const candidates = []
  if (explicit) candidates.push(explicit)

  const resourceDirs = [
    "/Applications/ZCode.app/Contents/Resources/model-providers",
    join(homeDir(), "Applications", "ZCode.app", "Contents", "Resources", "model-providers"),
  ]

  for (const dir of resourceDirs) {
    try {
      for (const name of readdirSync(dir)) {
        if (/^models_catalog_.*\.json$/u.test(name)) {
          candidates.push(join(dir, name))
        }
      }
    } catch {
      // Missing app resources are fine in tests and non-macOS installs.
    }
  }

  return candidates
}

function defaultCatalogFile() {
  return candidateCatalogFiles().find((file) => existsSync(file))
}

function readJsonFile(filepath, fallback) {
  if (!filepath || !existsSync(filepath)) return fallback
  return JSON.parse(readFileSync(filepath, "utf8"))
}

function readHintsFile(filepath) {
  const raw = readJsonFile(filepath, { models: [] })
  if (Array.isArray(raw)) return raw.filter(isRecord)
  if (Array.isArray(raw.models)) return raw.models.filter(isRecord)
  return []
}

function isRecord(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value)
}

function stringArray(value) {
  return Array.isArray(value)
    ? value.filter((item) => typeof item === "string")
    : []
}

function providerDisplayName(providerID, providerConfig, catalogProvider) {
  return (
    stringValue(providerConfig.name) ??
    stringValue(catalogProvider?.name) ??
    providerID
  )
}

function stringValue(value) {
  return typeof value === "string" && value.trim() ? value : undefined
}

function compactMatchKey(value) {
  return String(value ?? "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/gu, "")
}

function matchStrings(value) {
  if (typeof value === "string") return [value]
  if (Array.isArray(value)) return value.filter((item) => typeof item === "string")
  return []
}

function catalogProviders(catalog) {
  if (!isRecord(catalog)) return new Map()
  const raw = Array.isArray(catalog.providers)
    ? catalog.providers
    : Object.values(catalog.providers ?? {})
  const providers = new Map()
  for (const provider of raw) {
    if (!isRecord(provider) || typeof provider.id !== "string") continue
    providers.set(provider.id, provider)
  }
  return providers
}

function catalogProviderAliases(providerID) {
  const aliases = new Set([providerID])
  if (providerID.startsWith("builtin:")) aliases.add(providerID.slice("builtin:".length))
  return aliases
}

function catalogProviderFor(providerID, providers) {
  for (const alias of catalogProviderAliases(providerID)) {
    const found = providers.get(alias)
    if (found) return found
  }
}

function catalogModelMap(catalogProvider) {
  if (!isRecord(catalogProvider)) return {}
  if (Array.isArray(catalogProvider.models)) {
    return Object.fromEntries(
      catalogProvider.models
        .filter((model) => isRecord(model) && typeof model.id === "string")
        .map((model) => [model.id, model]),
    )
  }
  if (isRecord(catalogProvider.models)) return catalogProvider.models
  return {}
}

function mergeModel(catalogModel, configModel) {
  const base = isRecord(catalogModel) ? catalogModel : {}
  const override = isRecord(configModel) ? configModel : {}
  return {
    ...base,
    ...override,
    modalities: {
      ...(isRecord(base.modalities) ? base.modalities : {}),
      ...(isRecord(override.modalities) ? override.modalities : {}),
    },
    limit: {
      ...(isRecord(base.limit) ? base.limit : {}),
      ...(isRecord(override.limit) ? override.limit : {}),
    },
  }
}

function configuredProviders(config, catalog) {
  const providers = []
  const catalogByID = catalogProviders(catalog)
  const rawProviders = isRecord(config.provider) ? config.provider : {}

  for (const [providerID, providerConfig] of Object.entries(rawProviders)) {
    if (!isRecord(providerConfig)) continue
    if (providerConfig.enabled === false) continue
    const catalogProvider = catalogProviderFor(providerID, catalogByID)
    const catalogModels = catalogModelMap(catalogProvider)
    const configuredModels = isRecord(providerConfig.models) ? providerConfig.models : {}
    providers.push({
      id: providerID,
      name: providerDisplayName(providerID, providerConfig, catalogProvider),
      config: providerConfig,
      catalogProvider,
      models: Object.fromEntries(
        Object.entries(configuredModels).map(([modelID, modelConfig]) => [
          modelID,
          mergeModel(catalogModels[modelID], modelConfig),
        ]),
      ),
    })
  }

  return providers
}

function modelInputModalities(model) {
  return stringArray(model?.modalities?.input)
}

function modelOutputModalities(model) {
  return stringArray(model?.modalities?.output)
}

function contextLimit(model) {
  if (typeof model?.contextWindow === "number") return model.contextWindow
  if (typeof model?.limit?.context === "number") return model.limit.context
  return null
}

function maxOutputTokens(model) {
  if (typeof model?.maxOutputTokens === "number") return model.maxOutputTokens
  if (typeof model?.limit?.output === "number") return model.limit.output
  return null
}

function reasoningEnabled(model) {
  if (model?.reasoning === true) return true
  if (isRecord(model?.reasoning)) {
    if (model.reasoning.enabled === true) return true
    if (typeof model.reasoning.defaultLevel === "string" && model.reasoning.defaultLevel !== "off") return true
    if (typeof model.reasoning.defaultVariant === "string" && model.reasoning.defaultVariant !== "off") return true
    if (isRecord(model.reasoning.levels) && Object.keys(model.reasoning.levels).some((level) => level !== "off")) return true
  }
  return false
}

function modelCapabilities(model) {
  const input = modelInputModalities(model)
  const output = modelOutputModalities(model)
  const supportsImage = input.includes("image") || (input.length === 0 && model?.attachment === true)
  const supportsTextOutput = output.length === 0 || output.includes("text")
  return { input, output, supportsImage, supportsTextOutput }
}

function hintInputModalities(hint) {
  return stringArray(hint.inputModalities ?? hint.modalities?.input)
}

function hintOutputModalities(hint) {
  return stringArray(hint.outputModalities ?? hint.modalities?.output)
}

function hintPatterns(hint) {
  return [
    ...matchStrings(hint.id),
    ...matchStrings(hint.model),
    ...matchStrings(hint.name),
    ...matchStrings(hint.names),
    ...matchStrings(hint.match),
    ...matchStrings(hint.matches),
  ].filter(Boolean)
}

function modelMatchCandidates(provider, modelID, model) {
  const candidates = [
    modelID,
    model.name,
    model.id,
    model.model,
    `${provider.id}/${modelID}`,
    `${provider.name}/${modelID}`,
  ]

  return candidates.filter((candidate) => typeof candidate === "string" && candidate.trim())
}

function hintMatchesModel(hint, provider, modelID, model) {
  const patterns = hintPatterns(hint)
    .map(compactMatchKey)
    .filter(Boolean)
  if (patterns.length === 0) return false

  const candidates = modelMatchCandidates(provider, modelID, model)
    .map(compactMatchKey)
    .filter(Boolean)

  return patterns.some((pattern) =>
    candidates.some((candidate) => candidate === pattern || candidate.includes(pattern)),
  )
}

function modelHint(provider, modelID, model, hints) {
  return hints.find((hint) => hintMatchesModel(hint, provider, modelID, model))
}

function effectiveCapabilities(model, hint) {
  const capabilities = modelCapabilities(model)
  const hintedInput = hint ? hintInputModalities(hint) : []
  const hintedOutput = hint ? hintOutputModalities(hint) : []
  const hintSupportsImage = hintedInput.includes("image")
  const hintSupportsTextOutput = hintedOutput.includes("text")
  const supportsImage = capabilities.supportsImage || hintSupportsImage
  const supportsTextOutput =
    hintedOutput.length > 0 ? hintSupportsTextOutput : capabilities.supportsTextOutput
  const input = hintedInput.length > 0 && hintSupportsImage ? hintedInput : capabilities.input
  const output = hintedOutput.length > 0 ? hintedOutput : capabilities.output
  let source = "config"

  if (hintSupportsImage && capabilities.supportsImage) source = "config+hint"
  else if (hintSupportsImage) source = "hint"

  return {
    input,
    output,
    supportsImage,
    supportsTextOutput,
    source,
    hintSupportsImage,
  }
}

function displayModel(providerID, modelID) {
  return `${providerID}/${modelID}`
}

function discoverVisionModels(config, catalog, hints = []) {
  const models = []
  const providers = configuredProviders(config, catalog)

  for (const provider of providers) {
    for (const [modelID, model] of Object.entries(provider.models)) {
      if (!isRecord(model)) continue
      if (model.status && model.status !== "active") continue
      const hint = modelHint(provider, modelID, model, hints)
      const capabilities = effectiveCapabilities(model, hint)
      if (!capabilities.supportsImage || !capabilities.supportsTextOutput) continue
      const modelName = stringValue(hint?.label) ?? stringValue(hint?.name) ?? stringValue(model.name) ?? modelID
      const fullModel = displayModel(provider.id, modelID)
      models.push({
        model: fullModel,
        provider: provider.id,
        providerName: provider.name,
        modelID,
        name: modelName,
        supportsImage: true,
        supportsTextOutput: true,
        inputModalities: capabilities.input,
        outputModalities: capabilities.output,
        capabilitySource: capabilities.source,
        hintID: capabilities.hintSupportsImage ? stringValue(hint?.id) ?? null : null,
        contextLimit: contextLimit(model),
        maxOutputTokens: maxOutputTokens(model),
        reasoning: reasoningEnabled(model),
        status: typeof model.status === "string" ? model.status : "active",
        pickerLabel: fullModel,
        pickerDescription: "",
      })
    }
  }

  models.sort(compareModels)
  return { providers, models }
}

function compareModels(a, b) {
  if (a.status !== b.status) {
    if (a.status === "active") return -1
    if (b.status === "active") return 1
  }
  if (a.reasoning !== b.reasoning) return a.reasoning ? -1 : 1
  if (a.contextLimit !== b.contextLimit) {
    return (b.contextLimit ?? 0) - (a.contextLimit ?? 0)
  }
  if (a.maxOutputTokens !== b.maxOutputTokens) {
    return (b.maxOutputTokens ?? 0) - (a.maxOutputTokens ?? 0)
  }
  return a.model.localeCompare(b.model)
}

function normalizeSeriesSource(value) {
  return value
    .toLowerCase()
    .replace(/@/gu, "")
    .replace(/[._:]+/gu, "-")
    .replace(/\//gu, " ")
    .replace(/[^a-z0-9\-\s]+/gu, " ")
    .replace(/\s+/gu, " ")
    .trim()
}

function versionParts(value) {
  return (value.match(/\d+/gu) ?? []).map((part) => Number(part))
}

function findVersionSpan(source) {
  const patterns = [
    { pattern: /\b([a-z]+-)(\d+(?:(?:-\d+)|(?:p\d+))+)\b/u, group: 2 },
    { pattern: /\b([a-z]+)(\d+(?:(?:-\d+)|(?:p\d+))+)\b/u, group: 2 },
    { pattern: /\b(\d+(?:-\d+)+)\b/u, group: 1 },
    { pattern: /\b([a-z]+-)(\d+)(?=$|-)/u, group: 2 },
    { pattern: /\b([a-z]+)(\d+)(?=$|-)/u, group: 2 },
  ]

  for (const { pattern, group } of patterns) {
    const match = pattern.exec(source)
    if (!match) continue
    const text = match[group]
    const relativeStart = match[0].indexOf(text)
    return {
      start: match.index + relativeStart,
      end: match.index + relativeStart + text.length,
      parts: versionParts(text),
    }
  }
}

function modelSeries(entry) {
  for (const source of [entry.modelID, entry.name]) {
    if (!source) continue
    const normalized = normalizeSeriesSource(source)
    if (!normalized) continue
    const version = findVersionSpan(normalized)
    if (!version || version.parts.length === 0) continue
    const key = `${normalized.slice(0, version.start)}<version>${normalized.slice(version.end)}`
      .replace(/[^a-z0-9<>]+/gu, " ")
      .replace(/\s+/gu, " ")
      .trim()
    return { key, version: version.parts }
  }

  const fallback = normalizeSeriesSource(entry.modelID || entry.name || entry.model)
    .replace(/[^a-z0-9]+/gu, " ")
    .replace(/\s+/gu, " ")
    .trim()
  return { key: fallback || entry.model, version: [] }
}

function compareVersionParts(a, b) {
  const length = Math.max(a.length, b.length)
  for (let i = 0; i < length; i += 1) {
    const left = a[i] ?? 0
    const right = b[i] ?? 0
    if (left !== right) return left - right
  }
  return 0
}

function latestModelsBySeries(models) {
  const bestBySeries = new Map()

  for (const entry of models) {
    const series = modelSeries(entry)
    const key = `${entry.provider}:${series.key}`
    const current = bestBySeries.get(key)
    if (
      !current ||
      compareVersionParts(series.version, current.series.version) > 0 ||
      (compareVersionParts(series.version, current.series.version) === 0 &&
        compareModels(entry, current.entry) < 0)
    ) {
      bestBySeries.set(key, { entry, series })
    }
  }

  return Array.from(bestBySeries.values())
    .map((item) => item.entry)
    .sort(compareModels)
}

function addPickerEntry(result, providerCounts, entry, options = {}) {
  if (!entry) return false
  if (result.some((item) => item.model === entry.model)) return false
  if (!options.force) {
    const providerCount = providerCounts.get(entry.provider) ?? 0
    if (providerCount >= PICKER_PROVIDER_LIMIT) return false
  }
  result.push(entry)
  providerCounts.set(entry.provider, (providerCounts.get(entry.provider) ?? 0) + 1)
  return true
}

function pickerModels(models, persistedChoice) {
  const ranked = latestModelsBySeries(models)
  const result = []
  const providerCounts = new Map()

  addPickerEntry(result, providerCounts, ranked[0])
  if (persistedChoice) {
    addPickerEntry(result, providerCounts, persistedChoice, { force: true })
  }

  for (const entry of ranked) {
    if (result.length >= PICKER_MODEL_LIMIT) break
    addPickerEntry(result, providerCounts, entry)
  }

  return result.slice(0, PICKER_MODEL_LIMIT).map((entry) =>
    pickerModelPayload(entry, {
      saved: entry.model === persistedChoice?.model,
    }),
  )
}

function pickerModelPayload(entry, options = {}) {
  const tags = [options.saved ? "Saved choice" : undefined].filter(Boolean)
  const suffix = tags.length > 0 ? ` (${tags.join(", ")})` : ""
  const detail = [
    entry.name,
    "image",
    entry.inputModalities?.includes("video") ? "video" : undefined,
    entry.capabilitySource === "hint" ? "hint" : undefined,
    entry.reasoning ? "reasoning" : undefined,
    entry.contextLimit ? `${entry.contextLimit} ctx` : undefined,
  ].filter(Boolean)
  return {
    model: entry.model,
    provider: entry.provider,
    providerName: entry.providerName,
    modelID: entry.modelID,
    capabilitySource: entry.capabilitySource,
    inputModalities: entry.inputModalities,
    outputModalities: entry.outputModalities,
    pickerLabel: entry.pickerLabel,
    pickerDescription: `${detail.join(" - ")}${suffix}`,
  }
}

function choicePayload(entry) {
  if (!entry) return undefined
  return pickerModelPayload(entry)
}

export function choiceFile(dataDir) {
  return join(dataDir, "vision-model-image.txt")
}

export function readPersistedChoice(file, modelsByID) {
  try {
    if (!existsSync(file)) return undefined
    const raw = readFileSync(file, "utf8").trim()
    const entry = modelsByID.get(raw)
    if (entry?.supportsImage) return entry
  } catch {
    return undefined
  }
}

export function persistSelection(file, entry) {
  mkdirSync(dirname(file), { recursive: true })
  writeFileSync(file, `${entry.model}\n`)
}

export function validateSelectedModel(model, modelsByID) {
  const entry = modelsByID.get(model)
  if (!entry) throw new Error(`Unknown image model: ${model}`)
  if (!entry.supportsImage) throw new Error(`Model ${model} does not support image input`)
  return entry
}

function buildWarnings({ configFile, catalogFile, hintsFile, configured, models }) {
  const warnings = []
  if (!existsSync(configFile)) {
    warnings.push(`ZCode config not found: ${configFile}`)
  }
  if (!catalogFile) {
    warnings.push("ZCode model catalog file was not found; only configured model metadata can be used.")
  }
  if (!hintsFile || !existsSync(hintsFile)) {
    warnings.push("Vision model hint file was not found; only config/catalog modality metadata can be used.")
  }
  if (configured.providers.length === 0) {
    warnings.push("No enabled ZCode model providers were found in the provider registry.")
  }
  if (models.length === 0) {
    warnings.push("No enabled configured ZCode model matched image-capable config/catalog metadata or vision hints.")
  }
  return warnings
}

export function runDiscovery(options = {}) {
  const configFile = resolve(options.configFile ?? env.ZCODE_CONFIG_FILE ?? defaultConfigFile())
  const catalogFile = options.catalogFile ?? defaultCatalogFile()
  const hintsFile = resolve(options.hintsFile ?? env.ZCODE_VISION_HINTS_FILE ?? defaultHintsFile())
  const dataDir = resolve(options.dataDir ?? env.ZCODE_VISION_DATA_DIR ?? defaultDataDir())
  const config = readJsonFile(configFile, {})
  const catalog = readJsonFile(catalogFile, {})
  const hints = readHintsFile(hintsFile)
  const configured = discoverVisionModels(config, catalog, hints)
  const allModels = configured.models
  const allModelsByID = new Map(allModels.map((entry) => [entry.model, entry]))
  const file = choiceFile(dataDir)
  const persistedChoice = readPersistedChoice(file, allModelsByID)
  const picker = pickerModels(allModels, persistedChoice)
  const warnings = buildWarnings({ configFile, catalogFile, hintsFile, configured, models: allModels })

  return {
    configFile,
    catalogFile: catalogFile ? resolve(catalogFile) : null,
    hintsFile,
    dataDir,
    choiceFile: file,
    allModels,
    allModelsByID,
    payload: {
      ok: true,
      persistedChoice: choicePayload(persistedChoice) ?? null,
      selectedModel: persistedChoice?.model ?? null,
      selectionRequired: !persistedChoice && picker.length > 0,
      models: picker,
      modelCount: allModels.length,
      configuredProviders: configured.providers.map((provider) => ({
        id: provider.id,
        name: provider.name,
        modelCount: Object.keys(provider.models).length,
      })),
      choiceFile: file,
      sources: {
        configFile,
        catalogFile: catalogFile ? resolve(catalogFile) : null,
        hintsFile,
        dataDir,
      },
      warnings,
    },
  }
}

function cliPayload(discovery, args) {
  const result = {
    saved: false,
    ...discovery.payload,
  }
  if (args.includeAll) {
    result.allModels = discovery.allModels.map((entry) => ({
      ...entry,
      pickerDescription: pickerModelPayload(entry).pickerDescription,
    }))
  }
  return result
}

export function saveSelectedModel(options, model) {
  const discovery = runDiscovery(options)
  const selected = validateSelectedModel(model, discovery.allModelsByID)
  persistSelection(discovery.choiceFile, selected)
  const after = runDiscovery(options)
  return {
    selected,
    payload: {
      ok: true,
      saved: true,
      savedChoice: choicePayload(selected),
      ...after.payload,
    },
  }
}

async function main() {
  const args = parseArgs(process.argv.slice(2))
  if (args.help) {
    console.log(usage())
    return
  }

  if (args.selectedModel) {
    console.log(JSON.stringify(saveSelectedModel(args, args.selectedModel).payload, null, 2))
    return
  }

  const discovery = runDiscovery(args)
  console.log(JSON.stringify({ ok: true, ...cliPayload(discovery, args) }, null, 2))
}

const isCli = process.argv[1]
  ? import.meta.url === pathToFileURL(resolve(process.argv[1])).href
  : false

if (isCli) {
  main().catch((error) => {
    console.error(
      JSON.stringify(
        {
          ok: false,
          error: "script_error",
          message: error instanceof Error ? error.message : String(error),
        },
        null,
        2,
      ),
    )
    process.exit(1)
  })
}
