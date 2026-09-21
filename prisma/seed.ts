/**
 * Seed data for local development and the event dry-run.
 *
 * Three things get seeded:
 *   1. RegisteredAttendee — the events-team export. Every registered agency
 *      is pre-run and hand-QA'd weeks out (see scripts/precompute.ts), so on
 *      the day they get an instant, correct result. Plan §6.7, §12.1
 *   2. DoNotContact — honored across every workspace. Plan §10 (CCPA/CPRA)
 *   3. A demo Workspace so `npm run dev` has something to click immediately.
 *
 * Idempotent: safe to run repeatedly. `npm run db:reset` wipes and re-seeds.
 */
import { PrismaClient } from "@prisma/client";

const db = new PrismaClient();

const REGISTERED = [
  { agencyName: "Harbor & Oak Digital", website: "harborandoak.com", email: "owner@harborandoak.com" },
  { agencyName: "Tidewater Marketing", website: "tidewatermktg.com", email: "coo@tidewatermktg.com" },
  { agencyName: "Northlight Studio", website: "northlightstudio.co", email: "hello@northlightstudio.co" },
  { agencyName: "Bright Anvil Media", website: "brightanvil.com", email: "team@brightanvil.com" },
  { agencyName: "Cedar Peak Growth", website: "cedarpeakgrowth.com", email: "ops@cedarpeakgrowth.com" },
  { agencyName: "Ridgeline Commerce", website: "ridgelinecommerce.com", email: "founder@ridgelinecommerce.com" },
  { agencyName: "Beacon Street Agency", website: "beaconstreet.agency", email: "hi@beaconstreet.agency" },
  { agencyName: "Lantern Local", website: "lanternlocal.com", email: "grow@lanternlocal.com" },
];

const DO_NOT_CONTACT = [
  { domain: "example-optout.com", reason: "Opt-out request received 2026-08-01" },
  { phone: "+15555550100", reason: "Opt-out request received 2026-08-14" },
  { email: "no-contact@privacyfirst.io", reason: "CCPA deletion request" },
];

async function main() {
  console.log("Seeding LeadFinder…");

  for (const r of REGISTERED) {
    const existing = await db.registeredAttendee.findFirst({ where: { website: r.website } });
    if (existing) {
      await db.registeredAttendee.update({ where: { id: existing.id }, data: r });
    } else {
      await db.registeredAttendee.create({ data: { ...r, status: "pending" } });
    }
  }
  console.log(`  ✓ ${REGISTERED.length} registered attendees`);

  for (const d of DO_NOT_CONTACT) {
    const where = d.domain ? { domain: d.domain } : d.phone ? { phone: d.phone } : { email: d.email };
    const existing = await db.doNotContact.findFirst({ where });
    if (!existing) await db.doNotContact.create({ data: d });
  }
  console.log(`  ✓ ${DO_NOT_CONTACT.length} do-not-contact entries`);

  const demoDomain = "harborandoak.com";
  await db.workspace.upsert({
    where: { domain: demoDomain },
    update: { agencyName: "Harbor & Oak Digital" },
    create: { domain: demoDomain, agencyName: "Harbor & Oak Digital" },
  });
  console.log(`  ✓ demo workspace (${demoDomain})`);

  console.log("Done. Try: npm run dev → http://localhost:3100");
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => db.$disconnect());
