import assert from "node:assert/strict"
import { execFile } from "node:child_process"
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"
import { test } from "node:test"
import { promisify } from "node:util"

const execFileAsync = promisify(execFile)
const packageDir = dirname(dirname(fileURLToPath(import.meta.url)))
const scriptPath = join(packageDir, "scripts", "zcode-vision-models.mjs")

function zcodeConfig() {
  return {
    provider: {
      "builtin:zai-start-plan": {
        name: "Z.ai",
        enabled: true,
        models: {
          "glm-4.6v": {},
          "glm-5.2": {},
          "glm-4.5v": {},
        },
      },
      "custom-disabled": {
        name: "Disabled",
        enabled: false,
        models: {
          "disabled-vision": {
            modalities: { input: ["text", "image"], output: ["text"] },
          },
        },
      },
      "custom-local": {
        name: "Local",
        models: {
          "local-vision-1": {
            name: "Local Vision 1",
            modalities: { input: ["text", "image"], output: ["text"] },
            contextWindow: 32_000,
          },
          "local-vision-2": {
            name: "Local Vision 2",
            modalities: { input: ["text", "image"], output: ["text"] },
            contextWindow: 64_000,
          },
          "local-image-output": {
            modalities: { input: ["text", "image"], output: ["image"] },
          },
        },
      },
    },
  }
}

function catalog() {
  return {
    schemaVersion: 1,
    providers: [
      {
        id: "zai-start-plan",
        name: "Z.ai Catalog",
        models: [
          {
            id: "glm-4.6v",
            name: "GLM-4.6V",
            modalities: { input: ["text", "image"], output: ["text"] },
            contextWindow: 128_000,
            maxOutputTokens: 8192,
            reasoning: { defaultLevel: "medium" },
          },
          {
            id: "glm-4.5v",
            name: "GLM-4.5V",
            modalities: { input: ["text", "image"], output: ["text"] },
            contextWindow: 64_000,
          },
          {
            id: "glm-5.2",
            name: "GLM-5.2",
            modalities: { input: ["text"], output: ["text"] },
            contextWindow: 128_000,
          },
        ],
      },
    ],
  }
}

async function fixture({ config = zcodeConfig(), modelCatalog = catalog() } = {}) {
  const root = await mkdtemp(join(tmpdir(), "zcode-vision-models-test-"))
  const configFile = join(root, "config.json")
  const catalogFile = join(root, "catalog.json")
  const dataDir = join(root, "data")
  await mkdir(dataDir)
  await writeFile(configFile, JSON.stringify(config, null, 2))
  await writeFile(catalogFile, JSON.stringify(modelCatalog, null, 2))
  return {
    root,
    configFile,
    catalogFile,
    dataDir,
    choiceFile: join(dataDir, "vision-model-image.txt"),
  }
}

async function withFixture(options, fn) {
  const fx = await fixture(options)
  try {
    await fn(fx)
  } finally {
    await rm(fx.root, { recursive: true, force: true })
  }
}

async function runZcode(fx, args = []) {
  const env = { ...process.env }
  delete env.ZCODE_CONFIG_FILE
  delete env.ZCODE_MODEL_CATALOG_PATH
  delete env.ZCODE_VISION_DATA_DIR
  delete env.ZCODE_TEST_HOME

  try {
    const { stdout, stderr } = await execFileAsync(
      process.execPath,
      [
        scriptPath,
        "--config-file",
        fx.configFile,
        "--catalog-file",
        fx.catalogFile,
        "--data-dir",
        fx.dataDir,
        ...args,
      ],
      { cwd: packageDir, env },
    )
    return { code: 0, stdout, stderr, json: JSON.parse(stdout) }
  } catch (error) {
    return {
      code: error.code ?? 1,
      stdout: error.stdout ?? "",
      stderr: error.stderr ?? "",
      json: JSON.parse(error.stdout || error.stderr),
    }
  }
}

function modelIDs(result, field = "models") {
  return result.json[field].map((model) => model.model)
}

test("lists enabled configured image-and-text ZCode models only", async () => {
  await withFixture({}, async (fx) => {
    const result = await runZcode(fx, ["--all"])
    assert.equal(result.code, 0)
    assert.deepEqual(new Set(modelIDs(result, "allModels")), new Set([
      "builtin:zai-start-plan/glm-4.6v",
      "builtin:zai-start-plan/glm-4.5v",
      "custom-local/local-vision-1",
      "custom-local/local-vision-2",
    ]))
    assert.equal(result.json.modelCount, 4)
    assert.equal(result.json.persistedChoice, null)
    assert.equal(result.json.choiceFile, fx.choiceFile)
    assert.equal(modelIDs(result, "allModels").includes("builtin:zai-start-plan/glm-5.2"), false)
    assert.equal(modelIDs(result, "allModels").includes("custom-disabled/disabled-vision"), false)
    assert.equal(modelIDs(result, "allModels").includes("custom-local/local-image-output"), false)
  })
})

test("catalog enriches configured builtin provider models", async () => {
  await withFixture({}, async (fx) => {
    const result = await runZcode(fx, ["--all"])
    const enriched = result.json.allModels.find(
      (model) => model.model === "builtin:zai-start-plan/glm-4.6v",
    )
    assert.equal(enriched.name, "GLM-4.6V")
    assert.equal(enriched.contextLimit, 128_000)
    assert.equal(enriched.maxOutputTokens, 8192)
    assert.equal(enriched.reasoning, true)
    assert.deepEqual(enriched.inputModalities, ["text", "image"])
  })
})

test("saving a model persists and marks the saved choice", async () => {
  await withFixture({}, async (fx) => {
    const save = await runZcode(fx, ["--model", "custom-local/local-vision-2"])
    assert.equal(save.code, 0)
    assert.equal(save.json.saved, true)
    assert.equal(save.json.selectedModel, "custom-local/local-vision-2")
    assert.equal(await readFile(fx.choiceFile, "utf8"), "custom-local/local-vision-2\n")

    const next = await runZcode(fx)
    assert.equal(next.json.selectedModel, "custom-local/local-vision-2")
    assert.equal(next.json.selectionRequired, false)
    const saved = next.json.models.find((model) => model.model === "custom-local/local-vision-2")
    assert.match(saved.pickerDescription, /Saved choice/u)
  })
})

test("unknown saved model fails instead of being invented", async () => {
  await withFixture({}, async (fx) => {
    const result = await runZcode(fx, ["--model", "missing/provider"])
    assert.equal(result.code, 1)
    assert.equal(result.json.ok, false)
    assert.match(result.json.message, /Unknown image model/u)
  })
})

test("picker is capped and folds older versions per provider series", async () => {
  const many = zcodeConfig()
  many.provider["custom-local"].models = {
    "local-vision-1": {
      name: "Local Vision 1",
      modalities: { input: ["text", "image"], output: ["text"] },
      contextWindow: 32_000,
    },
    "local-vision-2": {
      name: "Local Vision 2",
      modalities: { input: ["text", "image"], output: ["text"] },
      contextWindow: 64_000,
    },
    "local-other-1": {
      name: "Local Other 1",
      modalities: { input: ["text", "image"], output: ["text"] },
      contextWindow: 48_000,
    },
    "local-other-2": {
      name: "Local Other 2",
      modalities: { input: ["text", "image"], output: ["text"] },
      contextWindow: 96_000,
    },
    "local-extra-9": {
      name: "Local Extra 9",
      modalities: { input: ["text", "image"], output: ["text"] },
      contextWindow: 16_000,
    },
  }

  await withFixture({ config: many }, async (fx) => {
    const result = await runZcode(fx)
    assert.equal(result.code, 0)
    assert.ok(result.json.models.length <= 6)
    const localModels = result.json.models.filter((model) => model.provider === "custom-local")
    assert.ok(localModels.length <= 2)
    assert.equal(modelIDs(result).includes("custom-local/local-vision-1"), false)
    assert.equal(modelIDs(result).includes("custom-local/local-vision-2"), true)
  })
})
