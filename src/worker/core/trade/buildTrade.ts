import type { DataPoint, Result } from "regression";
import { groupBy } from "../../../common/groupBy";
import type { TradePickValues, TradeTeams } from "src/common/types";
import { g, helpers, local } from "../../util";
import { idb } from "../../db";
import team from "../team";
import trade from ".";
import regression from "regression";

// updated once per season
let cache: {
	cacheKey: number;
	// an equation to map from a team ovr to an ovr rank among league
	// changed at the beginning of each season so it accurate models the distribution of the present league
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

		const teamRanks: DataPoint[] = teamOvrs.map((team, index) => [
			team.ovr,
			index + 1,
		]);
		// generate a function using linear regression that maps team ovr -> estimated team rank
		const ovrToRankModel = regression.linear(teamRanks);

		cache = {
			cacheKey: season,
			ovrToRankModel,
			estValues: await trade.getPickValues(),
		};
	}
};

const buildTrade = async (
	teams: TradeTeams,
	holdUserConstant: boolean,
	maxAssetsToAdd = Infinity,
): Promise<TradeTeams | undefined> => {
	await refreshCache();
	// note: value initially calculated in updateValues
	const tradedPlayerValues = [
		await Promise.all(
			teams[0].pids.map(async pid => {
				const p = await idb.cache.players.get(pid);
				return { pid, value: p!.value };
			}),
		),
		await Promise.all(
			teams[1].pids.map(async pid => {
				const p = await idb.cache.players.get(pid);
				return { pid, value: p!.value };
			}),
		),
	];
	const totalValuePlayers = [0, 0];
	const tradedDraftPicks = [{}, {}];
	const totalValueDraftPicks = [{}, {}];
	// invariant: user team/proposing team will always be teams[0]
	return;
};

// add assets from trade proposer until proposer assets value > receiver assets value
// using forward selection, always add asset that will push the trade value the smallest amount above 0
// and biggest asset otherwise if said asset doesn't exist
const addProposerAssets = async (
	teams: TradeTeams,
	holdUserConstant: boolean,
	maxAssetsToAdd = Infinity,
): Promise<TradeTeams | undefined> => {
	return;
};

// add assets from trade receiver to miminize positive value of proposer assets value - receiver assets value
// using forward selection, add biggest asset that does not cause receiver assets value > proposer assets value
const addReceiverAssets = async (
	teams: TradeTeams,
	holdUserConstant: boolean,
	maxAssetsToAdd = Infinity,
) => {};

// Source: https://stackoverflow.com/questions/55725139/fit-sigmoid-function-s-shape-curve-to-data-using-python
// This curve models specifically a mapping from win % to estimated draft pick based on simulation of 30 BBGM seasons
// Different curves could be generated for other sports as well, and the parameters below could be decided based on sport
const winPToPick = (winP: number) => {
	const L = 1.0687820005007198;
	const x0 = 0.4878517508315021;
	const k = 10.626956987806935;
	const b = -0.038756647038824504;
	// without multiplying numActiveTeams, the equation returns a val
	// representing position in draft as a decimal between 0 to 1
	// numDraftsPickPerRound scales this equation so it ports across leagues with different numbers of team
	const numDraftPicksPerRound = g.get("numActiveTeams");
	const projectedPick =
		numDraftPicksPerRound * (L / (1 + Math.exp(-k * (winP - x0))) + b);
	return helpers.bound(projectedPick, 1, numDraftPicksPerRound);
};

export default buildTrade;
