/** pdf.js needs Promise.withResolvers (Chrome 119+, Safari 17.4+, Node 22+). */
export function installPolyfills(): void {
  const P = Promise as unknown as { withResolvers?: unknown };
  if (typeof P.withResolvers !== "function") {
    P.withResolvers = function withResolvers<T>() {
      let resolve!: (v: T | PromiseLike<T>) => void;
      let reject!: (e?: unknown) => void;
      const promise = new Promise<T>((a, b) => {
        resolve = a;
        reject = b;
      });
      return { promise, resolve, reject };
    };
  }
}
