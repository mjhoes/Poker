import { useEffect, useMemo, useRef } from "react";
import type { EChartsOption } from "echarts";
import { init, use } from "echarts/core";
import { BarChart, LineChart } from "echarts/charts";
import { AxisPointerComponent, GridComponent, TooltipComponent } from "echarts/components";
import { SVGRenderer } from "echarts/renderers";
import { describeLabel } from "@perfect-draw/engine";
import type { CategoryStats, StatsReport } from "@perfect-draw/shared";

use([BarChart, LineChart, GridComponent, TooltipComponent, AxisPointerComponent, SVGRenderer]);

type TrendMetric = "accuracyPct" | "evLostPer1000" | "asDrilledReturnPct";

export function formatCoinValue(value: number | null | undefined, digits = 3) {
  if (value == null || !Number.isFinite(value)) return "—";
  const magnitude = Math.abs(value);
  const formatted = value !== 0 && magnitude < 0.001 ? value.toExponential(2)
    : value !== 0 && magnitude < 1 ? value.toPrecision(5) : value.toFixed(digits);
  return `${formatted} coins`;
}

function labelFor(label: string, familyId: string) {
  try { return describeLabel(label, familyId as Parameters<typeof describeLabel>[1]); }
  catch { return label; }
}

function fullDay(value: number) {
  return new Intl.DateTimeFormat(undefined, { dateStyle: "medium", timeZone: "UTC" }).format(value);
}

export function TrendChart({ report, metric }: { report: StatsReport; metric: TrendMetric }) {
  const host = useRef<HTMLDivElement>(null);
  const chart = useRef<ReturnType<typeof init> | null>(null);
  const rows = report.trend;
  const meta = metric === "accuracyPct"
    ? { label: "Daily accuracy", unit: "%", color: "#61A9BD", format: (value: number) => `${value.toFixed(2)}%` }
    : metric === "evLostPer1000"
      ? { label: "EV loss per 1,000 hands", unit: "coins / 1,000 hands", color: "#E98E2E", format: (value: number) => formatCoinValue(value) }
      : { label: "As-drilled return", unit: "%", color: "#44986D", format: (value: number) => `${value.toFixed(3)}%` };

  useEffect(() => {
    const node = host.current;
    if (!node || !rows.length) return;
    chart.current?.dispose();
    const instance = init(node, undefined, { renderer: "svg" });
    chart.current = instance;
    const option: EChartsOption = {
      animationDuration: 280,
      grid: { left: 68, right: 22, top: 18, bottom: 42 },
      tooltip: {
        trigger: "axis",
        axisPointer: { type: "line" },
        formatter: (input: unknown) => {
          const first = Array.isArray(input) ? input[0] as { value?: unknown } : input as { value?: unknown } | null;
          if (!first || !Array.isArray(first.value) || first.value.length < 2) return "";
          const at = Number(first.value[0]);
          const value = Number(first.value[1]);
          if (!Number.isFinite(at) || !Number.isFinite(value)) return "";
          return `${fullDay(at)}<br />${meta.label}: ${meta.format(value)}`;
        },
      },
      xAxis: {
        type: "time",
        axisLabel: { color: "#6e7a72", hideOverlap: true, formatter: "{MMM} {d}, {yyyy}" },
        axisLine: { lineStyle: { color: "#cbd4ca" } },
      },
      yAxis: {
        type: "value",
        scale: true,
        name: meta.unit,
        nameTextStyle: { color: "#6e7a72", fontSize: 10 },
        axisLabel: {
          color: "#6e7a72",
          formatter: (value: number) => meta.unit === "%"
            ? `${value}%`
            : metric === "evLostPer1000" ? formatCoinValue(value).replace(/ coins$/, "") : `${value}`,
        },
        splitLine: { lineStyle: { color: "#e4e8df" } },
      },
      series: [{
        name: meta.label,
        type: "line",
        showSymbol: rows.length < 10,
        symbolSize: 7,
        connectNulls: false,
        data: rows.map(row => [row.at, row[metric]]),
        lineStyle: { width: 2.5, color: meta.color },
        itemStyle: { color: meta.color },
      }],
    };
    instance.setOption(option);
    const observer = new ResizeObserver(() => instance.resize());
    observer.observe(node);
    return () => {
      observer.disconnect();
      instance.dispose();
      if (chart.current === instance) chart.current = null;
    };
  }, [rows, metric, meta.label, meta.unit, meta.color]);

  return <div ref={host} className="stats-chart" role="img" aria-label={`${meta.label} by UTC day. The accessible data table below contains every recorded day.`} />;
}

export function WeaknessRankingChart({ categories, familyId }: { categories: CategoryStats[]; familyId: StatsReport["familyId"] }) {
  const host = useRef<HTMLDivElement>(null);
  const chart = useRef<ReturnType<typeof init> | null>(null);
  const total = categories.filter(category => category.n > 0 && category.weakness > 0).length;
  const ranked = useMemo(() => categories.filter(category => category.n > 0 && category.weakness > 0).slice(0, 10), [categories]);
  const chartHeight = Math.max(164, ranked.length * 40 + 22);
  const names = useMemo(() => ranked.map(category => labelFor(category.label, familyId)), [ranked, familyId]);

  useEffect(() => {
    const node = host.current;
    if (!node || !ranked.length) return;
    chart.current?.dispose();
    const instance = init(node, undefined, { renderer: "svg" });
    chart.current = instance;
    const option: EChartsOption = {
      animationDuration: 260,
      grid: { left: 168, right: 92, top: 12, bottom: 26 },
      tooltip: {
        trigger: "axis",
        axisPointer: { type: "shadow" },
        formatter: (input: unknown) => {
          const first = Array.isArray(input) ? input[0] as { dataIndex?: number } : input as { dataIndex?: number } | null;
          const row = first && typeof first.dataIndex === "number" ? ranked[first.dataIndex] : undefined;
          if (!row) return "";
          return `${labelFor(row.label, familyId)}<br />Engine weakness: ${formatCoinValue(row.weakness)} per real hand<br />Observed decisions: ${row.n}`;
        },
      },
      xAxis: {
        type: "value",
        min: 0,
        name: "coins / real hand",
        nameLocation: "middle",
        nameGap: 23,
        nameTextStyle: { color: "#6e7a72", fontSize: 9 },
        axisLabel: { color: "#6e7a72", formatter: (value: number) => formatCoinValue(value).replace(/ coins$/, "") },
        axisLine: { lineStyle: { color: "#cbd4ca" } },
        splitLine: { lineStyle: { color: "#e4e8df" } },
      },
      yAxis: {
        type: "category",
        data: names,
        inverse: true,
        axisLabel: { color: "#526259", width: 148, overflow: "truncate", fontSize: 10 },
        axisLine: { lineStyle: { color: "#cbd4ca" } },
      },
      series: [{
        name: "Engine weakness",
        type: "bar",
        data: ranked.map(category => category.weakness),
        barMaxWidth: 22,
        itemStyle: { color: "#61A9BD", borderRadius: [0, 3, 3, 0] },
        label: {
          show: true,
          position: "right",
          color: "#385447",
          fontSize: 9,
          formatter: (input: unknown) => {
            const value = input && typeof input === "object" && "value" in input ? Number(input.value) : NaN;
            return Number.isFinite(value) ? formatCoinValue(value) : "";
          },
        },
      }],
    };
    instance.setOption(option);
    const observer = new ResizeObserver(() => instance.resize());
    observer.observe(node);
    return () => {
      observer.disconnect();
      instance.dispose();
      if (chart.current === instance) chart.current = null;
    };
  }, [ranked, names, familyId]);

  return <div className="stats-weakness-chart-block">
    {ranked.length ? <>
      <p className="stats-chart-disclosure">Showing top {ranked.length} of {total} positive observed categories. Values are engine-supplied weakness in coins per real hand; no EV or weakness values are derived in the interface.</p>
      <div ref={host} className="stats-weakness-chart" style={{ height: chartHeight }} role="img" aria-label={`Horizontal bars, top ${ranked.length} of ${total} positive observed categories, ranked by engine-supplied weakness in coins per real hand. The table below is an accessible data alternative.`} />
      <details className="stats-data-details"><summary>View weakness chart data table ({ranked.length} shown)</summary><div className="table-scroll"><table className="stats-table"><caption>Top {ranked.length} of {total} positive observed categories · engine-supplied weakness</caption><thead><tr><th scope="col">Optimal category</th><th scope="col">Decisions</th><th scope="col">Weakness (coins / real hand)</th></tr></thead><tbody>{ranked.map(category => <tr key={category.label}><th scope="row">{labelFor(category.label, familyId)}</th><td>{category.n}</td><td>{formatCoinValue(category.weakness)}</td></tr>)}</tbody></table></div></details>
    </> : <div className="stats-chart-empty">No positive observed weakness scores in this scope. Unsampled categories have unknown costs and are not plotted.</div>}
  </div>;
}
