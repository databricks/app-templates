import { readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import type { NodePlopAPI } from "plop";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const getTemplateDir = (type: string) =>
  path.join(__dirname, "templates", type);

export default function (plop: NodePlopAPI) {
  plop.setGenerator("package", {
    description: "Generate a new package",
    prompts: [
      {
        type: "input",
        name: "name",
        message: "Package name (e.g., auth)",
        validate: (value) => {
          if (!value) {
            return "Package name is required";
          }
          return true;
        },
      },
      {
        type: "list",
        name: "type",
        message: "Package type",
        choices: ["backend", "frontend"],
        validate: (value) => {
          if (!value) {
            return "Package type is required";
          }
          return true;
        },
      },
    ],
    actions(data) {
      if (!data?.type || !data?.name) {
        throw new Error("type or name is missing");
      }

      const type = data.type;
      const basePath = path.join(process.cwd(), "packages", type, data.name);
      const templateDir = getTemplateDir(type);
      return [
        {
          type: "add",
          path: `${basePath}/package.json`,
          templateFile: path.join(templateDir, "package.json.hbs"),
        },
        {
          type: "add",
          path: `${basePath}/tsconfig.json`,
          templateFile: path.join(templateDir, "tsconfig.json.hbs"),
        },
        {
          type: "add",
          path: `${basePath}/src/index.ts`,
          templateFile: path.join(templateDir, "index.ts.hbs"),
        },
        {
          type: "add",
          path: `${basePath}/src/index.test.ts`,
          templateFile: path.join(templateDir, "index.test.ts.hbs"),
        },
        // update the root tsconfig.json
        function updateTsConfig(answers) {
          const tsconfigPath = path.join(process.cwd(), "tsconfig.json");
          const tsconfig = JSON.parse(readFileSync(tsconfigPath, "utf-8"));

          const packageName = `@chat-template/${answers.name}`;
          const packagePath = [`packages/${answers.type}/${answers.name}/src`];

          // add the new path mapping
          if (!tsconfig.compilerOptions) {
            tsconfig.compilerOptions = {};
          }
          if (!tsconfig.compilerOptions.paths) {
            tsconfig.compilerOptions.paths = {};
          }

          // insert in sorted order
          const paths = tsconfig.compilerOptions.paths;
          const sortedPaths: Record<string, string[]> = {};
          const allKeys = [...Object.keys(paths), packageName].sort();

          for (const key of allKeys) {
            sortedPaths[key] = key === packageName ? packagePath : paths[key];
          }

          tsconfig.compilerOptions.paths = sortedPaths;

          // write back the updated tsconfig.json
          writeFileSync(
            tsconfigPath,
            `${JSON.stringify(tsconfig, null, 2)} \n`,
            "utf-8"
          );

          return `Updated tsconfig.json with path mapping for ${packageName}`;
        },
      ];
    },
  });
}
