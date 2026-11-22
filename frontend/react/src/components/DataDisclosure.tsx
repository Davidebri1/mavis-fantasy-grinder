/**
 * Disclosure surfaces for data honesty.
 *
 * Two banners, both of them unconditional when they appear:
 *
 *  - `SampleDataBanner` — the roster on screen is a bundled sample because
 *    the live feed could not be reached. Loud, amber, unmissable.
 *  - `EstimateNotice` — projections are modelled estimates. Quiet,
 *    persistent, attached to every surface that shows them.
 *  - `PricesMissingBanner` — the slate has no published DraftKings
 *    prices, so nothing here can be built into an enterable lineup.
 */
import { AlertTriangle, Info } from "lucide-react";

import {
  BUNDLED_DK_NOTICE,
  ESTIMATE_NOTICE,
  PRICES_MISSING_NOTICE,
  SAMPLE_NOTICE,
} from "@/lib/data-provenance";

export function SampleDataBanner({ className = "" }: { className?: string }) {
  return (
    <div
      role="alert"
      className={`flex items-start gap-2.5 rounded-2 border px-3.5 py-2.5 text-xs ${className}`}
      style={{
        borderColor: "var(--warn)",
        background: "var(--warn-wash)",
        color: "var(--warn)",
      }}
    >
      <AlertTriangle size={14} className="mt-0.5 shrink-0" aria-hidden />
      <span className="leading-relaxed">
        <strong className="font-semibold">Sample roster.</strong>{" "}
        {SAMPLE_NOTICE}
      </span>
    </div>
  );
}

export function BundledSlateBanner({ className = "" }: { className?: string }) {
  return (
    <div
      role="alert"
      className={`flex items-start gap-2.5 rounded-2 border px-3.5 py-2.5 text-xs ${className}`}
      style={{
        borderColor: "var(--warn)",
        background: "var(--warn-wash)",
        color: "var(--warn)",
      }}
    >
      <AlertTriangle size={14} className="mt-0.5 shrink-0" aria-hidden />
      <span className="leading-relaxed">
        <strong className="font-semibold">Older DraftKings slate.</strong>{" "}
        {BUNDLED_DK_NOTICE}
      </span>
    </div>
  );
}

export function PricesMissingBanner({ className = "" }: { className?: string }) {
  return (
    <div
      role="alert"
      className={`flex items-start gap-2.5 rounded-2 border px-3.5 py-2.5 text-xs ${className}`}
      style={{
        borderColor: "var(--warn)",
        background: "var(--warn-wash)",
        color: "var(--warn)",
      }}
    >
      <AlertTriangle size={14} className="mt-0.5 shrink-0" aria-hidden />
      <span className="leading-relaxed">
        <strong className="font-semibold">No DraftKings prices on this slate.</strong>{" "}
        {PRICES_MISSING_NOTICE}
      </span>
    </div>
  );
}

export function EstimateNotice({
  className = "",
  mode = "estimate",
}: {
  className?: string;
  /**
   * "estimate" = ESPN pool, modelled numbers.
   * "dk" = a real DraftKings slate.
   * "dk-stale" = a real DraftKings slate from an earlier game week.
   * "sample" = a bundled sample whose numbers are not real at all.
   */
  mode?: "estimate" | "dk" | "dk-stale" | "sample";
}) {
  const text =
    mode === "dk"
      ? "Salaries and projections on this slate are DraftKings' own published numbers."
      : mode === "dk-stale"
        ? "Salaries and projections on this slate are DraftKings' own published numbers, from an earlier game week."
        : mode === "sample"
          ? "This is a sample roster. Its prices and projections are made up for demonstration, not published DraftKings numbers."
          : ESTIMATE_NOTICE;
  return (
    <p
      className={`flex items-start gap-2 text-[11px] leading-relaxed text-ink-subtle ${className}`}
    >
      <Info size={12} className="mt-0.5 shrink-0" aria-hidden />
      <span>{text}</span>
    </p>
  );
}
