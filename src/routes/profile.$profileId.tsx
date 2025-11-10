// app/routes/profile.$profileId.tsx
import { createFileRoute, Link } from '@tanstack/react-router';
import { useQuery, useAction } from 'convex/react';
import { api } from '../../convex/_generated/api';
import { useEffect, useMemo, useRef, useState } from 'react';

// Recharts
import {
  ResponsiveContainer,
  BarChart, Bar,
  LineChart, Line,
  XAxis, YAxis, CartesianGrid, Tooltip, Legend, LabelList,
} from 'recharts';

const CHART_MARGINS = { top: 32, right: 64, bottom: 40, left: 24 };
const SPEND_COLOR = '#f97316'; // orange-500
const SALES_COLOR = '#0ea5e9'; // sky-500
const CVR_COLOR   = '#2563eb'; // blue-600
const ACOS_COLOR  = '#16a34a'; // green-600
const CPC_COLOR   = '#f59e0b'; // amber-500

export const Route = createFileRoute('/profile/$profileId')({
  component: ProfileDashboard,
});

function formatMoney(major: number, currencyCode?: string, digits: number = 2) {
  const amt = Number(major || 0);
  try {
    return new Intl.NumberFormat(undefined, {
      style: 'currency',
      currency: currencyCode || 'USD',
      minimumFractionDigits: digits,
      maximumFractionDigits: digits,
    }).format(amt);
  } catch {
    return `${amt.toFixed(digits)} ${currencyCode || ''}`;
  }
}
const pct = (n: number) => `${(n * 100).toFixed(2)}%`;

type WeekRow = {
  label: string; startDate: string; endDate: string;
  reports: { sp?: string; sb?: string; sd?: string };
  impressions: number; clicks: number; spend: number; ppcSales: number; ppcOrders: number;
  campaignCount?: number; activeCampaignCount?: number;
};

function ProfileDashboard() {
  const { profileId } = Route.useParams();
  const profile = useQuery(api.profiles.getById, { profileId });

  const [portfolios, setPortfolios] = useState<any[]>([]);
  const [selectedPortfolio, setSelectedPortfolio] = useState<string>('');

  const [weeks, setWeeks] = useState<WeekRow[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [portfoliosLoading, setPortfoliosLoading] = useState(true);
  const [loadingMessage, setLoadingMessage] = useState('Requesting report from Amazon...');

  const fetchPortfolios = useAction(api.amazonAds.fetchPortfolios);
  const createFourWeekReports = useAction(api.amazonAds.createFourWeekReports);
  const checkAndDownloadReports = useAction(api.amazonAds.checkAndDownloadReports);

  // Build chart-ready rows from the table rows
  const chartData = useMemo(() => {
    if (!weeks) return [];
    return weeks.map(w => {
      const acos = w.ppcSales > 0 ? w.spend / w.ppcSales : 0;
      const cpc  = w.clicks   > 0 ? w.spend / w.clicks   : 0;
      const cvr  = w.clicks   > 0 ? w.ppcOrders / w.clicks : 0;
      return {
        label: w.label,
        spend: w.spend || 0,
        ppcSales: w.ppcSales || 0,
        clicks: w.clicks || 0,
        impressions: w.impressions || 0,
        acos,
        cpc,
        cvr,
      };
    });
  }, [weeks]);

  // Load portfolios
  useEffect(() => {
    const run = async () => {
      setPortfoliosLoading(true);
      try {
        const res = await fetchPortfolios({ profileId });
        if (res.success) setPortfolios(res.portfolios || []);
      } finally {
        setPortfoliosLoading(false);
      }
    };
    run();
  }, [profileId]);

  // Orchestrate: create → poll until all downloaded
  const pollTimer = useRef<any>(null);

  const startFlow = async () => {
    setLoading(true);
    setLoadingMessage('Creating reports...');
    setWeeks(null);

    try {
      const created = await createFourWeekReports({
        profileId,
        portfolioId: selectedPortfolio || undefined,
      });
      if (!created?.success) throw new Error('Failed to create reports');

      const initial: WeekRow[] = (created.weeks || []).map((w: any) => ({
        label: w.label,
        startDate: w.startDate,
        endDate: w.endDate,
        reports: w.reports || {}, // { sp?: id, sb?: id, sd?: id }
        impressions: 0,
        clicks: 0,
        spend: 0,
        ppcSales: 0,
        ppcOrders: 0,
        campaignCount: w.campaignCount,
        activeCampaignCount: w.activeCampaignCount,
      }));

      setWeeks(initial);

      // keep a mutable snapshot so the interval always sees the latest weeks
      let latestWeeks: WeekRow[] = initial;

      // clear any prior interval
      if (pollTimer.current) clearInterval(pollTimer.current);

      pollTimer.current = setInterval(async () => {
        try {
          setLoadingMessage('Waiting for Amazon to finish reports...');

          // Build polling list from the *latest* weeks, not the initial snapshot
          const entries: { reportId: string; type: 'sp' | 'sb' | 'sd' }[] = [];
          for (const w of latestWeeks) {
            if (w.reports.sp) entries.push({ reportId: w.reports.sp, type: 'sp' });
            if (w.reports.sb) entries.push({ reportId: w.reports.sb, type: 'sb' });
            if (w.reports.sd) entries.push({ reportId: w.reports.sd, type: 'sd' });
          }

          // If nothing left to poll, we're done
          if (entries.length === 0) {
            clearInterval(pollTimer.current);
            pollTimer.current = null;
            setLoading(false);
            setLoadingMessage('');
            return;
          }

          const res = await checkAndDownloadReports({ profileId, entries });

          if (res?.success && Array.isArray(res.results) && res.results.length) {
            // Fold results into state; remove report ids that have been consumed
            setWeeks(prev => {
              if (!prev) return prev;

              const next = prev.map(w => ({ ...w, reports: { ...w.reports } }));
              for (const r of res.results) {
                if (r.status === 'DOWNLOADED' && r.totals) {
                  const owner = next.find(w =>
                    w.reports.sp === r.reportId ||
                    w.reports.sb === r.reportId ||
                    w.reports.sd === r.reportId
                  );
                  if (owner) {
                    owner.impressions += Number(r.totals.impressions || 0);
                    owner.clicks     += Number(r.totals.clicks || 0);
                    owner.spend      += Number(r.totals.cost || 0);   // major units
                    owner.ppcSales   += Number(r.totals.sales || 0);  // major units
                    owner.ppcOrders  += Number(r.totals.orders || 0);

                    if (owner.reports.sp === r.reportId) delete owner.reports.sp;
                    if (owner.reports.sb === r.reportId) delete owner.reports.sb;
                    if (owner.reports.sd === r.reportId) delete owner.reports.sd;
                  }
                }
              }
              latestWeeks = next; // update snapshot for next tick
              return next;
            });

            // completion check on latest snapshot
            const allDone =
              latestWeeks.length > 0 &&
              latestWeeks.every(w => !w.reports.sp && !w.reports.sb && !w.reports.sd);

            if (allDone) {
              clearInterval(pollTimer.current);
              pollTimer.current = null;
              setLoading(false);
              setLoadingMessage('');
            }
          }
        } catch (err) {
          // transient issues (e.g., S3 hiccup) — keep polling
          console.warn('[poll] transient error:', (err as any)?.message || err);
        }
      }, 4000); // gentle cadence
    } catch (e: any) {
      console.error(e);
      setWeeks([]);
      setLoading(false);
      setLoadingMessage('');
    }
  };

  // start on mount / when portfolio changes
  useEffect(() => {
    startFlow();
    return () => { if (pollTimer.current) clearInterval(pollTimer.current); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [profileId, selectedPortfolio]);

  // progress wording
  useEffect(() => {
    if (!loading) return;
    const msgs = ['Creating reports...', 'Waiting for Amazon...', 'Processing data...', 'Almost there...', 'Finalizing...'];
    let i = 0;
    const t = setInterval(() => {
      i = (i + 1) % msgs.length;
      setLoadingMessage(msgs[i]);
    }, 4000);
    return () => clearInterval(t);
  }, [loading]);

  // ✅ Table complete once no week has pending report ids
  const allFilled = useMemo(() => {
    if (!weeks || loading) return false;
    return weeks.every(w => !w.reports || Object.keys(w.reports).length === 0);
  }, [weeks, loading]);

  if (!profile) return <div className="p-8">Loading profile...</div>;

  return (
    <div className="p-8 max-w-6xl mx-auto">
      {/* Header */}
      <div className="mb-6">
        <Link to="/" className="text-blue-600 hover:underline text-sm mb-2 inline-block">
          ← Back to Profiles
        </Link>
        <div className="flex justify-between items-start">
          <div>
            <h1 className="text-3xl font-bold">{profile.accountName}</h1>
            <p className="text-gray-600 mt-1">
              {profile.accountType} • {profile.countryCode} • {profile.currencyCode}
              {profile.region && <span className="ml-2 px-2 py-0.5 bg-blue-100 text-blue-800 text-xs rounded">{profile.region}</span>}
            </p>
          </div>
        </div>
      </div>

      {/* Portfolio Selector */}
      <div className="mb-6 bg-white rounded-lg border p-4">
        <label className="block text-sm font-semibold mb-2">Filter by Portfolio:</label>
        {portfoliosLoading ? (
          <p className="text-gray-500 text-sm">Loading portfolios...</p>
        ) : (
          <select
            value={selectedPortfolio}
            onChange={(e) => setSelectedPortfolio(e.target.value)}
            disabled={loading}
            className="w-full md:w-96 px-4 py-2 border rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500 disabled:bg-gray-100 disabled:cursor-not-allowed"
          >
            <option value="">All Portfolios (Account Level)</option>
            {portfolios.map((p) => (
              <option key={p.portfolioId} value={p.portfolioId}>{p.name} ({p.state})</option>
            ))}
          </select>
        )}
        {portfolios.length === 0 && !portfoliosLoading && (
          <p className="text-sm text-gray-500 mt-2">No portfolios found for this profile.</p>
        )}
      </div>

      {/* Four-Week Grid */}
      <div className="bg-white rounded-lg border shadow">
        <div className="p-4 border-b bg-gray-50">
          <h2 className="text-xl font-semibold">Last 4 Weeks Performance</h2>
          {selectedPortfolio
            ? <p className="text-sm text-gray-600 mt-1">Showing data for: {portfolios.find(p => p.portfolioId === selectedPortfolio)?.name}</p>
            : <p className="text-sm text-gray-600 mt-1">Showing data for entire account</p>}
          {loading && <p className="text-xs text-gray-500 mt-1">{loadingMessage}</p>}
        </div>

        {!weeks ? (
          <div className="p-8 text-center">
            <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-600 mx-auto mb-4"></div>
            <p className="text-gray-700 font-medium">{loadingMessage}</p>
            <p className="text-sm text-gray-500 mt-2">We’ll update as each report finishes…</p>
          </div>
        ) : weeks.length === 0 ? (
          <div className="p-8 text-center text-gray-500">No data.</div>
        ) : (
          <div className="p-6 overflow-x-auto">
            <table className="w-full min-w-[820px]">
              <thead>
                <tr className="border-b bg-orange-50">
                  <th className="text-left py-3 px-4 font-semibold text-gray-700">Metric</th>
                  {weeks.map((w) => (
                    <th key={w.label} className="text-right py-3 px-4 font-semibold text-gray-700">
                      {w.label}
                      <div className="text-xs text-gray-500">{w.startDate} – {w.endDate}</div>
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                <tr className="border-b hover:bg-gray-50">
                  <td className="py-3 px-4 text-gray-900 bg-orange-50">Impressions</td>
                  {weeks.map(w => (
                    <td key={w.label + '-imp'} className="py-3 px-4 text-right text-lg font-bold">
                      {Number(w.impressions || 0).toLocaleString()}
                    </td>
                  ))}
                </tr>
                <tr className="border-b hover:bg-gray-50">
                  <td className="py-3 px-4 text-gray-900 bg-orange-50">Clicks</td>
                  {weeks.map(w => (
                    <td key={w.label + '-clk'} className="py-3 px-4 text-right text-lg font-bold">
                      {Number(w.clicks || 0).toLocaleString()}
                    </td>
                  ))}
                </tr>
                <tr className="border-b hover:bg-gray-50">
                  <td className="py-3 px-4 text-gray-900 bg-orange-50">PPC Spend</td>
                  {weeks.map(w => (
                    <td key={w.label + '-spend'} className="py-3 px-4 text-right text-lg font-bold">
                      {formatMoney(w.spend || 0, profile?.currencyCode, 2)}
                    </td>
                  ))}
                </tr>
                <tr className="border-b hover:bg-gray-50">
                  <td className="py-3 px-4 text-gray-900 bg-orange-50">PPC Sales</td>
                  {weeks.map(w => (
                    <td key={w.label + '-sales'} className="py-3 px-4 text-right text-lg font-bold">
                      {formatMoney(w.ppcSales || 0, profile?.currencyCode, 2)}
                    </td>
                  ))}
                </tr>
                <tr className="border-b hover:bg-gray-50">
                  <td className="py-3 px-4 text-gray-900 bg-orange-50">PPC Orders</td>
                  {weeks.map(w => (
                    <td key={w.label + '-orders'} className="py-3 px-4 text-right text-lg font-bold">
                      {Number(w.ppcOrders || 0).toLocaleString()}
                    </td>
                  ))}
                </tr>
                <tr className="border-b hover:bg-gray-50">
                  <td className="py-3 px-4 text-gray-900 bg-orange-50">ACOS</td>
                  {weeks.map(w => {
                    const acos = w.ppcSales > 0 ? w.spend / w.ppcSales : 0;
                    return <td key={w.label + '-acos'} className="py-3 px-4 text-right text-lg font-bold">{pct(acos)}</td>;
                  })}
                </tr>
                <tr className="border-b hover:bg-gray-50">
                  <td className="py-3 px-4 text-gray-900 bg-orange-50">Cost per Click</td>
                  {weeks.map(w => {
                    const cpc = w.clicks > 0 ? w.spend / w.clicks : 0;
                    return <td key={w.label + '-cpc'} className="py-3 px-4 text-right text-lg font-bold">{formatMoney(cpc, profile?.currencyCode, 2)}</td>;
                  })}
                </tr>
                <tr>
                  <td className="py-3 px-4 text-gray-900 bg-orange-50">Conversion Rate</td>
                  {weeks.map(w => {
                    const cvr = w.clicks > 0 ? w.ppcOrders / w.clicks : 0;
                    return <td key={w.label + '-cvr'} className="py-3 px-4 text-right text-lg font-bold">{pct(cvr)}</td>;
                  })}
                </tr>
              </tbody>
            </table>

            <div className="mt-4 pt-4 border-t text-sm text-gray-500">
              <p>✅ Reports are created instantly; we poll Amazon and fill each column as soon as it’s ready.</p>
            </div>
          </div>
        )}
      </div>

      {/* Charts — only render when table is fully filled */}
      {allFilled && weeks && (
        <div className="mt-8 space-y-8">
          {/* 1) PPC Spend vs PPC Sales */}
          <div className="bg-white rounded-lg border shadow mt-6 overflow-visible">
            <div className="p-4 border-b bg-gray-50">
              <h3 className="text-xl font-semibold">PPC Spend vs PPC Sales</h3>
            </div>
            <div className="p-4" style={{ overflow: 'visible' }}>
              <ResponsiveContainer width="100%" height={360}>
                <BarChart data={chartData} barCategoryGap={24} margin={CHART_MARGINS}>
                  <CartesianGrid strokeDasharray="3 6" vertical={false} />
                  <XAxis dataKey="label" interval={0} tick={{ fontSize: 12 }} />
                  <YAxis width={84} tickFormatter={(v: number) => formatMoney(v, profile?.currencyCode)} />
                  <Tooltip formatter={(v: number) => formatMoney(v, profile?.currencyCode)} />
                  <Legend verticalAlign="bottom" align="center" wrapperStyle={{ paddingTop: 8 }} />
                  <Bar dataKey="ppcSales" name="PPC Sales" fill={SALES_COLOR} radius={[6,6,0,0]}>
                    <LabelList
                      dataKey="ppcSales"
                      position="top"
                      content={(p: any) => {
                        const { x, y, value } = p;
                        if (x == null || y == null) return null;
                        return (
                          <text x={x} y={y - 6} textAnchor="middle" fontSize={12} fill="#374151">
                            {formatMoney(Number(value || 0), profile?.currencyCode)}
                          </text>
                        );
                      }}
                    />
                  </Bar>
                  <Bar dataKey="spend" name="PPC Spend" fill={SPEND_COLOR} radius={[6,6,0,0]}>
                    <LabelList
                      dataKey="spend"
                      position="top"
                      content={(p: any) => {
                        const { x, y, value } = p;
                        if (x == null || y == null) return null;
                        return (
                          <text x={x} y={y - 6} textAnchor="middle" fontSize={12} fill="#374151">
                            {formatMoney(Number(value || 0), profile?.currencyCode)}
                          </text>
                        );
                      }}
                    />
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            </div>
          </div>

          {/* 2) Conversion Rate (line) */}
          <div className="bg-white rounded-lg border shadow mt-6 overflow-visible">
            <div className="p-4 border-b bg-gray-50">
              <h3 className="text-xl font-semibold">Conversion Rate</h3>
            </div>
            <div className="p-4" style={{ overflow: 'visible' }}>
              <ResponsiveContainer width="100%" height={320}>
                <LineChart data={chartData} margin={CHART_MARGINS}>
                  <CartesianGrid strokeDasharray="3 6" vertical={false} />
                  <XAxis dataKey="label" tick={{ fontSize: 12 }} />
                  <YAxis width={64} domain={[0, 0.4]} tickFormatter={(v:number)=>`${(v*100).toFixed(2)}%`} />
                  <Tooltip formatter={(v:number)=>`${(v*100).toFixed(2)}%`} />
                  <Legend />
                  <Line type="monotone" dataKey="cvr" name="Conversion Rate" stroke={CVR_COLOR} strokeWidth={3} dot={{ r: 4 }} activeDot={{ r: 6 }} isAnimationActive={false}>
                    <LabelList
                      dataKey="cvr"
                      position="top"
                      content={(p:any)=>{
                        const { x, y, value } = p;
                        if (x==null || y==null) return null;
                        return <text x={x} y={y-6} textAnchor="middle" fontSize={12} fill="#374151">{`${(Number(value||0)*100).toFixed(2)}%`}</text>;
                      }}
                    />
                  </Line>
                </LineChart>
              </ResponsiveContainer>
            </div>
          </div>

          {/* 3) ACOS (line) */}
          <div className="bg-white rounded-lg border shadow mt-6 overflow-visible">
            <div className="p-4 border-b bg-gray-50">
              <h3 className="text-xl font-semibold">ACOS</h3>
            </div>
            <div className="p-4" style={{ overflow: 'visible' }}>
              <ResponsiveContainer width="100%" height={320}>
                <LineChart data={chartData} margin={CHART_MARGINS}>
                  <CartesianGrid strokeDasharray="3 6" vertical={false} />
                  <XAxis dataKey="label" tick={{ fontSize: 12 }} />
                  <YAxis width={64} domain={[0, 1]} tickFormatter={(v:number)=>`${(v*100).toFixed(0)}%`} />
                  <Tooltip formatter={(v:number)=>`${(v*100).toFixed(2)}%`} />
                  <Legend />
                  <Line type="monotone" dataKey="acos" name="ACOS" stroke={ACOS_COLOR} strokeWidth={3} dot={{ r: 4 }} activeDot={{ r: 6 }} isAnimationActive={false}>
                    <LabelList
                      dataKey="acos"
                      position="top"
                      content={(p:any)=>{
                        const { x, y, value } = p;
                        if (x==null || y==null) return null;
                        return <text x={x} y={y-6} textAnchor="middle" fontSize={12} fill="#374151">{`${(Number(value||0)*100).toFixed(2)}%`}</text>;
                      }}
                    />
                  </Line>
                </LineChart>
              </ResponsiveContainer>
            </div>
          </div>

          {/* 4) CPC (line) */}
          <div className="bg-white rounded-lg border shadow mt-6 overflow-visible">
            <div className="p-4 border-b bg-gray-50">
              <h3 className="text-xl font-semibold">Cost per Click</h3>
            </div>
            <div className="p-4" style={{ overflow: 'visible' }}>
              <ResponsiveContainer width="100%" height={320}>
                <LineChart data={chartData} margin={CHART_MARGINS}>
                  <CartesianGrid strokeDasharray="3 6" vertical={false} />
                  <XAxis dataKey="label" tick={{ fontSize: 12 }} />
                  <YAxis width={84} domain={['auto','auto']} tickFormatter={(v:number)=>formatMoney(v, profile?.currencyCode, 2)} />
                  <Tooltip formatter={(v:number)=>formatMoney(v, profile?.currencyCode, 2)} />
                  <Legend />
                  <Line type="monotone" dataKey="cpc" name="CPC" stroke={CPC_COLOR} strokeWidth={3} dot={{ r: 4 }} activeDot={{ r: 6 }} isAnimationActive={false}>
                    <LabelList
                      dataKey="cpc"
                      position="top"
                      content={(p:any)=>{
                        const { x, y, value } = p;
                        if (x==null || y==null) return null;
                        return <text x={x} y={y-6} textAnchor="middle" fontSize={12} fill="#374151">{formatMoney(Number(value||0), profile?.currencyCode, 2)}</text>;
                      }}
                    />
                  </Line>
                </LineChart>
              </ResponsiveContainer>
            </div>
          </div>

          {/* 5) Impressions (bars) */}
          <div className="bg-white rounded-lg border shadow mt-6 overflow-visible">
            <div className="p-4 border-b bg-gray-50">
              <h3 className="text-xl font-semibold">Impressions</h3>
            </div>
            <div className="p-4" style={{ overflow: 'visible' }}>
              <ResponsiveContainer width="100%" height={320}>
                <BarChart data={chartData} barSize={36} margin={CHART_MARGINS}>
                  <CartesianGrid strokeDasharray="3 6" vertical={false} />
                  <XAxis dataKey="label" tick={{ fontSize: 12 }} />
                  <YAxis width={84} tickFormatter={(v:number)=>Number(v).toLocaleString()} />
                  <Tooltip formatter={(v:number)=>Number(v).toLocaleString()} />
                  <Legend />
                  <Bar dataKey="impressions" name="Impressions" fill="#6b7280" radius={[6,6,0,0]}>
                    <LabelList
                      dataKey="impressions"
                      position="top"
                      content={(p:any)=>{
                        const { x, y, value } = p;
                        if (x==null || y==null) return null;
                        return <text x={x} y={y-6} textAnchor="middle" fontSize={12} fill="#374151">{Number(value||0).toLocaleString()}</text>;
                      }}
                    />
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            </div>
          </div>
        </div>
      )}

      {/* Refresh Button */}
      <div className="mt-6">
        <button
          onClick={() => startFlow()}
          disabled={loading}
          className="px-4 py-2 bg-blue-600 text-white rounded hover:bg-blue-700 disabled:bg-gray-400 disabled:cursor-not-allowed"
        >
          {loading ? 'Working…' : '🔄 Refresh Data'}
        </button>
        <p className="text-xs text-gray-500 mt-2">
          Uses major units and your account currency ({profile?.currencyCode}).
        </p>
      </div>
    </div>
  );
}

export default ProfileDashboard;
