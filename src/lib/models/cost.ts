export class CostMeter {
  private sum = 0;
  add(n: number): void {
    if (Number.isFinite(n) && n > 0) this.sum += n;
  }
  total(): number {
    return this.sum;
  }
}
