import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

const DIR = "C:\\Users\\D\\mavis-fantasy-grinder\\docs\\shots";

function scan(s, name) {
  const problems = [];
  let i = 0;
  while (i < s.length) {
    const c = s[i];
    if (c === "<") {
      if (s.startsWith("<!--", i)) { const e = s.indexOf("-->", i); if (e < 0) { problems.push(["unclosed comment", i]); break; } i = e + 3; continue; }
      if (s.startsWith("<!", i)) { const e = s.indexOf(">", i); i = e < 0 ? s.length : e + 1; continue; }
      const end = s.indexOf(">", i);
      if (end < 0) { problems.push(["unclosed tag", i, s.slice(i, i + 80)]); break; }
      let tag = s.slice(i + 1, end);
      const closing = tag.startsWith("/");
      if (closing) tag = tag.slice(1);
      tag = tag.replace(/\/$/, "");
      const nameMatch = /^([A-Za-z_:][A-Za-z0-9_.:-]*)/.exec(tag);
      if (!nameMatch) { problems.push(["bad tag name", i, JSON.stringify(tag.slice(0, 60))]); i = end + 1; continue; }
      const rest = tag.slice(nameMatch[1].length);
      if (rest.trim() !== "") {
        const attrRe = /\s+([A-Za-z_:][A-Za-z0-9_.:-]*)\s*(?:=\s*("([^"]*)"|'([^']*)'|([^\s"'>]+)))?/g;
        let m, consumed = 0, count = 0;
        while ((m = attrRe.exec(rest)) !== null) {
          if (m.index !== consumed) {
            const gap = rest.slice(consumed, m.index);
            if (gap.trim() !== "") problems.push(["gap in attrs", i, nameMatch[1], JSON.stringify(gap)]);
          }
          consumed = m.index + m[0].length;
          count++;
        }
        const tail = rest.slice(consumed);
        if (tail.trim() !== "") problems.push(["unparsed tail", i, nameMatch[1], JSON.stringify(tail.slice(0, 80))]);
        if (count === 0) problems.push(["attrs on tag", i, nameMatch[1], JSON.stringify(rest.slice(0, 80))]);
      }
      i = end + 1;
    } else {
      const next = s.indexOf("<", i);
      const text = s.slice(i, next < 0 ? s.length : next);
      const amp = /&(?!(amp|lt|gt|quot|apos|#\d+|#x[0-9a-fA-F]+);)/.exec(text);
      if (amp) problems.push(["raw ampersand", i + amp.index, JSON.stringify(text.slice(Math.max(0, amp.index - 40), amp.index + 40))]);
      if (next < 0) break;
      i = next;
    }
  }
  return problems;
}

for (const f of readdirSync(DIR).filter(x => x.endsWith(".svg")).sort()) {
  const s = readFileSync(join(DIR, f), "utf8");
  const p = scan(s, f);
  if (p.length) {
    console.log("=== " + f + " -> " + p.length + " problems");
    for (const q of p.slice(0, 8)) console.log("   ", JSON.stringify(q));
  } else {
    console.log("=== " + f + " -> clean");
  }
}