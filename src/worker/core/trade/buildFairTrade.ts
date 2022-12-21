import type { Result } from "regression";
import { groupBy } from "../../../common/groupBy";
import type { TradePickValues } from "src/common/types";
import { g, helpers, local } from "../../util";
import { idb } from "../../db";

let cache: {
	cacheKey: number;
	ovrToRankModel: Result;
	estValues: TradePickValues;
};

const refreshCache = async () => {
	const season = g.get("season");
	if (cache === undefined || cache.cacheKey != season) {
		const playersByTid = groupBy(
			await idb.cache.players.indexGetAll("playersByTid", [0, Infinity]),
			"tid",
		);
	}
};

const buildFairTrade = () => {
	refreshCache();
};

// Source: https://stackoverflow.com/questions/55725139/fit-sigmoid-function-s-shape-curve-to-data-using-python
// This curve models specifically a mapping from win % to estimated draft pick based on simulation of 30 BBGM seasons
// Different curves could be generated for other sports as well, and the parameters below could be decided based on sport
const winPToPick = (winP: number) => {
	const L = 1.0687820005007198;
	const x0 = 0.4878517508315021;
	const k = 10.626956987806935;
	const b = -0.038756647038824504;
	return g.get("numActiveTeams") * (L / (1 + Math.exp(-k * (winP - x0))) + b);
};

export default buildFairTrade;
