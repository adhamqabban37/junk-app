"use client";

import { useMemo, useState } from "react";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import type { TaxonomyItemResponse } from "@/lib/api";

const LETTERS = "ABCDEFGHIJKLMNOPQRSTUVWXYZ".split("");

/**
 * Car-Part.com-style part picker: search-as-you-type across the whole
 * real parts catalog (~706 entries, backend/src/database/seeds/taxonomy.seed.ts),
 * plus an A-Z browse mode for paging through it letter by letter --
 * neither existed before, the old UI only ever showed ~16 hardcoded
 * "quick pick" buttons until you typed something. Presentation-only:
 * owns its own search/browse state, not what happens after a pick, so
 * every caller keeps its existing selection/assign logic unchanged.
 */
export function TaxonomyPicker({
  taxonomies,
  selectedId,
  onSelect,
}: {
  taxonomies: TaxonomyItemResponse[];
  selectedId: string | null;
  onSelect: (id: string) => void;
}) {
  const [query, setQuery] = useState("");
  const [activeLetter, setActiveLetter] = useState<string | null>(null);

  const quickPicks = useMemo(() => taxonomies.filter((t) => t.isQuickPick), [taxonomies]);

  const sortedByName = useMemo(
    () => [...taxonomies].sort((a, b) => a.name.localeCompare(b.name)),
    [taxonomies],
  );

  const results = useMemo(() => {
    if (query) {
      const q = query.toLowerCase();
      return sortedByName.filter((t) => t.name.toLowerCase().includes(q));
    }
    if (activeLetter) {
      return sortedByName.filter((t) => t.name.toUpperCase().startsWith(activeLetter));
    }
    return [];
  }, [query, activeLetter, sortedByName]);

  const browsing = query.length > 0 || activeLetter !== null;

  function handleQueryChange(value: string) {
    setQuery(value);
    if (value) setActiveLetter(null);
  }

  function handleLetterClick(letter: string) {
    setQuery("");
    setActiveLetter((current) => (current === letter ? null : letter));
  }

  return (
    <div className="space-y-2">
      <Input
        aria-label="Search parts"
        placeholder="Search parts…"
        value={query}
        onChange={(e) => handleQueryChange(e.target.value)}
      />

      <div className="flex flex-wrap gap-1" role="group" aria-label="Browse parts A to Z">
        {LETTERS.map((letter) => (
          <Button
            key={letter}
            type="button"
            size="sm"
            variant={activeLetter === letter ? "default" : "outline"}
            className="h-7 w-7 px-0"
            onClick={() => handleLetterClick(letter)}
          >
            {letter}
          </Button>
        ))}
      </div>

      {browsing ? (
        results.length === 0 ? (
          <p className="text-sm text-muted-foreground">No matching parts.</p>
        ) : (
          <div
            role="listbox"
            aria-label="Part results"
            className="max-h-72 overflow-y-auto rounded-lg border border-border"
          >
            {results.map((t) => (
              <button
                key={t.id}
                type="button"
                role="option"
                aria-selected={selectedId === t.id}
                onClick={() => onSelect(t.id)}
                className={`block w-full px-3 py-2 text-left text-sm ${
                  selectedId === t.id
                    ? "bg-primary text-primary-foreground"
                    : "hover:bg-muted"
                }`}
              >
                {t.name}
              </button>
            ))}
          </div>
        )
      ) : (
        <div className="flex flex-wrap gap-2">
          {quickPicks.map((t) => (
            <Button
              key={t.id}
              type="button"
              variant={selectedId === t.id ? "default" : "outline"}
              size="sm"
              onClick={() => onSelect(t.id)}
            >
              {t.name}
            </Button>
          ))}
        </div>
      )}
    </div>
  );
}
