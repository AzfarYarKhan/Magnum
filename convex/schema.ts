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

  // NEW: Stores the state of specific portfolio/date-range reports
  adSnapshots: defineTable({
    profileId: v.string(),
    portfolioId: v.string(), // "all" or specific ID
    
    // The specific week this snapshot covers
    startDate: v.string(), 
    endDate: v.string(),
    label: v.string(),

    // State management
    status: v.union(
      v.literal("INIT"), 
      v.literal("PENDING"), 
      v.literal("COMPLETED"), 
      v.literal("FAILED")
    ),
    
    // Amazon Report IDs (to allow resuming)
    reportIds: v.object({
      sp: v.optional(v.string()),
      sb: v.optional(v.string()),
      sd: v.optional(v.string()),
    }),

    // The actual cached data (populated when status === COMPLETED)
    data: v.object({
      impressions: v.number(),
      clicks: v.number(),
      spend: v.number(),
      sales: v.number(),
      orders: v.number(),
    }),

    updatedAt: v.number(),
  })
  .index("by_profile_portfolio", ["profileId", "portfolioId"])
  .index("by_status", ["status"]), 
});