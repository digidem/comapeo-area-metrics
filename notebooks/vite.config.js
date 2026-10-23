// Local preview and build only. notebook-kit resolves `observable:@gmaclennan/x`
// imports through api.observablehq.com, which only compiles Observable 1.0 style
// cells and drops the multi-declaration cells these notebooks rely on. This plugin
// serves the same notebooks from the local x.html files instead, as runtime
// modules in the shape that API would return. On observablehq.com the imports
// resolve natively and this file is not used.
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { JSDOM } from "jsdom";
import { deserialize, parseJavaScript, transpile } from "@observablehq/notebook-kit";

const PREFIX = "/@local-notebook/";
const API_IMPORT = /"https:\/\/api\.observablehq\.com\/@gmaclennan\/([\w-]+)\.js\?v=4"/g;
const parser = new new JSDOM("").window.DOMParser();

export default { plugins: [localNotebooks()] };

function localNotebooks() {
  let root;
  const notebookPath = (name) => resolve(root, `${name}.html`);
  return {
    name: "local-notebooks",
    configResolved(config) {
      root = config.root;
    },
    transform(code) {
      if (!code.includes("api.observablehq.com/@gmaclennan/")) return;
      // The API fallback drops multi-declaration cells, so a missing local copy is an error.
      return code.replace(API_IMPORT, (match, name) => {
        if (!existsSync(notebookPath(name))) this.error(`observable:@gmaclennan/${name} has no local ${name}.html`);
        return JSON.stringify(`${PREFIX}${name}.js`);
      });
    },
    resolveId(id) {
      if (id.startsWith(PREFIX)) return `\0${id}`;
    },
    load(id) {
      if (!id.startsWith(`\0${PREFIX}`)) return;
      const path = notebookPath(id.slice(PREFIX.length + 1, -3));
      this.addWatchFile(path);
      return defineModule(readFileSync(path, "utf8"));
    },
  };
}

// A notebook as an Observable runtime module definition, like api.observablehq.com
// returns: one variable per cell plus one per declared name.
function defineModule(html) {
  const imports = [];
  const definitions = [];
  for (const cell of deserialize(html, { parser }).cells) {
    if (!["js", "ojs", "ts"].includes(cell.mode)) continue;
    // `notebooks download` labels the platform's JavaScript cells as Observable JavaScript.
    if (cell.mode === "ojs") cell.mode = "js";
    const imported = observableImports(cell);
    if (imported) {
      for (const { name, specifiers } of imported) {
        const child = `child${imports.length}`;
        imports.push(`import ${child} from ${JSON.stringify(`${PREFIX}${name}.js`)};`);
        for (const [imported, alias] of specifiers)
          definitions.push(`main.import(${JSON.stringify(imported)}, ${JSON.stringify(alias)}, runtime.module(${child}));`);
      }
      continue;
    }
    let transpiled;
    try {
      transpiled = transpile(cell);
    } catch {
      continue;
    }
    if (transpiled.inputs.includes("@variable")) continue;
    const id = JSON.stringify(`cell ${cell.id}`);
    definitions.push(`main.variable(observer(${id})).define(${id}, ${JSON.stringify(transpiled.inputs)}, ${transpiled.body});`);
    for (const name of transpiled.outputs ?? []) {
      const key = JSON.stringify(name);
      definitions.push(`main.variable(observer(${key})).define(${key}, [${id}], (cell) => cell[${key}]);`);
    }
  }
  return `${imports.join("\n")}
export default function define(runtime, observer) {
  const main = runtime.module();
  // Cell-scoped builtins the runtime provides only to top-level notebooks.
  main.variable().define("view", ["Generators"], (Generators) => (element) => Generators.input(element));
  main.variable().define("display", [], () => (value) => value);
  ${definitions.join("\n  ")}
  return main;
}
`;
}

// For a cell made only of `import {…} from "observable:@gmaclennan/…"` statements, the
// notebook name and [imported, local] name pairs of each; otherwise null.
function observableImports(cell) {
  const statements = parseJavaScript(cell.value, cell.mode).body.body ?? [];
  const imports = statements.map((statement) => {
    const match = statement.type === "ImportDeclaration" && /^observable:@gmaclennan\/([\w-]+)$/.exec(statement.source.value);
    return match && { name: match[1], specifiers: statement.specifiers.map((s) => [s.imported.name, s.local.name]) };
  });
  return imports.length && imports.every(Boolean) ? imports : null;
}
