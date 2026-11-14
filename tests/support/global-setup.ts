import "./env";
import { migrate } from "../../scripts/migrate";
import { closeSql } from "../../src/lib/db/client";

export default async function setup() {
  await migrate(false);
  await closeSql();
}
