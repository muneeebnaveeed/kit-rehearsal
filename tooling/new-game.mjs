import fs from "node:fs/promises";
import path from "node:path";

const teamName = process.argv[2];

if (!teamName) {
  console.error("Usage: node tooling/new-game.mjs <team-name>");
  process.exit(1);
}

const source = "server/template";
const destination = path.join("games", teamName);

try {
  await fs.access(destination);
  console.error(`Destination already exists: ${destination}`);
  process.exit(1);
} catch (error) {
  if (error.code !== "ENOENT") {
    throw error;
  }
}

await fs.cp(source, destination, { recursive: true });

const packagePath = path.join(destination, "package.json");
const packageJson = JSON.parse(await fs.readFile(packagePath, "utf8"));
packageJson.name = `@kit/${teamName}`;
await fs.writeFile(packagePath, `${JSON.stringify(packageJson, null, 2)}\n`);

console.log(`Created ${destination} from ${source}.`);
