import { Client } from "colyseus.js";

export async function main(options: { endpoint: string; roomName: string }) {
  const client = new Client(options.endpoint);
  const room = await client.joinOrCreate(options.roomName);

  console.log(`[load] Client joined room ${room.roomId} successfully!`);

  room.onMessage("*", (type, _message) => {
    console.log(`[load] Message received - Type: ${String(type)}`);
  });

  room.onLeave((code) => {
    console.log(`[load] Client left room. Code: ${code}`);
  });

  return room;
}
