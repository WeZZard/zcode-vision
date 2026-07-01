---
description: Pick or re-pick the ZCode vision model.
argument-hint: "[provider/model]"
skills:
  - zcode-vision
---

Use the `zcode-vision` skill.

If `$ARGUMENTS` is a non-empty exact `provider/model` id, call `zcode_vision_select_model` with that model.

Otherwise call `zcode_vision_pick_model` with `force: true`. If native selection is unavailable and the tool returns `selectionRequired: true`, ask the user to choose one exact `models[].model`, then call `zcode_vision_select_model`.
