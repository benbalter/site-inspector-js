module.exports = {
  // Hold back upgrades that break installed packages' peer ranges (e.g. TypeScript 7
  // until typescript-eslint supports it).
  peer: true,
  // wappalyzer-core 7.x is a tombstone whose entry point logs a deprecation notice and
  // calls process.exit(1). 6.10.66 is the last working release; fingerprints come from
  // enthec/webappanalyzer via scripts/update-fingerprints.sh.
  reject: ["wappalyzer-core"],
};
