/** What the centre answers when it refuses this node's credential. */
export type RejectedStatus = 401 | 403;

/**
 * Runs once, whichever of the outbox or the heartbeat hears the rejection first.
 * 401 (node deleted, token revoked or expired): the token is useless, so it is erased.
 * 403 (token of another camera): the token is kept; it is shown only once when issued,
 * and what needs fixing is the camera id.
 */
export function createUnauthorizedHandler(options: {
  stopHeartbeat(): void;
  stopRuntime(): Promise<void>;
  clearToken(): Promise<void>;
  onUnauthorized(status: RejectedStatus): void;
  onCleanupError(operation: 'token' | 'runtime', reason: unknown): void;
}): (status: RejectedStatus) => void {
  let handled = false;
  return (status) => {
    if (handled) return;
    handled = true;
    options.stopHeartbeat();
    const stopping = options.stopRuntime();
    void (async () => {
      if (status === 401) {
        try {
          await options.clearToken();
        } catch (reason) {
          options.onCleanupError('token', reason);
        }
      }
      options.onUnauthorized(status);
      try {
        await stopping;
      } catch (reason) {
        options.onCleanupError('runtime', reason);
      }
    })();
  };
}
