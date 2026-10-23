#!/usr/bin/env node
// Formats the JavaScript and TypeScript cells of notebook files with prettier and
// writes each file back in notebook-kit's normal form.
// Usage: node notebooks/scripts/format-notebook.mjs <notebook.html>...
import { readFileSync, writeFileSync } from "node:fs";
import { JSDOM } from "jsdom";
import {
  deserialize,
  serialize,
  maybeParseJavaScript,
} from "@observablehq/notebook-kit";
import * as prettier from "prettier";

const PARSER = { js: "babel", ts: "typescript" };

const { window } = new JSDOM("");
const parser = new window.DOMParser();

for (const file of process.argv.slice(2)) {
  const notebook = deserialize(readFileSync(file, "utf8"), { parser });
  for (const cell of notebook.cells) {
    if (!(cell.mode in PARSER)) continue;
    // An expression cell displays its value; prettier's trailing semicolon would
    // turn it into a program cell that displays nothing.
    const isExpression = maybeParseJavaScript(cell.value, cell.mode)?.expression;
    let value = await prettier.format(cell.value, { parser: PARSER[cell.mode] });
    value = value.trimEnd();
    if (isExpression) value = value.replace(/;$/, "");
    cell.value = value;
  }
  writeFileSync(file, serialize(notebook, { document: window.document }));
  console.log(`formatted ${file}`);
}
