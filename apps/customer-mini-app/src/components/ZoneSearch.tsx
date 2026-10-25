import { useCallback, useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { apiClient } from "../api/client";
import { useSessionStore } from "../store/session";

// G-S9.3 (CLM-0647): text search for a valid zone (CMS §3.2 L52-53 — «بحثٌ
// نصّيٌّ»; the pickup search must yield «منطقة صالحة (GeographyPort)»).
// Contract: GET /geo/zones/search?q=&locale= (CLM-0645) — active zones only,
// the same rule customers enforces on an order's zone_id, so every result is
// a zone the order may use. The stop contract already declares
// source: "text_search". This component only searches and reports the chosen
// zone; the screen decides what the choice fills.
//
// Lesson of G-S9.18 (CLM-0643): a response only reaches the UI if it answers
// the latest search — an older, slower response never replaces a newer one.

export const ZONE_SEARCH_MIN_LENGTH = 2;

export interface ZoneSearchResult {
  id: string;
  code: string;
  status: string;
  name: string;
  path: {
    country: { id: string; code: string; name: string };
    region: { id: string; code: string; name: string };
    city: { id: string; code: string; name: string };
    district: { id: string; code: string; name: string };
  };
}

interface ZoneSearchProps {
  id: string;
  label: string;
  testId: string;
  onSelect: (zone: ZoneSearchResult) => void;
}

type Status = "idle" | "too_short" | "loading" | "success" | "error";

export function ZoneSearch({ id, label, testId, onSelect }: ZoneSearchProps) {
  const { t, i18n } = useTranslation();
  const { token, customerId } = useSessionStore();
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<ZoneSearchResult[]>([]);
  const [status, setStatus] = useState<Status>("idle");
  const seqRef = useRef(0);
  const mountedRef = useRef(true);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  const runSearch = useCallback(async () => {
    if (!token || !customerId) return;
    const q = query.trim();
    seqRef.current += 1;
    const seq = seqRef.current;
    if ([...q].length < ZONE_SEARCH_MIN_LENGTH) {
      setResults([]);
      setStatus("too_short");
      return;
    }
    setStatus("loading");
    const locale = ["ar", "en", "ur"].includes(i18n.language) ? i18n.language : "ar";
    try {
      const found = await apiClient.get<ZoneSearchResult[]>(
        `/geo/zones/search?q=${encodeURIComponent(q)}&locale=${locale}`
      );
      if (!mountedRef.current || seq !== seqRef.current) return; // stale
      setResults(found);
      setStatus("success");
    } catch {
      if (!mountedRef.current || seq !== seqRef.current) return;
      setResults([]);
      setStatus("error");
    }
  }, [token, customerId, query, i18n.language]);

  const handleSelect = useCallback(
    (zone: ZoneSearchResult) => {
      seqRef.current += 1; // any in-flight search no longer applies
      onSelect(zone);
      setResults([]);
      setStatus("idle");
      setQuery("");
    },
    [onSelect]
  );

  return (
    <div className="form-group zone-search" data-testid={testId}>
      <label htmlFor={id}>{label}</label>
      <div className="zone-search-row">
        <input
          id={id}
          type="search"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              void runSearch();
            }
          }}
          placeholder={t("ride_order.zone_search_placeholder")}
          aria-label={label}
          data-testid={`${testId}-input`}
        />
        <button
          type="button"
          onClick={() => void runSearch()}
          disabled={status === "loading"}
          data-testid={`${testId}-button`}
        >
          {t("ride_order.zone_search_button")}
        </button>
      </div>
      {status === "loading" && (
        <p className="zone-search-status" data-testid={`${testId}-loading`}>
          {t("ride_order.zone_search_loading")}
        </p>
      )}
      {status === "too_short" && (
        <p className="zone-search-status" role="alert" data-testid={`${testId}-too-short`}>
          {t("ride_order.zone_search_too_short")}
        </p>
      )}
      {status === "error" && (
        <p className="zone-search-status error" role="alert" data-testid={`${testId}-error`}>
          {t("ride_order.zone_search_error")}
        </p>
      )}
      {status === "success" && results.length === 0 && (
        <p className="zone-search-status" data-testid={`${testId}-empty`}>
          {t("ride_order.zone_search_empty")}
        </p>
      )}
      {status === "success" && results.length > 0 && (
        <ul className="zone-search-results" data-testid={`${testId}-results`}>
          {results.map((zone) => (
            <li key={zone.id}>
              <button
                type="button"
                onClick={() => handleSelect(zone)}
                data-testid={`${testId}-result-${zone.id}`}
              >
                {zone.name} — {zone.path.district.name} · {zone.path.city.name}
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
