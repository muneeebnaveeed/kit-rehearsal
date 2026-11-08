import { Client } from "colyseus.js";

const botCount = Number.parseInt(process.argv[2] ?? "1", 10);
const roomName = process.argv[3] ?? "sample_room";
const serverUrl = process.argv[4] ?? "ws://localhost:2567";
const client = new Client(serverUrl);

async function spawnBot(botIndex) {
  await new Promise((resolve) => setTimeout(resolve, 50 * botIndex));

  try {
    const room = await client.joinOrCreate(roomName);
    console.log(`[bot ${botIndex}] joined room ${room.id}`);
    return room;
  } catch (error) {
    console.error(`[bot ${botIndex}] failed to join ${roomName}:`, error);
    return null;
  }
}

await Promise.all(
  Array.from({ length: Number.isFinite(botCount) ? Math.max(0, botCount) : 1 }, (_, index) =>
    spawnBot(index + 1),
  ),
);

// Keep the event loop alive without upsetting Node 24
setInterval(() => {}, 3600000);
