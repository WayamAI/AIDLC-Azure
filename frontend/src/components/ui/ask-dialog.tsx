import { useCallback, useRef, useState, type ReactNode } from "react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";

type AskOptions = {
  title: string;
  description?: ReactNode;
  /** Label for the confirming button. */
  confirmLabel?: string;
  /** Styles the confirming button as destructive (delete, discard). */
  destructive?: boolean;
  /** When set, the dialog asks for a line of text. */
  input?: {
    label: string;
    defaultValue?: string;
    placeholder?: string;
    /** Masks the value (tokens, passwords). */
    secret?: boolean;
  };
};

type Pending = AskOptions & { resolve: (value: string | boolean | null) => void };

/**
 * In-app replacement for `window.prompt` / `window.confirm`. Render `dialog`
 * once in the component and await `askText` or `confirm` from handlers:
 *
 *   const { dialog, askText, confirm } = useAskDialog();
 *   const name = await askText({ title: "Rename", input: { label: "Path", defaultValue: path } });
 *   if (name === null) return;   // cancelled
 */
export function useAskDialog() {
  const [pending, setPending] = useState<Pending | null>(null);
  const [value, setValue] = useState("");
  const pendingRef = useRef<Pending | null>(null);

  const open = useCallback((options: AskOptions) => {
    return new Promise<string | boolean | null>((resolve) => {
      // A second request while one is open cancels the first.
      pendingRef.current?.resolve(null);
      const next = { ...options, resolve };
      pendingRef.current = next;
      setValue(options.input?.defaultValue ?? "");
      setPending(next);
    });
  }, []);

  const settle = useCallback((result: string | boolean | null) => {
    const current = pendingRef.current;
    pendingRef.current = null;
    setPending(null);
    current?.resolve(result);
  }, []);

  const askText = useCallback(
    async (options: AskOptions & { input: NonNullable<AskOptions["input"]> }) => {
      const result = await open(options);
      return typeof result === "string" ? result : null;
    },
    [open],
  );

  const confirm = useCallback(async (options: Omit<AskOptions, "input">) => (await open(options)) === true, [open]);

  const wantsText = !!pending?.input;
  const trimmed = value.trim();

  const dialog = (
    <Dialog open={!!pending} onOpenChange={(isOpen) => !isOpen && settle(null)}>
      <DialogContent className="max-w-md">
        <form
          onSubmit={(event) => {
            event.preventDefault();
            if (wantsText) {
              if (trimmed) settle(trimmed);
            } else {
              settle(true);
            }
          }}
          className="space-y-4"
        >
          <DialogHeader>
            <DialogTitle className="font-sans text-base font-medium text-ink">{pending?.title}</DialogTitle>
            {pending?.description ? (
              <DialogDescription className="text-sm text-ink-secondary">{pending.description}</DialogDescription>
            ) : (
              <DialogDescription className="sr-only">{pending?.title}</DialogDescription>
            )}
          </DialogHeader>
          {pending?.input && (
            <div>
              <label htmlFor="ask-dialog-input" className="mb-1.5 block text-xs font-medium text-ink-secondary">
                {pending.input.label}
              </label>
              <Input
                id="ask-dialog-input"
                autoFocus
                type={pending.input.secret ? "password" : "text"}
                autoComplete="off"
                spellCheck={false}
                value={value}
                placeholder={pending.input.placeholder}
                onChange={(event) => setValue(event.target.value)}
                className={pending.input.secret ? undefined : "font-mono text-xs"}
              />
            </div>
          )}
          <DialogFooter className="gap-2 sm:space-x-0">
            <Button type="button" variant="outline" onClick={() => settle(null)}>
              Cancel
            </Button>
            <Button type="submit" variant={pending?.destructive ? "destructive" : "default"} disabled={wantsText && !trimmed}>
              {pending?.confirmLabel ?? (wantsText ? "Save" : "Confirm")}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );

  return { dialog, askText, confirm };
}
