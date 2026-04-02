import { Disposable } from './disposable';

export type Event<T> = (listener: (event: T) => unknown, thisArgs?: unknown, disposables?: Disposable[]) => Disposable;

export class Emitter<T> {
  private readonly listeners = new Set<(event: T) => unknown>();

  readonly event: Event<T> = (listener, thisArgs, disposables) => {
    const wrapped = (event: T): void => {
      if (thisArgs) {
        listener.call(thisArgs, event);
        return;
      }
      listener(event);
    };

    this.listeners.add(wrapped);
    const disposable: Disposable = {
      dispose: () => {
        this.listeners.delete(wrapped);
      }
    };

    if (disposables) {
      disposables.push(disposable);
    }

    return disposable;
  };

  fire(event: T): void {
    for (const listener of this.listeners) {
      listener(event);
    }
  }

  dispose(): void {
    this.listeners.clear();
  }
}
