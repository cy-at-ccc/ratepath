// Quick verification of the 12 q3×q4 combinations in directional mode,
// plus 3 in flat mode. Total 15 paths.

function deriveMediumDirection(shortOutlook, mediumOutlook) {
  if (!shortOutlook || !mediumOutlook) return 0;
  if (shortOutlook === "flat") {
    if (mediumOutlook === "rise") return +0.6;
    if (mediumOutlook === "fall") return -0.6;
    return 0;
  }
  const tier = shortOutlook.endsWith("strong") ? 1 : 0;
  const rise = shortOutlook.startsWith("rise");
  const baseMag = tier === 1 ? 1.0 : 0.6;
  const sign = rise ? 1 : -1;
  if (mediumOutlook === "reverse")  return -sign * baseMag * 0.6;
  if (mediumOutlook === "continue") return  sign * baseMag;
  if (mediumOutlook === "slow")     return  sign * baseMag * 0.4;
  return 0;
}

const cases = [
  ["fall-strong", "continue"], ["fall-strong", "slow"], ["fall-strong", "reverse"],
  ["fall",        "continue"], ["fall",        "slow"], ["fall",        "reverse"],
  ["flat",        "rise"],     ["flat",        "flat"], ["flat",        "fall"],
  ["rise",        "continue"], ["rise",        "slow"], ["rise",        "reverse"],
  ["rise-strong", "continue"], ["rise-strong", "slow"], ["rise-strong", "reverse"]
];

console.log("q3 × q4 → mediumTermDirection\n");
for (const [q3, q4] of cases) {
  const v = deriveMediumDirection(q3, q4);
  const sign = v >= 0 ? "+" : "";
  console.log(`  ${q3.padEnd(12)} × ${q4.padEnd(8)} → ${sign}${v.toFixed(2)}`);
}
