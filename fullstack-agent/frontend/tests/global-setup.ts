import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const REPO_ROOT = fileURLToPath(new URL("../..", import.meta.url));
const WRITE_PRIVILEGES = ["ALL_PRIVILEGES", "MODIFY"];

type EffectivePrivileges = { privilege_assignments?: { privileges: { privilege: string }[] }[] };

function cli(...args: string[]) {
  return JSON.parse(execFileSync("databricks", [...args, "-o", "json"], { cwd: REPO_ROOT, encoding: "utf8" }));
}

/** Fail if suite identity holds catalog-wide write privilege; updates should be blocked by Unity Catalog. */
function requireUserPrivileges(): void {
  const variables = cli("bundle", "validate").variables;
  const catalog: string = variables.catalog.value;
  const user: string = process.env.APP_TOKEN ? variables.test_user_one_id.value : cli("current-user", "me").userName;
  const effective: EffectivePrivileges = cli("grants", "get-effective", "catalog", catalog, "--principal", user);
  const held = (effective.privilege_assignments ?? []).flatMap((assignment) => assignment.privileges.map((grant) => grant.privilege));
  const extra = held.filter((privilege) => WRITE_PRIVILEGES.includes(privilege));
  if (extra.length > 0) {
    throw new Error(
      `${user} holds ${extra.join(", ")} on catalog ${catalog}, so the agent's update would change the data. Revoke them, keeping MANAGE and USE_CATALOG for a person, then run the tests again.`,
    );
  }
}

/** Check privileges, then reset data. Each run needs fresh seed data. */
export default function globalSetup(): void {
  requireUserPrivileges();
  execFileSync("databricks", ["bundle", "run", "reset_data"], { cwd: REPO_ROOT, stdio: "inherit" });
}
