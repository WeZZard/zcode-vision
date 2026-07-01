---
name: zcode-vision
description: >-
  Use when a ZCode session is running a text-only model and a task requires
  reading image pixels, screenshots, visual layout, visible state, color,
  alignment, or comparison. Discovers image-capable ZCode provider models,
  asks the user to pick one when needed, then analyzes local image files via
  the zcode-vision MCP server.
---

# ZCode Vision

Use this skill only when the active model cannot see images itself. If the active model is already vision-capable, use native multimodal input instead.

## Difference From OpenCode Vision

OpenCode can run a JavaScript plugin hook that mutates config, registers `vision-*` subagents dynamically, transforms dropped user images into files, and injects model-selection hints into the system prompt.

ZCode plugins are static bundles of skills, commands, and MCP servers. The stable plugin surface does not provide an OpenCode-style runtime config hook or chat-message transform, so this skill uses the `zcode-vision` MCP server:

- `zcode_vision_models` discovers enabled ZCode provider models with image input and text output.
- `zcode_vision_pick_model` uses native MCP elicitation when available, otherwise returns a capped shortlist for the user.
- `zcode_vision_select_model` persists an exact `provider/model` choice.
- `zcode_vision_analyze` sends local image files to the selected model through MCP sampling.

## Workflow

1. Decide whether pixels are needed. Accessibility trees or text tool output are enough for label/state existence checks; screenshots are needed for layout, color, alignment, readability, visual comparison, and visible rendering quality.
2. Gather local image paths. Prefer screenshot tool options that write a file. If the user only attached an image without a path, ask for a path or create a screenshot file with the relevant browser/computer tool; ZCode does not expose OpenCode's dropped-image transform hook here.
3. Assign short IDs such as `current`, `before`, `after`, `reference`, or `detail`.
4. Call `zcode_vision_pick_model` before the first analysis. If it returns `selectionRequired: true`, ask the user to choose one exact `models[].model` and call `zcode_vision_select_model`.
5. Call `zcode_vision_analyze` with:
   - `task`: the exact visual question.
   - `images`: objects containing `id`, `path`, and optional `reason`.
   - `responseTemplate`: a small JSON-compatible shape suited to the task.
   - `responseRules`: concise constraints such as evidence, uncertainty, pass/fail threshold, or comparison rules.
6. Use the returned `parsedJson` when present; otherwise use `text`. If `actualModel` differs from `requestedModel`, mention the actual model when relaying evidence.

Do not invent a model. Use only exact model IDs returned by `zcode_vision_models` or `zcode_vision_pick_model`.
