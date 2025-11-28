import { defineSchema, defineTable } from 'convex/server'
import { v } from 'convex/values'

export default defineSchema({
  profiles: defineTable({
    profileId: v.string(),
    accountName: v.string(),
    countryCode: v.string(),
    accountType: v.string(),
    currencyCode: v.string(),
    timezone: v.string(),
    region: v.optional(v.string()),
    isActive: v.boolean(),
  })
    .index("by_profileId", ["profileId"])
    .index("by_region", ["region"]),

  adSnapshots: defineTable({
    profileId: v.string(),
    portfolioId: v.string(), 
    
    // NEW: Distinguish between "weekly" view and "monthly" view
    period: v.optional(
      v.union(v.literal("weekly"), v.literal("monthly"))
    ),

    startDate: v.string(), 
    endDate: v.string(),
    label: v.string(),

    status: v.union(
      v.literal("INIT"), 
      v.literal("PENDING"), 
      v.literal("COMPLETED"), 
      v.literal("FAILED")
    ),
    
    reportIds: v.object({
      sp: v.optional(v.string()),
      sb: v.optional(v.string()),
      sd: v.optional(v.string()),
    }),

    data: v.object({
      impressions: v.number(),
      clicks: v.number(),
      spend: v.number(),
      sales: v.number(),
      orders: v.number(),
    }),

    updatedAt: v.number(),
  })
  .index("by_profile_portfolio_period", ["profileId", "portfolioId", "period"]) // Updated Index
  .index("by_status", ["status"]), 
});