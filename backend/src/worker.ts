// Standalone worker process. Run several of these to scale sending horizontally;
// the Redis-backed limiter and hourly counters are shared between all of them.
import { prepareInfrastructure, registerShutdown, startWorkerWithRecovery } from './bootstrap';

async function main() {
  await prepareInfrastructure();
  const worker = await startWorkerWithRecovery();
  registerShutdown([() => worker.close()]);
}

main().catch((err) => {
  console.error('Worker failed to start', err);
  process.exit(1);
});
