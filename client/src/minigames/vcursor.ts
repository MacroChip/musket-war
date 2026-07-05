// Virtual cursor for pointer-locked minigames: we stay in pointer lock while
// the QTE runs, so the overlay tracks its own cursor from mouse deltas.

export class VCursor {
  x = 0;
  y = 0;

  constructor(private w: number, private h: number) {
    this.center();
  }

  resize(w: number, h: number): void {
    this.w = w;
    this.h = h;
  }

  center(): void {
    this.x = this.w / 2;
    this.y = this.h / 2;
  }

  move(dx: number, dy: number): void {
    this.x = Math.max(0, Math.min(this.w, this.x + dx));
    this.y = Math.max(0, Math.min(this.h, this.y + dy));
  }

  draw(c: CanvasRenderingContext2D): void {
    c.save();
    c.strokeStyle = '#2b241a';
    c.lineWidth = 2;
    c.beginPath();
    c.moveTo(this.x - 9, this.y);
    c.lineTo(this.x + 9, this.y);
    c.moveTo(this.x, this.y - 9);
    c.lineTo(this.x, this.y + 9);
    c.stroke();
    c.beginPath();
    c.arc(this.x, this.y, 4, 0, Math.PI * 2);
    c.fillStyle = '#c9a53f';
    c.fill();
    c.stroke();
    c.restore();
  }
}
