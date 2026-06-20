import { TouchControls } from './TouchControls';

/**
 * Keyboard + pointer-lock mouse + touch input, abstracted behind a small intent API so the
 * controller never touches raw DOM events. Touch (virtual joystick / drag-look / pinch-zoom)
 * is folded into the same `forward`/`strafe`/look-delta/wheel surface as keyboard + mouse.
 */
export class Input {
  private keys = new Set<string>();
  /** Accumulated mouse delta since the last `consumeMouseDelta()`. */
  private mouseDX = 0;
  private mouseDY = 0;
  private wheelDelta = 0;
  private locked = false;
  private touch: TouchControls;

  constructor(private readonly element: HTMLElement) {
    window.addEventListener('keydown', this.onKeyDown);
    window.addEventListener('keyup', this.onKeyUp);
    window.addEventListener('blur', this.onBlur);

    element.addEventListener('click', this.requestLock);
    document.addEventListener('pointerlockchange', this.onPointerLockChange);
    document.addEventListener('mousemove', this.onMouseMove);
    window.addEventListener('wheel', this.onWheel, { passive: true });

    this.touch = new TouchControls(element);
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
    // Don't grab the pointer on touch devices — that path uses the on-screen controls.
    if (this.touch.usedTouch) return;
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

  /** Movement axes in [-1, 1] (keyboard digital + touch analog, summed and clamped). */
  get forward(): number {
    const kb = (this.has('KeyW', 'ArrowUp') ? 1 : 0) - (this.has('KeyS', 'ArrowDown') ? 1 : 0);
    return clamp(kb + this.touch.forward, -1, 1);
  }
  get strafe(): number {
    const kb = (this.has('KeyD', 'ArrowRight') ? 1 : 0) - (this.has('KeyA', 'ArrowLeft') ? 1 : 0);
    return clamp(kb + this.touch.strafe, -1, 1);
  }
  get running(): boolean {
    return this.has('ShiftLeft', 'ShiftRight') || this.touch.running;
  }
  get isLocked(): boolean {
    return this.locked;
  }
  /** Whether look input should be applied (pointer locked on desktop, or a touch-drag active). */
  get lookActive(): boolean {
    return this.locked || this.touch.lookActive;
  }

  private has(...codes: string[]): boolean {
    return codes.some((c) => this.keys.has(c));
  }

  /** Returns and clears the accumulated look delta (mouse + touch). */
  consumeMouseDelta(): { x: number; y: number } {
    const t = this.touch.consumeLook();
    const d = { x: this.mouseDX + t.x, y: this.mouseDY + t.y };
    this.mouseDX = 0;
    this.mouseDY = 0;
    return d;
  }

  /** Returns and clears the accumulated wheel/zoom delta (mouse wheel + pinch). */
  consumeWheel(): number {
    const d = this.wheelDelta + this.touch.consumeZoom();
    this.wheelDelta = 0;
    return d;
  }
}

function clamp(v: number, min: number, max: number): number {
  return v < min ? min : v > max ? max : v;
}
