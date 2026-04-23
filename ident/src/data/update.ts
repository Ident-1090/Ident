import {
  type ReleaseInfo,
  type UpdateSlice,
  type UpdateStatusKind,
  useIdentStore,
  type VersionInfo,
} from "./store";

const UPDATE_URL = "/update.json";
const UPDATE_POLL_INTERVAL_MS = 24 * 60 * 60 * 1000;
const UPDATE_FETCH_TIMEOUT_MS = 5000;

interface UpdateStatusResponse {
  enabled?: boolean;
  status?: string;
  current?: VersionInfo | null;
  latest?: ReleaseInfo | null;
  checkedAt?: string;
  lastSuccessAt?: string;
  error?: string;
}

const VALID_STATUS = new Set<UpdateStatusKind>([
  "current",
  "available",
  "unavailable",
  "disabled",
  "unknown",
]);

export function startUpdateStatusPolling(): () => void {
  let stopped = false;
  let timer: ReturnType<typeof setTimeout> | null = null;
  let controller: AbortController | null = null;

  const scheduleNext = () => {
    if (stopped) return;
    timer = setTimeout(() => void tick(), UPDATE_POLL_INTERVAL_MS);
  };

  const tick = async () => {
    if (stopped) return;
    controller = new AbortController();
    const timeout = setTimeout(
      () => controller?.abort(),
      UPDATE_FETCH_TIMEOUT_MS,
    );
    useIdentStore.getState().setUpdateStatus({ status: "checking" });
    try {
      const res = await fetch(UPDATE_URL, {
        cache: "no-store",
        signal: controller.signal,
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const body = (await res.json()) as UpdateStatusResponse;
      useIdentStore.getState().setUpdateStatus(normalizeUpdateStatus(body));
    } catch (err) {
      if (stopped) return;
      useIdentStore.getState().setUpdateStatus({
        status: "unavailable",
        error: readableUpdateError(err),
      });
    } finally {
      clearTimeout(timeout);
      controller = null;
      scheduleNext();
    }
  };

  void tick();

  return () => {
    stopped = true;
    if (timer) clearTimeout(timer);
    controller?.abort();
  };
}

function normalizeUpdateStatus(
  body: UpdateStatusResponse,
): Partial<UpdateSlice> {
  const status =
    typeof body.status === "string" &&
    VALID_STATUS.has(body.status as UpdateStatusKind)
      ? (body.status as UpdateStatusKind)
      : "unknown";
  return {
    enabled: body.enabled ?? status !== "disabled",
    status,
    current: body.current ?? null,
    latest: body.latest ?? null,
    checkedAt: body.checkedAt ?? null,
    lastSuccessAt: body.lastSuccessAt ?? null,
    error: body.error ?? null,
  };
}

function readableUpdateError(err: unknown): string {
  if (err instanceof DOMException && err.name === "AbortError") {
    return "Update check timed out";
  }
  if (err instanceof Error && err.message) {
    return `Update check failed: ${err.message}`;
  }
  return "Update check failed";
}
