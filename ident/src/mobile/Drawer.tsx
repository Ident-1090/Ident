import { useEffect } from "react";

interface Props {
  open: boolean;
  onClose: () => void;
  label?: string;
  children: React.ReactNode;
}

/**
 * Top-right menu surface. It scales from the hamburger button's center so the
 * action reads as unfolding from / folding into that control, while the panel
 * itself stays inside the phone safe area. Close on scrim tap or Escape. No
 * internal focus trap — we rely on Escape + tap to dismiss on phones where
 * keyboard focus isn't a concern.
 */
export function Drawer({ open, onClose, label = "Drawer", children }: Props) {
  useEffect(() => {
    if (!open) return;
    function onKey(e: KeyboardEvent): void {
      if (e.key === "Escape") onClose();
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  return (
    <>
      {open && (
        <div aria-hidden onClick={onClose} className="fixed inset-0 z-30" />
      )}
      <aside
        role="dialog"
        aria-label={label}
        aria-hidden={!open}
        data-open={open}
        className={
          "mobile-drawer-panel fixed z-40 bg-paper flex flex-col overflow-hidden border border-line-strong " +
          "transition-[opacity,transform] duration-200 ease-out"
        }
      >
        {children}
      </aside>
    </>
  );
}
