import { MetricLegend, SearchResults } from "@/app/SearchResults";
import { OutputPanel } from "@/app/OutputPanel";

export function SearchWorkspace({ legend, results, output, panelRefs }) {
  return (
    <div className="grid gap-4 sm:gap-5">
      <div className="hidden sm:block">
        <MetricLegend />
      </div>

      {legend.open ? (
        <div id="search-metric-legend" className="sm:hidden">
          <MetricLegend />
        </div>
      ) : null}

      <section ref={panelRefs.results} className="grid gap-3">
        <SearchResults
          {...results}
          metricLegendOpen={legend.open}
          onToggleMetricLegend={legend.onToggle}
        />
      </section>

      <section ref={panelRefs.output} className="grid gap-3">
        <OutputPanel {...output} />
      </section>
    </div>
  );
}

export default SearchWorkspace;
