import test from "node:test";
import assert from "node:assert/strict";
import {availableModels, probability} from "../src/predictionModels.ts";

test("old weeks expose only models actually archived", () => {
  const old = {home_win_prob_v4_a: .6, home_win_prob_v4_qb_plus: .4};
  assert.deepEqual(availableModels([old], true), ["v4_a", "v4_qb_plus"]);
  assert.throws(() => probability(old, "v5_boosted"));
});
test("new weeks show three models without silently substituting probabilities", () => {
  const game = {home_win_prob_v4_a: .6, home_win_prob_v4_qb_plus: .4,
                home_win_prob_v5_qb_plus: .7, home_win_prob_v5_boosted: .8};
  assert.deepEqual(availableModels([game]), ["v5_qb_plus", "v5_boosted", "v4_a"]);
  assert.equal(probability(game, "v5_boosted"), .8);
  assert.equal(probability(game, "v5_qb_plus"), .7);
  assert.equal(probability(game, "v4_a"), .6);
});
