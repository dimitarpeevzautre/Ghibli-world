/**
 * Touch input: a floating virtual joystick (left half of the screen) for walking, drag-to-look
 * (right half) for turning + camera pitch, and two-finger pinch to zoom. Values are exposed in
 * the same shape the keyboard/mouse path uses, so PlayerController/CameraRig stay device-agnostic.
 */

type Role = 'move' | 'look';

interface TouchInfo {
  id: number;
  role: Role;
  originX: number;
  originY: number;
  lastX: number;
  lastY: number;
}

const JOYSTICK_RADIUS = 60; // px travel for full deflection
const RUN_THRESHOLD = 0.85; // deflection fraction that triggers running

export class TouchControls {
  forward = 0;
  strafe = 0;
  running = false;
  lookActive = false;
  /** True once the user has interacted via touch (used to suppress pointer-lock). */
  usedTouch = false;

  private lookDX = 0;
  private lookDY = 0;
  private zoom = 0;

  private touches = new Map<number, TouchInfo>();
  private pinchDist: number | null = null;

  private base: HTMLDivElement;
  private knob: HTMLDivElement;

  constructor(element: HTMLElement) {
    // Disable browser gestures (scroll, pull-to-refresh, double-tap zoom) over the canvas.
    document.body.style.touchAction = 'none';
    (document.body.style as CSSStyleDeclaration & { overscrollBehavior: string }).overscrollBehavior =
      'none';
    element.style.touchAction = 'none';

    this.injectStyles();
    this.base = document.createElement('div');
    this.base.className = 'touch-joystick-base';
    this.knob = document.createElement('div');
    this.knob.className = 'touch-joystick-knob';
    this.base.appendChild(this.knob);
    document.body.appendChild(this.base);

    window.addEventListener('touchstart', this.onTouchStart, { passive: false });
    window.addEventListener('touchmove', this.onTouchMove, { passive: false });
    window.addEventListener('touchend', this.onTouchEnd, { passive: false });
    window.addEventListener('touchcancel', this.onTouchEnd, { passive: false });
  }

  private onTouchStart = (e: TouchEvent) => {
    let handled = false;
    for (const t of Array.from(e.changedTouches)) {
      // Let touches on the lil-gui panel through untouched.
      if ((t.target as HTMLElement)?.closest?.('.lil-gui')) continue;

      this.usedTouch = true;
      const leftHalf = t.clientX < window.innerWidth * 0.5;
      const hasMove = [...this.touches.values()].some((i) => i.role === 'move');
      const role: Role = leftHalf && !hasMove ? 'move' : 'look';

      this.touches.set(t.identifier, {
        id: t.identifier,
        role,
        originX: t.clientX,
        originY: t.clientY,
        lastX: t.clientX,
        lastY: t.clientY,
      });

      if (role === 'move') this.showJoystick(t.clientX, t.clientY);
      else this.lookActive = true;
      handled = true;
    }
    this.refreshPinch();
    if (handled) e.preventDefault();
  };

  private onTouchMove = (e: TouchEvent) => {
    let handled = false;

    // Pinch-zoom takes over when two 'look' touches are present.
    const lookTouches = [...this.touches.values()].filter((i) => i.role === 'look');
    if (lookTouches.length >= 2) {
      for (const t of Array.from(e.changedTouches)) {
        const info = this.touches.get(t.identifier);
        if (info) {
          info.lastX = t.clientX;
          info.lastY = t.clientY;
          handled = true;
        }
      }
      const [a, b] = lookTouches;
      const dist = Math.hypot(a.lastX - b.lastX, a.lastY - b.lastY);
      if (this.pinchDist !== null) this.zoom += (this.pinchDist - dist) * 4;
      this.pinchDist = dist;
      if (handled) e.preventDefault();
      return;
    }

    for (const t of Array.from(e.changedTouches)) {
      const info = this.touches.get(t.identifier);
      if (!info) continue;
      handled = true;

      if (info.role === 'move') {
        let dx = t.clientX - info.originX;
        let dy = t.clientY - info.originY;
        const mag = Math.hypot(dx, dy);
        const clamped = Math.min(mag, JOYSTICK_RADIUS);
        if (mag > 0) {
          dx = (dx / mag) * clamped;
          dy = (dy / mag) * clamped;
        }
        this.strafe = dx / JOYSTICK_RADIUS;
        this.forward = -dy / JOYSTICK_RADIUS;
        this.running = clamped / JOYSTICK_RADIUS > RUN_THRESHOLD;
        this.moveKnob(dx, dy);
      } else {
        this.lookDX += t.clientX - info.lastX;
        this.lookDY += t.clientY - info.lastY;
        info.lastX = t.clientX;
        info.lastY = t.clientY;
        this.lookActive = true;
      }
    }
    if (handled) e.preventDefault();
  };

  private onTouchEnd = (e: TouchEvent) => {
    for (const t of Array.from(e.changedTouches)) {
      const info = this.touches.get(t.identifier);
      if (!info) continue;
      this.touches.delete(t.identifier);
      if (info.role === 'move') {
        this.forward = 0;
        this.strafe = 0;
        this.running = false;
        this.hideJoystick();
      }
    }
    const lookLeft = [...this.touches.values()].some((i) => i.role === 'look');
    if (!lookLeft) this.lookActive = false;
    this.refreshPinch();
  };

  private refreshPinch(): void {
    const lookCount = [...this.touches.values()].filter((i) => i.role === 'look').length;
    if (lookCount < 2) this.pinchDist = null;
  }

  // --- consumable deltas (mirror the mouse/wheel API) ---
  consumeLook(): { x: number; y: number } {
    const d = { x: this.lookDX, y: this.lookDY };
    this.lookDX = 0;
    this.lookDY = 0;
    return d;
  }
  consumeZoom(): number {
    const z = this.zoom;
    this.zoom = 0;
    return z;
  }

  // --- joystick UI ---
  private showJoystick(x: number, y: number): void {
    this.base.style.left = `${x}px`;
    this.base.style.top = `${y}px`;
    this.base.style.display = 'block';
    this.moveKnob(0, 0);
  }
  private hideJoystick(): void {
    this.base.style.display = 'none';
  }
  private moveKnob(dx: number, dy: number): void {
    this.knob.style.transform = `translate(calc(-50% + ${dx}px), calc(-50% + ${dy}px))`;
  }

  private injectStyles(): void {
    const css = `
      .touch-joystick-base {
        position: fixed; display: none; width: ${JOYSTICK_RADIUS * 2}px;
        height: ${JOYSTICK_RADIUS * 2}px; margin-left: -${JOYSTICK_RADIUS}px;
        margin-top: -${JOYSTICK_RADIUS}px; border-radius: 50%;
        background: rgba(244, 236, 216, 0.12); border: 2px solid rgba(244, 236, 216, 0.35);
        pointer-events: none; z-index: 20; backdrop-filter: blur(1px);
      }
      .touch-joystick-knob {
        position: absolute; left: 50%; top: 50%; width: 54px; height: 54px;
        border-radius: 50%; background: rgba(244, 236, 216, 0.55);
        border: 2px solid rgba(120, 84, 54, 0.6); transform: translate(-50%, -50%);
      }`;
    const style = document.createElement('style');
    style.textContent = css;
    document.head.appendChild(style);
  }
}
