/**
 * Minimal typed event bus used to decouple gameplay systems from the HUD,
 * audio and statistics without threading callbacks through every constructor.
 */
export type KillCause = 'bullet' | 'split' | 'returned' | 'collateral' | 'friendly' | 'melee' | 'thrown' | 'ricochet' | 'transfer';

export type GameEventMap = {
  'enemy:killed': { id: number; x: number; y: number; z: number; cause: KillCause; remaining: number };
  'enemy:spawned': { id: number; x: number; y: number; z: number };
  'player:died': { reason: string; x: number; y: number; z: number };
  'weapon:changed': { kind: string | null; ammo: number };
  'weapon:fired': { kind: string };
  'weapon:empty': {};
  'pickup': { kind: string; caught: boolean };
  'hotswitch': {};
  'borrow:begin': {};
  'borrow:end': { debt: number };
  'borrow:repaid': {};
  'bullet:near': { x: number; y: number; z: number };
  'bullet:split': {};
  'bullet:returned': {};
  'hitmarker': {};
  'level:complete': {};
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
}
