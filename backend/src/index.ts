import { createApp } from './app';
import { prepareInfrastructure, registerShutdown, startWorkerWithRecovery } from './bootstrap';
import { config } from './config';
import { log } from './logger';

async function main() {
  await prepareInfrastructure();

  const server = createApp().listen(config.port, () => {
    log(`[api] listening on http://localhost:${config.port}`);
  });

  const closers: Array<() => Promise<unknown>> = [];
  if (config.runWorker) {
    const worker = await startWorkerWithRecovery();
    closers.push(() => worker.close());
  }
  closers.push(() => new Promise((resolve) => server.close(resolve)));
  registerShutdown(closers);
}

main().catch((err) => {
  console.error('Failed to start', err);
  process.exit(1);
});
