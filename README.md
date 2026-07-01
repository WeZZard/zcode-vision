# ZCode Vision

Give text-only ZCode sessions a clean path to vision-capable models already configured in ZCode.

## What It Does

ZCode Vision ships as a ZCode plugin package:

- `.zcode-plugin/plugin.json`
- `skills/zcode-vision/SKILL.md`
- `commands/vision-model.md`
- `mcp/zcode-vision-server.mjs`
- `scripts/zcode-vision-models.mjs`

It discovers enabled ZCode provider models that support image input and text output, asks you to pick one when needed, persists that exact `provider/model` id, and uses MCP sampling to analyze local image files.

## Why This Is Separate From OpenCode Vision

OpenCode Vision can use OpenCode runtime plugin hooks to register dynamic model-specific `vision-*` subagents and rewrite dropped image messages into local file markers.

ZCode plugins are static bundles of skills, commands, MCP servers, and user config. ZCode Vision therefore uses one static skill plus one MCP server:

- `zcode_vision_models` discovers configured image-capable models.
- `zcode_vision_pick_model` uses MCP elicitation when available, otherwise returns a short model list.
- `zcode_vision_select_model` persists the selected exact model id.
- `zcode_vision_analyze` sends local images to the selected model through MCP sampling.

The detailed design comparison is in [docs/zcode-design.md](docs/zcode-design.md).

## Usage

### Install From ZCode UI

Open **Settings > Plugin Management > Discover**, click **+**, and add this repository path or URL as a plugin marketplace:

```text
/Users/wezzard/Artifacts/Repositories/com.github/WeZZard/zcode-vision
```

or:

```text
https://github.com/WeZZard/zcode-vision
```

The repository includes `marketplace.json`, so ZCode can discover and install the `zcode-vision` plugin from it.

### Use

After installing/enabling this plugin in ZCode, use `$zcode-vision` for visual tasks or run `/vision-model` to pick or re-pick the model.

To inspect discovery from a shell:

```bash
npm run models -- --all
```

If discovery returns no models, enable a ZCode provider/account model that exposes image input and text output.

### Local Development Shortcut

For a project-local checkout without using the marketplace UI, add this to the target project's `zcode.json`:

```json
{
  "plugins": {
    "dirs": [
      "/Users/wezzard/Artifacts/Repositories/com.github/WeZZard/zcode-vision"
    ]
  }
}
```

## Development

```bash
npm test
npm run pack:check
```

## License

MIT - see [LICENSE](./LICENSE).
