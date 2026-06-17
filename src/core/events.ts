/**
 * Minimal typed event bus used to decouple gameplay systems from the HUD/audio
 * without threading callbacks through every constructor.
 */
export type GameEventMap = {
  'enemy:killed': { remaining: number };
  'enemy:spawned': { remaining: number };
  'player:died': { reason: string };
  'weapon:changed': { kind: string | null; ammo: number };
  'weapon:fired': { kind: string };
  'weapon:empty': {};
  'glass:shattered': {};
  'pickup': { kind: string };
  'hotswitch': {};
  'hitmarker': {};
  'level:complete': {};
  'wave:announce': { index: number; total: number };
  'hint': { text: string; ms?: number };
};

type Handler<T> = (payload: T) => void;

export class EventBus {
  private listeners = new Map<keyof GameEventMap, Set<Handler<any>>>();

  on<K extends keyof GameEventMap>(event: K, handler: Handler<GameEventMap[K]>): () => void {
    let set = this.listeners.get(event);
    if (!set) {
      set = new Set();
      this.listeners.set(event, set);
    }
    set.add(handler);
    return () => set!.delete(handler);
  }

  emit<K extends keyof GameEventMap>(event: K, payload: GameEventMap[K]): void {
    const set = this.listeners.get(event);
    if (!set) return;
    for (const handler of set) handler(payload);
  }

  clear(): void {
    this.listeners.clear();
  }
}
