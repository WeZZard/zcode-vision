---
description: Pick or re-pick the ZCode vision model.
argument-hint: "[provider/model]"
skills:
  - zcode-vision
---

Use the `zcode-vision` skill.

Resolve `../../scripts/zcode-vision-models.mjs` relative to the skill directory.

If `$ARGUMENTS` is a non-empty exact `provider/model` id, run:

```bash
node "$ZCODE_VISION_SCRIPT" --model "$ARGUMENTS"
```

Otherwise run:

```bash
node "$ZCODE_VISION_SCRIPT"
```

If the output has `selectionRequired: true`, ask the user to choose one exact `models[].model`, then persist it with `--model`.
