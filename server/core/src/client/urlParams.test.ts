import { describe, expect, it } from "vitest";
import { generateRoomCode, ROOM_CODE_ALPHABET, ROOM_CODE_LENGTH } from "../server/roomCodes.ts";
import { buildInviteLink, normalizeRoomCode, readClientParams, serverUrlFromPage } from "./urlParams.ts";

describe("normalizeRoomCode", () => {
  it("uppercases and trims a valid code", () => {
    expect(normalizeRoomCode(" qxtr ")).toBe("QXTR");
  });

  it("rejects codes with the wrong length or characters", () => {
    expect(normalizeRoomCode("QXT")).toBeNull();
    expect(normalizeRoomCode("QXTRA")).toBeNull();
    expect(normalizeRoomCode("QX1R")).toBeNull();
    expect(normalizeRoomCode("")).toBeNull();
  });

  it("rejects I and O, which the server never puts in a code", () => {
    expect(normalizeRoomCode("QOTR")).toBeNull();
    expect(normalizeRoomCode("qitr")).toBeNull();
    expect(readClientParams("?room=QOTR").room).toBeNull();
  });

  it("accepts every letter the server uses, and only those", () => {
    for (const letter of "ABCDEFGHIJKLMNOPQRSTUVWXYZ") {
      const code = letter.repeat(ROOM_CODE_LENGTH);
      const expected = ROOM_CODE_ALPHABET.includes(letter) ? code : null;
      expect(normalizeRoomCode(code)).toBe(expected);
    }
  });

  it("accepts codes the server generates", () => {
    let seed = 1;
    const random = (): number => {
      seed = (seed * 16807) % 2147483647;
      return seed / 2147483647;
    };
    for (let i = 0; i < 200; i++) {
      const code = generateRoomCode(() => false, random);
      expect(normalizeRoomCode(code)).toBe(code);
    }
  });
});

describe("readClientParams", () => {
  it("reads room, name, scenario and debug", () => {
    expect(readClientParams("?room=qxtr&name=Ada&scenario=crowded&debug=1")).toEqual({
      room: "QXTR",
      name: "Ada",
      scenario: "crowded",
      debug: true,
    });
  });

  it("returns nulls and debug off when nothing is set", () => {
    expect(readClientParams("")).toEqual({ room: null, name: null, scenario: null, debug: false });
  });

  it("ignores an invalid room code and empty values", () => {
    expect(readClientParams("?room=nope!&name=&scenario=")).toEqual({
      room: null,
      name: null,
      scenario: null,
      debug: false,
    });
  });

  it("treats debug without a value, or true, as on, and 0 or false as off", () => {
    expect(readClientParams("?debug").debug).toBe(true);
    expect(readClientParams("?debug=true").debug).toBe(true);
    expect(readClientParams("?debug=0").debug).toBe(false);
    expect(readClientParams("?debug=false").debug).toBe(false);
  });

  it("trims and limits the player name", () => {
    expect(readClientParams(`?name=${"x".repeat(40)}`).name).toHaveLength(24);
    expect(readClientParams("?name=%20Ada%20").name).toBe("Ada");
  });
});

describe("buildInviteLink", () => {
  it("keeps the page and replaces only the room", () => {
    expect(buildInviteLink("https://game.example/play?room=AAAA&name=Ada#top", "QXTR")).toBe(
      "https://game.example/play?room=QXTR",
    );
  });
});

describe("serverUrlFromPage", () => {
  it("is the origin for a page at the root", () => {
    expect(serverUrlFromPage("https://game.example/")).toBe("https://game.example");
    expect(serverUrlFromPage("https://game.example/index.html")).toBe("https://game.example");
    expect(serverUrlFromPage("http://localhost:2567/")).toBe("http://localhost:2567");
  });

  it("keeps the path a game is served under, without a trailing slash", () => {
    expect(serverUrlFromPage("https://game.example/team-2/")).toBe("https://game.example/team-2");
    expect(serverUrlFromPage("https://game.example/team-2/index.html")).toBe("https://game.example/team-2");
  });

  it("ignores the query string and the hash", () => {
    expect(serverUrlFromPage("https://game.example/team-2/?room=QXTR#top")).toBe(
      "https://game.example/team-2",
    );
    expect(serverUrlFromPage("https://game.example/?room=QXTR")).toBe("https://game.example");
  });

  it("climbs out of folders for a page below the server root", () => {
    expect(serverUrlFromPage("https://game.example/team-4/multiplayer/", 1)).toBe(
      "https://game.example/team-4",
    );
    expect(serverUrlFromPage("https://game.example/multiplayer/index.html", 1)).toBe("https://game.example");
  });

  it("never climbs above the origin", () => {
    expect(serverUrlFromPage("https://game.example/", 3)).toBe("https://game.example");
  });

  it("agrees with buildInviteLink about which page it is on", () => {
    const page = "https://game.example/team-2/?room=ABCD";
    expect(buildInviteLink(page, "QXTR")).toBe(`${serverUrlFromPage(page)}/?room=QXTR`);
  });
});
