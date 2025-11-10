import { action } from "./_generated/server";
import { v } from "convex/values";
import { api } from "./_generated/api";
import { inflate } from "pako";

/** ===== Types ===== */
interface AmazonCampaign {
  campaignId: string;
  name?: string;
  portfolioId?: string;
  state?: string;
  type: "sp" | "sb" | "sd";
}

interface AmazonReportRecord {
  campaignId: string;
  impressions: number;
  clicks: number;
  cost: number;
}

interface WeeklyStatsResult {
  success: boolean;
  impressions: number;
  clicks: number;
  spend: number;
  campaignCount: number;
  activeCampaignCount: number;
  startDate: string;
  endDate: string;
  error?: string;
}

/** ===== Region config ===== */
const REGION_CONFIG = {
  NA: {
    tokenUrl: "https://api.amazon.com/auth/o2/token",
    apiUrl: "https://advertising-api.amazon.com",
  },
  EU: {
    tokenUrl: "https://api.amazon.co.uk/auth/o2/token",
    apiUrl: "https://advertising-api-eu.amazon.com",
  },
  FE: {
    tokenUrl: "https://api.amazon.co.jp/auth/o2/token",
    apiUrl: "https://advertising-api-fe.amazon.com",
  },
} as const;

/** ===== Date helpers (build 4 weekly windows ending yesterday) ===== */
function toYmd(d: Date): string {
  return d.toISOString().split("T")[0];
}
const monthShort = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];
function ordinal(n:number){const s=["th","st","nd","rd"],v=n%100;return n+(s[(v-20)%10]||s[v]||s[0]);}
function formatLabel(s: Date, e: Date){
  const sDay = ordinal(s.getDate()), eDay = ordinal(e.getDate());
  const sMon = monthShort[s.getMonth()], eMon = monthShort[e.getMonth()];
  return `${sDay} ${sMon} – ${eDay} ${eMon}`;
}
function buildFourWeekWindows(today = new Date()){
  // Use yesterday to avoid slow "today" processing in Amazon's pipeline
  const end = new Date(today.getFullYear(), today.getMonth(), today.getDate() - 1);
  const windows: Array<{startStr:string; endStr:string; label:string}> = [];
  let cursorEnd = end;
  for (let i=0;i<4;i++){
    const start = new Date(cursorEnd); start.setDate(cursorEnd.getDate() - 6);
    windows.push({ startStr: toYmd(start), endStr: toYmd(cursorEnd), label: formatLabel(start, cursorEnd) });
    const prevEnd = new Date(start); prevEnd.setDate(start.getDate() - 1);
    cursorEnd = prevEnd;
  }
  return windows.reverse(); // oldest → newest
}

/** ===== Utilities ===== */
function extractDuplicateReportId(errText: string): string | null {
  try {
    const j = JSON.parse(errText); const detail: string = j?.detail || "";
    const m = detail.match(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i);
    return m ? m[0] : null;
  } catch {
    const m = errText.match(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i);
    return m ? m[0] : null;
  }
}

/** ===== OAuth: access token from refresh token ===== */
export async function getAccessToken(region: "NA" | "EU" | "FE") {
  const refreshToken = process.env.AMAZON_REFRESH_TOKEN!;
  const clientId     = process.env.AMAZON_CLIENT_ID!;
  const clientSecret = process.env.AMAZON_CLIENT_SECRET!;
  const tokenUrl = REGION_CONFIG[region].tokenUrl;

  const res = await fetch(tokenUrl, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "refresh_token",
      refresh_token: refreshToken,
      client_id: clientId,
      client_secret: clientSecret,
    }),
  });

  if (!res.ok) {
    const errorText = await res.text();
    throw new Error(`Failed to refresh token for ${region}: ${errorText}`);
  }
  const data = await res.json();
  const token = (data.access_token as string)?.trim();
  if (!token) throw new Error(`No access token received for ${region}`);
  return token;
}

/** ===== OAuth callback (unchanged) ===== */
export const processOAuthCallback = action({
  args: { 
    code: v.string(),
    region: v.union(v.literal("NA"), v.literal("EU"), v.literal("FE")),
  },
  handler: async (ctx, args) => {
    try {
      const clientId = process.env.AMAZON_CLIENT_ID!;
      const clientSecret = process.env.AMAZON_CLIENT_SECRET!;
      const redirectUri = process.env.AMAZON_REDIRECT_URI || "http://localhost:3000/callback";
      const tokenUrl = REGION_CONFIG[args.region].tokenUrl;
      const apiUrl = REGION_CONFIG[args.region].apiUrl;

      const response = await fetch(tokenUrl, {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({
          grant_type: "authorization_code",
          code: args.code,
          redirect_uri: redirectUri,
          client_id: clientId,
          client_secret: clientSecret,
        }),
      });

      if (!response.ok) {
        const error = await response.text();
        throw new Error(`Token exchange failed: ${error}`);
      }

      const tokenData = await response.json();
      const { access_token, refresh_token } = tokenData;

      const profilesResponse = await fetch(`${apiUrl}/v2/profiles`, {
        headers: {
          "Amazon-Advertising-API-ClientId": clientId,
          Authorization: `Bearer ${access_token}`,
          "Content-Type": "application/json",
        },
      });

      if (!profilesResponse.ok) {
        const errorText = await profilesResponse.text();
        throw new Error(`Failed to fetch profiles: ${errorText}`);
      }

      const profiles = await profilesResponse.json();
      const profilesToSave = profiles.map((p: any) => ({
        profileId: p.profileId.toString(),
        accountName: p.accountInfo?.name || "Unnamed Account",
        countryCode: p.countryCode,
        accountType: p.accountInfo?.type || "unknown",
        currencyCode: p.currencyCode,
        timezone: p.timezone,
        region: args.region,
      }));

      await ctx.runMutation(api.profiles.appendProfiles, { profiles: profilesToSave });

      return {
        success: true,
        region: args.region,
        profiles: profiles.map((p: any) => ({
          accountName: p.accountInfo?.name || "Unnamed Account",
          countryCode: p.countryCode,
          accountType: p.accountInfo?.type || "unknown",
        })),
        refreshToken: refresh_token,
      };
    } catch (error: any) {
      console.error("OAuth callback error:", error);
      return { success: false, error: error.message };
    }
  },
});

/** ===== Fetch portfolios (unchanged) ===== */
export const fetchPortfolios = action({
  args: { profileId: v.string() },
  handler: async (ctx, args) => {
    try {
      const profile = await ctx.runQuery(api.profiles.getById, { profileId: args.profileId });
      if (!profile) throw new Error("Profile not found");

      const region = (profile.region || "NA") as "NA" | "EU" | "FE";
      const clientId = process.env.AMAZON_CLIENT_ID!;
      const accessToken = await getAccessToken(region);
      const apiUrl = REGION_CONFIG[region].apiUrl;

      console.log(`Fetching portfolios for profile ${args.profileId}`);

      const response = await fetch(`${apiUrl}/portfolios/list`, {
        method: "POST",
        headers: {
          "Amazon-Advertising-API-ClientId": clientId,
          "Amazon-Advertising-API-Scope": args.profileId,
          Authorization: `Bearer ${accessToken}`,
          "Content-Type": "application/vnd.spPortfolio.v3+json",
        },
        body: JSON.stringify({}),
      });

      if (!response.ok) {
        const errorText = await response.text();
        console.error("Failed to fetch portfolios:", response.status, errorText);

        if (response.status === 404 || response.status === 400) {
          console.log("No portfolios endpoint or no portfolios for this profile");
          return { success: true, portfolios: [] };
        }
        throw new Error(`Failed to fetch portfolios: ${errorText}`);
      }

      const responseData = await response.json();
      const portfolios = Array.isArray(responseData)
        ? responseData
        : (responseData.portfolios || []);

      console.log(`Found ${portfolios.length} portfolios`);

      return {
        success: true,
        portfolios: portfolios.map((p: any) => ({
          portfolioId: p.portfolioId.toString(),
          name: p.name || "Unnamed Portfolio",
          state: p.state || "unknown",
          inBudget: p.inBudget !== undefined ? p.inBudget : true,
        })),
      };
    } catch (error: any) {
      console.error("Error fetching portfolios:", error);
      return { success: true, portfolios: [], error: error.message };
    }
  },
});

/** ========================================================================
 *  Two-phase reporting for the 4-week view
 *  1) createFourWeekReports: quickly create reportIds for each week & type
 *  2) checkAndDownloadReports: poll, download, and aggregate (major units)
 *     and filter down to a selected portfolio on the server.
 *  ====================================================================== */

/** 1) Create reports for last 4 weekly windows (no invalid filters; valid columns per type) */
export const createFourWeekReports = action({
  args: { profileId: v.string(), portfolioId: v.optional(v.string()) },
  handler: async (ctx, args) => {
    const profile = await ctx.runQuery(api.profiles.getById, { profileId: args.profileId });
    if (!profile) throw new Error("Profile not found");

    const region = (profile.region || "NA") as "NA"|"EU"|"FE";
    const clientId = process.env.AMAZON_CLIENT_ID!;
    const apiUrl = REGION_CONFIG[region].apiUrl;
    const accessToken = await getAccessToken(region);
    const authHeader = `Bearer ${accessToken.trim()}`;

    // 1) Get all campaigns (SP/SB/SD)
    console.log(`Fetching all campaign types for profile ${args.profileId} (${region})`);
    const endpoints = [
      { type: "sp" as const, url: `${apiUrl}/sp/campaigns/list`, method: "POST" as const, contentType: "application/vnd.spCampaign.v3+json" },
      { type: "sb" as const, url: `${apiUrl}/sb/v4/campaigns/list`, method: "POST" as const, contentType: "application/vnd.sbcampaignresource.v4+json" },
      { type: "sd" as const, url: `${apiUrl}/sd/campaigns`,       method: "GET"  as const, contentType: "application/vnd.sdcampaign.v3+json" },
    ];
    const all: AmazonCampaign[] = [];

    for (const ep of endpoints) {
      const headers: Record<string,string> = {
        "Amazon-Advertising-API-ClientId": clientId,
        "Amazon-Advertising-API-Scope": args.profileId,
        Authorization: authHeader,
        Accept: ep.method === "POST" ? ep.contentType : "application/json",
      };
      if (ep.method === "POST") headers["Content-Type"] = ep.contentType;

      const res = await fetch(ep.url, {
        method: ep.method,
        headers,
        body: ep.method === "POST" ? JSON.stringify({}) : undefined,
      });

      if (!res.ok) {
        const t = await res.text().catch(() => "");
        console.warn(`Warning: Failed to fetch ${ep.type} campaigns: ${res.status} ${t}`);
        continue;
      }
      const data = await res.json();
      const arr: any[] = Array.isArray(data) ? data : (data.campaigns || []);
      for (const c of arr) {
        const id = (c.campaignId ?? c.campaign?.campaignId)?.toString();
        if (!id) continue;
        all.push({
          campaignId: id,
          name: c.name,
          portfolioId: c.portfolioId?.toString(),
          state: c.state,
          type: ep.type,
        });
      }
    }

    console.log(`Found ${all.length} total campaigns`);
    const filtered = args.portfolioId ? all.filter(c => c.portfolioId === args.portfolioId) : all;
    const activeCampaignCount = filtered.filter(c => c.state?.toLowerCase() === "enabled").length;

    const byType: Record<"sp"|"sb"|"sd", string[]> = { sp: [], sb: [], sd: [] };
    for (const c of filtered) byType[c.type].push(c.campaignId);
    console.log(`Campaigns by type (after filter): SP=${byType.sp.length}, SB=${byType.sb.length}, SD=${byType.sd.length}`);

    const windows = buildFourWeekWindows();
    const contentType = "application/vnd.createasyncreportrequest.v3+json";

    // Valid columns by ad product for groupBy: "campaign"
    const COLUMNS = {
      sp: ["impressions","clicks","cost","sales14d","purchases14d","campaignId"], // SP allows sales14d/purchases14d
      sb: ["impressions","clicks","cost","sales","purchases","campaignId"],       // SB allows sales/purchases
      sd: ["impressions","clicks","cost","sales14d","purchases14d","campaignId"], // SD commonly allows *14d
    } as const;

    async function createOne(type: "sp"|"sb"|"sd", startStr: string, endStr: string) {
      // Primary body (no filters; filters were the cause of 400 with groupBy=campaign)
      const bodyPrimary = {
        name: `${type.toUpperCase()} ${startStr}-${endStr}`,
        startDate: startStr,
        endDate: endStr,
        configuration: {
          adProduct: type === "sp" ? "SPONSORED_PRODUCTS" : type === "sb" ? "SPONSORED_BRANDS" : "SPONSORED_DISPLAY",
          groupBy: ["campaign"],
          columns: COLUMNS[type],
          reportTypeId: type === "sp" ? "spCampaigns" : type === "sb" ? "sbCampaigns" : "sdCampaigns",
          timeUnit: "SUMMARY",
          format: "GZIP_JSON",
        },
      };

      // Fallback body with only the most basic columns if Amazon rejects the set above on your tenant
      const bodyFallback = {
        ...bodyPrimary,
        configuration: {
          ...bodyPrimary.configuration,
          columns: ["impressions","clicks","cost","campaignId"],
        },
      };

      let attempts = 0;
      while (attempts < 4) {
        const createRes = await fetch(`${apiUrl}/reporting/reports`, {
          method: "POST",
          headers: {
            "Amazon-Advertising-API-ClientId": clientId,
            "Amazon-Advertising-API-Scope": args.profileId,
            Authorization: authHeader,
            "Content-Type": contentType,
            Accept: "application/json",
          },
          body: JSON.stringify(attempts === 0 ? bodyPrimary : bodyFallback),
        });

        if (createRes.ok) {
          const j = await createRes.json();
          console.log(`Created ${type} report request: ${j.reportId} for date range ${startStr} to ${endStr}`);
          return j.reportId || null;
        }

        const status = createRes.status;
        const text = await createRes.text();

        if (status === 425 || status === 409) {
          const dup = extractDuplicateReportId(text);
          if (dup) {
            console.log(`Using duplicate ${type} report id from server: ${dup}`);
            return dup;
          }
        }
        if (status === 429) {
          const wait = Math.pow(2, Math.min(attempts, 3)) * 1000; // 1s,2s,4s,8s
          console.warn(`Rate limited (429) for ${type} report. Retrying after ${wait}ms`);
          await new Promise(r=>setTimeout(r, wait));
          attempts++;
          continue;
        }
        if (status === 400 && attempts === 0) {
          // Switch to fallback columns once if columns were rejected
          console.warn(`Create ${type} report failed with columns (${status}). Retrying with fallback columns. Detail: ${text}`);
          attempts++;
          continue;
        }

        console.warn(`Create ${type} report failed: ${status} ${text}`);
        return null;
      }
      return null;
    }

    // Create report IDs for each week & type (quick; no polling here)
    const weeks: Array<{
      label: string;
      startDate: string;
      endDate: string;
      reports: { sp?: string|null; sb?: string|null; sd?: string|null };
      campaignCount: number;
      activeCampaignCount: number;
    }> = [];

    for (const w of windows) {
      const sp = byType.sp.length ? await createOne("sp", w.startStr, w.endStr) : null;
      await new Promise(r=>setTimeout(r,120));
      const sb = byType.sb.length ? await createOne("sb", w.startStr, w.endStr) : null;
      await new Promise(r=>setTimeout(r,120));
      const sd = byType.sd.length ? await createOne("sd", w.startStr, w.endStr) : null;

      weeks.push({
        label: w.label,
        startDate: w.startStr,
        endDate: w.endStr,
        reports: { sp, sb, sd },
        campaignCount: filtered.length,
        activeCampaignCount,
      });
    }

    return { success: true, weeks };
  }
});

/** 2) Poll statuses; download & aggregate when ready (MAJOR units).
 *    Filters down to a selected portfolio by refetching campaigns and
 *    keeping only those campaignIds in the selected portfolio.
 */
export const checkAndDownloadReports = action({
    args: {
      profileId: v.string(),
      portfolioId: v.optional(v.string()),
      entries: v.array(v.object({
        reportId: v.string(),
        type: v.union(v.literal("sp"), v.literal("sb"), v.literal("sd")),
      })),
    },
    handler: async (ctx, args) => {
      const profile = await ctx.runQuery(api.profiles.getById, { profileId: args.profileId });
      if (!profile) throw new Error("Profile not found");
  
      const region = (profile.region || "NA") as "NA"|"EU"|"FE";
      const clientId = process.env.AMAZON_CLIENT_ID!;
      const apiUrl = REGION_CONFIG[region].apiUrl;
      const accessToken = await getAccessToken(region);
      const authHeader = `Bearer ${accessToken.trim()}`;
  
      // Build allowed campaign IDs by type for optional portfolio filter
      async function loadCampaignsByType(): Promise<Record<"sp"|"sb"|"sd", Set<string>>> {
        const endpoints = [
          { type: "sp" as const, url: `${apiUrl}/sp/campaigns/list`, method: "POST" as const, contentType: "application/vnd.spCampaign.v3+json" },
          { type: "sb" as const, url: `${apiUrl}/sb/v4/campaigns/list`, method: "POST" as const, contentType: "application/vnd.sbcampaignresource.v4+json" },
          { type: "sd" as const, url: `${apiUrl}/sd/campaigns`,       method: "GET"  as const, contentType: "application/vnd.sdcampaign.v3+json" },
        ];
        const out: Record<"sp"|"sb"|"sd", Set<string>> = { sp: new Set(), sb: new Set(), sd: new Set() };
  
        for (const ep of endpoints) {
          const headers: Record<string,string> = {
            "Amazon-Advertising-API-ClientId": clientId,
            "Amazon-Advertising-API-Scope": args.profileId,
            Authorization: authHeader,
            Accept: ep.method === "POST" ? ep.contentType : "application/json",
          };
          if (ep.method === "POST") headers["Content-Type"] = ep.contentType;
  
          const res = await fetch(ep.url, {
            method: ep.method,
            headers,
            body: ep.method === "POST" ? JSON.stringify({}) : undefined,
          });
          if (!res.ok) continue;
  
          const data = await res.json();
          const arr: any[] = Array.isArray(data) ? data : (data.campaigns || []);
          for (const c of arr) {
            const id = (c.campaignId ?? c.campaign?.campaignId)?.toString();
            if (!id) continue;
            const portfolioId = c.portfolioId?.toString();
            if (args.portfolioId && portfolioId !== args.portfolioId) continue;
            out[ep.type].add(id);
          }
        }
        return out;
      }
  
      const allowedByType = await loadCampaignsByType();
  
      async function getStatus(reportId: string){
        const res = await fetch(`${apiUrl}/reporting/reports/${reportId}`, {
          headers: {
            "Amazon-Advertising-API-ClientId": clientId,
            "Amazon-Advertising-API-Scope": args.profileId,
            Authorization: authHeader,
            Accept: "application/json",
          }
        });
        if (!res.ok) {
          const t = await res.text().catch(()=> "");
          console.warn(`Status check failed for ${reportId}: ${res.status} ${t}`);
          return { status: "UNKNOWN" as const, url: undefined as string | undefined };
        }
        const j = await res.json();
        const status = (j.status || j.reportStatus || "IN_PROGRESS") as string;
        return { status, url: j.url as (string|undefined) };
      }
  
      async function downloadAndAggregate(url: string, type: "sp"|"sb"|"sd"){
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
        const allowed = allowedByType[type];
  
        for (const rec of arr) {
          const cid = (rec.campaignId ?? rec.campaign_id ?? rec.campaign)?.toString();
          if (!cid) continue;
          if (allowed.size > 0 && !allowed.has(cid)) continue; // portfolio filter
  
          impressions += Number(rec.impressions || 0);
          clicks     += Number(rec.clicks || 0);
          cost       += Number(rec.cost || 0); // MAJOR currency units
  
          // Per-adproduct sales/order fields:
          if (type === "sp" || type === "sd") {
            sales  += Number(rec.sales14d || rec.attributedSales14d || 0);
            orders += Number(rec.purchases14d || rec.attributedConversions14d || 0);
          } else if (type === "sb") {
            sales  += Number(rec.sales || 0);
            orders += Number(rec.purchases || 0);
          }
        }
        return { type, impressions, clicks, cost, sales, orders };
      }
  
      const out: Array<{
        reportId: string;
        type: "sp"|"sb"|"sd";
        status: "IN_PROGRESS"|"PENDING"|"PROCESSING"|"CREATED"|"SUCCESS"|"COMPLETED"|"FAILURE"|"UNKNOWN"|"DOWNLOADED";
        totals?: { impressions:number; clicks:number; cost:number; sales:number; orders:number };
      }> = [];
  
      for (const e of args.entries) {
        const { status, url } = await getStatus(e.reportId);
  
        // 🔧 Fix: treat SUCCESS/COMPLETED *without URL* as still pending
        if ((status === "SUCCESS" || status === "COMPLETED") && !url) {
          out.push({ reportId: e.reportId, type: e.type, status: "IN_PROGRESS" });
          await new Promise(r=>setTimeout(r, 120));
          continue;
        }
  
        if (status === "SUCCESS" || status === "COMPLETED") {
          try {
            const totals = await downloadAndAggregate(url!, e.type);
            out.push({ reportId: e.reportId, type: e.type, status: "DOWNLOADED", totals });
          } catch (err:any) {
            console.warn(`Download parse error for ${e.type} ${e.reportId}:`, err.message);
            out.push({ reportId: e.reportId, type: e.type, status: "FAILURE" });
          }
        } else {
          out.push({ reportId: e.reportId, type: e.type, status: status as any });
        }
  
        await new Promise(r=>setTimeout(r, 120)); // gentle stagger
      }
  
      return { success: true, results: out };
    }
  });
  

/** ===== Helper used by the legacy single-window call below ===== */
const parseReportData = (data: any, _type: "sp" | "sb" | "sd", campaignIds: string[]): AmazonReportRecord[] => {
  try {
    let records: any[] = [];
    if (Array.isArray(data)) {
      records = data;
    } else if (data.records && Array.isArray(data.records)) {
      records = data.records;
    } else if (data.data && Array.isArray(data.data)) {
      records = data.data;
    }

    const campaignMap = new Map<string, AmazonReportRecord>();
    for (const record of records) {
      const campaignId =
        record.campaignId?.toString() ||
        record.campaign_id?.toString() ||
        record.campaign?.toString() ||
        "";

      if (!campaignId || (campaignIds.length > 0 && !campaignIds.includes(campaignId))) {
        continue;
      }

      const existing = campaignMap.get(campaignId);
      const impressions = Number(record.impressions || 0);
      const clicks = Number(record.clicks || 0);
      const cost = Number(record.cost || record.spend || 0);
      if (existing) {
        existing.impressions += impressions;
        existing.clicks += clicks;
        existing.cost += cost;
      } else {
        campaignMap.set(campaignId, { campaignId, impressions, clicks, cost });
      }
    }
    return Array.from(campaignMap.values());
  } catch (error: any) {
    console.warn(`Warning: Failed to parse report data:`, error.message);
    return [];
  }
};

/** ===== Legacy: single 7-day summary (kept for compatibility) ===== */
export const fetchWeeklyStats = action({
  args: { 
    profileId: v.string(),
    portfolioId: v.optional(v.string()),
  },
  handler: async (ctx, args): Promise<WeeklyStatsResult> => {
    try {
      const profile = await ctx.runQuery(api.profiles.getById, { profileId: args.profileId });
      if (!profile) throw new Error("Profile not found");

      const region = (profile.region || "NA") as "NA" | "EU" | "FE";
      const clientId = process.env.AMAZON_CLIENT_ID!;
      const apiUrl = REGION_CONFIG[region].apiUrl;
      const accessToken = await getAccessToken(region);

      console.log(`Fetching all campaign types for profile ${args.profileId} (${region})`);

      const campaignEndpoints = [
        { type: "sp" as const, url: `${apiUrl}/sp/campaigns/list`, method: "POST" as const, contentType: "application/vnd.spCampaign.v3+json" },
        { type: "sb" as const, url: `${apiUrl}/sb/v4/campaigns/list`, method: "POST" as const, contentType: "application/vnd.sbcampaignresource.v4+json" },
        { type: "sd" as const, url: `${apiUrl}/sd/campaigns`, method: "GET" as const, contentType: "application/vnd.sdcampaign.v3+json" },
      ];

      const allCampaigns: AmazonCampaign[] = [];

      for (const endpoint of campaignEndpoints) {
        const authHeader = `Bearer ${accessToken.trim()}`;
        const headers: Record<string, string> = {
          "Amazon-Advertising-API-ClientId": clientId,
          "Amazon-Advertising-API-Scope": args.profileId,
          Authorization: authHeader,
        };

        if (endpoint.method === "POST") {
          headers["Content-Type"] = endpoint.contentType;
          headers["Accept"] = endpoint.contentType;
        } else {
          headers["Accept"] = "application/json";
        }

        const res = await fetch(endpoint.url, {
          method: endpoint.method,
          headers,
          body: endpoint.method === "POST" ? JSON.stringify({}) : undefined,
        });

        if (res.ok) {
          const data = await res.json();
          const campaigns: any[] = Array.isArray(data) ? data : (data.campaigns || []);
          allCampaigns.push(...campaigns.map((c: any) => ({
            campaignId: c.campaignId,
            name: c.name,
            portfolioId: c.portfolioId?.toString(),
            state: c.state,
            type: endpoint.type,
          })));
        } else {
          const errText = await res.text();
          console.warn(`Warning: Failed to fetch ${endpoint.type} campaigns`, errText);
        }
      }

      console.log(`Found ${allCampaigns.length} total campaigns`);

      const filteredCampaigns = args.portfolioId
        ? allCampaigns.filter(c => c.portfolioId === args.portfolioId)
        : allCampaigns;

      const campaignIds = filteredCampaigns.map(c => c.campaignId);
      if (campaignIds.length === 0) {
        return {
          success: true,
          impressions: 0,
          clicks: 0,
          spend: 0,
          campaignCount: 0,
          activeCampaignCount: 0,
          startDate: "",
          endDate: "",
        };
      }

      const endDate = new Date();
      const startDate = new Date();
      startDate.setDate(endDate.getDate() - 7);

      const startStr = startDate.toISOString().split("T")[0];
      const endStr = endDate.toISOString().split("T")[0];

      const fetchReportData = async (
        type: "sp" | "sb" | "sd",
        apiBaseUrl: string,
        ids: string[]
      ): Promise<AmazonReportRecord[]> => {
        try {
          const adProduct = type === "sp" ? "SPONSORED_PRODUCTS" : type === "sb" ? "SPONSORED_BRANDS" : "SPONSORED_DISPLAY";
          const reportTypeId = type === "sp" ? "spCampaigns" : type === "sb" ? "sbCampaigns" : "sdCampaigns";
          const reportBody = {
            name: `${type.toUpperCase()} campaigns report ${startStr}-${endStr}`,
            startDate: startStr,
            endDate: endStr,
            configuration: {
              adProduct,
              groupBy: ["campaign"],
              // Use basic columns valid across ad products for compatibility here
              columns: ["impressions", "clicks", "cost", "campaignId"],
              reportTypeId,
              timeUnit: "SUMMARY",
              format: "GZIP_JSON",
            },
          };

          const reportUrl = `${apiBaseUrl}/reporting/reports`;
          const authHeader = `Bearer ${accessToken.trim()}`;
          const contentType = "application/vnd.createasyncreportrequest.v3+json";

          let createRes: Response | null = null;
          let retryCount = 0;
          const maxRetries = 3;

          while (retryCount <= maxRetries) {
            createRes = await fetch(reportUrl, {
              method: "POST",
              headers: {
                "Amazon-Advertising-API-ClientId": clientId,
                "Amazon-Advertising-API-Scope": args.profileId,
                Authorization: authHeader,
                "Content-Type": contentType,
                Accept: "application/json",
              },
              body: JSON.stringify(reportBody),
            });

            if (createRes.ok) break;

            const status = createRes.status;
            if (status === 429 && retryCount < maxRetries) {
              const waitTime = Math.pow(2, retryCount) * 1000;
              console.warn(`Rate limited (429) for ${type} report. Retrying after ${waitTime}ms (attempt ${retryCount + 1}/${maxRetries + 1})`);
              await new Promise(resolve => setTimeout(resolve, waitTime));
              retryCount++;
              continue;
            }

            const errText = await createRes.text();
            console.warn(`Warning: Failed to create ${type} report request (${status})`, errText);
            return [];
          }

          if (!createRes || !createRes.ok) return [];

          const createData = await createRes.json();
          const reportId = createData.reportId;
          if (!reportId) {
            console.warn(`Warning: No reportId returned for ${type} report`);
            return [];
          }

          console.log(`Created ${type} report request: ${reportId} for date range ${startStr} to ${endStr}`);

          const statusUrl = `${apiBaseUrl}/reporting/reports/${reportId}`;
          const pollDeadline = Date.now() + 420_000;
          let waitMs = 2000;

          while (Date.now() < pollDeadline) {
            const statusRes = await fetch(statusUrl, {
              method: "GET",
              headers: {
                "Amazon-Advertising-API-ClientId": clientId,
                "Amazon-Advertising-API-Scope": args.profileId,
                Authorization: authHeader,
                Accept: "application/json",
              },
            });

            if (statusRes.ok) {
              const statusData = await statusRes.json();
              const reportStatus = statusData.status || statusData.reportStatus || "IN_PROGRESS";

              if ((reportStatus === "SUCCESS" || reportStatus === "COMPLETED") && statusData.url) {
                const downloadRes = await fetch(statusData.url, { method: "GET" });
                if (downloadRes.ok) {
                  try {
                    const arrayBuffer = await downloadRes.arrayBuffer();
                    const uint8Array = new Uint8Array(arrayBuffer);
                    let jsonData: any;

                    if (uint8Array.length >= 2 && uint8Array[0] === 0x1f && uint8Array[1] === 0x8b) {
                      const decompressed = inflate(uint8Array, { to: "string" });
                      jsonData = JSON.parse(decompressed);
                    } else {
                      const text = new TextDecoder().decode(arrayBuffer);
                      jsonData = JSON.parse(text);
                    }

                    const records = parseReportData(jsonData, type, ids);
                    return records;
                  } catch (parseError: any) {
                    console.warn(`Warning: Failed to parse ${type} report data:`, parseError.message);
                    return [];
                  }
                }
              } else if (reportStatus === "FAILURE") {
                console.warn(`Warning: Report ${reportId} failed for ${type}`);
                return [];
              }
            }
            await new Promise(resolve => setTimeout(resolve, waitMs));
            waitMs = Math.min(10_000, Math.floor(waitMs * 1.4));
          }

          console.warn(`Warning: Report ${reportId} for ${type} timed out after ~7 minutes.`);
          return [];
        } catch (error: any) {
          console.warn(`Warning: Error fetching ${type} report:`, error.message);
          return [];
        }
      };

      const reportTypes: ("sp" | "sb" | "sd")[] = ["sp", "sb", "sd"];
      let impressions = 0;
      let clicks = 0;
      let spend = 0;

      const tasks = reportTypes.map((type, i) => (async () => {
        const idsForType = filteredCampaigns.filter(c => c.type === type).map(c => c.campaignId);
        if (idsForType.length === 0) return [] as AmazonReportRecord[];
        if (i > 0) await new Promise(r => setTimeout(r, 400));
        return await fetchReportData(type, apiUrl, idsForType);
      })());

      const results = await Promise.all(tasks);

      for (const records of results) {
        for (const r of records) {
          impressions += Number(r.impressions || 0);
          clicks += Number(r.clicks || 0);
          spend += Number(r.cost || 0);
        }
      }

      const activeCampaignCount = filteredCampaigns.filter(c => 
        c.state?.toLowerCase() === "enabled"
      ).length;

      return {
        success: true,
        impressions,
        clicks,
        spend,
        campaignCount: filteredCampaigns.length,
        activeCampaignCount,
        startDate: startStr,
        endDate: endStr,
      };

    } catch (error: any) {
      console.error("Error fetching weekly stats:", error);
      return {
        success: false,
        error: error.message,
        impressions: 0,
        clicks: 0,
        spend: 0,
        campaignCount: 0,
        activeCampaignCount: 0,
        startDate: "",
        endDate: "",
      };
    }
  },
});
