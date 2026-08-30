import { BrainCircuit } from './Icons.jsx'
import {
  Area,
  AreaChart,
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Pie,
  PieChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts'

const CHART_COLORS = ['var(--chart-primary)', 'var(--chart-secondary)', 'var(--chart-tertiary)', 'var(--chart-quaternary)', 'var(--chart-muted)']

export default function StatsView({ stats }) {
  if (!stats) return <div className="skeleton-panel" />
  const totalMinutes = Math.round((stats.overview?.seconds || 0) / 60)
  const contextualRows = stats.recommendations?.algorithms?.filter((item) => item.algorithm.startsWith('sonora-context-v')) || []
  const contextualOutcomes = contextualRows.reduce((sum, item) => sum + Number(item.accepted || 0) + Number(item.skipped || 0), 0)
  const contextualMetrics = contextualRows.length ? {
    acceptanceRate: contextualOutcomes
      ? contextualRows.reduce((sum, item) => sum + Number(item.accepted || 0), 0) / contextualOutcomes
      : null,
  } : null
  const legacyMetrics = stats.recommendations?.algorithms?.find((item) => item.algorithm === 'legacy-mood-v1')

  return (
    <div className="stats-layout">
      <section className="stats-intro">
        <div>
          <span>Tu resumen</span>
          <h2>{totalMinutes.toLocaleString('es-ES')} minutos</h2>
          <p>de escucha privada, solo en este dispositivo.</p>
        </div>
        <div className="stats-facts">
          <span><strong>{stats.overview?.completedTracks || 0}</strong> canciones completas</span>
          <span><strong>{stats.overview?.activeDays || 0}</strong> días activos</span>
        </div>
      </section>
      <section className="recommendation-stats">
        <div className="recommendation-stats-copy">
          <BrainCircuit />
          <div>
            <h3>Calidad del recomendador</h3>
            <p>Se calcula con aceptaciones y saltos reales. Las explicaciones y puntuaciones se guardan junto a cada decisión.</p>
          </div>
        </div>
        <div className="recommendation-stat-row">
          <span>Aceptación contextual</span>
          <strong>{contextualMetrics?.acceptanceRate == null ? 'Sin datos' : `${Math.round(contextualMetrics.acceptanceRate * 100)}%`}</strong>
        </div>
        <div className="recommendation-stat-row">
          <span>Saltos antes de 30 s</span>
          <strong>{stats.recommendations?.listening?.earlySkipRate == null ? 'Sin datos' : `${Math.round(stats.recommendations.listening.earlySkipRate * 100)}%`}</strong>
        </div>
        <div className="recommendation-stat-row">
          <span>Descubrimientos aceptados</span>
          <strong>{stats.recommendations?.discovery?.acceptanceRate == null ? 'Sin datos' : `${Math.round(stats.recommendations.discovery.acceptanceRate * 100)}%`}</strong>
        </div>
        {legacyMetrics && contextualMetrics && (
          <div className="recommendation-comparison">
            <span>Comparación local</span>
            <strong>Contextual {Math.round((contextualMetrics.acceptanceRate || 0) * 100)}%</strong>
            <span>frente a Mood v1 {Math.round((legacyMetrics.acceptanceRate || 0) * 100)}%</span>
          </div>
        )}
      </section>
      <section className="chart-section chart-wide">
        <div className="section-heading"><div><h3>Ritmo de escucha</h3><p>Minutos durante los últimos 14 días.</p></div></div>
        <ResponsiveContainer width="100%" height={260}>
          <AreaChart data={stats.byDay}>
            <CartesianGrid vertical={false} stroke="rgba(255,255,255,.08)" />
            <XAxis dataKey="day" stroke="rgba(255,255,255,.45)" axisLine={false} tickLine={false} />
            <YAxis stroke="rgba(255,255,255,.45)" axisLine={false} tickLine={false} width={32} />
            <Tooltip contentStyle={{ background: 'oklch(0.19 0 0)', border: 'none', borderRadius: 8 }} />
            <Area type="monotone" dataKey="minutes" stroke="var(--chart-primary)" fill="var(--chart-area-fill)" strokeWidth={2} />
          </AreaChart>
        </ResponsiveContainer>
      </section>
      <section className="chart-section">
        <div className="section-heading"><div><h3>Artistas principales</h3><p>Por tiempo escuchado.</p></div></div>
        <ResponsiveContainer width="100%" height={260}>
          <BarChart data={stats.topArtists} layout="vertical">
            <XAxis type="number" hide />
            <YAxis dataKey="name" type="category" width={96} axisLine={false} tickLine={false} stroke="rgba(255,255,255,.62)" />
            <Tooltip cursor={{ fill: 'oklch(1 0 0 / 0.04)' }} contentStyle={{ background: 'oklch(0.19 0 0)', border: 'none', borderRadius: 8 }} />
            <Bar dataKey="minutes" fill="var(--chart-primary)" radius={[0, 3, 3, 0]} />
          </BarChart>
        </ResponsiveContainer>
      </section>
      <section className="chart-section">
        <div className="section-heading"><div><h3>Ambientes</h3><p>Cómo se reparte tu escucha.</p></div></div>
        <ResponsiveContainer width="100%" height={260}>
          <PieChart>
            <Pie data={stats.moods} dataKey="minutes" nameKey="name" innerRadius={62} outerRadius={96} paddingAngle={2}>
              {stats.moods.map((entry, index) => <Cell key={entry.name} fill={CHART_COLORS[index % CHART_COLORS.length]} />)}
            </Pie>
            <Tooltip contentStyle={{ background: 'oklch(0.19 0 0)', border: 'none', borderRadius: 8 }} />
          </PieChart>
        </ResponsiveContainer>
      </section>
      <section className="ranking-section">
        <div className="section-heading"><div><h3>Álbumes que más vuelven</h3><p>Tu rotación personal.</p></div></div>
        {stats.topAlbums.map((album, index) => (
          <div className="ranking-row" key={`${album.name}-${album.artist}`}>
            <span>{String(index + 1).padStart(2, '0')}</span>
            <strong>{album.name}</strong>
            <small>{album.artist}</small>
            <b>{album.minutes} min</b>
          </div>
        ))}
      </section>
    </div>
  )
}
