'use client';
import * as React from 'react';
import {
  Area,
  AreaChart,
  Bar,
  BarChart,
  CartesianGrid,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip as RTooltip,
  XAxis,
  YAxis,
} from 'recharts';
import { BarChart3, Table2 } from 'lucide-react';
import { cn } from '../lib/cn';
import { Card } from './card';

export interface ChartSeries {
  key: string;
  label: string;
  tone?: 'blue' | 'gold' | 'red' | 'ink';
}

const toneColor = {
  blue: 'var(--chart-blue)',
  gold: 'var(--chart-gold)',
  red: 'var(--chart-red)',
  ink: 'var(--chart-ink)',
};
const toneDash = { blue: undefined, gold: '6 3', red: '2 3', ink: '10 4' };

export interface ChartProps {
  title: string;
  /** Plain-language summary of what the chart shows (required for accessibility). */
  summary: string;
  data: Array<Record<string, string | number>>;
  xKey: string;
  series: ChartSeries[];
  kind?: 'bar' | 'line' | 'area';
  height?: number;
  formatValue?: (v: number) => string;
  labels?: { chart: string; table: string; view: string };
  className?: string;
}

/**
 * Chart wrapper with a text summary and a chart/table toggle so the data
 * is never available only visually. Chart series differ by pattern (dash) as well as colour.
 */
export function ChartCard({
  title,
  summary,
  data,
  xKey,
  series,
  kind = 'bar',
  height = 260,
  formatValue = (v) => String(v),
  labels = { chart: 'Chart', table: 'Table', view: 'View as' },
  className,
}: ChartProps) {
  const [view, setView] = React.useState<'chart' | 'table'>('chart');
  const headingId = React.useId();
  const descId = React.useId();
  const common = {
    data,
    margin: { top: 8, right: 8, bottom: 0, left: -8 },
  };
  const axis = (
    <>
      <CartesianGrid stroke="var(--chart-grid)" vertical={false} />
      <XAxis
        dataKey={xKey}
        tickLine={false}
        axisLine={{ stroke: 'var(--line-strong)' }}
        tick={{ fill: 'var(--chart-axis)', fontSize: 12 }}
      />
      <YAxis
        tickLine={false}
        axisLine={false}
        tick={{ fill: 'var(--chart-axis)', fontSize: 12 }}
        width={44}
        tickFormatter={(v: number) => formatValue(v)}
      />
      <RTooltip
        formatter={(v) => formatValue(Number(v))}
        contentStyle={{
          borderRadius: 10,
          border: '1px solid var(--line)',
          boxShadow: 'var(--shadow-md)',
          background: 'var(--surface)',
          fontSize: 13,
        }}
        cursor={{ fill: 'var(--ivory-200)', opacity: 0.6 }}
      />
    </>
  );
  return (
    <Card
      aria-labelledby={headingId}
      aria-describedby={descId}
      as="section"
      accent="blue"
      className={cn('enter-fade', className)}
    >
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <h3 id={headingId} className="font-display text-lg font-semibold text-ink">
            {title}
          </h3>
          <p id={descId} className="mt-0.5 max-w-prose text-sm text-muted">
            {summary}
          </p>
        </div>
        <div
          role="group"
          aria-label={labels.view}
          className="inline-flex rounded-md border border-line-strong bg-ivory-100 p-0.5"
        >
          {(['chart', 'table'] as const).map((v) => (
            <button
              key={v}
              type="button"
              aria-pressed={view === v}
              onClick={() => setView(v)}
              className={cn(
                'inline-flex min-h-9 items-center gap-1.5 rounded px-2.5 text-[0.8125rem] font-medium',
                view === v ? 'bg-surface text-ink shadow-xs' : 'text-muted hover:text-ink',
              )}
            >
              {v === 'chart' ? (
                <BarChart3 className="size-3.5" aria-hidden="true" />
              ) : (
                <Table2 className="size-3.5" aria-hidden="true" />
              )}
              {v === 'chart' ? labels.chart : labels.table}
            </button>
          ))}
        </div>
      </div>

      <div className="mt-4">
        {view === 'chart' ? (
          <div style={{ height }} role="img" aria-label={`${title}. ${summary}`}>
            <ResponsiveContainer width="100%" height="100%" minWidth={0}>
              {kind === 'bar' ? (
                <BarChart {...common}>
                  {axis}
                  {series.map((s) => (
                    <Bar
                      key={s.key}
                      dataKey={s.key}
                      name={s.label}
                      fill={toneColor[s.tone ?? 'blue']}
                      radius={[4, 4, 0, 0]}
                      maxBarSize={36}
                      isAnimationActive={false}
                    />
                  ))}
                </BarChart>
              ) : kind === 'line' ? (
                <LineChart {...common}>
                  {axis}
                  {series.map((s) => (
                    <Line
                      key={s.key}
                      type="monotone"
                      dataKey={s.key}
                      name={s.label}
                      stroke={toneColor[s.tone ?? 'blue']}
                      strokeDasharray={toneDash[s.tone ?? 'blue']}
                      strokeWidth={2.25}
                      dot={{ r: 3 }}
                      isAnimationActive={false}
                    />
                  ))}
                </LineChart>
              ) : (
                <AreaChart {...common}>
                  {axis}
                  {series.map((s) => (
                    <Area
                      key={s.key}
                      type="monotone"
                      dataKey={s.key}
                      name={s.label}
                      stroke={toneColor[s.tone ?? 'blue']}
                      fill={toneColor[s.tone ?? 'blue']}
                      fillOpacity={0.12}
                      strokeWidth={2.25}
                      isAnimationActive={false}
                    />
                  ))}
                </AreaChart>
              )}
            </ResponsiveContainer>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm">
              <caption className="sr-only">{title}</caption>
              <thead>
                <tr className="border-b border-line text-xs tracking-wide text-muted uppercase">
                  <th scope="col" className="py-2 pr-4 font-semibold">
                    {xKey}
                  </th>
                  {series.map((s) => (
                    <th key={s.key} scope="col" className="py-2 pr-4 text-right font-semibold">
                      {s.label}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-line">
                {data.map((row, i) => (
                  <tr key={i}>
                    <th scope="row" className="py-2 pr-4 font-medium text-ink">
                      {String(row[xKey])}
                    </th>
                    {series.map((s) => (
                      <td key={s.key} className="tabular py-2 pr-4 text-right">
                        {formatValue(Number(row[s.key]))}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
      {view === 'chart' && (
        <ul
          className="mt-3 flex flex-wrap gap-x-4 gap-y-1 text-[0.8125rem] text-ink-700"
          aria-label="Legend"
        >
          {series.map((s) => (
            <li key={s.key} className="inline-flex items-center gap-1.5">
              <svg aria-hidden="true" width="18" height="8">
                <line
                  x1="0"
                  y1="4"
                  x2="18"
                  y2="4"
                  stroke={toneColor[s.tone ?? 'blue']}
                  strokeWidth="3"
                  strokeDasharray={toneDash[s.tone ?? 'blue']}
                />
              </svg>
              {s.label}
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}
