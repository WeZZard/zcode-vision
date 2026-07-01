# ZCode Vision

Script-assisted vision model selection for ZCode sessions.

## What It Does

ZCode Vision ships as a small ZCode plugin package:

- `.zcode-plugin/plugin.json`
- `skills/zcode-vision/SKILL.md`
- `commands/vision-model.md`
- `data/vision-model-hints.json`
- `scripts/zcode-vision-models.mjs`

The script reads enabled ZCode provider models from `~/.zcode/v2/config.json`, enriches them from ZCode's bundled catalog when available, and applies provider-independent hint entries for models whose runtime vision capability is hidden by ZCode config metadata. It persists the selected exact `provider/model` id at `~/.zcode/vision/vision-model-image.txt`.

This plugin does not run an MCP server and does not delegate inference to a second model. After selecting a model, switch the active ZCode model to that exact model and use ZCode's native multimodal runtime.

## Why This Is Separate From OpenCode Vision

OpenCode Vision can use runtime plugin hooks to register dynamic model-specific `vision-*` subagents and rewrite dropped image messages into local file markers.

ZCode's plugin surface is static. The bundled ZCode examples use helper scripts from skills, so this plugin follows the same pattern:

- the skill resolves the script relative to `SKILL.md`;
- the script discovers configured candidate models;
- the hint file recovers known model capabilities that ZCode config does not expose;
- the user or agent switches the active model before asking visual questions.

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

After installing/enabling this plugin in ZCode, run `/vision-model` to pick or re-pick the model. For a visual task, use `$zcode-vision`; the skill will inspect the saved choice or run the script when a choice is needed.

To inspect discovery from a shell:

```bash
npm run models -- --all
```

To persist a model from a shell:

```bash
npm run models -- --model "provider-id/model-id"
```

If discovery returns no models, the configured model ids did not match config/catalog vision metadata or the bundled hints in `data/vision-model-hints.json`.

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
