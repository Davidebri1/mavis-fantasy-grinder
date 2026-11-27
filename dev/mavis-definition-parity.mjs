#!/usr/bin/env node
/**
 * mavis-definition-parity.mjs - the definitions are stated three times: in
 * the harness comment block, in the harness DEFINITIONS object, and in the
 * JSON the harness writes. They must agree word for word, or the evaluation
 * document is describing something the data does not say.
 *
 * node dev/mavis-definition-parity.mjs
 */

import { readFileSync, existsSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(HERE, "..");
const HARNESS = join(ROOT, "frontend", "react", "scripts", "mavis-projection-evaluation.mjs");
const JSON_OUT = join(ROOT, "frontend", "react", ".tmp-audit", "projection-evaluation.json");

const LOW_SAMPLE_N = Number(process.env.MAVIS_LOW_SAMPLE_N ?? 30);

function fail(message) {
  console.error("FAIL: " + message);
  process.exitCode = 1;
}

const source = readFileSync(HARNESS, "utf8");

// 1. the comment block
const start = source.indexOf(" * DEFINITIONS (authoritative");
const end = source.indexOf(" * USAGE");
if (start < 0 || end < 0) {
  fail("the definitions comment block was not found in the harness");
  process.exit(1);
}
const block = source.slice(start, end);
const fromComment = {};
for (const line of block.split(/\r?\n/)) {
  const m = line.match(/^\s*\*\s*([a-zA-Z]+):\s*(.+)$/);
  if (m) fromComment[m[1]] = m[2];
}

// 2. the DEFINITIONS object
const objStart = source.indexOf("const DEFINITIONS = {");
const objEnd = source.indexOf("\n};", objStart);
if (objStart < 0 || objEnd < 0) {
  fail("the DEFINITIONS object was not found in the harness");
  process.exit(1);
}
const objText = source.slice(objStart + "const DEFINITIONS = ".length, objEnd + 2);
let fromObject = {};
try {
  fromObject = new Function("LOW_SAMPLE_N", "return (" + objText + ")")(LOW_SAMPLE_N);
} catch (err) {
  fail("the DEFINITIONS object could not be evaluated: " + err.message);
  process.exit(1);
}

// 3. the JSON the harness wrote
let fromJson = null;
if (existsSync(JSON_OUT)) {
  fromJson = JSON.parse(readFileSync(JSON_OUT, "utf8")).definitions ?? null;
} else {
  console.log("NOTE: " + JSON_OUT + " not found - the JSON block was not checked.");
}

const keys = new Set([
  ...Object.keys(fromComment),
  ...Object.keys(fromObject),
  ...(fromJson ? Object.keys(fromJson) : []),
]);
let mismatches = 0;
for (const key of [...keys].sort()) {
  const a = fromComment[key];
  const b = fromObject[key];
  const c = fromJson ? fromJson[key] : undefined;
  if (a === undefined || b === undefined || a !== b || (fromJson && b !== c)) {
    mismatches++;
    console.error("MISMATCH " + key);
    if (a !== b) {
      console.error("  comment: " + JSON.stringify(a));
      console.error("  object : " + JSON.stringify(b));
    }
    if (fromJson && b !== c) {
      console.error("  json   : " + JSON.stringify(c));
    }
  }
}
if (mismatches > 0) {
  fail(mismatches + " definition(s) differ between the comment block, the object and the JSON");
} else {
  console.log("PASS: " + keys.size + " definitions match word for word across the comment block, the DEFINITIONS object" +
    (fromJson ? " and the JSON." : "."));
}
