export function createUnauthorizedHandler(options: {
  stopHeartbeat(): void;
  stopRuntime(): Promise<void>;
  clearToken(): Promise<void>;
  onUnauthorized(): void;
  onCleanupError(operation: 'token' | 'runtime', reason: unknown): void;
}): () => void {
  let handled = false;
  return () => {
    if (handled) return;
    handled = true;
    options.stopHeartbeat();
    const stopping = options.stopRuntime();
    void (async () => {
      try {
        await options.clearToken();
      } catch (reason) {
        options.onCleanupError('token', reason);
      }
      options.onUnauthorized();
      try {
        await stopping;
      } catch (reason) {
        options.onCleanupError('runtime', reason);
      }
    })();
  };
}
