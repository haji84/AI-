"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { searchJarvisCommands } from "../../jarvis/command-search";

function isEditableTarget(target: EventTarget | null) {
  if (!(target instanceof HTMLElement)) return false;
  if (target.isContentEditable) return true;
  const tag = target.tagName;
  return tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT";
}

export default function JarvisCommandSearch({ pathname }: { pathname: string }) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [query, setQuery] = useState("");
  const [open, setOpen] = useState(false);
  const results = useMemo(() => searchJarvisCommands(query), [query]);

  useEffect(() => {
    const onGlobalKeyDown = (event: KeyboardEvent) => {
      const commandShortcut = (event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "k";
      const slashShortcut = event.key === "/" && !event.metaKey && !event.ctrlKey && !event.altKey && !isEditableTarget(event.target);
      if (!commandShortcut && !slashShortcut) return;
      event.preventDefault();
      setOpen(true);
      inputRef.current?.focus();
    };
    window.addEventListener("keydown", onGlobalKeyDown);
    return () => window.removeEventListener("keydown", onGlobalKeyDown);
  }, []);

  const onInputKeyDown = (event: React.KeyboardEvent<HTMLInputElement>) => {
    if (event.key === "Escape") {
      event.preventDefault();
      setQuery("");
      setOpen(false);
      inputRef.current?.blur();
      return;
    }
    if (event.key === "Enter" && results[0]) {
      event.preventDefault();
      window.location.assign(results[0].href);
    }
  };

  return (
    <div className="jarvis-command-search" role="search">
      <div className="jarvis-command-search-box">
        <span className="jarvis-command-search-icon" aria-hidden="true">⌕</span>
        <input
          ref={inputRef}
          type="search"
          value={query}
          onChange={(event) => {
            setQuery(event.target.value);
            setOpen(true);
          }}
          onFocus={() => setOpen(true)}
          onKeyDown={onInputKeyDown}
          aria-label="JARVIS コマンドと画面を検索"
          aria-controls="jarvis-command-search-results"
          aria-expanded={open}
          aria-autocomplete="list"
          placeholder="JARVISを検索 / コマンド  ⌘K・Ctrl+K・/"
          autoComplete="off"
        />
        {query ? (
          <button type="button" className="jarvis-command-search-clear" onClick={() => setQuery("")} aria-label="検索をクリア">×</button>
        ) : null}
      </div>
      {open ? (
        <div id="jarvis-command-search-results" className="jarvis-command-search-results" role="listbox" aria-label="検索結果">
          {results.length ? results.map((item) => {
            const active = item.href === "/jarvis" ? pathname === item.href : pathname === item.href || pathname.startsWith(`${item.href}/`);
            return (
              <a key={item.id} href={item.href} role="option" aria-selected={active} className={active ? "active" : ""}>
                <strong>{item.label}</strong>
                <span>{item.description}</span>
              </a>
            );
          }) : <p className="jarvis-command-search-empty">一致するJARVIS画面はありません。</p>}
          <p className="jarvis-command-search-boundary">ここから実行するのは画面移動だけです。端末操作・承認・権限変更は各画面の既存Human Gateを通ります。</p>
        </div>
      ) : null}
    </div>
  );
}
