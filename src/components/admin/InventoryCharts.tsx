"use client";

import {
  Bar,
  BarChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import type { DashboardStats } from "@/lib/admin-queries";

const AXIS = { fill: "rgb(var(--paper) / 0.55)", fontSize: 12 };

function ChartCard({
  title,
  children,
}: {
  title: string;
  children: React.ReactNode;
}) {
  return (
    <div className="card p-5">
      <h3 className="mb-4 text-sm font-semibold text-paper/80">{title}</h3>
      <div className="h-56">{children}</div>
    </div>
  );
}

function TooltipBox({
  active,
  payload,
  label,
}: {
  active?: boolean;
  payload?: { value?: number | string; name?: string }[];
  label?: string;
}) {
  if (!active || !payload?.length) return null;
  return (
    <div className="rounded-lg border border-white/10 bg-ink px-3 py-2 text-xs text-paper shadow-lg">
      {label && <p className="mb-1 font-medium">{label}</p>}
      {payload.map((p, i) => (
        <p key={i} className="text-paper/70">
          {p.name}: <span className="font-semibold text-paper">{p.value}</span>
        </p>
      ))}
    </div>
  );
}

export function InventoryCharts({ stats }: { stats: DashboardStats }) {
  return (
    <div className="grid gap-5 lg:grid-cols-2">
      <ChartCard title="Vendas (últimos 6 meses)">
        <ResponsiveContainer width="100%" height="100%">
          <BarChart data={stats.salesByMonth}>
            <XAxis dataKey="name" tick={AXIS} axisLine={false} tickLine={false} />
            <YAxis
              tick={AXIS}
              axisLine={false}
              tickLine={false}
              allowDecimals={false}
              width={24}
            />
            <Tooltip
              content={<TooltipBox />}
              cursor={{ fill: "rgba(255,255,255,0.04)" }}
            />
            <Bar dataKey="vendidos" radius={[6, 6, 0, 0]} fill="#E8B15A" />
          </BarChart>
        </ResponsiveContainer>
      </ChartCard>

      <ChartCard title="Viaturas por marca">
        <ResponsiveContainer width="100%" height="100%">
          <BarChart data={stats.byMake} layout="vertical" margin={{ left: 8 }}>
            <XAxis
              type="number"
              tick={AXIS}
              axisLine={false}
              tickLine={false}
              allowDecimals={false}
            />
            <YAxis
              type="category"
              dataKey="name"
              tick={AXIS}
              axisLine={false}
              tickLine={false}
              width={90}
            />
            <Tooltip
              content={<TooltipBox />}
              cursor={{ fill: "rgba(255,255,255,0.04)" }}
            />
            <Bar dataKey="value" radius={[0, 6, 6, 0]} fill="#6C8EBF" />
          </BarChart>
        </ResponsiveContainer>
      </ChartCard>

      <ChartCard title="Faixas de preço">
        <ResponsiveContainer width="100%" height="100%">
          <BarChart data={stats.byPriceBand}>
            <XAxis dataKey="name" tick={AXIS} axisLine={false} tickLine={false} />
            <YAxis
              tick={AXIS}
              axisLine={false}
              tickLine={false}
              allowDecimals={false}
              width={24}
            />
            <Tooltip
              content={<TooltipBox />}
              cursor={{ fill: "rgba(255,255,255,0.04)" }}
            />
            <Bar dataKey="value" radius={[6, 6, 0, 0]} fill="#7FB285" />
          </BarChart>
        </ResponsiveContainer>
      </ChartCard>
    </div>
  );
}
