"use client";

import { useEffect, useId, useRef, useState } from "react";
import { Icon } from "./icon";

type Option = { value: string; label: string };

/**
 * A field of the query form that can be typed or picked: the text is read when the field
 * is left (or on Enter) and the chevron, like the rest of the form, unfolds the options.
 * `parse` turns what was typed into a value, or null to keep the previous one.
 */
export function ComboField({ label, placeholder, value, options, parse = matchOption(options), onChange, format, inputMode = "numeric", className = "" }: {
  label: string;
  placeholder: string;
  value: string;
  options: Option[];
  /** Defaults to the option whose name holds what was typed. */
  parse?: (text: string) => string | null;
  onChange: (value: string) => void;
  /** How a value outside the list is shown (e.g. a typed 09:20 as «09:20 a. m.»). */
  format?: (value: string) => string;
  inputMode?: "numeric" | "text";
  className?: string;
}) {
  const id = useId();
  const listId = `${id}-list`;
  // An empty value (e.g. «any colour») leaves the placeholder showing.
  const shown = value ? options.find((option) => option.value === value)?.label ?? (format ? format(value) : value) : "";
  const [draft, setDraft] = useState<string | null>(null);
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(-1);
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLUListElement>(null);
  const text = draft ?? shown;
  // While typing, the list narrows: numbers to those that start with the text, names to
  // those that contain it.
  const typed = draft?.trim().toLowerCase() ?? "";
  const visible = typed ? options.filter((option) => inputMode === "numeric" ? option.label.startsWith(typed) || option.value.startsWith(typed) : fold(option.label).includes(fold(typed))) : options;
  const list = visible.length ? visible : options;

  useEffect(() => {
    if (!open) return;
    // Opens at the current value, or at the first option after it when it is not listed.
    const exact = list.findIndex((option) => option.value === value);
    const index = active >= 0 ? active : exact >= 0 ? exact : list.findIndex((option) => option.value >= value);
    listRef.current?.children[Math.max(0, index)]?.scrollIntoView({ block: index > 0 ? "center" : "nearest" });
  }, [open, active, list, value]);

  function commit() {
    if (draft !== null) {
      const next = parse(draft);
      if (next !== null && next !== value) onChange(next);
    }
    setDraft(null);
  }

  function choose(option: Option) {
    onChange(option.value);
    setDraft(null);
    setOpen(false);
    setActive(-1);
  }

  function toggle() {
    setActive(-1);
    setOpen((current) => !current);
    inputRef.current?.focus();
  }

  function onKeyDown(event: React.KeyboardEvent<HTMLInputElement>) {
    if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      event.preventDefault();
      const start = active >= 0 ? active : list.findIndex((option) => option.value === value);
      if (!list.length) return;
      const step = event.key === "ArrowDown" ? 1 : -1;
      setOpen(true);
      if (open) setActive(Math.min(list.length - 1, Math.max(0, start + step)));
      else setActive(Math.max(0, start));
    } else if (event.key === "Enter") {
      // With the list open, Enter picks (the highlighted option, or what was typed) instead
      // of sending the form.
      if (open) event.preventDefault();
      if (open && active >= 0 && list[active]) choose(list[active]);
      else {
        commit();
        setOpen(false);
      }
    } else if (event.key === "Escape" && open) {
      event.preventDefault();
      setOpen(false);
      setDraft(null);
    }
  }

  return <span className={`line-select combo-field ${value ? "" : "empty"} ${className}`}>
    <input
      ref={inputRef}
      role="combobox"
      aria-label={label}
      aria-expanded={open}
      aria-controls={listId}
      aria-autocomplete="list"
      aria-activedescendant={open && active >= 0 ? `${listId}-${active}` : undefined}
      inputMode={inputMode}
      autoComplete="off"
      spellCheck={false}
      placeholder={placeholder}
      value={text}
      onChange={(event) => { setDraft(event.target.value); setActive(-1); setOpen(true); }}
      onFocus={(event) => event.target.select()}
      onBlur={() => { commit(); setOpen(false); }}
      onKeyDown={onKeyDown}
    />
    {/* The pointer press does not take the focus away from the text. */}
    <button type="button" className="combo-toggle" tabIndex={-1} aria-label={`Mostrar opciones de ${label}`} onMouseDown={(event) => event.preventDefault()} onClick={toggle}>
      <Icon name="chevron" size={24}/>
    </button>
    {open && <ul className="combo-list" id={listId} role="listbox" aria-label={label} ref={listRef}>
      {list.map((option, index) => <li key={option.value} id={`${listId}-${index}`} role="option" aria-selected={option.value === value} className={index === active ? "active" : ""}
        onMouseDown={(event) => event.preventDefault()} onClick={() => choose(option)}>{option.label}</li>)}
    </ul>}
  </span>;
}

/** Lower case without accents, so «camara» finds «Cámara». */
const fold = (text: string) => text.normalize("NFD").replace(/\p{Diacritic}/gu, "").toLowerCase();

/** The first option whose name holds the typed text (an empty text clears the field). */
export function matchOption(options: Option[]) {
  return (text: string) => {
    const typed = fold(text.trim());
    if (!typed) return options.some((option) => option.value === "") ? "" : null;
    return (options.find((option) => fold(option.label) === typed) ?? options.find((option) => fold(option.label).includes(typed)))?.value ?? null;
  };
}

const pad = (value: number) => String(value).padStart(2, "0");

/** Whole number typed in a date part, within its range, as two digits (four for a year). */
export function parseDatePart(min: number, max: number, digits = 2) {
  return (text: string) => {
    const clean = text.trim();
    if (!/^\d{1,4}$/.test(clean)) return null;
    const value = Number(clean);
    return value >= min && value <= max ? String(value).padStart(digits, "0") : null;
  };
}

/** «09:20 a. m.» for 09:20, as the time fields show it. */
export function timeLabel(value: string) {
  const [hours, minutes] = value.split(":").map(Number);
  if (Number.isNaN(hours) || Number.isNaN(minutes)) return value;
  return `${pad(hours % 12 || 12)}:${pad(minutes)} ${hours < 12 ? "a. m." : "p. m."}`;
}

/**
 * Reads a typed time: «9:20», «0920», «9.20», «21:05», «9 pm» or «09:20 p. m.»
 * become HH:MM (24 hours). Anything else is null.
 */
export function parseTime(text: string) {
  const clean = text.trim().toLowerCase().replace(/\s+/g, "").replace(/\./g, ":").replace(/:?(a|p):?m:?$/, " $1").replace(/:$/, "");
  const match = clean.match(/^(\d{1,2})(?::?(\d{2}))?(?: ([ap]))?$/);
  if (!match) return null;
  let hours = Number(match[1]);
  const minutes = Number(match[2] ?? 0);
  const half = match[3];
  if (minutes > 59) return null;
  if (half) {
    if (hours < 1 || hours > 12) return null;
    hours = hours % 12 + (half === "p" ? 12 : 0);
  } else if (hours > 23) return null;
  return `${pad(hours)}:${pad(minutes)}`;
}

/** Every quarter of an hour, for the time fields' list. */
export const TIME_OPTIONS: Option[] = Array.from({ length: 96 }, (_, index) => {
  const value = `${pad(Math.floor(index / 4))}:${pad(index % 4 * 15)}`;
  return { value, label: timeLabel(value) };
});
