import { mutation, query } from "./_generated/server";
import { v } from "convex/values";

// Append profiles (don't replace existing ones)
export const appendProfiles = mutation({
  args: {
    profiles: v.array(v.object({
      profileId: v.string(),
      accountName: v.string(),
      countryCode: v.string(),
      accountType: v.string(),
      currencyCode: v.string(),
      timezone: v.string(),
      region: v.string(),
    })),
  },
  handler: async (ctx, args) => {
    for (const profile of args.profiles) {
      // Check if profile already exists
      const existing = await ctx.db
        .query("profiles")
        .withIndex("by_profileId", (q) => q.eq("profileId", profile.profileId))
        .first();

      if (existing) {
        // Update existing profile
        await ctx.db.patch(existing._id, {
          ...profile,
          isActive: true,
        });
      } else {
        // Insert new profile
        await ctx.db.insert("profiles", {
          ...profile,
          isActive: true,
        });
      }
    }
  },
});

// Keep existing functions
export const saveAll = mutation({
  args: {
    profiles: v.array(v.object({
      profileId: v.string(),
      accountName: v.string(),
      countryCode: v.string(),
      accountType: v.string(),
      currencyCode: v.string(),
      timezone: v.string(),
    })),
  },
  handler: async (ctx, args) => {
    // Clear and replace all
    const existing = await ctx.db.query("profiles").collect();
    for (const profile of existing) {
      await ctx.db.delete(profile._id);
    }

    for (const profile of args.profiles) {
      await ctx.db.insert("profiles", {
        ...profile,
        region: "NA", // Default to NA for backward compatibility
        isActive: true,
      });
    }
  },
});

export const list = query({
  handler: async (ctx) => {
    return await ctx.db.query("profiles").collect();
  },
});

export const getById = query({
  args: { profileId: v.string() },
  handler: async (ctx, args) => {
    return await ctx.db
      .query("profiles")
      .withIndex("by_profileId", (q) => q.eq("profileId", args.profileId))
      .first();
  },
});