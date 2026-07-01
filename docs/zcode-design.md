# ZCode Vision Design

## Mechanism Differences

| Concern | OpenCode Vision | ZCode Vision |
| --- | --- | --- |
| Plugin execution | Runtime TypeScript plugin loaded through `@opencode-ai/plugin`. | Static plugin package with `skills`, `commands`, and a helper script. |
| Model registry | Reads OpenCode config, auth, environment, and cached `models.dev` catalog. | Reads ZCode provider registry from `~/.zcode/v2/config.json`, enriches from ZCode's bundled model catalog, then applies bundled hint entries. |
| Vision model provider | Dynamically registers one `vision-*` subagent per discovered image-capable OpenCode model. | Stores a selected configured `provider/model`; no dynamic subagent or MCP server is used. |
| User images | OpenCode chat transform materializes dropped image parts into local files and rewrites them as text markers. | ZCode runtime handles images for the active model. The skill only helps choose which configured model to use. |
| Picker | Skill asks the user from a script-produced shortlist, then persists `~/.config/opencode/vision-model-image.txt`. | Skill runs `scripts/zcode-vision-models.mjs`, asks the user when needed, then persists `~/.zcode/vision/vision-model-image.txt`. |
| Inference path | Main model delegates to a model-specific subagent. | User or agent switches the active ZCode model; ZCode's native multimodal runtime does the inference. |

## Discovery

`scripts/zcode-vision-models.mjs` treats configured ZCode provider models as the only candidates. Catalog-only models are not presented, because they may not be enabled for the user's account or provider.

The config and catalog modality fields are not sufficient for some Ollama Cloud and OpenCode-plan models: ZCode may mark them as text-only even when the runtime accepts images. To handle that without asking users to edit hidden config fields, `data/vision-model-hints.json` provides provider-independent matches by model id/name. Provider ids may change; model names are expected to stay stable.

The picker keeps active configured models with image input and text output, whether that capability came from config/catalog metadata or from a hint. It folds older versions within each provider/model series, ranks capable reasoning and larger-context models first, limits to three per provider, and caps the interaction at six options.

## Interaction

The ZCode interaction is a static skill plus script:

1. The skill resolves `../../scripts/zcode-vision-models.mjs` relative to its own `SKILL.md`.
2. The script returns a saved choice when one exists.
3. If no saved choice exists, the script returns `models[]`; the agent asks the user to choose one exact id.
4. The skill persists the selected exact id with `node <script> --model "<provider/model>"`.
5. For visual work, the active ZCode model must be switched to the selected id before asking the image question.

This keeps the plugin installable as a plain ZCode plugin, avoids an MCP server for a simple discovery/persistence task, and makes the selected model visible in script output.

## References

- ZCode plugin docs: https://zcode.z.ai/en/docs/plugin
- ZCode skill docs: https://zcode.z.ai/en/docs/skill
- ZCode subagent docs: https://zcode.z.ai/en/docs/subagents
- ZCode model configuration docs: https://zcode.z.ai/en/docs/configuration
- Local ZCode plugin examples: `/Applications/ZCode.app/Contents/Resources/glm/packages`
