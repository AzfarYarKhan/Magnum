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

  weeklyStats: defineTable({
    profileId: v.string(),
    impressions: v.number(),
    clicks: v.number(),
    weekStartDate: v.string(), // e.g., "2024-10-28"
    weekEndDate: v.string(),   // e.g., "2024-11-03"
    lastSyncedAt: v.number(),
  }).index("by_profileId", ["profileId"]),
});