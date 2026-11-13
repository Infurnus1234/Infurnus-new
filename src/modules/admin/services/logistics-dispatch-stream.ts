import type { Pool, PoolClient } from 'pg';

export function logisticsDispatchStream(pool: Pool) {
  const subscribers = new Set<() => void>();
  let client: PoolClient | undefined;
  let connecting = false;
  let retry: ReturnType<typeof setTimeout> | undefined;
  const publish = () => {
    for (const subscriber of subscribers) subscriber();
  };

  async function listen() {
    if (client || connecting || !subscribers.size) return;
    connecting = true;
    let acquired: PoolClient | undefined;
    try {
      acquired = await pool.connect();
      await acquired.query('LISTEN logistics_dispatch_changed');
      if (!subscribers.size) {
        acquired.release(true);
        return;
      }
      client = acquired;
      acquired.on('notification', publish);
      acquired.once('error', () => {
        if (client !== acquired) return;
        client = undefined;
        acquired?.removeListener('notification', publish);
        acquired?.release(true);
        scheduleRetry();
      });
      publish();
    } catch {
      acquired?.release(true);
      scheduleRetry();
    } finally {
      connecting = false;
    }
  }

  function scheduleRetry() {
    if (!subscribers.size || retry) return;
    retry = setTimeout(() => {
      retry = undefined;
      void listen();
    }, 3000);
    retry.unref();
  }

  return (subscriber: () => void) => {
    subscribers.add(subscriber);
    void listen();
    return () => {
      subscribers.delete(subscriber);
      if (subscribers.size) return;
      clearTimeout(retry);
      retry = undefined;
      client?.removeListener('notification', publish);
      client?.release(true);
      client = undefined;
    };
  };
}
