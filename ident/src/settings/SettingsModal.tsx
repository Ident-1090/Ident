import { ExternalLink, X } from "lucide-react";
import type { ReactNode } from "react";
import { useEffect, useState } from "react";
import { type UpdateSlice, useIdentStore } from "../data/store";
import type { ClockMode, UnitMode } from "../data/types";

const TRAIL_FADE_OPTIONS = [
  { value: 10, label: "10 s" },
  { value: 60, label: "60 s" },
  { value: 180, label: "180 s" },
  { value: 600, label: "600 s" },
] as const;

export function SettingsModal({ onClose }: { onClose: () => void }) {
  const settings = useIdentStore((s) => s.settings);
  const update = useIdentStore((s) => s.update);
  const setSettings = useIdentStore((s) => s.setSettings);

  const [form, setForm] = useState(() => settings);

  useEffect(() => {
    setForm(settings);
  }, [settings]);

  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape") {
        e.preventDefault();
        onClose();
      }
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [onClose]);

  function save() {
    setSettings(form);
    onClose();
  }

  return (
    <>
      <button
        type="button"
        aria-label="Close settings"
        className="fixed inset-0 z-90 cursor-default backdrop-blur-[2px]"
        style={{
          backgroundColor: "rgb(from var(--color-ink) r g b / 0.36)",
        }}
        onClick={onClose}
      />
      <div
        role="dialog"
        aria-modal="true"
        aria-label="Settings"
        className="fixed left-1/2 top-1/2 z-100 flex max-h-[calc(100dvh-32px)] w-[min(680px,calc(100vw-24px))] -translate-x-1/2 -translate-y-1/2 flex-col overflow-hidden rounded-[7px] border border-(--color-line-strong) bg-paper text-(--color-ink) shadow-2xl"
      >
        <div className="flex items-center justify-between border-b border-(--color-line) bg-paper px-4 py-3.5">
          <div className="min-w-0">
            <div className="text-[17px] font-semibold leading-tight">
              Settings
            </div>
            <div className="mt-0.5 font-mono text-[10px] uppercase tracking-[0.12em] text-ink-faint">
              Units and trails
            </div>
          </div>
          <button
            type="button"
            aria-label="Close settings"
            onClick={onClose}
            className="grid h-8 w-8 shrink-0 place-items-center rounded-sm border border-transparent bg-transparent text-ink-soft hover:border-(--color-line) hover:bg-paper-2 hover:text-(--color-ink)"
          >
            <X size={15} strokeWidth={1.9} aria-hidden="true" />
          </button>
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto px-4 py-4 sm:px-5">
          <SettingsSection title="Units">
            <ControlRow label="Preset">
              <ChoiceGroup<UnitMode>
                value={form.unitMode}
                onChange={(unitMode) =>
                  setForm((prev) => ({ ...prev, unitMode }))
                }
                minColumnWidth={98}
                options={[
                  { value: "aviation", label: "Aviation" },
                  { value: "metric", label: "Metric" },
                  { value: "imperial", label: "Imperial" },
                  { value: "custom", label: "Custom" },
                ]}
              />
            </ControlRow>

            {form.unitMode === "custom" && (
              <div className="mt-3 grid gap-3 border-t border-(--color-line-soft) pt-3 sm:grid-cols-2">
                <ControlStack label="Altitude">
                  <ChoiceGroup<"m" | "ft">
                    value={form.unitOverrides.altitude}
                    onChange={(altitude) =>
                      setForm((prev) => ({
                        ...prev,
                        unitOverrides: { ...prev.unitOverrides, altitude },
                      }))
                    }
                    options={[
                      { value: "m", label: "Meters" },
                      { value: "ft", label: "Feet" },
                    ]}
                  />
                </ControlStack>
                <ControlStack label="Air speed">
                  <ChoiceGroup<"km/h" | "mph" | "kt">
                    value={form.unitOverrides.horizontalSpeed}
                    onChange={(horizontalSpeed) =>
                      setForm((prev) => ({
                        ...prev,
                        unitOverrides: {
                          ...prev.unitOverrides,
                          horizontalSpeed,
                        },
                      }))
                    }
                    options={[
                      { value: "km/h", label: "km/h" },
                      { value: "mph", label: "mph" },
                      { value: "kt", label: "kt" },
                    ]}
                  />
                </ControlStack>
                <ControlStack label="Distance">
                  <ChoiceGroup<"km" | "mi" | "nm">
                    value={form.unitOverrides.distance}
                    onChange={(distance) =>
                      setForm((prev) => ({
                        ...prev,
                        unitOverrides: { ...prev.unitOverrides, distance },
                      }))
                    }
                    options={[
                      { value: "km", label: "km" },
                      { value: "mi", label: "mi" },
                      { value: "nm", label: "nm" },
                    ]}
                  />
                </ControlStack>
                <ControlStack label="Vertical speed">
                  <ChoiceGroup<"m/s" | "ft/min" | "fpm">
                    value={form.unitOverrides.verticalSpeed}
                    onChange={(verticalSpeed) =>
                      setForm((prev) => ({
                        ...prev,
                        unitOverrides: {
                          ...prev.unitOverrides,
                          verticalSpeed,
                        },
                      }))
                    }
                    options={[
                      { value: "m/s", label: "m/s" },
                      { value: "ft/min", label: "ft/min" },
                      { value: "fpm", label: "fpm" },
                    ]}
                  />
                </ControlStack>
                <ControlStack label="Temperature">
                  <ChoiceGroup<"C" | "F">
                    value={form.unitOverrides.temperature}
                    onChange={(temperature) =>
                      setForm((prev) => ({
                        ...prev,
                        unitOverrides: {
                          ...prev.unitOverrides,
                          temperature,
                        },
                      }))
                    }
                    options={[
                      { value: "C", label: "Celsius" },
                      { value: "F", label: "Fahrenheit" },
                    ]}
                  />
                </ControlStack>
              </div>
            )}
          </SettingsSection>

          <SettingsSection title="Time and trails">
            <ControlRow label="Clock">
              <ChoiceGroup<ClockMode>
                value={form.clock}
                onChange={(clock) => setForm((prev) => ({ ...prev, clock }))}
                options={[
                  { value: "utc", label: "UTC" },
                  { value: "local", label: "Local" },
                ]}
              />
            </ControlRow>
            <ControlRow label="Trails">
              <ChoiceGroup<number>
                value={form.trailFadeSec}
                onChange={(trailFadeSec) =>
                  setForm((prev) => ({ ...prev, trailFadeSec }))
                }
                minColumnWidth={78}
                options={TRAIL_FADE_OPTIONS.map((opt) => ({
                  value: opt.value,
                  label: opt.label,
                }))}
              />
            </ControlRow>
          </SettingsSection>

          <SettingsSection title="Updates" layout="row" last>
            <UpdateDetails update={update} />
          </SettingsSection>
        </div>

        <div className="flex flex-col-reverse gap-2 border-t border-(--color-line) bg-paper-2 px-4 py-3 sm:flex-row sm:justify-end">
          <button
            type="button"
            onClick={onClose}
            className="h-9 rounded-sm border border-(--color-line) bg-paper px-4 text-[13px] font-medium text-ink-soft hover:border-(--color-line-strong) hover:text-(--color-ink)"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={save}
            className="h-9 rounded-sm border border-(--color-accent) bg-(--color-accent) px-4 text-[13px] font-semibold text-bg hover:border-(--color-blue-deep) hover:bg-(--color-blue-deep)"
          >
            Save
          </button>
        </div>
      </div>
    </>
  );
}

function UpdateDetails({ update }: { update: UpdateSlice }) {
  const latestUrl = update.latest?.url;
  const showStatusDot = updateNeedsAttention(update.status);
  return (
    <div className="grid gap-3">
      <div className="flex flex-wrap items-center gap-2">
        <div className="flex min-h-9 items-center gap-2 rounded-sm border border-(--color-line) bg-paper px-3">
          {showStatusDot && (
            <span
              data-testid="update-status-dot"
              className="h-2 w-2 rounded-full bg-(--color-warn)"
            />
          )}
          <span className="font-mono text-[11px] font-medium uppercase tracking-[0.05em] text-(--color-ink)">
            {updateStatusLabel(update.status)}
          </span>
        </div>
        <UpdateValue
          label="Installed"
          value={formatVersion(update.current?.version)}
        />
        <UpdateValue
          label="Latest"
          value={formatVersion(update.latest?.version)}
        />
      </div>
      {update.status === "unavailable" && update.error && (
        <div className="rounded-sm border border-(--color-line-soft) bg-paper-2 px-3 py-2 font-mono text-[11px] text-ink-soft">
          {update.error}
        </div>
      )}
      {latestUrl && (
        <a
          href={latestUrl}
          target="_blank"
          rel="noreferrer"
          className="inline-flex h-9 w-fit items-center gap-2 rounded-sm border border-(--color-line-strong) bg-paper px-3 font-mono text-[11px] font-medium uppercase tracking-[0.06em] text-(--color-ink) hover:bg-paper-2"
        >
          <ExternalLink size={13} strokeWidth={1.8} aria-hidden="true" />
          Release notes
        </a>
      )}
    </div>
  );
}

function UpdateValue({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex min-h-9 items-center gap-2 rounded-sm border border-(--color-line) bg-paper px-3 font-mono text-[11px]">
      <span className="font-medium uppercase tracking-[0.06em] text-ink-faint">
        {label}
      </span>
      <span className="text-ink-soft">{value}</span>
    </div>
  );
}

function updateStatusLabel(status: string): string {
  switch (status) {
    case "available":
      return "Update available";
    case "current":
      return "Up to date";
    case "checking":
      return "Checking";
    case "disabled":
      return "Disabled";
    case "unavailable":
      return "Unable to check";
    case "unknown":
      return "Unknown";
    default:
      return "Not checked";
  }
}

function updateNeedsAttention(status: string): boolean {
  return status === "available" || status === "unavailable";
}

function formatVersion(value: string | undefined): string {
  return value?.trim() ? value : "-";
}

function SettingsSection({
  title,
  last = false,
  layout = "stack",
  children,
}: {
  title: string;
  last?: boolean;
  layout?: "stack" | "row";
  children: ReactNode;
}) {
  const rowLayout = layout === "row";
  return (
    <section
      className={
        "grid gap-3.5 py-4 first:pt-0 " +
        (rowLayout
          ? "sm:grid-cols-[116px_minmax(0,1fr)] sm:items-start "
          : "") +
        (last ? "pb-0" : "border-b border-(--color-line-soft)")
      }
    >
      <h3 className="m-0 font-mono text-[10px] font-semibold uppercase tracking-[0.14em] text-ink-faint">
        {title}
      </h3>
      <div className="grid min-w-0 gap-3">{children}</div>
    </section>
  );
}

function ControlRow({
  label,
  children,
}: {
  label: string;
  children: ReactNode;
}) {
  return (
    <div className="grid gap-2 sm:grid-cols-[116px_minmax(0,1fr)] sm:items-center">
      <div className="font-mono text-[10px] font-medium uppercase tracking-[0.1em] text-ink-soft">
        {label}
      </div>
      <div className="min-w-0">{children}</div>
    </div>
  );
}

function ControlStack({
  label,
  children,
}: {
  label: string;
  children: ReactNode;
}) {
  return (
    <div className="grid gap-1.5">
      <div className="font-mono text-[10px] font-medium uppercase tracking-[0.1em] text-ink-soft">
        {label}
      </div>
      {children}
    </div>
  );
}

function ChoiceGroup<T extends string | number>({
  value,
  onChange,
  options,
  minColumnWidth = 84,
}: {
  value: T;
  onChange: (value: T) => void;
  options: Array<{ value: T; label: string; icon?: ReactNode }>;
  minColumnWidth?: number;
}) {
  return (
    <div
      className="grid overflow-hidden rounded-sm border border-(--color-line) bg-paper"
      style={{
        gridTemplateColumns: `repeat(auto-fit, minmax(${minColumnWidth}px, 1fr))`,
      }}
    >
      {options.map((option) => {
        const active = option.value === value;
        return (
          <button
            key={String(option.value)}
            type="button"
            aria-pressed={active}
            onClick={() => onChange(option.value)}
            className={
              "flex min-h-9 min-w-0 items-center justify-center gap-1.5 border-0 border-r border-(--color-line-soft) px-2.5 font-mono text-[11px] font-medium uppercase tracking-[0.05em] last:border-r-0 " +
              (active
                ? "bg-paper-2 text-(--color-ink)"
                : "bg-transparent text-ink-soft hover:bg-paper-2 hover:text-(--color-ink)")
            }
          >
            {option.icon && (
              <span className="grid h-4 w-4 shrink-0 place-items-center [&>svg]:h-3.5 [&>svg]:w-3.5 [&>svg]:stroke-[1.8]">
                {option.icon}
              </span>
            )}
            <span className="min-w-0 truncate">{option.label}</span>
          </button>
        );
      })}
    </div>
  );
}
