import { action, mutation, query } from "./_generated/server";
import { v } from "convex/values";
import { api } from "./_generated/api";
import { inflate } from "pako";
import { Doc, Id } from "./_generated/dataModel";

/** ================= TYPES ================= */
type AdType = "sp" | "sb" | "sd";
type Period = "weekly" | "monthly";

interface Totals {
  impressions: number; clicks: number; cost: number; sales: number; orders: number;
}

/** ================= REGION CONFIG ================= */
const REGION_CONFIG = {
  NA: { tokenUrl: "https://api.amazon.com/auth/o2/token", apiUrl: "https://advertising-api.amazon.com" },
  EU: { tokenUrl: "https://api.amazon.co.uk/auth/o2/token", apiUrl: "https://advertising-api-eu.amazon.com" },
  FE: { tokenUrl: "https://api.amazon.co.jp/auth/o2/token", apiUrl: "https://advertising-api-fe.amazon.com" },
} as const;

/** ================= HELPERS ================= */
function toYmd(d: Date): string { return d.toISOString().split("T")[0]; }
const monthShort = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];
const monthFull = ["January","February","March","April","May","June","July","August","September","October","November","December"];
function ordinal(n:number){const s=["th","st","nd","rd"],v=n%100;return n+((s[(v-20)%10]||s[v])||s[0]);}

function formatLabel(s: Date, e: Date, period: Period){
  if (period === 'monthly') {
    if (s.getDate() === 1) return `${monthFull[s.getMonth()]} ${s.getFullYear()}`;
    return `${monthShort[s.getMonth()]} ${s.getDate()} - ${monthShort[e.getMonth()]} ${e.getDate()}`;
  }
  const sDay = ordinal(s.getDate()), eDay = ordinal(e.getDate());
  const sMon = monthShort[s.getMonth()], eMon = monthShort[e.getMonth()];
  return `${sDay} ${sMon} – ${eDay} ${eMon}`;
}

function buildWeeklyWindows(today = new Date()){
  const end = new Date(today.getFullYear(), today.getMonth(), today.getDate() - 1);
  const windows: Array<{startStr:string; endStr:string; label:string}> = [];
  let cursorEnd = end;
  for (let i=0;i<4;i++){
    const start = new Date(cursorEnd); start.setDate(cursorEnd.getDate() - 6);
    windows.push({ startStr: toYmd(start), endStr: toYmd(cursorEnd), label: formatLabel(start, cursorEnd, 'weekly') });
    const prevEnd = new Date(start); prevEnd.setDate(start.getDate() - 1);
    cursorEnd = prevEnd;
  }
  return windows.reverse();
}

function buildMonthlyWindows(today = new Date()){
  const windows: Array<{startStr:string; endStr:string; label:string}> = [];
  const yesterday = new Date(today.getFullYear(), today.getMonth(), today.getDate() - 1);
  const startCurrent = new Date(yesterday.getFullYear(), yesterday.getMonth(), 1);
  
  if (yesterday >= startCurrent) {
     windows.push({ startStr: toYmd(startCurrent), endStr: toYmd(yesterday), label: formatLabel(startCurrent, yesterday, 'monthly') });
  }

  const lastMonthEnd = new Date(startCurrent); 
  lastMonthEnd.setDate(0); 
  const lastMonthStart = new Date(lastMonthEnd.getFullYear(), lastMonthEnd.getMonth(), 1);

  windows.push({ startStr: toYmd(lastMonthStart), endStr: toYmd(lastMonthEnd), label: formatLabel(lastMonthStart, lastMonthEnd, 'monthly') });

  return windows.reverse(); 
}

/** ================= OAUTH & API HELPERS ================= */
async function getAccessToken(region: "NA" | "EU" | "FE") {
  const refreshToken = process.env.AMAZON_REFRESH_TOKEN!;
  const clientId     = process.env.AMAZON_CLIENT_ID!;
  const clientSecret = process.env.AMAZON_CLIENT_SECRET!;
  const tokenUrl = REGION_CONFIG[region].tokenUrl;

  const res = await fetch(tokenUrl, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ grant_type: "refresh_token", refresh_token: refreshToken, client_id: clientId, client_secret: clientSecret }),
  });

  if (!res.ok) throw new Error(`Failed to refresh token: ${await res.text()}`);
  const data = await res.json();
  return (data.access_token as string)?.trim();
}

async function downloadAndAggregate(url: string, type: AdType): Promise<Totals> {
  const r = await fetch(url);
  if (!r.ok) throw new Error(`Download failed ${r.status}`);
  const buf = new Uint8Array(await r.arrayBuffer());
  let json: any;
  if (buf.length >= 2 && buf[0] === 0x1f && buf[1] === 0x8b) {
    json = JSON.parse(inflate(buf, { to: "string" }));
  } else {
    json = JSON.parse(new TextDecoder().decode(buf));
  }
  const arr: any[] = Array.isArray(json) ? json : (json.records || json.data || []);

  let impressions = 0, clicks = 0, cost = 0, sales = 0, orders = 0;
  for (const rec of arr) {
    impressions += Number(rec.impressions || 0);
    clicks     += Number(rec.clicks || 0);
    cost       += Number(rec.cost || 0);
    if (type === "sp" || type === "sd") {
      sales  += Number(rec.sales14d || rec.attributedSales14d || 0);
      orders += Number(rec.purchases14d || rec.attributedConversions14d || 0);
    } else if (type === "sb") {
      sales  += Number(rec.sales || 0);
      orders += Number(rec.purchases || 0);
    }
  }
  return { impressions, clicks, cost, sales, orders };
}

/** ================= DB QUERIES & MUTATIONS ================= */

export const getSnapshots = query({
  args: { 
    profileId: v.string(), 
    portfolioId: v.optional(v.string()),
    period: v.union(v.literal("weekly"), v.literal("monthly")) 
  },
  handler: async (ctx, args) => {
    if (!args.portfolioId) return [];
    return await ctx.db
      .query("adSnapshots")
      .withIndex("by_profile_portfolio_period", (q) => 
        q.eq("profileId", args.profileId)
         .eq("portfolioId", args.portfolioId!)
         .eq("period", args.period)
      )
      .collect();
  }
});

export const saveReportIds = mutation({
  args: {
    snapshotId: v.id("adSnapshots"),
    reportIds: v.object({ sp: v.optional(v.string()), sb: v.optional(v.string()), sd: v.optional(v.string()) }),
  },
  handler: async (ctx, args) => {
    await ctx.db.patch(args.snapshotId, { status: "PENDING", reportIds: args.reportIds, updatedAt: Date.now() });
  }
});

export const completeSnapshot = mutation({
  args: {
    snapshotId: v.id("adSnapshots"),
    data: v.object({ impressions: v.number(), clicks: v.number(), spend: v.number(), sales: v.number(), orders: v.number() }),
  },
  handler: async (ctx, args) => {
    await ctx.db.patch(args.snapshotId, { status: "COMPLETED", data: args.data, updatedAt: Date.now() });
  }
});

export const resetSnapshots = mutation({
  args: { profileId: v.string(), portfolioId: v.string(), period: v.union(v.literal("weekly"), v.literal("monthly")) },
  handler: async (ctx, args) => {
    const existing = await ctx.db
      .query("adSnapshots")
      .withIndex("by_profile_portfolio_period", (q) => 
        q.eq("profileId", args.profileId)
         .eq("portfolioId", args.portfolioId)
         .eq("period", args.period)
      )
      .collect();
    
    for (const row of existing) await ctx.db.delete(row._id);
  }
});

// === UPDATED: NOW IDEMPOTENT ===
// This prevents creating a duplicate row if one already exists for the same startDate
export const createSnapshotStub = mutation({
  args: { 
    profileId: v.string(), portfolioId: v.string(), 
    startDate: v.string(), endDate: v.string(), label: v.string(),
    period: v.union(v.literal("weekly"), v.literal("monthly")) 
  },
  handler: async (ctx, args) => {
    // 1. Check if it exists
    const existing = await ctx.db
      .query("adSnapshots")
      .withIndex("by_profile_portfolio_period", q => 
         q.eq("profileId", args.profileId)
          .eq("portfolioId", args.portfolioId)
          .eq("period", args.period)
      )
      .filter(q => q.eq(q.field("startDate"), args.startDate))
      .first();

    if (existing) {
      // 2. If exists, just return its ID (don't create a new one)
      return existing._id;
    }

    // 3. If not, create new
    return await ctx.db.insert("adSnapshots", {
      profileId: args.profileId,
      portfolioId: args.portfolioId,
      period: args.period,
      startDate: args.startDate,
      endDate: args.endDate,
      label: args.label,
      status: "INIT",
      reportIds: {},
      data: { impressions:0, clicks:0, spend:0, sales:0, orders:0 },
      updatedAt: Date.now()
    });
  }
});

/** ================= MAIN ACTIONS ================= */

export const syncAds = action({
  args: { 
    profileId: v.string(), 
    portfolioId: v.string(),
    period: v.union(v.literal("weekly"), v.literal("monthly"))
  },
  handler: async (ctx, args) => {
    const existing: Doc<"adSnapshots">[] = await ctx.runQuery(api.amazonAds.getSnapshots, { 
      profileId: args.profileId, 
      portfolioId: args.portfolioId,
      period: args.period
    });

    const windows = args.period === 'weekly' ? buildWeeklyWindows() : buildMonthlyWindows();
    const missingWindows = windows.filter(w => 
      !existing.find(e => e.startDate === w.startStr && e.endDate === w.endStr)
    );

    if (missingWindows.length === 0) return { success: true, message: "Data up to date" };

    const profile = await ctx.runQuery(api.profiles.getById, { profileId: args.profileId });
    if (!profile) throw new Error("Profile not found");
    const region = (profile.region || "NA") as "NA"|"EU"|"FE";
    const clientId = process.env.AMAZON_CLIENT_ID!;
    const accessToken = await getAccessToken(region);
    const apiUrl = REGION_CONFIG[region].apiUrl;

    // === ROBUST REQUEST FUNCTION WITH RETRY ===
    const requestReport = async (type: AdType, start: string, end: string, attempt = 1): Promise<string | null> => {
      const body = {
        name: `${type.toUpperCase()} ${start}-${end}`,
        startDate: start, endDate: end,
        configuration: {
          adProduct: type === "sp" ? "SPONSORED_PRODUCTS" : type === "sb" ? "SPONSORED_BRANDS" : "SPONSORED_DISPLAY",
          groupBy: ["campaign"],
          columns: type === "sp" ? ["impressions","clicks","cost","sales14d","purchases14d"] : ["impressions","clicks","cost"],
          reportTypeId: type === "sp" ? "spCampaigns" : type === "sb" ? "sbCampaigns" : "sdCampaigns",
          timeUnit: "SUMMARY", format: "GZIP_JSON",
        },
      };

      try {
        const res = await fetch(`${apiUrl}/reporting/reports`, {
          method: "POST",
          headers: {
            "Amazon-Advertising-API-ClientId": clientId,
            "Amazon-Advertising-API-Scope": args.profileId,
            Authorization: `Bearer ${accessToken}`,
            "Content-Type": "application/vnd.createasyncreportrequest.v3+json",
          },
          body: JSON.stringify(body),
        });

        if (res.ok) {
          const j = await res.json();
          return j.reportId as string;
        }
        
        if (res.status === 429 && attempt <= 3) {
          const delay = attempt * 2000;
          await new Promise(r => setTimeout(r, delay));
          return requestReport(type, start, end, attempt + 1);
        }
        return null;
      } catch (e: any) {
        return null;
      }
    };

    // === SEQUENTIAL EXECUTION ===
    for (const w of missingWindows) {
      // This will now reuse the existing row if it was created by a parallel process
      const snapshotId = await ctx.runMutation(api.amazonAds.createSnapshotStub, {
        profileId: args.profileId,
        portfolioId: args.portfolioId,
        period: args.period,
        startDate: w.startStr,
        endDate: w.endStr,
        label: w.label
      });

      const sp = await requestReport("sp", w.startStr, w.endStr);
      const sb = await requestReport("sb", w.startStr, w.endStr);
      const sd = await requestReport("sd", w.startStr, w.endStr);

      await ctx.runMutation(api.amazonAds.saveReportIds, {
        snapshotId,
        reportIds: { sp: sp || undefined, sb: sb || undefined, sd: sd || undefined }
      });
    }

    return { success: true, initiated: missingWindows.length };
  }
});

export const pollPendingSnapshots = action({
  args: { profileId: v.string() },
  handler: async (ctx, args) => {
    const pendingRows = await ctx.runQuery(api.amazonAds.getPendingSnapshots, { profileId: args.profileId });
    if (pendingRows.length === 0) return { success: true, processed: 0 };

    const profile = await ctx.runQuery(api.profiles.getById, { profileId: args.profileId });
    if (!profile) return;
    const region = (profile.region || "NA") as "NA"|"EU"|"FE";
    const clientId = process.env.AMAZON_CLIENT_ID!;
    const accessToken = await getAccessToken(region);
    const apiUrl = REGION_CONFIG[region].apiUrl;

    let processedCount = 0;

    for (const row of pendingRows) {
      const reports = row.reportIds;
      const reportTypes: {id: string, type: AdType}[] = [];
      if (reports.sp) reportTypes.push({ id: reports.sp, type: "sp" });
      if (reports.sb) reportTypes.push({ id: reports.sb, type: "sb" });
      if (reports.sd) reportTypes.push({ id: reports.sd, type: "sd" });

      if (reportTypes.length === 0) {
        // Stop polling empty rows
        await ctx.runMutation(api.amazonAds.completeSnapshot, { snapshotId: row._id, data: row.data });
        continue;
      }

      const results = await Promise.all(reportTypes.map(async (rt) => {
        try {
            const statusRes = await fetch(`${apiUrl}/reporting/reports/${rt.id}`, {
            headers: { Authorization: `Bearer ${accessToken}`, "Amazon-Advertising-API-ClientId": clientId, "Amazon-Advertising-API-Scope": args.profileId }
            });
            
            if (!statusRes.ok) return null;
            
            const sData = await statusRes.json();
            const status = sData.status || sData.reportStatus;
            
            if (status === "COMPLETED" || status === "SUCCESS") {
                try {
                    const totals = await downloadAndAggregate(sData.url, rt.type);
                    return { type: rt.type, totals, done: true };
                } catch(e) { return null; }
            }
            return { type: rt.type, done: false };
        } catch (err: any) { return null; }
      }));

      if (results.every(r => r && r.done)) {
        const final = { impressions:0, clicks:0, spend:0, sales:0, orders:0 };
        results.forEach(r => {
          if (r?.totals) {
            final.impressions += r.totals.impressions;
            final.clicks += r.totals.clicks;
            final.spend += r.totals.cost;
            final.sales += r.totals.sales;
            final.orders += r.totals.orders;
          }
        });
        await ctx.runMutation(api.amazonAds.completeSnapshot, { snapshotId: row._id, data: final });
        processedCount++;
      }
    }
    return { success: true, processed: processedCount };
  }
});

export const getPendingSnapshots = query({
  args: { profileId: v.string() },
  handler: async (ctx, args) => {
    return await ctx.db
      .query("adSnapshots")
      .filter(q => q.and(q.eq(q.field("profileId"), args.profileId), q.eq(q.field("status"), "PENDING")))
      .collect();
  }
});

export const fetchPortfolios = action({
  args: { profileId: v.string() },
  handler: async (ctx, args) => {
    try {
      const profile = await ctx.runQuery(api.profiles.getById, { profileId: args.profileId });
      if (!profile) throw new Error("Profile not found");
      const region = (profile.region || "NA") as "NA" | "EU" | "FE";
      const accessToken = await getAccessToken(region);
      const apiUrl = REGION_CONFIG[region].apiUrl;
      const clientId = process.env.AMAZON_CLIENT_ID!;
      const response = await fetch(`${apiUrl}/portfolios/list`, {
        method: "POST",
        headers: { "Amazon-Advertising-API-ClientId": clientId, "Amazon-Advertising-API-Scope": args.profileId, Authorization: `Bearer ${accessToken}`, "Content-Type": "application/vnd.spPortfolio.v3+json" },
        body: JSON.stringify({}),
      });
      if (!response.ok) { if (response.status === 404 || response.status === 400) return { success: true, portfolios: [] }; throw new Error(`Failed to fetch portfolios`); }
      const responseData = await response.json();
      const portfolios = Array.isArray(responseData) ? responseData : (responseData.portfolios || []);
      return { success: true, portfolios: portfolios.map((p: any) => ({ portfolioId: p.portfolioId.toString(), name: p.name || "Unnamed Portfolio", state: p.state || "unknown" })) };
    } catch (error: any) { return { success: true, portfolios: [], error: error.message }; }
  },
});