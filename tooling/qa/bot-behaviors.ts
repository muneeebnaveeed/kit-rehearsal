export interface BotBehavior {
  execute(): void;
}

export class IdleBehavior implements BotBehavior {
  execute() {
    console.log("[bot] Idling...");
  }
}

export class RandomMoveBehavior implements BotBehavior {
  execute() {
    const x = Math.floor(Math.random() * 100);
    const y = Math.floor(Math.random() * 100);
    console.log(`[bot] Moving to (${x}, ${y})`);
  }
}

export function getBehavior(type: "idle" | "move"): BotBehavior {
  return type === "idle" ? new IdleBehavior() : new RandomMoveBehavior();
}
