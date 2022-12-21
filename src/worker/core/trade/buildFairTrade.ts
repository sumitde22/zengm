import type { Result } from "regression";
import { groupBy } from "../../../common/groupBy";
import type { TradePickValues } from "src/common/types";
import { g, helpers, local } from "../../util";
import { idb } from "../../db";
import team from "../team";

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

		const teamOvrs: {
			tid: number;
			ovr: number;
		}[] = [];
		for (const [tidString, players] of Object.entries(playersByTid)) {
			const tid = parseInt(tidString);
			const ovr = team.ovr(
				players.map(p => ({
					pid: p.pid,
					value: p.value,
					ratings: {
						ovr: p.ratings.at(-1)!.ovr,
						ovrs: p.ratings.at(-1)!.ovrs,
						pos: p.ratings.at(-1)!.pos,
					},
				})),
				{
					fast: true,
				},
			);

			teamOvrs.push({ tid, ovr });
		}

		teamOvrs.sort((a, b) => b.ovr - a.ovr);
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
