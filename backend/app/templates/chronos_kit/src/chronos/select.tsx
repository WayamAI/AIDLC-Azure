/**
 * Custom dropdown that replaces the native <select> in the kit.
 *
 * Accepts the same children as a native select (<option> and <optgroup>) so
 * generated pages keep working, plus an `options` array. `onChange` receives an
 * object shaped like a change event (`target.value` / `currentTarget.value`), so
 * `(e) => set(e.target.value)` keeps working. The menu is rendered in place and
 * positioned absolutely inside a relative wrapper; it flips above the trigger
 * when there is no room below.
 *
 * Props are untrusted (they can come from generated code), so nothing here
 * throws: non-element children are ignored and a value that is not in the
 * option list shows the placeholder.
 */

import {
  Fragment,
  isValidElement,
  useEffect,
  useId,
  useLayoutEffect,
  useRef,
  useState,
  type ButtonHTMLAttributes,
  type ChangeEvent,
  type ComponentPropsWithoutRef,
  type KeyboardEvent as ReactKeyboardEvent,
  type ReactNode,
} from "react";
import { Check, ChevronDown } from "lucide-react";

import { cx } from "./cx";

export type SelectOption = { value: string; label: string; disabled?: boolean };

export type SelectProps = Omit<
  ComponentPropsWithoutRef<"select">,
  "onChange" | "value" | "defaultValue" | "size"
> & {
  value?: string;
  defaultValue?: string;
  onChange?: (event: ChangeEvent<HTMLSelectElement>) => void;
  onValueChange?: (value: string) => void;
  options?: SelectOption[];
  placeholder?: string;
  disabled?: boolean;
  name?: string;
  "aria-label"?: string;
  id?: string;
  size?: "sm" | "md";
  className?: string;
  children?: ReactNode;
};

type Item =
  | { kind: "option"; value: string; label: string; disabled: boolean }
  | { kind: "group"; label: string };

function textOf(node: ReactNode): string {
  if (node === null || node === undefined || typeof node === "boolean") return "";
  if (typeof node === "string" || typeof node === "number") return String(node);
  if (Array.isArray(node)) return node.map(textOf).join("");
  if (isValidElement(node)) return textOf((node.props as { children?: ReactNode }).children);
  return "";
}

/** Flattens nested arrays without React's child validation, so bad children are skipped rather than thrown. */
function flattenChildren(node: unknown, out: unknown[]): unknown[] {
  if (Array.isArray(node)) {
    for (const item of node) flattenChildren(item, out);
  } else {
    out.push(node);
  }
  return out;
}

function collect(node: ReactNode, out: Item[]): void {
  flattenChildren(node, []).forEach((child) => {
    if (!isValidElement(child)) return;
    const props = (child.props ?? {}) as {
      children?: ReactNode;
      value?: unknown;
      label?: unknown;
      disabled?: unknown;
    };
    if (child.type === "option") {
      const label = textOf(props.children);
      const value = props.value !== undefined && props.value !== null ? String(props.value) : label;
      out.push({ kind: "option", value, label: label || value, disabled: Boolean(props.disabled) });
    } else if (child.type === "optgroup") {
      out.push({ kind: "group", label: props.label != null ? String(props.label) : "" });
      collect(props.children, out);
    } else if (child.type === Fragment) {
      collect(props.children, out);
    }
  });
}

function buildItems(children: ReactNode, options: unknown): Item[] {
  const items: Item[] = [];
  if (Array.isArray(options)) {
    for (const raw of options) {
      if (!raw || typeof raw !== "object") continue;
      const o = raw as { value?: unknown; label?: unknown; disabled?: unknown };
      if (o.value === undefined || o.value === null) continue;
      const value = String(o.value);
      const label = o.label !== undefined && o.label !== null ? String(o.label) : value;
      items.push({ kind: "option", value, label, disabled: Boolean(o.disabled) });
    }
  }
  collect(children, items);
  return items;
}

const WIDTH_CLASS = /^(min-|max-)?w-/;

const TRIGGER_SIZE = { sm: "h-8", md: "h-9" } as const;

export function Select({
  value,
  defaultValue,
  onChange,
  onValueChange,
  options,
  placeholder = "Select…",
  disabled = false,
  name,
  id,
  "aria-label": ariaLabel,
  size = "md",
  className,
  children,
  title,
  onBlur,
  onFocus,
}: SelectProps) {
  const uid = useId();
  const isControlled = value !== undefined;
  const [internal, setInternal] = useState<string>(
    defaultValue !== undefined && defaultValue !== null ? String(defaultValue) : "",
  );
  const current = isControlled ? (value === null ? "" : String(value)) : internal;

  const items = buildItems(children, options);
  const selectedItem = items.find((item) => item.kind === "option" && item.value === current);
  const selectedLabel = selectedItem && selectedItem.kind === "option" ? selectedItem.label : undefined;

  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(-1);
  const [placement, setPlacement] = useState<"below" | "above">("below");

  const wrapRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const listRef = useRef<HTMLUListElement>(null);
  const optionEls = useRef<Array<HTMLLIElement | null>>([]);
  const typeBuf = useRef("");
  const typeTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const widthClasses = (className ?? "").split(/\s+/).filter((c) => WIDTH_CLASS.test(c)).join(" ");

  useEffect(() => {
    return () => {
      if (typeTimer.current) clearTimeout(typeTimer.current);
    };
  }, []);

  // Close on outside mouse down.
  useEffect(() => {
    if (!open) return;
    const onDown = (event: MouseEvent) => {
      const node = wrapRef.current;
      if (node && event.target instanceof Node && !node.contains(event.target)) {
        setOpen(false);
      }
    };
    document.addEventListener("mousedown", onDown);
    return () => document.removeEventListener("mousedown", onDown);
  }, [open]);

  // Move focus into the listbox when it opens.
  useEffect(() => {
    if (open) listRef.current?.focus();
  }, [open]);

  // Flip above the trigger when there is no room below.
  useLayoutEffect(() => {
    if (!open) return;
    const trigger = triggerRef.current?.getBoundingClientRect();
    const menu = listRef.current?.getBoundingClientRect();
    if (!trigger || typeof window === "undefined") return;
    const menuHeight = menu?.height ?? 0;
    const spaceBelow = window.innerHeight - trigger.bottom;
    setPlacement(spaceBelow < menuHeight + 4 && trigger.top > spaceBelow ? "above" : "below");
  }, [open, items.length]);

  // Keep the active option visible.
  useEffect(() => {
    if (!open || active < 0) return;
    const el = optionEls.current[active];
    if (el && typeof el.scrollIntoView === "function") {
      el.scrollIntoView({ block: "nearest" });
    }
  }, [open, active]);

  const firstEnabled = (): number => items.findIndex((i) => i.kind === "option" && !i.disabled);

  const stepEnabled = (from: number, dir: 1 | -1): number => {
    const n = items.length;
    for (let k = 1; k <= n; k++) {
      const idx = from + dir * k;
      if (idx < 0 || idx >= n) continue;
      const item = items[idx];
      if (item.kind === "option" && !item.disabled) return idx;
    }
    return from;
  };

  const commit = (next: string) => {
    if (!isControlled) setInternal(next);
    if (next !== current) {
      onValueChange?.(next);
      if (onChange) {
        const event = {
          target: { value: next, name },
          currentTarget: { value: next, name },
          type: "change",
        };
        onChange(event as unknown as ChangeEvent<HTMLSelectElement>);
      }
    }
  };

  const openMenu = () => {
    if (disabled) return;
    const idx = items.findIndex(
      (i) => i.kind === "option" && i.value === current && !i.disabled,
    );
    setActive(idx >= 0 ? idx : firstEnabled());
    setOpen(true);
  };

  const closeMenu = (returnFocus: boolean) => {
    setOpen(false);
    if (returnFocus) triggerRef.current?.focus();
  };

  const chooseIndex = (idx: number) => {
    const item = items[idx];
    if (!item || item.kind !== "option" || item.disabled) return;
    commit(item.value);
    closeMenu(true);
  };

  /** Finds the first enabled option whose label starts with `query`, from `from` and wrapping. */
  const findMatch = (query: string, from: number): number => {
    const n = items.length;
    if (n === 0) return -1;
    const q = query.toLowerCase();
    for (let k = 0; k < n; k++) {
      const idx = (((from + k) % n) + n) % n;
      const item = items[idx];
      if (item.kind === "option" && !item.disabled && item.label.toLowerCase().startsWith(q)) {
        return idx;
      }
    }
    return -1;
  };

  const bumpTypeahead = (key: string) => {
    typeBuf.current += key;
    if (typeTimer.current) clearTimeout(typeTimer.current);
    typeTimer.current = setTimeout(() => {
      typeBuf.current = "";
    }, 500);
    return typeBuf.current;
  };

  const onTriggerKeyDown = (event: ReactKeyboardEvent<HTMLButtonElement>) => {
    if (disabled) return;
    const key = event.key;
    if (key === "Enter" || key === " " || key === "ArrowDown" || key === "ArrowUp") {
      event.preventDefault();
      openMenu();
      return;
    }
    if (key.length === 1 && !event.ctrlKey && !event.metaKey && !event.altKey) {
      const query = bumpTypeahead(key);
      const selectedIdx = items.findIndex((i) => i.kind === "option" && i.value === current);
      const from = typeBuf.current.length > 1 ? Math.max(0, selectedIdx) : selectedIdx + 1;
      const idx = findMatch(query, from);
      if (idx >= 0) {
        const item = items[idx];
        if (item.kind === "option") commit(item.value);
      }
    }
  };

  const onListKeyDown = (event: ReactKeyboardEvent<HTMLUListElement>) => {
    const key = event.key;
    if (key === "ArrowDown" || key === "ArrowUp") {
      event.preventDefault();
      const from = active < 0 ? (key === "ArrowDown" ? -1 : items.length) : active;
      const next = stepEnabled(from, key === "ArrowDown" ? 1 : -1);
      if (next !== active && items[next]?.kind === "option") setActive(next);
      return;
    }
    if (key === "Home" || key === "End") {
      event.preventDefault();
      if (key === "Home") {
        const idx = firstEnabled();
        if (idx >= 0) setActive(idx);
      } else {
        const last = stepEnabled(items.length, -1);
        if (items[last]?.kind === "option") setActive(last);
      }
      return;
    }
    if (key === "Enter" || key === " ") {
      event.preventDefault();
      if (active >= 0) chooseIndex(active);
      return;
    }
    if (key === "Escape") {
      event.preventDefault();
      closeMenu(true);
      return;
    }
    if (key === "Tab") {
      setOpen(false);
      return;
    }
    if (key.length === 1 && !event.ctrlKey && !event.metaKey && !event.altKey) {
      const query = bumpTypeahead(key);
      const from = typeBuf.current.length > 1 ? Math.max(0, active) : active + 1;
      const idx = findMatch(query, from);
      if (idx >= 0) setActive(idx);
    }
  };

  const listId = `${uid}-list`;
  const optionId = (idx: number) => `${uid}-opt-${idx}`;
  const activeId = active >= 0 && items[active]?.kind === "option" ? optionId(active) : undefined;
  const hasOptions = items.some((i) => i.kind === "option");

  return (
    <div
      ref={wrapRef}
      className={cx("relative inline-block max-w-full align-middle", widthClasses)}
    >
      <button
        ref={triggerRef}
        type="button"
        id={id}
        title={title}
        onBlur={onBlur as unknown as ButtonHTMLAttributes<HTMLButtonElement>["onBlur"]}
        onFocus={onFocus as unknown as ButtonHTMLAttributes<HTMLButtonElement>["onFocus"]}
        disabled={disabled}
        aria-label={ariaLabel}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-controls={open ? listId : undefined}
        onClick={() => (open ? closeMenu(false) : openMenu())}
        onKeyDown={onTriggerKeyDown}
        className={cx(
          "relative inline-flex min-w-0 items-center gap-2 rounded-lg border border-default bg-container px-3 text-body-md text-primary",
          "cursor-pointer hover:bg-raised focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-active",
          "disabled:cursor-not-allowed disabled:opacity-50 disabled:hover:bg-container",
          TRIGGER_SIZE[size] ?? TRIGGER_SIZE.md,
          className,
        )}
      >
        <span
          className={cx(
            "min-w-0 flex-1 truncate text-left",
            selectedLabel === undefined && "text-tertiary",
          )}
        >
          {selectedLabel ?? placeholder}
        </span>
        <ChevronDown
          size={12}
          strokeWidth={1.75}
          aria-hidden
          className={cx(
            "pointer-events-none shrink-0 text-quaternary transition-transform",
            open && "rotate-180",
          )}
        />
      </button>

      {open ? (
        <ul
          ref={listRef}
          id={listId}
          role="listbox"
          tabIndex={-1}
          aria-activedescendant={activeId}
          aria-label={ariaLabel}
          onKeyDown={onListKeyDown}
          className={cx(
            "absolute left-0 z-50 min-w-full max-h-[18rem] overflow-y-auto rounded-lg border border-muted bg-container py-1",
            "shadow-[0_8px_24px_rgba(0,0,0,0.12)] outline-none",
            placement === "above" ? "bottom-full mb-1" : "top-full mt-1",
          )}
        >
          {!hasOptions ? (
            <li role="presentation" className="px-3 py-2 text-body-md text-tertiary">
              No options
            </li>
          ) : null}
          {items.map((item, idx) => {
            if (item.kind === "group") {
              return (
                <li
                  key={`g-${idx}`}
                  role="presentation"
                  className="px-3 pb-1 pt-2 text-caption uppercase tracking-wide text-tertiary"
                >
                  {item.label}
                </li>
              );
            }
            const isActive = idx === active;
            const isSelected = item.value === current;
            return (
              <li
                key={`o-${idx}`}
                id={optionId(idx)}
                ref={(el) => {
                  optionEls.current[idx] = el;
                }}
                role="option"
                aria-selected={isSelected}
                aria-disabled={item.disabled || undefined}
                onMouseEnter={() => {
                  if (!item.disabled) setActive(idx);
                }}
                onClick={() => chooseIndex(idx)}
                className={cx(
                  "flex cursor-pointer items-center gap-2 px-3 py-2 text-body-md text-primary",
                  isActive && !item.disabled && "bg-raised",
                  isSelected && "font-medium",
                  item.disabled && "cursor-not-allowed text-quaternary",
                )}
              >
                <span className="min-w-0 flex-1 truncate">{item.label}</span>
                {isSelected ? (
                  <Check size={14} strokeWidth={1.75} aria-hidden className="shrink-0 text-primary" />
                ) : null}
              </li>
            );
          })}
        </ul>
      ) : null}

      {name ? <input type="hidden" name={name} value={current} /> : null}
    </div>
  );
}
