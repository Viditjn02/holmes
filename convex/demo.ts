import { mutation } from "./_generated/server";
import type { Id } from "./_generated/dataModel";
import { FANIN_DEADLINE_MS } from "../lib/contract";

// ============================================================================
// INTERCEPT — OUTBOUND DEMO SEED (so the pipeline + email canvas are never empty)
// ----------------------------------------------------------------------------
// One public mutation materializes a complete, realistic OUTBOUND cycle exactly
// as a flawless live run would leave it: an active campaign, a finished outbound
// run (board lit), a brief, a full prospect pipeline spanning every stage with
// real signals + Fiber-verified emails, the email sequence (draft → approved →
// sent → replied + a follow-up draft), and an events ticker. Idempotent-ish: it
// always inserts a fresh demo conversation so re-seeding never collides.
//
// Public so scripts/seed-demo.ts (ConvexHttpClient → public fns only) and a
// "Load demo" button can both call it. NOT "use node".
// ============================================================================

interface SeedProspect {
  company: string;
  domain: string;
  industry: string;
  employeeCount: string;
  location: string;
  name: string;
  title: string;
  emailUser: string; // local-part; full address built from domain
  emailVerified: boolean;
  fitScore: number;
  signalType:
    | "funding"
    | "hiring"
    | "news"
    | "post"
    | "job_change"
    | "tech"
    | "other";
  signalSummary: string;
  signalUrl?: string;
  stage:
    | "sourced"
    | "enriched"
    | "qualified"
    | "contacted"
    | "replied"
    | "booked"
    | "skipped";
}

const SELLER = {
  company: "Resend",
  domain: "resend.com",
  icp: "Developer-first SaaS companies (Seed–Series B, 10–500 staff) sending transactional and product email, whose teams are frustrated with legacy ESP deliverability and DX.",
  positioning:
    "Resend is the email API for developers — a clean SDK, React Email templates, and first-class deliverability, built to replace clunky legacy ESPs.",
  valueProp:
    "ship transactional email in minutes with a modern API, React templates, and deliverability you can trust",
  personas: ["Head of Engineering", "Founder/CTO", "Head of Growth", "Lead Platform Engineer"],
};

const PROSPECTS: SeedProspect[] = [
  {
    company: "Cal.com", domain: "cal.com", industry: "Developer Tools", employeeCount: "51-200",
    location: "Remote", name: "Peer Richelsen", title: "Co-founder & CEO",
    emailUser: "founders", emailVerified: true, fitScore: 92, signalType: "funding",
    signalSummary: "Cal.com raised a $25M Series B to scale its scheduling platform.",
    signalUrl: "https://techcrunch.com/cal-com-series-b", stage: "replied",
  },
  {
    company: "Supabase", domain: "supabase.com", industry: "Developer Infrastructure", employeeCount: "201-500",
    location: "Remote", name: "Ant Wilson", title: "Co-founder & CTO",
    emailUser: "ant", emailVerified: true, fitScore: 90, signalType: "hiring",
    signalSummary: "Supabase is hiring 4 platform engineers — scaling notification + auth email volume.",
    signalUrl: "https://supabase.com/careers", stage: "contacted",
  },
  {
    company: "Raycast", domain: "raycast.com", industry: "Developer Tools", employeeCount: "51-200",
    location: "London, UK", name: "Thomas Paul Mann", title: "Co-founder & CEO",
    emailUser: "thomas", emailVerified: true, fitScore: 88, signalType: "news",
    signalSummary: "Raycast launched Raycast for Teams — new onboarding + billing email flows.",
    signalUrl: "https://raycast.com/blog/teams", stage: "qualified",
  },
  {
    company: "Linear", domain: "linear.app", industry: "Developer Tools", employeeCount: "51-200",
    location: "San Francisco, CA", name: "Karri Saarinen", title: "Co-founder & CEO",
    emailUser: "karri", emailVerified: true, fitScore: 86, signalType: "tech",
    signalSummary: "Linear shipped Customer Requests — more transactional email surface area.",
    signalUrl: "https://linear.app/changelog", stage: "qualified",
  },
  {
    company: "Trigger.dev", domain: "trigger.dev", industry: "Developer Infrastructure", employeeCount: "11-50",
    location: "Remote", name: "Matt Aitken", title: "Founder & CEO",
    emailUser: "matt", emailVerified: true, fitScore: 84, signalType: "funding",
    signalSummary: "Trigger.dev raised a $3M seed to grow its background-jobs platform.",
    signalUrl: "https://trigger.dev/blog/seed", stage: "enriched",
  },
  {
    company: "Resend competitor watch — Loops", domain: "loops.so", industry: "Marketing Email", employeeCount: "11-50",
    location: "Remote", name: "Chris Frantz", title: "Co-founder & CEO",
    emailUser: "chris", emailVerified: false, fitScore: 41, signalType: "post",
    signalSummary: "Loops is itself an email tool — overlapping category, weak fit as a buyer.",
    stage: "skipped",
  },
  {
    company: "Float", domain: "float.com", industry: "SaaS", employeeCount: "51-200",
    location: "Remote", name: "Glenn Rogers", title: "Co-founder",
    emailUser: "glenn", emailVerified: true, fitScore: 78, signalType: "hiring",
    signalSummary: "Float is hiring a platform engineer to own notifications infrastructure.",
    signalUrl: "https://float.com/careers", stage: "sourced",
  },
  {
    company: "Tinybird", domain: "tinybird.co", industry: "Data Infrastructure", employeeCount: "51-200",
    location: "Madrid, ES", name: "Jorge Sancha", title: "Co-founder & CEO",
    emailUser: "jorge", emailVerified: true, fitScore: 80, signalType: "job_change",
    signalSummary: "Tinybird hired a new Head of Growth — likely revisiting lifecycle email.",
    signalUrl: "https://www.linkedin.com/company/tinybird", stage: "sourced",
  },
];

function emailDraftFor(p: SeedProspect): { subject: string; body: string } {
  const first = p.name.split(" ")[0];
  const hook = p.signalSummary.replace(/\.$/, "");
  return {
    subject: `Quick idea for ${p.company.replace(/ —.*$/, "")}`,
    body: [
      `Hi ${first},`,
      "",
      `Saw ${hook}. As ${p.company.replace(/ —.*$/, "")} scales, transactional email DX and deliverability usually start to bite.`,
      "",
      `${SELLER.company} is the email API built for developers — clean SDK, React Email templates, deliverability you can trust. Worth a quick look to see if it'd help your team?`,
    ].join("\n"),
  };
}

export const seedOutboundDemo = mutation({
  args: {},
  handler: async (
    ctx,
  ): Promise<{
    conversationId: Id<"conversations">;
    campaignId: Id<"campaigns">;
    runId: Id<"runs">;
    prospects: number;
    emails: number;
  }> => {
    const now = Date.now();

    // 1. Conversation + the chat turn that "started" it.
    const conversationId = await ctx.db.insert("conversations", {
      title: "find customers for resend.com",
      lastIntent: "outbound",
      createdAt: now,
      lastMessageAt: now,
    });
    await ctx.db.insert("messages", {
      conversationId,
      role: "user",
      content: "find customers for resend.com",
      createdAt: now,
    });

    // 2. The active 24/7 campaign (this IS the standing watch).
    const campaignId = await ctx.db.insert("campaigns", {
      conversationId,
      company: SELLER.company,
      domain: SELLER.domain,
      description: SELLER.positioning,
      icp: SELLER.icp,
      positioning: SELLER.positioning,
      personas: SELLER.personas,
      valueProp: SELLER.valueProp,
      status: "active",
      autonomy: "review",
      cadenceMinutes: 60,
      createdAt: now,
    });

    // 3. The finished outbound run, board fully lit.
    const runId = await ctx.db.insert("runs", {
      conversationId,
      campaignId,
      input: SELLER.domain,
      inputType: "url",
      intent: "outbound",
      trigger: "chat",
      status: "complete",
      startedAt: now,
      deadlineAt: now + FANIN_DEADLINE_MS,
      company: SELLER.company,
      routedDomain: SELLER.domain,
      sourcedCount: PROSPECTS.length,
      qualifiedCount: PROSPECTS.filter((p) => p.fitScore >= 60).length,
      contactedCount: PROSPECTS.filter((p) =>
        ["contacted", "replied", "booked"].includes(p.stage),
      ).length,
    });
    for (const agent of ["sourcer", "qualifier", "writer"]) {
      await ctx.db.insert("agentStatus", {
        runId,
        agent,
        status: "done",
        note: "demo",
        startedAt: now,
        finishedAt: now,
      });
    }

    // 4. The brief.
    await ctx.db.insert("brief", {
      runId,
      icp: SELLER.icp,
      positioning: SELLER.positioning,
      generatedAt: now,
    });

    // 5. The assistant reply, linked to the run (so the canvas keys off it).
    await ctx.db.insert("messages", {
      conversationId,
      role: "assistant",
      content: `On it — sourced ${PROSPECTS.length} developer-tool companies that fit Resend's ICP, verified emails via Fiber, and drafted signal-grounded outreach. ${PROSPECTS.filter((p) => ["contacted", "replied", "booked"].includes(p.stage)).length} are already in motion; the rest are waiting for your approval on the canvas.`,
      intent: "outbound",
      runId,
      isStreaming: false,
      createdAt: now + 2,
    });

    // 6. Prospects + their email sequences + the events feed.
    let emailCount = 0;
    for (const p of PROSPECTS) {
      const fullEmail = `${p.emailUser}@${p.domain}`;
      const prospectId = await ctx.db.insert("prospects", {
        campaignId,
        runId,
        company: p.company.replace(/ —.*$/, ""),
        domain: p.domain,
        industry: p.industry,
        employeeCount: p.employeeCount,
        location: p.location,
        name: p.name,
        title: p.title,
        email: p.emailVerified ? fullEmail : undefined,
        emailVerified: p.emailVerified || undefined,
        linkedinUrl: `https://www.linkedin.com/company/${p.domain.split(".")[0]}`,
        signal: {
          type: p.signalType,
          summary: p.signalSummary,
          url: p.signalUrl,
          source: p.signalUrl ? new URL(p.signalUrl).hostname.replace(/^www\./, "") : "inferred",
          foundAt: now - 86_400_000,
        },
        fitScore: p.fitScore,
        fitReason:
          p.stage === "skipped"
            ? "Overlapping category — weak fit as a buyer."
            : `${p.title} with a live ${p.signalType} signal; strong ICP match.`,
        stage: p.stage,
        skipReason: p.stage === "skipped" ? "Below ICP fit threshold" : undefined,
        source: p.emailVerified ? "fiber" : "orangeslice",
        updatedAt: now,
      });

      await ctx.db.insert("events", {
        conversationId,
        runId,
        campaignId,
        prospectId,
        agent: "sourcer",
        kind: "sourced",
        message: `Sourced ${p.name}, ${p.title} at ${p.company.replace(/ —.*$/, "")}`,
        createdAt: now - 60_000 + emailCount * 1000,
      });

      // Email sequence by stage.
      if (["qualified", "contacted", "replied", "booked"].includes(p.stage)) {
        const draft = emailDraftFor(p);
        const isSent = ["contacted", "replied", "booked"].includes(p.stage);
        const isReplied = ["replied", "booked"].includes(p.stage);
        const status = isReplied
          ? "replied"
          : isSent
            ? "sent"
            : p.stage === "qualified" && p.fitScore >= 88
              ? "approved"
              : "draft";
        await ctx.db.insert("emails", {
          campaignId,
          prospectId,
          runId,
          step: 0,
          kind: "initial",
          subject: draft.subject,
          body: draft.body,
          signalRef: p.signalSummary,
          to: p.emailVerified ? fullEmail : undefined,
          status,
          sentAt: isSent ? now - 43_200_000 : undefined,
          replyBody: isReplied
            ? "Interesting timing — we've been hitting deliverability issues. Can you send a comparison vs our current ESP? Happy to find 20 min next week."
            : undefined,
          repliedAt: isReplied ? now - 3_600_000 : undefined,
          agentmailId: isSent ? `demo-${prospectId}` : undefined,
          createdAt: now - 86_400_000,
        });
        emailCount++;

        if (isReplied) {
          await ctx.db.insert("events", {
            conversationId, runId, campaignId, prospectId, agent: "follower",
            kind: "replied",
            message: `${p.company.replace(/ —.*$/, "")} replied — moved to Replied.`,
            createdAt: now - 3_600_000,
          });
        } else if (isSent) {
          await ctx.db.insert("events", {
            conversationId, runId, campaignId, prospectId, agent: "sender",
            kind: "sent",
            message: `Sent to ${fullEmail} · "${draft.subject}"`,
            createdAt: now - 43_200_000,
          });
        }

        // A follow-up draft for the contacted-but-silent Supabase.
        if (p.stage === "contacted") {
          await ctx.db.insert("emails", {
            campaignId,
            prospectId,
            runId,
            step: 1,
            kind: "followup",
            subject: `Re: ${draft.subject}`,
            body: `Hi ${p.name.split(" ")[0]},\n\nFloating this back up — happy to share a quick deliverability comparison vs your current setup. Worth 15 minutes?`,
            signalRef: p.signalSummary,
            to: fullEmail,
            status: "draft",
            createdAt: now,
          });
          emailCount++;
        }
      }
    }

    return {
      conversationId,
      campaignId,
      runId,
      prospects: PROSPECTS.length,
      emails: emailCount,
    };
  },
});
