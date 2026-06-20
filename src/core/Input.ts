/**
 * Keyboard + pointer-lock mouse input, abstracted behind a small intent API so the
 * controller never touches raw DOM events (and so touch can be bolted on later).
 */
export class Input {
  private keys = new Set<string>();
  /** Accumulated mouse delta since the last `consumeMouseDelta()`. */
  private mouseDX = 0;
  private mouseDY = 0;
  private wheelDelta = 0;
  private locked = false;

  constructor(private readonly element: HTMLElement) {
    window.addEventListener('keydown', this.onKeyDown);
    window.addEventListener('keyup', this.onKeyUp);
    window.addEventListener('blur', this.onBlur);

    element.addEventListener('click', this.requestLock);
    document.addEventListener('pointerlockchange', this.onPointerLockChange);
    document.addEventListener('mousemove', this.onMouseMove);
    window.addEventListener('wheel', this.onWheel, { passive: true });
  }

  private onKeyDown = (e: KeyboardEvent) => {
    this.keys.add(e.code);
  };
  private onKeyUp = (e: KeyboardEvent) => {
    this.keys.delete(e.code);
  };
  private onBlur = () => {
    this.keys.clear();
  };

  private requestLock = () => {
    if (!this.locked) this.element.requestPointerLock();
  };
  private onPointerLockChange = () => {
    this.locked = document.pointerLockElement === this.element;
  };
  private onMouseMove = (e: MouseEvent) => {
    if (!this.locked) return;
    this.mouseDX += e.movementX;
    this.mouseDY += e.movementY;
  };
  private onWheel = (e: WheelEvent) => {
    this.wheelDelta += e.deltaY;
  };

  /** Movement axes in [-1, 1]. */
  get forward(): number {
    return (this.has('KeyW', 'ArrowUp') ? 1 : 0) - (this.has('KeyS', 'ArrowDown') ? 1 : 0);
  }
  get strafe(): number {
    return (this.has('KeyD', 'ArrowRight') ? 1 : 0) - (this.has('KeyA', 'ArrowLeft') ? 1 : 0);
  }
  get running(): boolean {
    return this.has('ShiftLeft', 'ShiftRight');
  }
  get isLocked(): boolean {
    return this.locked;
  }

  private has(...codes: string[]): boolean {
    return codes.some((c) => this.keys.has(c));
  }

  /** Returns and clears the accumulated mouse delta. */
  consumeMouseDelta(): { x: number; y: number } {
    const d = { x: this.mouseDX, y: this.mouseDY };
    this.mouseDX = 0;
    this.mouseDY = 0;
    return d;
  }

  /** Returns and clears the accumulated wheel delta. */
  consumeWheel(): number {
    const d = this.wheelDelta;
    this.wheelDelta = 0;
    return d;
  }
}
