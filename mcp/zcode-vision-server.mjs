#!/usr/bin/env node
import { existsSync, readFileSync } from "node:fs"
import { extname } from "node:path"
import {
  readPersistedChoice,
  runDiscovery,
  saveSelectedModel,
  validateSelectedModel,
} from "../scripts/zcode-vision-models.mjs"

const SERVER_NAME = "zcode-vision"
const SERVER_VERSION = "0.1.0"
const DEFAULT_SAMPLING_TIMEOUT_MS = 120_000
const DEFAULT_ELICITATION_TIMEOUT_MS = 240_000

let inputBuffer = ""
let transportMode = "jsonl"
let clientCapabilities = {}
let nextRequestID = 1
const pendingRequests = new Map()

const tools = [
  {
    name: "zcode_vision_models",
    description:
      "Discover enabled ZCode provider models that support image input and text output.",
    inputSchema: {
      type: "object",
      properties: {
        includeAll: {
          type: "boolean",
          description: "Return all discovered models as allModels[].",
        },
        configFile: { type: "string" },
        catalogFile: { type: "string" },
        dataDir: { type: "string" },
      },
      additionalProperties: false,
    },
  },
  {
    name: "zcode_vision_pick_model",
    description:
      "Pick a ZCode vision-capable model. Uses MCP elicitation when the client supports it; otherwise returns a short list for manual selection.",
    inputSchema: {
      type: "object",
      properties: {
        force: {
          type: "boolean",
          description: "Ask again even when a saved choice exists.",
        },
        configFile: { type: "string" },
        catalogFile: { type: "string" },
        dataDir: { type: "string" },
      },
      additionalProperties: false,
    },
  },
  {
    name: "zcode_vision_select_model",
    description: "Persist an exact provider/model choice for later ZCode vision tasks.",
    inputSchema: {
      type: "object",
      required: ["model"],
      properties: {
        model: {
          type: "string",
          description: "Exact provider/model id returned by zcode_vision_models.",
        },
        configFile: { type: "string" },
        catalogFile: { type: "string" },
        dataDir: { type: "string" },
      },
      additionalProperties: false,
    },
  },
  {
    name: "zcode_vision_analyze",
    description:
      "Analyze one or more local image files through the saved ZCode vision model using MCP sampling.",
    inputSchema: {
      type: "object",
      required: ["task", "images"],
      properties: {
        task: {
          type: "string",
          description: "Direct visual task or question to answer.",
        },
        images: {
          type: "array",
          minItems: 1,
          items: {
            type: "object",
            required: ["path"],
            properties: {
              id: {
                type: "string",
                description: "Stable image id such as current, before, after, or reference.",
              },
              path: { type: "string" },
              reason: {
                type: "string",
                description: "Why this image is included.",
              },
            },
            additionalProperties: false,
          },
        },
        responseTemplate: {
          description:
            "Optional JSON-compatible response shape the vision model should follow.",
        },
        responseRules: {
          type: "array",
          items: { type: "string" },
        },
        model: {
          type: "string",
          description: "Optional exact provider/model override.",
        },
        maxTokens: {
          type: "number",
          minimum: 1,
          maximum: 32_768,
        },
        temperature: {
          type: "number",
          minimum: 0,
          maximum: 2,
        },
        configFile: { type: "string" },
        catalogFile: { type: "string" },
        dataDir: { type: "string" },
      },
      additionalProperties: false,
    },
  },
]

process.stdin.setEncoding("utf8")
process.stdin.on("data", (chunk) => {
  inputBuffer += chunk
  processInputBuffer().catch((error) => {
    console.error(error instanceof Error ? error.stack ?? error.message : String(error))
  })
})

process.stdin.on("end", () => {
  for (const pending of pendingRequests.values()) {
    clearTimeout(pending.timeout)
    pending.reject(new Error("MCP client closed stdin"))
  }
  pendingRequests.clear()
})

async function processInputBuffer() {
  while (inputBuffer.length > 0) {
    const message = readNextMessage()
    if (!message) return
    await handleMessage(message)
  }
}

function readNextMessage() {
  if (transportMode === "headers" || /^Content-Length:/iu.test(inputBuffer)) {
    transportMode = "headers"
    const headerEnd = inputBuffer.indexOf("\r\n\r\n")
    if (headerEnd < 0) return undefined
    const headers = inputBuffer.slice(0, headerEnd).split("\r\n")
    const lengthHeader = headers.find((line) => /^Content-Length:/iu.test(line))
    const length = Number(lengthHeader?.split(":").slice(1).join(":").trim())
    if (!Number.isFinite(length) || length < 0) {
      throw new Error("Invalid Content-Length header")
    }
    const bodyStart = headerEnd + 4
    const bodyEnd = bodyStart + length
    if (inputBuffer.length < bodyEnd) return undefined
    const body = inputBuffer.slice(bodyStart, bodyEnd)
    inputBuffer = inputBuffer.slice(bodyEnd)
    return JSON.parse(body)
  }

  const newline = inputBuffer.indexOf("\n")
  if (newline < 0) return undefined
  const line = inputBuffer.slice(0, newline).trim()
  inputBuffer = inputBuffer.slice(newline + 1)
  if (!line) return undefined
  return JSON.parse(line)
}

async function handleMessage(message) {
  if (!isRecord(message)) return

  if (!message.method && Object.prototype.hasOwnProperty.call(message, "id")) {
    handleClientResponse(message)
    return
  }

  if (typeof message.method !== "string") return

  if (!Object.prototype.hasOwnProperty.call(message, "id")) {
    await handleNotification(message)
    return
  }

  try {
    const result = await handleRequest(message.method, recordValue(message.params))
    sendMessage({ jsonrpc: "2.0", id: message.id, result })
  } catch (error) {
    sendMessage({
      jsonrpc: "2.0",
      id: message.id,
      error: {
        code: -32_000,
        message: error instanceof Error ? error.message : String(error),
      },
    })
  }
}

function handleClientResponse(message) {
  const id = String(message.id)
  const pending = pendingRequests.get(id)
  if (!pending) return
  pendingRequests.delete(id)
  clearTimeout(pending.timeout)
  if (message.error) {
    const errorMessage = isRecord(message.error)
      ? String(message.error.message ?? "MCP client request failed")
      : "MCP client request failed"
    pending.reject(new Error(errorMessage))
    return
  }
  pending.resolve(message.result)
}

async function handleNotification(message) {
  if (message.method === "notifications/initialized") return
}

async function handleRequest(method, params) {
  switch (method) {
    case "initialize": {
      clientCapabilities = recordValue(params.capabilities)
      return {
        protocolVersion: stringValue(params.protocolVersion) ?? "2024-11-05",
        capabilities: {
          tools: {},
        },
        serverInfo: {
          name: SERVER_NAME,
          version: SERVER_VERSION,
        },
      }
    }
    case "ping":
      return {}
    case "tools/list":
      return { tools }
    case "tools/call":
      return callTool(params)
    default:
      throw new Error(`Unsupported method: ${method}`)
  }
}

async function callTool(params) {
  const name = stringValue(params.name)
  const args = recordValue(params.arguments)
  try {
    switch (name) {
      case "zcode_vision_models":
        return jsonToolResult(discoverPayload(args))
      case "zcode_vision_pick_model":
        return jsonToolResult(await pickModel(args))
      case "zcode_vision_select_model":
        return jsonToolResult(selectModel(args))
      case "zcode_vision_analyze":
        return jsonToolResult(await analyzeImages(args))
      default:
        return jsonToolResult(
          { ok: false, error: "unknown_tool", message: `Unknown tool: ${name}` },
          true,
        )
    }
  } catch (error) {
    return jsonToolResult(
      {
        ok: false,
        error: "tool_error",
        message: error instanceof Error ? error.message : String(error),
      },
      true,
    )
  }
}

function discoverPayload(args) {
  const discovery = runDiscovery(discoveryOptions(args))
  const payload = { ...discovery.payload }
  if (args.includeAll === true) {
    payload.allModels = discovery.allModels.map((entry) => ({
      model: entry.model,
      provider: entry.provider,
      providerName: entry.providerName,
      modelID: entry.modelID,
      name: entry.name,
      supportsImage: entry.supportsImage,
      supportsTextOutput: entry.supportsTextOutput,
      inputModalities: entry.inputModalities,
      outputModalities: entry.outputModalities,
      contextLimit: entry.contextLimit,
      maxOutputTokens: entry.maxOutputTokens,
      reasoning: entry.reasoning,
      status: entry.status,
      pickerLabel: entry.pickerLabel,
      pickerDescription: entry.pickerDescription,
    }))
  }
  return payload
}

async function pickModel(args) {
  const discovery = runDiscovery(discoveryOptions(args))
  if (discovery.payload.persistedChoice && args.force !== true) {
    return {
      ...discovery.payload,
      picked: true,
      interaction: "saved_choice",
    }
  }

  if (discovery.payload.models.length === 0) {
    return {
      ...discovery.payload,
      picked: false,
      interaction: "none_available",
    }
  }

  if (clientSupportsElicitation()) {
    const choice = await elicitModelChoice(discovery)
    if (choice) {
      return {
        ...saveSelectedModel(discoveryOptions(args), choice).payload,
        picked: true,
        interaction: "elicitation",
      }
    }
  }

  return {
    ...discovery.payload,
    picked: false,
    selectionRequired: true,
    interaction: "manual",
    message:
      "Ask the user to choose one model from models[]. Then call zcode_vision_select_model with the exact model id.",
  }
}

function selectModel(args) {
  const model = stringValue(args.model)
  if (!model) throw new Error("model is required")
  return saveSelectedModel(discoveryOptions(args), model).payload
}

async function analyzeImages(args) {
  if (!clientSupportsSampling()) {
    throw new Error(
      "The ZCode MCP client did not advertise sampling support, so this plugin cannot run a vision model from MCP.",
    )
  }

  const task = stringValue(args.task)
  if (!task) throw new Error("task is required")
  const images = arrayValue(args.images).map(normalizeImageInput)
  if (images.length === 0) throw new Error("images must contain at least one image path")

  const options = discoveryOptions(args)
  const discovery = runDiscovery(options)
  const selected = args.model
    ? validateSelectedModel(String(args.model), discovery.allModelsByID)
    : readPersistedChoice(discovery.choiceFile, discovery.allModelsByID)
  if (!selected) {
    throw new Error(
      "No ZCode vision model is selected. Call zcode_vision_pick_model first, then retry.",
    )
  }

  const imageMessages = images.map((image) => imageToSamplingMessage(image))
  const samplingResult = await requestClient(
    "sampling/createMessage",
    {
      messages: [
        {
          role: "user",
          content: {
            type: "text",
            text: buildVisionPrompt({
              task,
              images,
              responseTemplate: args.responseTemplate,
              responseRules: arrayValue(args.responseRules).filter((item) => typeof item === "string"),
            }),
          },
        },
        ...imageMessages,
      ],
      modelPreferences: {
        hints: [
          { name: selected.model },
          { name: selected.modelID },
          { name: selected.name },
        ],
        intelligencePriority: 0.6,
        speedPriority: 0.2,
        costPriority: 0.2,
      },
      systemPrompt:
        "You are a vision-capable inspection worker. Answer only the requested visual task. Cite visual evidence and state uncertainty.",
      maxTokens: numberValue(args.maxTokens, 2048),
      temperature: numberValue(args.temperature, 0),
      metadata: {
        requestedModel: selected.model,
        provider: selected.provider,
        modelID: selected.modelID,
      },
    },
    DEFAULT_SAMPLING_TIMEOUT_MS,
  )

  const text = samplingText(samplingResult)
  return {
    ok: true,
    requestedModel: selected.model,
    actualModel: stringValue(samplingResult?.model) ?? null,
    stopReason: stringValue(samplingResult?.stopReason) ?? null,
    text,
    parsedJson: parseMaybeJson(text),
  }
}

async function elicitModelChoice(discovery) {
  const choices = discovery.payload.models
  try {
    const result = await requestClient(
      "elicitation/create",
      {
        message: "Choose the model ZCode Vision should use for image analysis.",
        requestedSchema: {
          type: "object",
          properties: {
            model: {
              type: "string",
              title: "Vision model",
              description: choices
                .map((choice) => `${choice.model}: ${choice.pickerDescription}`)
                .join("\n"),
              enum: choices.map((choice) => choice.model),
            },
          },
          required: ["model"],
        },
      },
      DEFAULT_ELICITATION_TIMEOUT_MS,
    )

    const action = stringValue(result?.action)
    if (action && action !== "accept") return undefined
    const content = recordValue(result?.content)
    const model = stringValue(content.model)
    if (!model) return undefined
    validateSelectedModel(model, discovery.allModelsByID)
    return model
  } catch {
    return undefined
  }
}

function clientSupportsElicitation() {
  return isRecord(clientCapabilities.elicitation)
}

function clientSupportsSampling() {
  return isRecord(clientCapabilities.sampling)
}

function requestClient(method, params, timeoutMs) {
  const id = `zcode-vision-${nextRequestID++}`
  sendMessage({ jsonrpc: "2.0", id, method, params })
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => {
      pendingRequests.delete(id)
      reject(new Error(`Timed out waiting for MCP client response to ${method}`))
    }, timeoutMs)
    pendingRequests.set(id, { resolve, reject, timeout })
  })
}

function sendMessage(message) {
  const json = JSON.stringify(message)
  if (transportMode === "headers") {
    process.stdout.write(`Content-Length: ${Buffer.byteLength(json, "utf8")}\r\n\r\n${json}`)
    return
  }
  process.stdout.write(`${json}\n`)
}

function jsonToolResult(value, isError = false) {
  return {
    content: [
      {
        type: "text",
        text: JSON.stringify(value, null, 2),
      },
    ],
    isError,
  }
}

function buildVisionPrompt({ task, images, responseTemplate, responseRules }) {
  const lines = [
    "Visual task:",
    task,
    "",
    "Images:",
    ...images.map((image) => {
      const reason = image.reason ? ` - ${image.reason}` : ""
      return `- ${image.id}: ${image.path}${reason}`
    }),
    "",
    "Rules:",
    "- Answer from visible evidence only.",
    "- If the image does not answer the question, say so explicitly.",
    "- Mention uncertainty when relevant.",
  ]
  for (const rule of responseRules) lines.push(`- ${rule}`)
  if (responseTemplate !== undefined) {
    lines.push(
      "",
      "Return a response matching this JSON-compatible template when possible:",
      stableStringify(responseTemplate),
    )
  }
  return lines.join("\n")
}

function imageToSamplingMessage(image) {
  if (!existsSync(image.path)) throw new Error(`Image file not found: ${image.path}`)
  const data = readFileSync(image.path)
  return {
    role: "user",
    content: {
      type: "image",
      data: data.toString("base64"),
      mimeType: image.mimeType ?? mimeTypeForImage(image.path, data),
    },
  }
}

function normalizeImageInput(value, index) {
  const record = recordValue(value)
  const path = stringValue(record.path)
  if (!path) throw new Error(`images[${index}].path is required`)
  return {
    id: stringValue(record.id) ?? `image-${index + 1}`,
    path,
    reason: stringValue(record.reason),
    mimeType: stringValue(record.mimeType),
  }
}

function mimeTypeForImage(path, data) {
  if (data[0] === 0x89 && data[1] === 0x50 && data[2] === 0x4e && data[3] === 0x47) {
    return "image/png"
  }
  if (data[0] === 0xff && data[1] === 0xd8 && data[2] === 0xff) return "image/jpeg"
  if (data.slice(0, 3).toString("ascii") === "GIF") return "image/gif"
  if (
    data.slice(0, 4).toString("ascii") === "RIFF" &&
    data.slice(8, 12).toString("ascii") === "WEBP"
  ) {
    return "image/webp"
  }

  switch (extname(path).toLowerCase()) {
    case ".jpg":
    case ".jpeg":
      return "image/jpeg"
    case ".webp":
      return "image/webp"
    case ".gif":
      return "image/gif"
    case ".bmp":
      return "image/bmp"
    case ".tif":
    case ".tiff":
      return "image/tiff"
    case ".png":
    default:
      return "image/png"
  }
}

function samplingText(result) {
  const content = result?.content
  if (isRecord(content) && content.type === "text") return stringValue(content.text) ?? ""
  if (typeof content === "string") return content
  return JSON.stringify(result)
}

function parseMaybeJson(text) {
  const trimmed = text.trim()
  if (!trimmed) return null
  const unfenced = trimmed
    .replace(/^```(?:json)?\s*/iu, "")
    .replace(/\s*```$/u, "")
    .trim()
  try {
    return JSON.parse(unfenced)
  } catch {
    return null
  }
}

function discoveryOptions(args) {
  return {
    configFile: stringValue(args.configFile),
    catalogFile: stringValue(args.catalogFile),
    dataDir: stringValue(args.dataDir),
  }
}

function stableStringify(value) {
  if (typeof value === "string") return value
  return JSON.stringify(value, null, 2)
}

function isRecord(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value)
}

function recordValue(value) {
  return isRecord(value) ? value : {}
}

function arrayValue(value) {
  return Array.isArray(value) ? value : []
}

function stringValue(value) {
  return typeof value === "string" && value.trim() ? value : undefined
}

function numberValue(value, fallback) {
  return typeof value === "number" && Number.isFinite(value) ? value : fallback
}
