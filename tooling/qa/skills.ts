export interface QaSkill {
  name: string;
  execute(context: Record<string, unknown>): boolean;
}

export class PingSkill implements QaSkill {
  public name = "ping";

  public execute(_context: Record<string, unknown>): boolean {
    console.log(`[skill] Executing ${this.name}... pong!`);
    return true;
  }
}

export function registerSkills(): QaSkill[] {
  return [new PingSkill()];
}
