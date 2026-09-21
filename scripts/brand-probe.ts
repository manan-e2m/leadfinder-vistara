import { extractBrandFromSite } from "../src/lib/brand";

async function main() {
  for (const d of ["stripe.com", "vercel.com"]) {
    const b = await extractBrandFromSite(d);
    console.log("---", d, "---");
    console.log(JSON.stringify(b));
  }
}
main();
