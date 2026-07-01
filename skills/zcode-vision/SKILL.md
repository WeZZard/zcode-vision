---
name: zcode-vision
description: >-
  Use when a ZCode session needs to pick a configured model for image,
  screenshot, visual layout, visible state, color, alignment, or comparison
  work. Runs the bundled discovery script and persists the selected exact
  provider/model id.
---

# ZCode Vision

Use this skill only to select or verify the model for visual work. If the active model can already see images, use native multimodal input directly.

## Difference From OpenCode Vision

OpenCode can run a JavaScript plugin hook that mutates config, registers `vision-*` subagents dynamically, transforms dropped user images into files, and injects model-selection hints into the system prompt.

ZCode plugins are static bundles. The bundled ZCode examples use scripts from skills, so this skill uses `scripts/zcode-vision-models.mjs` directly. There is no MCP server and no second-model delegation path.

The script reads `~/.zcode/v2/config.json`, enriches models from ZCode's bundled catalog when available, and applies `data/vision-model-hints.json` for known models whose runtime image capability is missing from config metadata.

## Script Path

Resolve the script from this skill directory before running it:

```bash
ZCODE_VISION_SCRIPT="<absolute path to this skill directory>/../../scripts/zcode-vision-models.mjs"
```

Do not assume the current working directory is the plugin root.

## Workflow

1. Decide whether pixels are needed. Accessibility trees or text tool output are enough for label/state existence checks; screenshots are needed for layout, color, alignment, readability, visual comparison, and visible rendering quality.
2. Run the script:

   ```bash
   node "$ZCODE_VISION_SCRIPT"
   ```

3. If `persistedChoice` exists, use that exact `selectedModel`.
4. If `selectionRequired` is `true`, ask the user to choose one exact `models[].model`, then persist it:

   ```bash
   node "$ZCODE_VISION_SCRIPT" --model "<provider/model>"
   ```

5. If no models are returned, report the script warnings. Do not invent a model.
6. Before a visual task, switch the active ZCode model to the selected exact model id using the model picker or a ZCode model-switch command if available.
7. Ask the visual question through ZCode's native multimodal runtime with the image attachment or local screenshot path.

Use only exact model IDs returned by the script.
