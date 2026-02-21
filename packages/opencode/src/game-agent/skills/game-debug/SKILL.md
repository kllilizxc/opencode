---
name: game-debug
description: A systematic workflow for debugging game logic issues using the GameState framework.
---

# Game Debugging Workflow (Diagnostics)

Follow this rigorous procedure when a user reports a bug in their game (e.g., "The score won't update," "I can't die," "The level doesn't end").

## 1. Initial Triage
Ask yourself: **Is this a logic bug or a visual bug?**
- **Logic Bug**: "The game state doesn't change when X happens." (Perfect for this skill)
- **Visual Bug**: "The colors are weird," "The sprite is flickering." (Use browser tools/CSS skills instead)

## 2. The Diagnostic Procedure

### Step A: Capture Context
Immediately get the current pulse of the game. Execute this in the game console/environment:
```typescript
const snapshot = GameState.snapshot();
const logs = GameState.getLog();
console.log("DEBUG_DUMP", JSON.stringify({ snapshot, logs }));
```
*Note: If you are the agent, you can just call these methods internally if the environment allows, or ask the user to provide the "Debug Dump".*

### Step B: Trace the "Missing Link"
Compare the **User's Intent** vs. the **Log Reality**.

**Example Scenario**: "The player doesn't take damage when hitting fire."
1. **Search Logs**: Search for the `takeDamage` action in the `logs`.
2. **Analysis**:
   - **Scenario 1: No log entry.** The overlap/collision handler in Phaser isn't firing, or it's not calling the action.
   - **Scenario 2: Log entry exists, but changes are empty.** The action logic is flawed (e.g., `if (invincible) return`).
   - **Scenario 3: Log entry shows correct change, but UI didn't update.** The `$subscribe` listener in the Scene is missing or broken.

### Step C: Formulate a Hypothesis
"I suspect the `onOverlap` handler is never called because the fire sprite doesn't have a physics body."

### Step D: Verify & Fix
1. Inspect the code.
2. Apply the fix.
3. **Verify**: Run the game again and check if the expected action now appears in `GameState.getLog()`.

---

## Common Debugging Patterns

### Pattern 1: The "Zobmied" Action
**Symptom**: You see the action in logs, but the state didn't change as expected.
**Log Look**: `{ action: "heal", changes: [] }`
**Diagnosis**: The action internal logic is likely blocking the mutation (check your `if` statements).

### Pattern 2: The Action Firehose
**Symptom**: Game lags or state is chaotic.
**Log Look**: 60 entries of the same action per second.
**Diagnosis**: The action is being called in the `update()` loop without a guard/timer. Move it to an event handler or add a cooldown.

### Pattern 3: The State Desync
**Symptom**: State is correct in logs, but game object on screen is wrong.
**Diagnosis**: Missing `$subscribe` in the Scene. Ensure the visual object "follows" the store.

## Debugging Checklist for Agents
- [ ] Did I call `GameState.dump()`?
- [ ] Did I identify the specific **Store** and **Action** that should be responsible?
- [ ] Did I verify the **Action** actually appears in the chronological log?
- [ ] If the log is correct, did I check the **UI listener** (`$subscribe`)?
