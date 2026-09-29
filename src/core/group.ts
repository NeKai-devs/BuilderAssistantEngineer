import type { ResultPromise } from "execa";
import { dropAllScratch } from "./scratch.js";

const GRACE_MS = 3_000;

export type Supervised = { timedOut: () => boolean; release: () => void };

export function superviseGroup(
  subprocess: ResultPromise,
  limit: number | undefined,
  group: boolean,
): Supervised {
  let timedOut = false;
  const stop = (signal: NodeJS.Signals) => {
    if (group && subprocess.pid) killGroup(subprocess.pid, signal);
  };
  const timer =
    group && limit
      ? setTimeout(() => {
          timedOut = true;
          stop("SIGTERM");
          setTimeout(() => stop("SIGKILL"), GRACE_MS).unref();
        }, limit)
      : undefined;
  subprocess.on("exit", () => stop("SIGKILL"));
  const forward = (signal: NodeJS.Signals) => {
    stop(signal);
    release();
    dropAllScratch();
    process.kill(process.pid, signal);
  };
  const release = () => {
    if (timer) clearTimeout(timer);
    process.off("SIGINT", forward);
    process.off("SIGTERM", forward);
  };
  if (group) {
    process.once("SIGINT", forward);
    process.once("SIGTERM", forward);
  }
  return { timedOut: () => timedOut, release };
}

function killGroup(pid: number, signal: NodeJS.Signals): void {
  try {
    process.kill(-pid, signal);
  } catch {}
}
