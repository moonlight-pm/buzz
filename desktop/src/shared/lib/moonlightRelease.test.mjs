import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { formatMoonlightAppVersion } from "./moonlightRelease.ts";

describe("formatMoonlightAppVersion", () => {
  it("appends the moonlight label to a semver", () => {
    assert.equal(formatMoonlightAppVersion("0.5.14"), "0.5.14-moonlight");
  });

  it("does not double-suffix an already labeled version", () => {
    assert.equal(
      formatMoonlightAppVersion("0.5.14-moonlight"),
      "0.5.14-moonlight",
    );
  });

  it("leaves unknown and empty versions untouched", () => {
    assert.equal(formatMoonlightAppVersion("unknown"), "unknown");
    assert.equal(formatMoonlightAppVersion(""), "");
  });
});
