---
name: generate-icons
description: Generate a set of game icons (items, abilities, UI elements) in a consistent art style using the generate_spritesheet tool. Load this skill when asked to create icons, item sprites, or UI element sets.
---

# Generate Icons Skill

## Overview
This skill guides the AI in generating sets of visually consistent game icons (items, abilities, UI elements, etc.) using the `generate_spritesheet` tool. Each icon set is produced as a single spritesheet PNG, with individual icons arranged in a grid.

## 1. Generating an Icon Set

Use `generate_spritesheet` with a grid that matches the number of icons needed.

### Grid Selection
| Icons Needed | Grid  | Notes                            |
|-------------|-------|----------------------------------|
| 1           | 1x1   | Single icon                      |
| 4           | 2x2   | Standard small set               |
| 9           | 3x3   | Square grid, great for 9 items   |
| 16          | 4x4   | Large set                        |

### Prompt Guidelines
- **List every icon explicitly** in the prompt so the model knows exactly what to put in each cell.
- **Specify the art style** (e.g., "pixel-art", "hand-painted fantasy", "flat minimalist").
- **Describe shared traits** like outline thickness, color palette, or perspective.
- No need to mention background — it's always transparent.

### Example: First Icon Set
```json
{
  "filename": "potions",
  "prompt": "4 pixel-art RPG potion icons: red health potion, blue mana potion, green poison flask, yellow speed elixir. Each icon should have a consistent bottle shape with a cork and a glowing liquid effect.",
  "grid": "2x2"
}
```

## 2. Generating Additional Icons in the Same Style

To create more icons that match an existing set, pass the previous spritesheet as `referenceSpritesheet`. This ensures the model replicates the exact same art style, proportions, and color treatment.

### Example: Follow-Up Set
```json
{
  "filename": "potions_2",
  "prompt": "4 pixel-art RPG potion icons: purple confusion potion, orange fire resistance potion, white invisibility potion, black death poison. Same bottle shape and art style as the reference.",
  "grid": "2x2",
  "referenceSpritesheet": "assets/generated/potions-1024x1024-2x2.png"
}
```

### Key Rule
> Always use `referenceSpritesheet` when generating a follow-up icon set. This is the **only** reliable way to maintain visual consistency across multiple sets.

## 3. Using Icons in a Phaser Game

### Loading the Spritesheet
```typescript
// In preload(): parse dimensions from the filename
// e.g., "potions-1024x1024-2x2.png" → 1024/2 = 512px per frame
this.load.spritesheet('potions', 'assets/generated/potions-1024x1024-2x2.png', {
    frameWidth: 512,
    frameHeight: 512
});
```

### Accessing Individual Icons by Frame Index
Icons are indexed left-to-right, top-to-bottom starting at 0:
```
Grid 2x2:
┌───┬───┐
│ 0 │ 1 │
├───┼───┤
│ 2 │ 3 │
└───┴───┘
```

```typescript
// Create a sprite for icon at frame index 1 (blue mana potion)
const manaIcon = this.add.sprite(x, y, 'potions', 1);
manaIcon.setScale(0.25); // Scale down from 512px to ~128px
```

### Extracting Individual Icon Textures
If you need separate textures for each icon (e.g., for UI elements):
```typescript
// After loading the spritesheet, create standalone textures per frame
const frames = this.textures.get('potions').getFrameNames();
// Or access frames by index:
const healthPotion = this.add.image(x, y, 'potions', 0);
const manaPotion = this.add.image(x, y, 'potions', 1);
```

## 4. Best Practices

1. **Be explicit about icon count and content.** Always list every icon in the prompt. Vague prompts like "some potions" produce inconsistent results.
2. **Keep grid size tight.** Don't use a 4x4 grid for 3 icons — use 2x2 instead. Empty cells waste generation quality.
3. **Use descriptive filenames.** Name files by category: `weapons`, `armor_set`, `skill_icons_fire`, etc.
4. **Reference previous sets.** When the user says "make more like these", always use `referenceSpritesheet` with the path of the previous output.
5. **Consistent scale.** All generated spritesheets are 1024×1024. Individual icon size = 1024 / grid_cols × 1024 / grid_rows.
