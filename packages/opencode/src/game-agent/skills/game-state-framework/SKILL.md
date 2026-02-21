---
name: game-state-framework
description: Enable state-driven development and telemetry using the GameState framework.
---

# GameState Debugging Skill

Use this skill to build robust, debuggable games using the `game-state.ts` Pinia-style framework.

## Core Concepts

The `GameState` framework splits the game into:
1.  **Logical State**: Managed in stores (health, score, game phase). **Always use stores for this.**
2.  **Rendering State**: Managed by the game engine (positions, physics, animations).

## When to use
- Use this by default for any game logic (scoring, health, levels, inventory).
- Use this when the user reports a "logical" bug (e.g. "I can't die", "Score doesn't move").

## Step 1: Initialize the framework
At the start of your project, ensure `game-state.ts` is available in your source directory.

## Step 2: Define your stores
Group related state into stores. Use the `defineGameStore` pattern.

```typescript
import { defineGameStore } from "./game-state";

export const usePlayerStore = defineGameStore("player", {
  state: () => ({
    health: 100,
    score: 0
  }),
  actions: {
    takeDamage(amount: number) {
      this.health = Math.max(0, this.health - amount);
    },
    addScore(pts: number) {
      this.score += pts;
    }
  }
});
```

## Step 3: Integrate with Phaser
In your scenes, instantiate stores and use their actions.

```typescript
class GameScene extends Phaser.Scene {
  private player = usePlayerStore();

  create() {
    // React to state changes
    this.player.$subscribe((mutation) => {
      if (mutation.key === "score") {
        this.scoreText.setText(`Score: ${this.player.score}`);
      }
    });

    // Mutate state in event handlers
    this.physics.add.overlap(player, enemies, () => {
      this.player.takeDamage(10);
    });
  }
}
```

## Step 4: Debugging with Logs
When a bug is reported:
1.  **Call `GameState.dump()`** or `GameState.getLog()` to see what happened.
2.  **Analyze the Action History**: If the user says "score doesn't change", look for `addScore` calls in the log.
3.  **Correlate**: If you see `takeDamage(10)` but `health` stayed at 100 in the `changes` array, check your setter logic.

## Best Practices
- **Keep actions pure**: Actions should perform the mutation and nothing else.
- **Don't put sprites in state**: State should be serializable JSON.
- **Reset on restart**: Call `store.$reset()` when starting a new game or changing scenes if needed.
