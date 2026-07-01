# ZCode Vision Design

## Mechanism Differences

| Concern | OpenCode Vision | ZCode Vision |
| --- | --- | --- |
| Plugin execution | Runtime TypeScript plugin loaded through `@opencode-ai/plugin`. | Static plugin package with `skills`, `commands`, `mcpServers`, and `userConfig`. |
| Model registry | Reads OpenCode config, auth, environment, and cached `models.dev` catalog. | Reads ZCode provider registry from `~/.zcode/v2/config.json` and enriches configured models from ZCode's bundled model catalog. |
| Vision model provider | Dynamically registers one `vision-*` subagent per discovered image-capable OpenCode model. | Uses one MCP server and stores a selected `provider/model`; no dynamic subagent generation is required. |
| User images | OpenCode chat transform materializes dropped image parts into local files and rewrites them as text markers. | ZCode plugin surface does not provide an equivalent chat transform, so the skill works with local file paths from screenshot tools or user-provided paths. |
| Picker | Skill asks the user from a script-produced shortlist, then persists `~/.config/opencode/vision-model-image.txt`. | MCP tool uses native elicitation when available, otherwise returns the same capped shortlist for conversational selection; persists under the plugin data dir. |
| Inference path | Main model delegates to a model-specific subagent. | MCP server calls `sampling/createMessage` with model preference hints and local image content. |

## Discovery

`scripts/zcode-vision-models.mjs` treats configured ZCode provider models as authoritative. The app catalog is used only to enrich configured models with names, modalities, context limits, and reasoning metadata. Catalog-only models are not presented, because they may not be enabled for the user's account or provider.

The picker keeps only active models with image input and text output, folds older versions within each provider/model series, ranks capable reasoning and larger-context models first, limits to two per provider, and caps the interaction at six options.

## Interaction

The elegant ZCode interaction is a static skill plus MCP server:

1. `zcode_vision_pick_model` returns a saved choice when one exists.
2. If no saved choice exists and the client supports MCP elicitation, the MCP server opens a native model-choice form and persists the accepted answer.
3. If elicitation is unavailable, the tool returns `models[]`; the agent asks the user to choose one exact id and persists it through `zcode_vision_select_model`.
4. `zcode_vision_analyze` sends the visual task, image files, and response template to the selected model through MCP sampling.

This keeps ZCode installation simple, avoids generating plugin files at runtime, and makes the selected/requested model visible in every analysis result.

## References

- ZCode plugin docs: https://zcode.z.ai/en/docs/plugin
- ZCode skill docs: https://zcode.z.ai/en/docs/skill
- ZCode subagent docs: https://zcode.z.ai/en/docs/subagents
- ZCode MCP docs: https://zcode.z.ai/en/docs/mcp-services
- ZCode model configuration docs: https://zcode.z.ai/en/docs/configuration
- Local ZCode plugin examples: `/Applications/ZCode.app/Contents/Resources/glm/packages`
